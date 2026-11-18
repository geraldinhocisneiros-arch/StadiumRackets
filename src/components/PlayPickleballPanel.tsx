// Painel "Play pickleball" na tela de uma locação de quadra de pickleball.
//
// Regra: o valor da quadra é dividido pelo número de pessoas que jogaram.
// Cada aluno com Play disponível no mês não paga a sua parte (gasta 1 play);
// quem não tem play (convidado, aluno sem pacote ou que já usou os 4) paga a
// sua parte. Convidado sem cadastro entra só pela quantidade: a parte dele
// vira um lançamento avulso.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/format";
import { courtShort } from "@/lib/court-map";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payment-methods";
import { fetchPlayBalances, playMonthOf, type PlayBalance } from "@/lib/play-pickleball";
import { longMonthRef } from "@/lib/mensalidade";

function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rest ? 1 : 0)) / 100);
}

interface Payer {
  method: string;
  /** Lança a parte como débito na conta corrente (paga depois). */
  toAccount: boolean;
}

export function PlayPickleballPanel({
  bookingId,
  bookingDate,
  court,
  startTime,
  endTime,
  players,
  courtPrice,
  payCategoryId,
  onDone,
}: {
  bookingId: string;
  bookingDate: string;
  court: number;
  startTime: string;
  endTime: string;
  /** Jogadores cadastrados da locação (titular + participantes). */
  players: { id: string; name: string }[];
  /** Valor cheio da quadra (tabela de preços, sem desconto). */
  courtPrice: number;
  /** Categoria dos lançamentos de quem paga a sua parte (aluguel de quadra). */
  payCategoryId: string | null;
  onDone: () => void;
}) {
  const month = playMonthOf(bookingDate);
  const [balances, setBalances] = useState<Record<string, PlayBalance>>({});
  const [usedHere, setUsedHere] = useState<Set<string>>(new Set());
  const [paymentsHere, setPaymentsHere] = useState(0);
  const [loading, setLoading] = useState(true);
  const [usePlay, setUsePlay] = useState<Record<string, boolean>>({});
  const [payers, setPayers] = useState<Record<string, Payer>>({});
  const [guests, setGuests] = useState("0");
  const [guestMethod, setGuestMethod] = useState("");
  const [price, setPrice] = useState(courtPrice > 0 ? courtPrice.toFixed(2) : "");
  const [saving, setSaving] = useState(false);

  const playerKey = players.map((p) => p.id).join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ids = players.map((p) => p.id);
      const [bal, used, pays] = await Promise.all([
        fetchPlayBalances(ids, month),
        supabase.from("pickleball_play_usage").select("client_id").eq("booking_id", bookingId),
        supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("booking_id", bookingId),
      ]);
      if (cancelled) return;
      setBalances(bal);
      const here = new Set((used.data ?? []).map((r) => r.client_id));
      setUsedHere(here);
      setPaymentsHere(pays.count ?? 0);
      // Marca "usar play" por padrão para quem tem play sobrando.
      const def: Record<string, boolean> = {};
      for (const id of ids) {
        const b = bal[id];
        def[id] = !here.has(id) && !!b && b.total - b.used > 0;
      }
      setUsePlay(def);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, month, playerKey]);

  useEffect(() => {
    if (courtPrice > 0) setPrice(courtPrice.toFixed(2));
  }, [courtPrice]);

  const guestCount = Math.max(0, Math.floor(Number(guests) || 0));
  const total = Math.round((Number(price.replace(",", ".")) || 0) * 100) / 100;
  const people = players.length + guestCount;
  const shares = useMemo(() => splitEvenly(total, people), [total, people]);
  const shareOf = (i: number) => shares[i] ?? 0;
  const guestShare = shares.slice(players.length).reduce((s, v) => s + v, 0);

  const remaining = (id: string) => {
    const b = balances[id];
    return b ? b.total - b.used : 0;
  };
  const payer = (id: string): Payer => payers[id] ?? { method: "", toAccount: false };
  const patchPayer = (id: string, patch: Partial<Payer>) =>
    setPayers((m) => ({ ...m, [id]: { ...payer(id), ...patch } }));

  const playUsers = players.filter((p) => usePlay[p.id] && !usedHere.has(p.id));
  const payingPlayers = players.filter((p) => !usePlay[p.id] && !usedHere.has(p.id));
  const toCharge = payingPlayers.reduce((s, p) => s + shareOf(players.indexOf(p)), 0) + guestShare;

  const submit = async () => {
    if (people === 0) return toast.error("Informe quem jogou.");
    if (total <= 0) return toast.error("Informe o valor da quadra.");
    for (const p of payingPlayers) {
      const v = payer(p.id);
      if (shareOf(players.indexOf(p)) > 0 && !v.method && !v.toAccount) {
        return toast.error(
          `Escolha a forma de pagamento de ${p.name} ou marque "Débito na conta".`,
        );
      }
    }
    if (guestCount > 0 && !guestMethod) {
      return toast.error("Escolha a forma de pagamento dos convidados.");
    }
    setSaving(true);
    // Usuário logado agora (computador da recepção é compartilhado).
    const { data: freshUser } = await supabase.auth.getUser();
    const recordedBy = freshUser.user?.id ?? null;
    const paidAt = new Date().toISOString();
    const notes = `Play pickleball · ${courtShort(court)} · ${startTime.slice(0, 5)}–${endTime.slice(0, 5)} · dividido em ${people}`;
    const base = {
      category_id: payCategoryId,
      paid_at: paidAt,
      court,
      start_time: startTime,
      end_time: endTime,
      booking_id: bookingId,
      recorded_by: recordedBy,
    };
    const rows = [
      ...payingPlayers
        .filter((p) => shareOf(players.indexOf(p)) > 0)
        .map((p) => {
          const v = payer(p.id);
          return {
            ...base,
            client_id: p.id,
            amount: shareOf(players.indexOf(p)),
            method: (v.method || "outro") as never,
            received: !v.toAccount,
            to_account: v.toAccount,
            account_direction: v.toAccount ? "debito" : null,
            notes,
          };
        }),
      ...(guestCount > 0 && guestShare > 0
        ? [
            {
              ...base,
              client_id: null,
              amount: Math.round(guestShare * 100) / 100,
              method: guestMethod as never,
              received: true,
              to_account: false,
              account_direction: null,
              notes: `${notes} · ${guestCount} convidado(s) sem cadastro`,
            },
          ]
        : []),
    ];

    if (playUsers.length > 0) {
      const { error } = await supabase
        .from("pickleball_play_usage")
        .insert(
          playUsers.map((p) => ({
            client_id: p.id,
            booking_id: bookingId,
            reference_month: month,
          })),
        );
      if (error) {
        setSaving(false);
        return toast.error(`Não consegui registrar o play: ${error.message}`);
      }
    }
    if (rows.length > 0) {
      const { error } = await supabase.from("payments").insert(rows);
      if (error) {
        setSaving(false);
        return toast.error(
          `Plays registrados, mas falhou o lançamento no caixa: ${error.message}. Lance a parte de quem pagou pelo Caixa.`,
        );
      }
    }
    setSaving(false);
    toast.success(
      `${playUsers.length} play(s) usado(s)` +
        (rows.length > 0 ? ` · ${fmtBRL(toCharge)} lançado(s) no caixa` : ""),
    );
    onDone();
  };

  if (loading) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">Carregando plays...</div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
      <div>
        <div className="text-sm font-medium">Play pickleball — {longMonthRef(month)}</div>
        <p className="text-xs text-muted-foreground">
          O valor da quadra é dividido por todos que jogaram. Quem usa play não paga a sua parte; os
          demais pagam.
        </p>
      </div>

      {paymentsHere > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-100">
          Esta locação já tem {paymentsHere} lançamento(s) no caixa. Confira antes de lançar de
          novo.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Valor da quadra (R$)</Label>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Convidados sem cadastro</Label>
          <Input
            type="number"
            min="0"
            max="8"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        {players.map((p, i) => {
          const rem = remaining(p.id);
          const b = balances[p.id];
          const already = usedHere.has(p.id);
          const using = !!usePlay[p.id] && !already;
          return (
            <div key={p.id} className="space-y-1.5 rounded-md border bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="text-sm">
                  {already ? "Play já usado" : using ? "Play" : fmtBRL(shareOf(i))}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {!b || b.total === 0
                  ? "Sem Play neste mês"
                  : `Plays: ${b.used} de ${b.total} usados · restam ${Math.max(0, rem)}`}
              </div>
              {!already && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={using}
                      disabled={rem <= 0}
                      onCheckedChange={(c) => setUsePlay((m) => ({ ...m, [p.id]: c === true }))}
                    />
                    Usar 1 play
                  </label>
                  {!using && shareOf(i) > 0 && (
                    <>
                      <Select
                        value={payer(p.id).method || "__none"}
                        onValueChange={(m) => patchPayer(p.id, { method: m === "__none" ? "" : m })}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue placeholder="Forma" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— Forma —</SelectItem>
                          {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                            <SelectItem key={v} value={v}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={payer(p.id).toAccount}
                          onCheckedChange={(c) => patchPayer(p.id, { toAccount: c === true })}
                        />
                        Débito na conta
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {guestCount > 0 && (
          <div className="space-y-1.5 rounded-md border bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{guestCount} convidado(s) sem cadastro</span>
              <span className="text-sm">{fmtBRL(guestShare)}</span>
            </div>
            <Select
              value={guestMethod || "__none"}
              onValueChange={(m) => setGuestMethod(m === "__none" ? "" : m)}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Forma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Forma —</SelectItem>
                {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {people} pessoa(s) · {fmtBRL(shares[0] ?? 0)} cada · {playUsers.length} play(s) · a lançar{" "}
          <strong>{fmtBRL(toCharge)}</strong>
        </span>
        <Button type="button" onClick={submit} disabled={saving || people === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Lançar play
        </Button>
      </div>
    </div>
  );
}

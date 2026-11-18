// Painel "Play pickleball" de uma locação de quadra de pickleball.
//
// Regra: o valor da quadra é dividido pelo número de pessoas que jogaram.
// Cada aluno com Play disponível no mês não paga a sua parte (gasta 1 play);
// quem não tem play (convidado, aluno sem pacote ou que já usou os 4) paga a
// sua parte. Convidado sem cadastro entra só pela quantidade: a parte dele
// vira um lançamento avulso.
//
// Dois usos:
//   * locação existente (bookingId preenchido): botão "Lançar play";
//   * reserva nova (bookingId null): o painel só monta o rascunho
//     (onDraftChange) e quem salva a reserva chama commitPlay com o id novo.

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

type Player = { id: string; name: string };

/** O que foi marcado no painel (vale para reserva nova ou existente). */
export interface PlayDraft {
  total: number;
  guestCount: number;
  guestMethod: string;
  /** Jogadores que gastam 1 play nesta locação. */
  playUserIds: string[];
  payers: Record<string, Payer>;
}

interface PlayContext {
  bookingDate: string;
  court: number;
  startTime: string;
  endTime: string;
  /** Jogadores cadastrados (titular + participantes), na ordem da divisão. */
  players: Player[];
  /** Jogadores que já gastaram play nesta locação (não pagam de novo). */
  alreadyUsedIds?: string[];
  /** Categoria dos lançamentos de quem paga a sua parte (aluguel de quadra). */
  payCategoryId: string | null;
}

function computePlay(ctx: PlayContext, draft: PlayDraft) {
  const already = new Set(ctx.alreadyUsedIds ?? []);
  const people = ctx.players.length + draft.guestCount;
  const shares = splitEvenly(draft.total, people);
  const playUsers = ctx.players.filter(
    (p) => draft.playUserIds.includes(p.id) && !already.has(p.id),
  );
  const payingPlayers = ctx.players
    .map((p, i) => ({ ...p, share: shares[i] ?? 0 }))
    .filter((p) => !draft.playUserIds.includes(p.id) && !already.has(p.id));
  const guestShare =
    Math.round(shares.slice(ctx.players.length).reduce((s, v) => s + v, 0) * 100) / 100;
  const toCharge = payingPlayers.reduce((s, p) => s + p.share, 0) + guestShare;
  return { people, shares, playUsers, payingPlayers, guestShare, toCharge };
}

/** Mensagem de erro do que falta preencher, ou null se dá pra lançar. */
export function validatePlayDraft(ctx: PlayContext, draft: PlayDraft): string | null {
  const { people, payingPlayers } = computePlay(ctx, draft);
  if (people === 0) return "Informe quem jogou.";
  if (draft.total <= 0) return "Informe o valor da quadra no Play.";
  for (const p of payingPlayers) {
    const v = draft.payers[p.id] ?? { method: "", toAccount: false };
    if (p.share > 0 && !v.method && !v.toAccount) {
      return `Play: escolha a forma de pagamento de ${p.name} ou marque "Débito na conta".`;
    }
  }
  if (draft.guestCount > 0 && !draft.guestMethod) {
    return "Play: escolha a forma de pagamento dos convidados.";
  }
  return null;
}

/**
 * Registra os plays usados e lança no caixa a parte de quem paga.
 * Retorna a mensagem de erro, ou null.
 */
export async function commitPlay(
  bookingId: string,
  ctx: PlayContext,
  draft: PlayDraft,
): Promise<{ error: string | null; plays: number; charged: number }> {
  const { people, playUsers, payingPlayers, guestShare, toCharge } = computePlay(ctx, draft);
  const month = playMonthOf(ctx.bookingDate);
  const { data: freshUser } = await supabase.auth.getUser();
  const base = {
    category_id: ctx.payCategoryId,
    paid_at: new Date().toISOString(),
    court: ctx.court,
    start_time: ctx.startTime,
    end_time: ctx.endTime,
    booking_id: bookingId,
    recorded_by: freshUser.user?.id ?? null,
  };
  const notes = `Play pickleball · ${courtShort(ctx.court)} · ${ctx.startTime.slice(0, 5)}–${ctx.endTime.slice(0, 5)} · dividido em ${people}`;
  const rows = [
    ...payingPlayers
      .filter((p) => p.share > 0)
      .map((p) => {
        const v = draft.payers[p.id] ?? { method: "", toAccount: false };
        return {
          ...base,
          client_id: p.id,
          amount: p.share,
          method: (v.method || "outro") as never,
          received: !v.toAccount,
          to_account: v.toAccount,
          account_direction: v.toAccount ? "debito" : null,
          notes,
        };
      }),
    ...(draft.guestCount > 0 && guestShare > 0
      ? [
          {
            ...base,
            client_id: null,
            amount: guestShare,
            method: draft.guestMethod as never,
            received: true,
            to_account: false,
            account_direction: null,
            notes: `${notes} · ${draft.guestCount} convidado(s) sem cadastro`,
          },
        ]
      : []),
  ];

  if (playUsers.length > 0) {
    const { error } = await supabase.from("pickleball_play_usage").insert(
      playUsers.map((p) => ({ client_id: p.id, booking_id: bookingId, reference_month: month })),
    );
    if (error) return { error: `Não consegui registrar o play: ${error.message}`, plays: 0, charged: 0 };
  }
  if (rows.length > 0) {
    const { error } = await supabase.from("payments").insert(rows);
    if (error) {
      return {
        error: `Plays registrados, mas falhou o lançamento no caixa: ${error.message}. Lance a parte de quem pagou pelo Caixa.`,
        plays: playUsers.length,
        charged: 0,
      };
    }
  }
  return { error: null, plays: playUsers.length, charged: rows.length > 0 ? toCharge : 0 };
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
  onDraftChange,
}: {
  /** Null = reserva ainda não salva (rascunho; quem salva chama commitPlay). */
  bookingId: string | null;
  bookingDate: string;
  court: number;
  startTime: string;
  endTime: string;
  /** Jogadores cadastrados da locação (titular + participantes). */
  players: Player[];
  /** Valor cheio da quadra (tabela de preços, sem desconto). */
  courtPrice: number;
  /** Categoria dos lançamentos de quem paga a sua parte (aluguel de quadra). */
  payCategoryId: string | null;
  onDone?: () => void;
  onDraftChange?: (draft: PlayDraft) => void;
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
      const bal = await fetchPlayBalances(ids, month);
      let here = new Set<string>();
      let pays = 0;
      if (bookingId) {
        const [used, payRes] = await Promise.all([
          supabase.from("pickleball_play_usage").select("client_id").eq("booking_id", bookingId),
          supabase
            .from("payments")
            .select("id", { count: "exact", head: true })
            .eq("booking_id", bookingId),
        ]);
        here = new Set((used.data ?? []).map((r) => r.client_id));
        pays = payRes.count ?? 0;
      }
      if (cancelled) return;
      setBalances(bal);
      setUsedHere(here);
      setPaymentsHere(pays);
      // Marca "usar play" por padrão para quem tem play sobrando.
      setUsePlay((prev) => {
        const def: Record<string, boolean> = {};
        for (const id of ids) {
          const b = bal[id];
          const can = !here.has(id) && !!b && b.total - b.used > 0;
          def[id] = id in prev ? prev[id]! && can : can;
        }
        return def;
      });
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

  const ctx: PlayContext = {
    bookingDate,
    court,
    startTime,
    endTime,
    players,
    alreadyUsedIds: Array.from(usedHere),
    payCategoryId,
  };
  const draft: PlayDraft = useMemo(
    () => ({
      total,
      guestCount,
      guestMethod,
      playUserIds: players.filter((p) => usePlay[p.id]).map((p) => p.id),
      payers,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, guestCount, guestMethod, usePlay, payers, playerKey],
  );
  const calc = computePlay(ctx, draft);

  useEffect(() => {
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const remaining = (id: string) => {
    const b = balances[id];
    return b ? b.total - b.used : 0;
  };
  const payer = (id: string): Payer => payers[id] ?? { method: "", toAccount: false };
  const patchPayer = (id: string, patch: Partial<Payer>) =>
    setPayers((m) => ({ ...m, [id]: { ...payer(id), ...patch } }));

  const submit = async () => {
    if (!bookingId) return;
    const err = validatePlayDraft(ctx, draft);
    if (err) return toast.error(err);
    setSaving(true);
    const r = await commitPlay(bookingId, ctx, draft);
    setSaving(false);
    if (r.error) return toast.error(r.error);
    toast.success(
      `${r.plays} play(s) usado(s)` +
        (r.charged > 0 ? ` · ${fmtBRL(r.charged)} lançado(s) no caixa` : ""),
    );
    onDone?.();
  };

  if (players.length === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Escolha o cliente da reserva para usar o Play.
      </div>
    );
  }

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
          O valor da quadra é dividido por todos que jogaram. Quem usa play não paga a sua parte;
          os demais pagam.
          {!bookingId && " Os plays e lançamentos são registrados ao salvar a reserva."}
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
          const share = calc.shares[i] ?? 0;
          return (
            <div key={p.id} className="space-y-1.5 rounded-md border bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="text-sm">
                  {already ? "Play já usado" : using ? "Play" : fmtBRL(share)}
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
                  {!using && share > 0 && (
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
              <span className="text-sm">{fmtBRL(calc.guestShare)}</span>
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
          {calc.people} pessoa(s) · {fmtBRL(calc.shares[0] ?? 0)} cada · {calc.playUsers.length}{" "}
          play(s) · a lançar <strong>{fmtBRL(calc.toCharge)}</strong>
        </span>
        {bookingId && (
          <Button type="button" onClick={submit} disabled={saving || calc.people === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lançar play
          </Button>
        )}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  RotateCcw,
  MessageSquareText,
  MessageCircle,
  UserRoundCheck,
  StickyNote,
  Hand,
} from "lucide-react";
import { fmtBRL, fmtDate, fmtDateTime, recifeDateToISO } from "@/lib/format";
import { sendOverdueBalanceReminder } from "@/lib/whatsapp";

export const Route = createFileRoute("/cobranca-followups")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Acompanhamento de cobrança • Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]} debtInfo>
      <CobrancaFollowupsPage />
    </RequireAuth>
  ),
});

interface Row {
  id: string;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  client_active: boolean;
  status: string;
  last_context: string | null;
  last_sent_at: string;
  send_count: number;
  balance_at_last_send: number | null;
  current_balance: number;
  created_at: string;
  resolved_at: string | null;
  resolved_note: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_at: string | null;
  last_note: string | null;
  last_note_at: string | null;
  last_note_by: string | null;
  kept_at: string | null;
  kept_by_name: string | null;
  /** "Gympass" | "Exceção" quando o cliente está fora da régua */
  client_exception: string | null;
}

interface WatchRow {
  client_id: string;
  client_name: string;
  is_gympass: boolean;
  exception_reason: string | null;
  balance: number;
  last_payment_on: string | null;
  days_without_payment: number;
  usual_max_gap: number | null;
  has_history: boolean;
  out_of_pattern: boolean;
  why: string | null;
  followup_id: string | null;
  assigned_name: string | null;
}

interface Assignee {
  user_id: string;
  full_name: string;
}

const CONTEXT_LABELS: Record<string, string> = {
  overdue: "Inadimplência",
  debt_limit_alert: "Limite de débito",
  month_end_credit_reminder: "Crédito de fim de mês",
  open_debt_d1: "Véspera — débito em aberto",
  fora_do_padrao: "Exceção fora do padrão",
};

function contextLabel(ctx: string | null): string {
  if (!ctx) return "—";
  return CONTEXT_LABELS[ctx] ?? ctx;
}

const DAY_MS = 24 * 3600 * 1000;
/** Régua: dias contados desde a 1ª mensagem do follow-up. */
const SECOND_MESSAGE_DAY = 3;
const ESCALATE_DAY = 7;
/** Mantido na recepção: lembrete a cada N dias; depois de M dias, decidir de novo. */
const KEPT_REMINDER_DAYS = 7;
const KEPT_REDECIDE_DAYS = 28;

type StepKind = "decide" | "second" | "reminder" | "wait" | "assigned" | "exception";
interface Step {
  kind: StepKind;
  label: string;
  sub: string;
  /** menor = mais urgente */
  priority: number;
}

function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS));
}

function nextStep(r: Row, now: number): Step | null {
  if (r.status !== "active") return null;
  if (r.assigned_to) {
    const d = r.assigned_at ? daysSince(r.assigned_at, now) : 0;
    return {
      kind: "assigned",
      label: `Com ${r.assigned_name ?? "diretoria"}`,
      sub: d === 0 ? "repassado hoje" : `repassado há ${d} dia${d > 1 ? "s" : ""}`,
      priority: 3,
    };
  }
  if (r.client_exception) {
    return {
      kind: "exception",
      label: `${r.client_exception}: fora da régua`,
      sub: "acompanhado pelo quadro de exceções abaixo",
      priority: 4,
    };
  }
  if (r.kept_at) {
    const kept = daysSince(r.kept_at, now);
    const who = r.kept_by_name ? ` por ${r.kept_by_name}` : "";
    if (kept >= KEPT_REDECIDE_DAYS) {
      return {
        kind: "decide",
        label: "Decidir de novo",
        sub: `mantido na recepção há ${kept} dias e ainda devendo`,
        priority: 0,
      };
    }
    const lastTouch = Math.max(
      new Date(r.kept_at).getTime(),
      r.send_count > 0 ? new Date(r.last_sent_at).getTime() : 0,
    );
    const since = daysSince(new Date(lastTouch).toISOString(), now);
    if (since >= KEPT_REMINDER_DAYS) {
      return {
        kind: "reminder",
        label: "Mandar lembrete",
        sub: `mantido na recepção${who} · ${since} dias sem mensagem`,
        priority: 1,
      };
    }
    const left = KEPT_REMINDER_DAYS - since;
    return {
      kind: "wait",
      label: "Mantido na recepção",
      sub: `${r.kept_by_name ? `por ${r.kept_by_name} · ` : ""}próximo lembrete em ${left} dia${left > 1 ? "s" : ""}`,
      priority: 2,
    };
  }
  const d = daysSince(r.created_at, now);
  const dia = `dia ${d} desde a 1ª mensagem`;
  if (d >= ESCALATE_DAY) {
    return {
      kind: "decide",
      label: "Decidir: repassar ou manter",
      sub: dia,
      priority: 0,
    };
  }
  if (d >= SECOND_MESSAGE_DAY && r.send_count < 2) {
    return { kind: "second", label: "Mandar 2ª mensagem", sub: dia, priority: 1 };
  }
  const nextDay = d >= SECOND_MESSAGE_DAY ? ESCALATE_DAY : SECOND_MESSAGE_DAY;
  const what = nextDay === ESCALATE_DAY ? "decisão" : "2ª mensagem";
  return {
    kind: "wait",
    label: "Aguardar",
    sub: `${dia} · ${what} no dia ${nextDay}`,
    priority: 2,
  };
}

const STEP_BADGE: Record<StepKind, string> = {
  decide: "border-destructive/40 bg-destructive/10 text-destructive",
  reminder: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  second: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  wait: "text-muted-foreground",
  assigned: "border-primary/40 bg-primary/10 text-primary",
  exception: "text-muted-foreground",
};

function CobrancaFollowupsPage() {
  const [statusFilter, setStatusFilter] = useState<"active" | "resolved" | "todos">("active");
  const [mineOnly, setMineOnly] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [watch, setWatch] = useState<WatchRow[]>([]);
  const [showInPattern, setShowInPattern] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<Row | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [escalating, setEscalating] = useState<{
    clientId: string;
    clientName: string;
    context?: string;
  } | null>(null);
  const [assignee, setAssignee] = useState("");
  const [escalateNote, setEscalateNote] = useState("");
  const [noting, setNoting] = useState<Row | null>(null);
  const [noteText, setNoteText] = useState("");
  const [keeping, setKeeping] = useState<Row | null>(null);
  const [keepNote, setKeepNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, w] = await Promise.all([
      supabase.rpc("cobranca_followups_list", { _status: statusFilter }),
      supabase.rpc("cobranca_exceptions_watch"),
    ]);
    if (list.error) toast.error(list.error.message);
    if (w.error) toast.error(w.error.message);
    setRows((list.data ?? []) as Row[]);
    setWatch((w.data ?? []) as WatchRow[]);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    void supabase.rpc("cobranca_assignees").then(({ data, error }) => {
      if (error) return toast.error(error.message);
      setAssignees((data ?? []) as Assignee[]);
    });
  }, []);

  const now = Date.now();
  const visible = useMemo(() => {
    const list = mineOnly ? rows.filter((r) => r.assigned_to && r.assigned_to === me) : rows;
    return list
      .map((r) => ({ r, step: nextStep(r, now) }))
      .filter(({ step }) => step?.kind !== "exception")
      .sort((a, b) => {
        const pa = a.step?.priority ?? 9;
        const pb = b.step?.priority ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(a.r.created_at).getTime() - new Date(b.r.created_at).getTime();
      });
  }, [rows, mineOnly, me, now]);

  const counts = useMemo(() => {
    const c = { decide: 0, second: 0, kept: 0, assigned: 0, mine: 0, exception: 0 };
    for (const r of rows) {
      const s = nextStep(r, now);
      if (s?.kind === "decide") c.decide++;
      if (s?.kind === "second" || s?.kind === "reminder") c.second++;
      if (s?.kind === "exception") c.exception++;
      if (r.status === "active" && r.kept_at && !r.assigned_to && !r.client_exception) c.kept++;
      if (s?.kind === "assigned") c.assigned++;
      if (r.status === "active" && r.assigned_to && r.assigned_to === me) c.mine++;
    }
    return c;
  }, [rows, me, now]);

  const watchSorted = useMemo(() => {
    const list = showInPattern ? watch : watch.filter((w) => w.out_of_pattern);
    return [...list].sort((a, b) => Number(b.out_of_pattern) - Number(a.out_of_pattern));
  }, [watch, showInPattern]);
  const outOfPatternCount = watch.filter((w) => w.out_of_pattern).length;

  const confirmResolve = async () => {
    if (!resolving) return;
    setBusy(resolving.id);
    const { data, error } = await supabase.rpc("cobranca_followup_resolve", {
      _followup_id: resolving.id,
      _note: resolveNote.trim() || undefined,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao marcar como pago.");
    toast.success("Follow-up marcado como resolvido.");
    setResolving(null);
    setResolveNote("");
    load();
  };

  const reopen = async (r: Row) => {
    setBusy(r.id);
    const { data, error } = await supabase.rpc("cobranca_followup_reopen", {
      _followup_id: r.id,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao reabrir.");
    toast.success("Follow-up reaberto.");
    load();
  };

  const sendSecond = async (r: Row) => {
    setBusy(r.id);
    await sendOverdueBalanceReminder(r.client_id);
    setBusy(null);
    // o registro do envio é assíncrono; recarrega em seguida pra contar a 2ª mensagem
    setTimeout(load, 1500);
  };

  const openEscalate = (clientId: string, clientName: string, context?: string) => {
    const monica = assignees.find((a) => a.full_name.toLowerCase().includes("monica"));
    setAssignee(monica?.user_id ?? assignees[0]?.user_id ?? "");
    setEscalateNote("");
    setEscalating({ clientId, clientName, context });
  };

  const confirmEscalate = async () => {
    if (!escalating || !assignee) return;
    setBusy(escalating.clientId);
    const { data, error } = await supabase.rpc("cobranca_followup_assign", {
      _client_id: escalating.clientId,
      _assignee: assignee,
      _note: escalateNote.trim() || undefined,
      _context: escalating.context,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao repassar.");
    const name = assignees.find((a) => a.user_id === assignee)?.full_name ?? "diretoria";
    toast.success(`Repassado para ${name}.`);
    setEscalating(null);
    load();
  };

  const keep = async (r: Row) => {
    setBusy(r.id);
    const { data, error } = await supabase.rpc("cobranca_followup_keep", {
      _followup_id: r.id,
      _note: keepNote.trim() || undefined,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao manter.");
    toast.success(
      `${r.client_name} fica com a recepção: lembrete a cada ${KEPT_REMINDER_DAYS} dias.`,
    );
    setKeeping(null);
    setKeepNote("");
    load();
  };

  const confirmNote = async () => {
    if (!noting || !noteText.trim()) return;
    setBusy(noting.id);
    const { data, error } = await supabase.rpc("cobranca_followup_add_note", {
      _followup_id: noting.id,
      _note: noteText.trim(),
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao anotar.");
    toast.success("Anotação salva.");
    setNoting(null);
    setNoteText("");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Acompanhamento de cobrança</h1>
        <p className="text-muted-foreground">
          O cliente entra aqui quando é cobrado pela aba{" "}
          <Link to="/inadimplentes" className="underline">
            Inadimplentes
          </Link>
          . O aviso diário de véspera e a calculadora de crédito não contam. Quem quitar (saldo
          zerado ou positivo) sai da lista sozinho.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Régua de cobrança</CardTitle>
          <CardDescription>
            Contada desde a 1ª mensagem: no dia {SECOND_MESSAGE_DAY}, 2ª mensagem; no dia{" "}
            {ESCALATE_DAY}, decidir: <strong>repassar</strong> à diretoria (casos difíceis, ela
            cobra pessoalmente) ou <strong>manter</strong> na recepção (lembrete a cada{" "}
            {KEPT_REMINDER_DAYS} dias; depois de {KEPT_REDECIDE_DAYS / 7} semanas ainda devendo,
            decidir de novo). A lista já vem ordenada pelo que precisa ser feito primeiro.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2 text-sm">
            <Badge variant="outline" className={STEP_BADGE.decide}>
              {counts.decide} para decidir
            </Badge>
            <Badge variant="outline" className={STEP_BADGE.second}>
              {counts.second} para mandar mensagem
            </Badge>
            <Badge variant="outline" className={STEP_BADGE.assigned}>
              {counts.kept} mantidos na recepção
            </Badge>
            <Badge variant="outline" className={STEP_BADGE.assigned}>
              {counts.assigned} com a diretoria
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1 pt-2">
            {(
              [
                ["active", "Pendentes"],
                ["resolved", "Resolvidos"],
                ["todos", "Todos"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </Button>
            ))}
            {(counts.mine > 0 || mineOnly) && (
              <Button
                size="sm"
                variant={mineOnly ? "default" : "outline"}
                onClick={() => setMineOnly((v) => !v)}
              >
                <UserRoundCheck className="h-4 w-4 mr-1" /> Repassados para mim ({counts.mine})
              </Button>
            )}
          </div>
          {counts.exception > 0 && (
            <p className="pt-2 text-xs text-muted-foreground">
              {counts.exception} cliente(s) Gympass ou da lista de exceção receberam cobrança e
              ficam fora da régua. Eles são acompanhados no quadro &quot;Exceções fora do
              padrão&quot; abaixo.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {statusFilter === "active"
                ? "Nenhum follow-up pendente. Boa notícia!"
                : "Nenhum follow-up encontrado."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Próximo passo</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Último envio</TableHead>
                    <TableHead className="text-center">Envios</TableHead>
                    <TableHead className="text-right">Saldo atual</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(({ r, step }) => {
                    const seemsPaid = r.status === "active" && r.current_balance >= 0;
                    return (
                      <TableRow key={r.id} className={seemsPaid ? "bg-success/5" : undefined}>
                        <TableCell className="align-top">
                          <Link
                            to="/clientes/$clientId"
                            params={{ clientId: r.client_id }}
                            className="font-medium hover:underline"
                          >
                            {r.client_name}
                          </Link>
                          {!r.client_active && (
                            <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                          )}
                          {seemsPaid && (
                            <div className="text-xs text-success mt-0.5">
                              Reaberto à mão — saldo em dia.
                            </div>
                          )}
                          {r.last_note && (
                            <div className="text-xs text-muted-foreground mt-0.5 max-w-xs">
                              <StickyNote className="inline h-3 w-3 mr-1" />
                              {r.last_note}
                              <span className="opacity-70">
                                {" "}
                                — {r.last_note_by ?? "?"}
                                {r.last_note_at ? `, ${fmtDateTime(r.last_note_at)}` : ""}
                              </span>
                            </div>
                          )}
                          {r.resolved_note && (
                            <div className="text-xs text-muted-foreground italic mt-0.5">
                              {r.resolved_note}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {step ? (
                            <>
                              <Badge variant="outline" className={STEP_BADGE[step.kind]}>
                                {step.label}
                              </Badge>
                              <div className="text-xs text-muted-foreground mt-0.5">{step.sub}</div>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline">{contextLabel(r.last_context)}</Badge>
                        </TableCell>
                        <TableCell className="text-sm align-top">
                          {r.send_count > 0 ? fmtDateTime(r.last_sent_at) : "—"}
                        </TableCell>
                        <TableCell className="text-center align-top">{r.send_count}</TableCell>
                        <TableCell
                          className={`text-right text-sm font-medium align-top ${
                            r.current_balance < 0 ? "text-destructive" : "text-success"
                          }`}
                        >
                          {fmtBRL(r.current_balance)}
                        </TableCell>
                        <TableCell className="text-right align-top">
                          {r.status === "active" ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {(step?.kind === "second" || step?.kind === "reminder") && (
                                <Button
                                  size="sm"
                                  onClick={() => sendSecond(r)}
                                  disabled={busy === r.id}
                                >
                                  <MessageCircle className="h-4 w-4 mr-1" />{" "}
                                  {step.kind === "second" ? "2ª mensagem" : "Lembrete"}
                                </Button>
                              )}
                              {step?.kind === "decide" && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => openEscalate(r.client_id, r.client_name)}
                                    disabled={busy === r.client_id || assignees.length === 0}
                                    title="Casos difíceis: a diretoria cobra pessoalmente"
                                  >
                                    <UserRoundCheck className="h-4 w-4 mr-1" /> Repassar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      setKeepNote("");
                                      setKeeping(r);
                                    }}
                                    disabled={busy === r.id}
                                    title={`Recepção continua: lembrete a cada ${KEPT_REMINDER_DAYS} dias`}
                                  >
                                    <Hand className="h-4 w-4 mr-1" /> Manter
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setNoteText("");
                                  setNoting(r);
                                }}
                                title="Anotar o que o cliente respondeu"
                              >
                                <StickyNote className="h-4 w-4 mr-1" /> Anotar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setResolving(r)}
                                disabled={busy === r.id}
                                title="Para acordos fora do sistema; quem paga sai sozinho"
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Pago
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reopen(r)}
                              disabled={busy === r.id}
                            >
                              {busy === r.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              )}
                              Reabrir
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exceções fora do padrão</CardTitle>
          <CardDescription>
            Clientes da lista de exceção do limite de débito e Gympass não entram na régua. Eles
            aparecem aqui quando saem do próprio padrão: passaram mais dias sem pagar do que o maior
            intervalo que já tiveram (+5 dias), ou a dívida passou de 1,5x o maior pagamento deles.
            Quem ainda não tem histórico (menos de 4 pagamentos no último ano) aparece com mais de
            35 dias sem pagar nada.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Badge
              variant="outline"
              className={outOfPatternCount > 0 ? STEP_BADGE.decide : undefined}
            >
              {outOfPatternCount} fora do padrão
            </Badge>
            <span className="text-xs text-muted-foreground">
              de {watch.length} cliente(s) de exceção com saldo devedor
            </span>
            {watch.length > outOfPatternCount && (
              <Button size="sm" variant="ghost" onClick={() => setShowInPattern((v) => !v)}>
                {showInPattern ? "Esconder os que estão no padrão" : "Mostrar todos"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? null : watchSorted.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhum cliente de exceção fora do padrão.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Último pagamento</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchSorted.map((w) => (
                    <TableRow key={w.client_id}>
                      <TableCell className="align-top">
                        <Link
                          to="/clientes/$clientId"
                          params={{ clientId: w.client_id }}
                          className="font-medium hover:underline"
                        >
                          {w.client_name}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {w.is_gympass ? "Gympass" : "Exceção"}
                          {w.exception_reason ? ` · ${w.exception_reason}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {w.out_of_pattern ? (
                          <span className="text-destructive">{w.why}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            No padrão ·{" "}
                            {w.has_history
                              ? `${w.days_without_payment} dias sem pagar; maior intervalo ${w.usual_max_gap} dias`
                              : `${w.days_without_payment} dias sem pagar; sem histórico (teto 35)`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {w.last_payment_on ? fmtDate(recifeDateToISO(w.last_payment_on)) : "nunca"}
                      </TableCell>
                      <TableCell className="align-top text-right text-sm font-medium text-destructive">
                        {fmtBRL(w.balance)}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        {w.assigned_name ? (
                          <Badge variant="outline" className={STEP_BADGE.assigned}>
                            Com {w.assigned_name}
                          </Badge>
                        ) : w.out_of_pattern ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              openEscalate(
                                w.client_id,
                                w.client_name,
                                w.followup_id ? undefined : "fora_do_padrao",
                              )
                            }
                            disabled={busy === w.client_id || assignees.length === 0}
                          >
                            <UserRoundCheck className="h-4 w-4 mr-1" /> Repassar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!escalating} onOpenChange={(v) => !v && setEscalating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRoundCheck className="h-4 w-4" /> Repassar à diretoria
            </DialogTitle>
            <DialogDescription>
              {escalating?.clientName} passa a ser cobrado pessoalmente por quem você escolher. O
              caso continua nesta tela, com a etiqueta &quot;Com …&quot;, até o cliente pagar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha quem vai cobrar" />
              </SelectTrigger>
              <SelectContent>
                {assignees.map((a) => (
                  <SelectItem key={a.user_id} value={a.user_id}>
                    {a.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={escalateNote}
              onChange={(e) => setEscalateNote(e.target.value)}
              placeholder="Contexto para quem vai cobrar (opcional): o que o cliente já respondeu, etc."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalating(null)}>
              Voltar
            </Button>
            <Button onClick={confirmEscalate} disabled={!assignee || busy === escalating?.clientId}>
              {busy === escalating?.clientId && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Repassar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!keeping} onOpenChange={(v) => !v && setKeeping(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hand className="h-4 w-4" /> Manter na recepção
            </DialogTitle>
            <DialogDescription>
              {keeping?.client_name} continua com a recepção. O sistema pede um lembrete a cada{" "}
              {KEPT_REMINDER_DAYS} dias e, se depois de {KEPT_REDECIDE_DAYS / 7} semanas ainda
              estiver devendo, pede a decisão de novo.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={keepNote}
            onChange={(e) => setKeepNote(e.target.value)}
            placeholder="Por que manter? (opcional) Ex.: cliente antigo, sempre paga, só demora"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeeping(null)}>
              Voltar
            </Button>
            <Button onClick={() => keeping && keep(keeping)} disabled={busy === keeping?.id}>
              {busy === keeping?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Manter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!noting} onOpenChange={(v) => !v && setNoting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4" /> Anotar
            </DialogTitle>
            <DialogDescription>
              O que {noting?.client_name} respondeu ou o que foi combinado. A anotação aparece para
              toda a equipe.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Ex.: disse que paga no começo do mês"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoting(null)}>
              Voltar
            </Button>
            <Button onClick={confirmNote} disabled={!noteText.trim() || busy === noting?.id}>
              {busy === noting?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolving} onOpenChange={(v) => !v && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" /> Marcar como pago
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {resolving && (
              <p>
                Confirmar que <strong>{resolving.client_name}</strong> quitou e encerrar este
                follow-up? Quem paga pelo sistema já sai sozinho; use isto só para acordos fora
                dele.
              </p>
            )}
            <Textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Observação (opcional)"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              Voltar
            </Button>
            <Button onClick={confirmResolve} disabled={busy === resolving?.id}>
              {busy === resolving?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

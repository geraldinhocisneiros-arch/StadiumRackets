// Turma de pickleball clicada no mapa de quadras: chamada do dia.
//
// Turma não tem cobrança por aula (o aluno paga a mensalidade do mês). Aqui
// se marca, para cada aluno:
//   * Veio     → presença;
//   * Faltou   → aula perdida, sem direito a reposição;
//   * Cancelou → não conta presença e dá direito a 1 reposição.
// E se lança quem veio REPOR uma aula nesta turma (consome 1 crédito).
// Ver supabase/migrations/20261126130000_pickleball_chamada_reposicao.sql.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { supabase } from "@/integrations/supabase/client";
import { courtShort, fmtDateBR, type FixedSchedule } from "@/lib/court-map";
import { cn } from "@/lib/utils";

export interface ClassDayData {
  fixed: FixedSchedule;
  siblings: FixedSchedule[];
}

// Status gravados. Os de cancelamento: no prazo (≥ 12h antes, ganha
// reposição), fora do prazo (sem reposição) e fora do prazo abonado (ganha).
type RollStatus =
  "came" | "no_show" | "cancelled_ok" | "cancelled_late_charged" | "cancelled_late_waived";
type RollButton = "came" | "no_show" | "cancelled";

const ROLL_STATUSES: RollStatus[] = [
  "came",
  "no_show",
  "cancelled_ok",
  "cancelled_late_charged",
  "cancelled_late_waived",
];
const isCancelled = (s: RollStatus | undefined) => !!s && s.startsWith("cancelled");
const buttonOf = (s: RollStatus | undefined): RollButton | null =>
  !s ? null : isCancelled(s) ? "cancelled" : (s as RollButton);

const OPTIONS: { value: RollButton; label: string; on: string }[] = [
  { value: "came", label: "Veio", on: "bg-emerald-600 text-white border-emerald-600" },
  { value: "no_show", label: "Faltou", on: "bg-red-600 text-white border-red-600" },
  { value: "cancelled", label: "Cancelou", on: "bg-slate-500 text-white border-slate-500" },
];

const CANCEL_NOTE: Partial<Record<RollStatus, { text: string; cls: string }>> = {
  cancelled_ok: {
    text: "No prazo (12h) · +1 reposição",
    cls: "text-emerald-700 dark:text-emerald-400",
  },
  cancelled_late_charged: {
    text: "Fora do prazo (menos de 12h) · sem reposição",
    cls: "text-red-700 dark:text-red-400",
  },
  cancelled_late_waived: {
    text: "Fora do prazo · abonado · +1 reposição",
    cls: "text-amber-700 dark:text-amber-400",
  },
};

interface Makeup {
  id: string;
  client_id: string;
  full_name: string;
}

export function ClassDayDialog({
  data,
  date,
  onOpenChange,
  onChanged,
}: {
  data: ClassDayData | null;
  date: string;
  onOpenChange: (v: boolean) => void;
  /** Recarrega o mapa (selo da chamada na célula). */
  onChanged?: () => void;
}) {
  const f = data?.fixed;
  const classId = f?.class_id ?? null;
  const students = data
    ? [data.fixed, ...data.siblings]
        .filter((s) => s.class_id === classId)
        .sort((a, b) => (a.clients?.full_name ?? "").localeCompare(b.clients?.full_name ?? ""))
    : [];
  const studentKey = students.map((s) => s.id).join(",");

  const [status, setStatus] = useState<Record<string, RollStatus>>({});
  const [balance, setBalance] = useState<Record<string, number>>({});
  const [makeups, setMakeups] = useState<Makeup[]>([]);
  const [makeupOptions, setMakeupOptions] = useState<ClientOption[]>([]);
  const [makeupClient, setMakeupClient] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!classId || students.length === 0) return;
    setLoading(true);
    const scheduleIds = students.map((s) => s.id);
    const [attRes, mkRes, allRes] = await Promise.all([
      supabase
        .from("client_schedule_attendance")
        .select("client_schedule_id, status")
        .eq("attendance_date", date)
        .in("client_schedule_id", scheduleIds),
      supabase
        .from("pickleball_class_makeups")
        .select("id, client_id, clients!client_id(full_name)")
        .eq("class_id", classId)
        .eq("class_date", date),
      // Todo aluno que já esteve em turma pode ter crédito de reposição.
      supabase.from("client_schedules").select("client_id").not("class_id", "is", null),
    ]);
    if (attRes.error) toast.error(attRes.error.message);
    if (mkRes.error) toast.error(mkRes.error.message);
    const st: Record<string, RollStatus> = {};
    for (const a of (attRes.data ?? []) as { client_schedule_id: string; status: string }[])
      if ((ROLL_STATUSES as string[]).includes(a.status))
        st[a.client_schedule_id] = a.status as RollStatus;
    setStatus(st);
    setMakeups(
      (
        (mkRes.data ?? []) as unknown as {
          id: string;
          client_id: string;
          clients: { full_name: string } | null;
        }[]
      ).map((m) => ({ id: m.id, client_id: m.client_id, full_name: m.clients?.full_name ?? "—" })),
    );

    const ids = [
      ...new Set(((allRes.data ?? []) as { client_id: string }[]).map((r) => r.client_id)),
    ];
    if (ids.length) {
      const { data: bal, error } = await supabase.rpc("pickleball_makeup_balance", {
        _client_ids: ids,
      });
      if (error) toast.error(error.message);
      const rows = (bal ?? []) as { client_id: string; available: number }[];
      setBalance(Object.fromEntries(rows.map((r) => [r.client_id, r.available])));
      const withCredit = rows.filter((r) => r.available > 0).map((r) => r.client_id);
      if (withCredit.length) {
        const { data: cl } = await supabase
          .from("clients")
          .select("id, full_name")
          .in("id", withCredit)
          .order("full_name");
        setMakeupOptions((cl ?? []) as ClientOption[]);
      } else setMakeupOptions([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (data) {
      setMakeupClient("");
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, date, studentKey]);

  // "cancelled": o banco aplica o prazo de 12h pelo horário de agora.
  const send = async (s: FixedSchedule, next: string | null) => {
    setBusy(s.id);
    const { data: saved, error } = await supabase.rpc("pickleball_class_mark_attendance", {
      _schedule_id: s.id,
      _date: date,
      _status: next,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    if (next === "cancelled" && saved === "cancelled_late_charged")
      toast.warning(
        `${s.clients?.full_name ?? "Aluno"} cancelou com menos de 12h: sem reposição. Use “Abonar” se quiser dar a reposição.`,
      );
    await load();
    onChanged?.();
  };

  const mark = (s: FixedSchedule, value: RollButton) =>
    // Clicar de novo no botão marcado desmarca.
    send(s, buttonOf(status[s.id]) === value ? null : value);

  const markAllCame = async () => {
    const pending = students.filter((s) => !status[s.id]);
    if (pending.length === 0) return;
    setBusy("all");
    for (const s of pending) {
      const { error } = await supabase.rpc("pickleball_class_mark_attendance", {
        _schedule_id: s.id,
        _date: date,
        _status: "came",
      });
      if (error) {
        toast.error(`${s.clients?.full_name ?? "Aluno"}: ${error.message}`);
        break;
      }
    }
    setBusy(null);
    await load();
    onChanged?.();
  };

  const addMakeup = async () => {
    if (!classId || !makeupClient) return;
    setBusy("makeup");
    const { error } = await supabase.rpc("pickleball_class_add_makeup", {
      _class_id: classId,
      _client_id: makeupClient,
      _date: date,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Reposição lançada");
    setMakeupClient("");
    await load();
  };

  const removeMakeup = async (m: Makeup) => {
    setBusy(m.id);
    const { error } = await supabase.rpc("pickleball_class_remove_makeup", { _id: m.id });
    setBusy(null);
    if (error) return toast.error(error.message);
    await load();
  };

  const count = (v: RollButton) => students.filter((s) => buttonOf(status[s.id]) === v).length;
  const memberIds = new Set(students.map((s) => s.client_id));
  const makeupIds = new Set(makeups.map((m) => m.client_id));

  return (
    <Dialog open={!!data} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {f && (
          <>
            <DialogHeader>
              <DialogTitle>Chamada — turma {f.pickleball_classes?.name ?? ""}</DialogTitle>
              <DialogDescription>
                {fmtDateBR(date)} · {f.start_time.slice(0, 5)}–{f.end_time.slice(0, 5)} ·{" "}
                {f.court ? courtShort(f.court) : ""}
                {f.teachers?.name ? ` · Prof. ${f.teachers.name}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  Alunos ({students.length}) ·{" "}
                  <span className="text-muted-foreground font-normal">
                    {count("came")} vieram · {count("no_show")} faltaram · {count("cancelled")}{" "}
                    cancelaram
                  </span>
                </div>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              <ul className="space-y-2">
                {students.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{s.clients?.full_name ?? "Aluno"}</div>
                      {CANCEL_NOTE[status[s.id]!] && (
                        <div className={cn("text-xs", CANCEL_NOTE[status[s.id]!]!.cls)}>
                          {CANCEL_NOTE[status[s.id]!]!.text}
                          {status[s.id] === "cancelled_late_charged" && (
                            <button
                              type="button"
                              disabled={busy != null}
                              className="ml-2 font-medium underline underline-offset-2"
                              onClick={() => send(s, "cancelled_late_waived")}
                            >
                              Abonar
                            </button>
                          )}
                          {status[s.id] === "cancelled_late_waived" && (
                            <button
                              type="button"
                              disabled={busy != null}
                              className="ml-2 underline underline-offset-2"
                              onClick={() => send(s, "cancelled_late_charged")}
                            >
                              Tirar abono
                            </button>
                          )}
                        </div>
                      )}
                      {(balance[s.client_id] ?? 0) > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {balance[s.client_id]} reposição(ões) a usar
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          disabled={busy != null}
                          onClick={() => mark(s, o.value)}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                            buttonOf(status[s.id]) === o.value
                              ? o.on
                              : "bg-background hover:bg-muted",
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>

              {students.some((s) => !status[s.id]) && (
                <Button variant="outline" size="sm" onClick={markAllCame} disabled={busy != null}>
                  {busy === "all" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Marcar “Veio” para quem falta marcar
                </Button>
              )}

              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">Reposição nesta aula</div>
                {makeups.length > 0 && (
                  <ul className="space-y-1">
                    {makeups.map((m) => (
                      <li key={m.id} className="flex items-center justify-between text-sm">
                        <span>
                          {m.full_name}{" "}
                          <span className="text-xs text-emerald-700 dark:text-emerald-400">
                            · veio repor
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={busy != null}
                          onClick={() => removeMakeup(m)}
                          aria-label={`Remover reposição de ${m.full_name}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {makeupOptions.filter((c) => !memberIds.has(c.id) && !makeupIds.has(c.id)).length >
                0 ? (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <ClientCombobox
                        clients={makeupOptions.filter(
                          (c) => !memberIds.has(c.id) && !makeupIds.has(c.id),
                        )}
                        value={makeupClient}
                        onChange={setMakeupClient}
                        placeholder="Aluno com reposição a usar"
                      />
                    </div>
                    <Button size="sm" onClick={addMakeup} disabled={!makeupClient || busy != null}>
                      Lançar
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nenhum outro aluno com reposição a usar.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Veio = presença. Faltou = aula perdida, sem reposição. Cancelou = não conta
                presença; até 12h antes da aula o aluno ganha 1 reposição (sem validade, em qualquer
                turma com vaga). Com menos de 12h não ganha, a menos que seja abonado. Marque o
                cancelamento na hora em que o aluno avisar — o prazo é contado pelo horário da
                marcação. Clique de novo para desmarcar. Turma não lança aula no caixa.
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button asChild variant="outline">
                <Link to="/turmas">Abrir Turmas</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

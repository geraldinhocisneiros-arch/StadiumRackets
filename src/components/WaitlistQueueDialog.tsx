import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, MessageCircle, X, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { fmtDateBR, courtLabel, courtShort } from "@/lib/court-map";

import { useAuth } from "@/hooks/useAuth";
import { useWaitlistTeacherPicker } from "@/hooks/useWaitlistTeacherPicker";

interface AckRow {
  user_id: string;
  actor_name: string | null;
  acknowledged_at: string;
}

interface QueueRow {
  id: string;
  status: string;
  position: number;
  created_at: string;
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  client_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  teacher_name: string | null;
  guest_name: string | null;
  court_continuity?: "same_court" | "allow_court_change" | null;
  availability_plan?: Array<{ start: string; end: string; court: number }> | null;
  acknowledgements: AckRow[];
}

export interface WaitlistQueueTarget {
  court: number;
  bookingDate: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

interface Props {
  target: WaitlistQueueTarget | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function WaitlistQueueDialog({ target, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const confirm = useConfirm();
  const teacherPicker = useWaitlistTeacherPicker();
  const [busyId, setBusyId] = useState<string | null>(null);
  // "Marcar": quadras livres no horário inteiro do pedido, por entrada da fila
  const [freeCourts, setFreeCourts] = useState<Record<string, number[]>>({});
  const open = !!target;

  const refresh = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("staff_get_waitlist_for_slot", {
        _date: target.bookingDate,
        _start: `${target.startTime}:00`,
        _end: `${target.endTime}:00`,
      });
      if (error) throw error;
      setRows((data ?? []) as QueueRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar fila");
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (open) void refresh();
    else {
      setRows([]);
      setFreeCourts({});
    }
  }, [open, refresh]);

  const grouped = useMemo(() => {
    const map = new Map<string, { start: string; end: string; rows: QueueRow[] }>();
    for (const r of rows) {
      const key = `${r.start_time}|${r.end_time}`;
      if (!map.has(key)) map.set(key, { start: r.start_time, end: r.end_time, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start),
    );
  }, [rows]);

  const ack = async (row: QueueRow) => {
    setBusyId(row.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("waitlist_acknowledge", {
        _waitlist_id: row.id,
      });
      if (error) throw error;
      toast.success("Marcado como ciente.");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar ciência");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: QueueRow) => {
    if (
      !(await confirm(
        `Retirar ${row.client_name ?? row.guest_name ?? "esta pessoa"} da fila de espera?`,
      ))
    ) {
      return;
    }
    setBusyId(row.id);
    try {
      const { error } = await supabase.from("court_waitlist").delete().eq("id", row.id);
      if (error) throw error;
      toast.success("Retirado da fila de espera.");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao retirar da fila");
    } finally {
      setBusyId(null);
    }
  };

  const personName = (row: QueueRow) =>
    row.client_name ?? row.teacher_name ?? row.guest_name ?? "esta pessoa";

  const afterBooked = async (row: QueueRow) => {
    toast.success(`${personName(row)} marcado(a) e retirado(a) da fila.`);
    setFreeCourts((m) => {
      const next = { ...m };
      delete next[row.id];
      return next;
    });
    await refresh();
    onChanged?.();
  };

  // Plano sugerido (2h com troca de quadra) → marca direto pelo plano.
  // Sem plano → lista as quadras livres no horário todo pra escolher.
  const startMark = async (row: QueueRow) => {
    setBusyId(row.id);
    try {
      if (Array.isArray(row.availability_plan) && row.availability_plan.length > 0) {
        const plan = row.availability_plan.map((p) => `${p.start}–${p.end} ${courtShort(p.court)}`).join(", ");
        const choice = await teacherPicker.pick(row.id, `Marcar ${personName(row)} em ${plan}?`);
        if (!choice) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).rpc("waitlist_mark_and_book", {
          _waitlist_id: row.id,
          _teacher_id: choice.teacherId,
          _teacher_set: true,
        });
        if (error) throw error;
        await afterBooked(row);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("waitlist_free_courts_for_entry", {
        _waitlist_id: row.id,
      });
      if (error) throw error;
      const courts = (data ?? []) as number[];
      if (courts.length === 0) {
        toast.error(
          `Nenhuma quadra livre de ${row.start_time.slice(0, 5)} a ${row.end_time.slice(0, 5)} neste dia.`,
        );
        return;
      }
      setFreeCourts((m) => ({ ...m, [row.id]: courts }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao marcar");
    } finally {
      setBusyId(null);
    }
  };

  const bookOnCourt = async (row: QueueRow, court: number) => {
    const choice = await teacherPicker.pick(
      row.id,
      `Marcar ${personName(row)} na ${courtLabel(court)}, ${row.start_time.slice(0, 5)}–${row.end_time.slice(0, 5)}?`,
    );
    if (!choice) return;
    setBusyId(row.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("waitlist_book_on_court", {
        _waitlist_id: row.id,
        _court: court,
        _teacher_id: choice.teacherId,
        _teacher_set: true,
      });
      if (error) throw error;
      await afterBooked(row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao marcar");
    } finally {
      setBusyId(null);
    }
  };

  const openWhatsapp = (phone: string | null) => {
    if (!phone) {
      toast.error("Cliente sem telefone cadastrado.");
      return;
    }
    const digits = phone.replace(/\D+/g, "");
    if (!digits) return;
    const full = digits.length <= 11 ? `55${digits}` : digits;
    window.open(`https://wa.me/${full}`, "_blank");
  };

  if (!target) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fila de espera</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-1 bg-muted/30">
              <div>
                <span className="text-muted-foreground">Quadra clicada:</span>{" "}
                {courtLabel(target.court)}{" "}
                <span className="text-muted-foreground">
                  (fila vale para qualquer quadra deste horário)
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Data:</span> {fmtDateBR(target.bookingDate)}
              </div>
              <div>
                <span className="text-muted-foreground">Locação ocupada:</span> {target.startTime}–
                {target.endTime}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando...
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                Ninguém na fila de espera para este horário.
              </div>
            ) : (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {grouped.map((g) => (
                  <div key={`${g.start}-${g.end}`} className="space-y-2">
                    <div className="flex items-baseline justify-between border-b pb-1">
                      <div className="font-semibold text-sm">
                        {g.start.slice(0, 5)}–{g.end.slice(0, 5)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {g.rows.length === 1
                          ? "1 pessoa aguardando"
                          : `${g.rows.length} pessoas aguardando`}
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {g.rows.map((r) => {
                        const acks = r.acknowledgements ?? [];
                        const ackByMe = !!user && acks.some((a) => a.user_id === user.id);
                        return (
                          <li key={r.id} className="rounded-md border p-3 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-medium">
                                  {r.position}º —{" "}
                                  {r.client_name ?? r.teacher_name ?? r.guest_name ?? "Sem nome"}
                                </div>
                                {r.client_phone && (
                                  <div className="text-xs text-muted-foreground">
                                    {r.client_phone}
                                  </div>
                                )}
                                <div className="text-[11px] text-muted-foreground">
                                  Entrou em {new Date(r.created_at).toLocaleString("pt-BR")}
                                  {r.status !== "waiting" && ` • ${r.status}`}
                                </div>
                                {(() => {
                                  const durMin = Math.round(
                                    Number(r.end_time.slice(0, 2)) * 60 +
                                      Number(r.end_time.slice(3, 5)) -
                                      (Number(r.start_time.slice(0, 2)) * 60 +
                                        Number(r.start_time.slice(3, 5))),
                                  );
                                  if (durMin <= 60) return null;
                                  return (
                                    <div className="text-[11px]">
                                      <span className="text-muted-foreground">
                                        Troca de quadra:
                                      </span>{" "}
                                      <strong>
                                        {r.court_continuity === "allow_court_change"
                                          ? "Aceita"
                                          : "Não aceita"}
                                      </strong>
                                    </div>
                                  );
                                })()}
                                {Array.isArray(r.availability_plan) &&
                                  r.availability_plan.length > 0 && (
                                    <div className="mt-1 text-[11px] rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-1.5 py-1">
                                      <div className="font-medium text-amber-800 dark:text-amber-300">
                                        Possibilidade encontrada:
                                      </div>
                                      {r.availability_plan.map((p, i) => (
                                        <div key={i}>
                                          {p.start}–{p.end} — {courtShort(p.court)}
                                        </div>
                                      ))}
                                      <div className="text-muted-foreground italic">
                                        Confirme com o cliente antes de reservar.
                                      </div>
                                    </div>
                                  )}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <Button
                                  size="sm"
                                  disabled={busyId === r.id}
                                  onClick={() => void startMark(r)}
                                  title="Marcar a quadra para esta pessoa e tirá-la da fila"
                                >
                                  {busyId === r.id ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                  ) : (
                                    <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                                  )}
                                  Marcar
                                </Button>
                                {ackByMe ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Ciente
                                  </span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busyId === r.id}
                                    onClick={() => ack(r)}
                                  >
                                    {busyId === r.id && (
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    )}
                                    Ciente
                                  </Button>
                                )}
                                {r.client_phone && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openWhatsapp(r.client_phone)}
                                  >
                                    <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={busyId === r.id}
                                  onClick={() => void remove(r)}
                                  title="Retirar da fila de espera"
                                >
                                  <X className="h-3.5 w-3.5 mr-1" /> Retirar
                                </Button>
                              </div>
                            </div>
                            {freeCourts[r.id] && (
                              <div className="flex flex-wrap items-center gap-1 pt-1">
                                <span className="text-[11px] text-muted-foreground">
                                  Quadra livre:
                                </span>
                                {freeCourts[r.id].map((c) => (
                                  <Button
                                    key={c}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2"
                                    disabled={busyId === r.id}
                                    onClick={() => void bookOnCourt(r, c)}
                                  >
                                    {courtLabel(c)}
                                  </Button>
                                ))}
                              </div>
                            )}
                            {acks.length > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                Cientes: {acks.length}
                                {acks.length <= 3 && (
                                  <> — {acks.map((a) => a.actor_name ?? "—").join(", ")}</>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {teacherPicker.element}
    </>
  );
}

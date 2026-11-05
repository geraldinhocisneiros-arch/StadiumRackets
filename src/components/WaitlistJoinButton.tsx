import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ClipboardList, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { hoursToTime, hoursToLabel, courtShort } from "@/lib/court-map";
import { isWithinOnlineOperatingHours } from "@/lib/operating-hours";

interface Props {
  bookingDate: string; // YYYY-MM-DD
  court: number;
  startHour: number;
  endHour: number;
  className?: string;
}

/**
 * Botão + modal para o Portal (cliente/professor) entrar na lista de espera de
 * uma quadra ocupada. Não cria reserva — apenas registra interesse.
 */
export function WaitlistJoinButton({ bookingDate, court, startHour, endHour, className }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [inQueue, setInQueue] = useState<{ id: string; position: number; total: number } | null>(
    null,
  );

  const startTime = hoursToTime(startHour);
  const endTime = hoursToTime(endHour);
  const withinHours = isWithinOnlineOperatingHours(bookingDate, startHour, endHour);
  const durationMin = Math.max(0, Math.round((endHour - startHour) * 60));

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("portal_waitlist_position", {
        _date: bookingDate,
        _start: startTime,
        _end: endTime,
      });
      if (error) throw error;
      const j = (data ?? {}) as { in_queue?: boolean; id?: string; position?: number; total?: number };
      if (j.in_queue) {
        setInQueue({ id: j.id!, position: j.position ?? 1, total: j.total ?? 1 });
      } else {
        setInQueue(null);
      }
    } catch {
      /* silencioso */
    } finally {
      setChecking(false);
    }
  }, [bookingDate, startTime, endTime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const join = async () => {
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("portal_join_court_waitlist", {
        _date: bookingDate,
        _start: startTime,
        _end: endTime,
      });
      if (error) throw error;
      const j = (data ?? {}) as { id?: string; already?: boolean; position?: number };
      if (j.already) {
        toast.info("Você já está na lista de espera deste horário.");
      } else {
        toast.success("Você entrou na lista de espera.");
      }
      setInQueue({ id: j.id!, position: j.position ?? 1, total: j.position ?? 1 });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao entrar na lista.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!inQueue || busy) return;
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("portal_leave_court_waitlist", {
        _waitlist_id: inQueue.id,
      });
      const res = (data ?? {}) as { ok?: boolean; already?: boolean; error?: string };
      if (error || !res.ok) {
        toast.error(res.error ?? error?.message ?? "Erro ao sair da lista.");
        return;
      }
      if (res.already) {
        toast.info("Você já saiu desta lista de espera.");
      } else {
        toast.success("Você saiu da lista de espera.");
      }
      setInQueue(null);
      setOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!withinHours) return null;

  return (
    <>
      <Button
        type="button"
        variant={inQueue ? "secondary" : "outline"}
        className={className}
        onClick={() => setOpen(true)}
        disabled={checking}
      >
        <ClipboardList className="h-4 w-4 mr-2" />
        {inQueue ? `Na lista de espera (${inQueue.position}º)` : "Entrar na lista de espera"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {inQueue ? "Você está na lista de espera" : "Entrar na lista de espera"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div><span className="text-muted-foreground">Quadra:</span> {courtShort(court)}</div>
              <div>
                <span className="text-muted-foreground">Data:</span>{" "}
                {bookingDate.split("-").reverse().join("/")}
              </div>
              <div>
                <span className="text-muted-foreground">Horário:</span>{" "}
                {hoursToLabel(startHour)}–{hoursToLabel(endHour)}
              </div>
              <div>
                <span className="text-muted-foreground">Duração:</span> {durationMin} min
              </div>
              {inQueue && (
                <div className="pt-2 text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Você é o {inQueue.position}º da fila
                  {inQueue.total > inQueue.position && ` (${inQueue.total} no total)`}.
                </div>
              )}
            </div>

            <p className="text-muted-foreground">
              Caso esta quadra seja liberada, avisaremos você e nossa equipe. A entrada na lista de
              espera <strong>não garante a reserva</strong>. A confirmação será feita pela recepção.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Voltar
            </Button>
            {inQueue ? (
              <Button variant="destructive" onClick={leave} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Sair da lista de espera
              </Button>
            ) : (
              <Button onClick={join} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Entrar na lista de espera
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

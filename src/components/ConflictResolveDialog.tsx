import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { offerBookingCourtChangeNotification } from "@/lib/whatsapp";
import { moveFixedToday } from "@/lib/fixed-swap";
import { Loader2 } from "lucide-react";

import {
  STAFF_COURTS,
  HALF_SLOTS,
  courtLabel,
  hoursToLabel,
  hoursToTime,
  timeToHours,
  weekdayOfISO,
  type Booking,
  type FixedSchedule,
} from "@/lib/court-map";

export type ConflictEntry =
  | { kind: "booking"; booking: Booking }
  | { kind: "fixed"; fixed: FixedSchedule };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookingDate: string;
  entry: ConflictEntry | null;
  onSaved: () => void;
}

export function ConflictResolveDialog({
  open,
  onOpenChange,
  bookingDate,
  entry,
  onSaved,
}: Props) {
  const initial =
    entry?.kind === "booking"
      ? {
          court: entry.booking.court,
          start: timeToHours(entry.booking.start_time),
          end: timeToHours(entry.booking.end_time),
        }
      : entry?.kind === "fixed"
        ? {
            court: entry.fixed.court ?? 1,
            start: timeToHours(entry.fixed.start_time),
            end: timeToHours(entry.fixed.end_time),
          }
        : { court: 1, start: 5, end: 6 };

  const [court, setCourt] = useState<number>(initial.court);
  const [start, setStart] = useState<number>(initial.start);
  const [end, setEnd] = useState<number>(initial.end);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    setCourt(initial.court);
    setStart(initial.start);
    setEnd(initial.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.kind, entry && ("booking" in entry ? entry.booking.id : entry.fixed.id)]);

  if (!entry) return null;

  const name =
    entry.kind === "booking"
      ? entry.booking.clients?.full_name ??
        entry.booking.teachers?.name ??
        entry.booking.guest_name ??
        "Locação"
      : entry.fixed.clients?.full_name ?? "Fixo";

  const originalRange =
    entry.kind === "booking"
      ? `${courtLabel(entry.booking.court)} · ${hoursToLabel(timeToHours(entry.booking.start_time))}–${hoursToLabel(timeToHours(entry.booking.end_time))}`
      : `${courtLabel(entry.fixed.court ?? 0)} · ${hoursToLabel(timeToHours(entry.fixed.start_time))}–${hoursToLabel(timeToHours(entry.fixed.end_time))}`;

  const unchanged =
    court === initial.court && start === initial.start && end === initial.end;

  const submit = async () => {
    if (end <= start) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    if (unchanged) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const startTime = hoursToTime(start);
    const endTime = hoursToTime(end);

    if (entry.kind === "booking") {
      const movedFromFixed =
        typeof entry.booking.notes === "string" &&
        entry.booking.notes.startsWith("Movido do fixo") &&
        !!entry.booking.client_id;

      if (movedFromFixed) {
        const weekday = weekdayOfISO(bookingDate);
        const { data: schedule, error: scheduleError } = await supabase
          .from("client_schedules")
          .select("id")
          .eq("client_id", entry.booking.client_id!)
          .eq("weekday", weekday)
          .eq("court", court)
          .eq("start_time", startTime)
          .eq("end_time", endTime)
          .or(`valid_from.is.null,valid_from.lte.${bookingDate}`)
          .or(`valid_until.is.null,valid_until.gte.${bookingDate}`)
          .maybeSingle();

        if (scheduleError) {
          setSaving(false);
          toast.error(scheduleError.message);
          return;
        }

        if (schedule?.id) {
          const { error: exceptionError } = await supabase
            .from("client_schedule_exceptions")
            .delete()
            .eq("client_schedule_id", schedule.id)
            .eq("exception_date", bookingDate)
            .is("start_time", null)
            .is("end_time", null);

          if (exceptionError) {
            setSaving(false);
            toast.error(exceptionError.message);
            return;
          }

          const { error: deleteError } = await supabase
            .from("court_bookings")
            .delete()
            .eq("id", entry.booking.id);

          setSaving(false);
          if (deleteError) {
            toast.error(deleteError.message);
            return;
          }

          toast.success("Locação restaurada como fixo");
          onSaved();
          onOpenChange(false);
          return;
        }
      }

      const { error } = await supabase
        .from("court_bookings")
        .update({ court, start_time: startTime, end_time: endTime })
        .eq("id", entry.booking.id);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Locação alterada");
      if (entry.booking.client_id && entry.booking.court !== court) {
        void offerBookingCourtChangeNotification({
          clientId: entry.booking.client_id,
          fromCourt: entry.booking.court,
          toCourt: court,
          bookingDate,
          startTime,
          endTime,
        });
      }
      onSaved();
      onOpenChange(false);
      return;

    }

    // Fixo: move somente para hoje (não altera todas as semanas), com
    // todo mundo que divide a quadra/horário junto e trocando com quem
    // estiver no destino — numa transação só no banco (ver moveFixedToday).
    const f = entry.fixed;
    const { data: res, error: moveErr } = await moveFixedToday({
      scheduleId: f.id,
      date: bookingDate,
      court,
      startTime,
      endTime,
    });
    setSaving(false);
    if (moveErr || !res) {
      toast.error(moveErr ?? "Falha ao mover.");
      return;
    }
    toast.success(res.restored ? "Locação restaurada para o horário fixo original" : "Fixo movido só para hoje");
    if (!res.restored) {
      for (const m of res.moved) {
        if (!m.client_id) continue;
        void offerBookingCourtChangeNotification({
          clientId: m.client_id,
          fromCourt: res.from_court,
          toCourt: res.to_court,
          bookingDate,
          startTime: m.start_time,
          endTime: m.end_time,
          isFixed: true,
        });
      }
      if (res.swapped_booking?.client_id) {
        void offerBookingCourtChangeNotification({
          clientId: res.swapped_booking.client_id,
          fromCourt: res.to_court,
          toCourt: res.from_court,
          bookingDate,
          startTime: res.swapped_booking.start_time,
          endTime: res.swapped_booking.end_time,
          isFixed: false,
        });
      }
      for (const m of res.swapped_fixed) {
        if (!m.client_id) continue;
        void offerBookingCourtChangeNotification({
          clientId: m.client_id,
          fromCourt: res.to_court,
          toCourt: res.from_court,
          bookingDate,
          startTime: m.start_time,
          endTime: m.end_time,
          isFixed: true,
        });
      }
    }
    onSaved();
    onOpenChange(false);
  };

  const cancelToday = async () => {
    const label =
      entry.kind === "fixed"
        ? "Cancelar este fixo somente hoje?"
        : "Cancelar esta locação?";
    if (!(await confirm(label))) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    if (entry.kind === "fixed") {
      const { error } = await supabase
        .from("client_schedule_exceptions")
        .insert({
          client_schedule_id: entry.fixed.id,
          exception_date: bookingDate,
          start_time: null,
          end_time: null,
          reason: "Cancelado via resolução de conflito",
          created_by: userId,
        });
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Fixo cancelado somente hoje");
    } else {
      const { error } = await supabase
        .from("court_bookings")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: userId,
          cancel_reason: "Cancelado via resolução de conflito",
        })
        .eq("id", entry.booking.id);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Locação cancelada");
    }
    onSaved();
    onOpenChange(false);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resolver conflito · {name}</DialogTitle>
          <DialogDescription>
            Atual: {originalRange}
            {entry.kind === "fixed" && " (fixo — altera só hoje)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nova quadra</Label>
            <Select value={String(court)} onValueChange={(v) => setCourt(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAFF_COURTS.map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {courtLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Início</Label>
              <Select
                value={String(start)}
                onValueChange={(v) => {
                  const s = Number(v);
                  setStart(s);
                  if (end <= s) setEnd(s + 1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HALF_SLOTS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hoursToLabel(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Select value={String(end)} onValueChange={(v) => setEnd(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HALF_SLOTS.filter((h) => h > start)
                    .concat([24])
                    .map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {hoursToLabel(h)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="destructive"
            onClick={cancelToday}
            disabled={saving}
            className="sm:mr-auto"
          >
            {entry.kind === "fixed" ? "Cancelar somente hoje" : "Cancelar locação"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Fechar
            </Button>
            <Button onClick={submit} disabled={saving || unchanged}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

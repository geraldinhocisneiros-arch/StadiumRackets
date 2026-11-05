import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { courtLabel } from "@/lib/court-map";

interface JoinResult {
  ok: boolean;
  error?: string;
  id?: string;
  position?: number;
  already?: boolean;
}

// Mesma janela de funcionamento online usada em portal_join_court_waitlist
// e em AvulsaWaitlistJoinDialog.
function operatingHoursFor(dateISO: string): { open: number; close: number } {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dow = new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
  if (dow === 0 || dow === 6) return { open: 7, close: 19 };
  if (dow === 5) return { open: 5, close: 22 };
  return { open: 5, close: 23 };
}

interface Props {
  bookingId: string;
  bookingDate: string; // YYYY-MM-DD
  court: number;
  startTime: string; // HH:MM ou HH:MM:SS
  endTime: string;
  onRequested?: () => void;
  size?: "sm" | "default" | "lg";
  className?: string;
}

/**
 * Botão "Antecipar / trocar horário" numa reserva já existente do cliente.
 * Não move a reserva na hora — registra um pedido na fila de espera
 * (court_waitlist, via portal_join_court_waitlist com source_booking_id)
 * para o novo horário desejado no MESMO dia. A reserva atual continua
 * valendo normalmente; só é cancelada quando a equipe atender o pedido.
 * Quem ainda não tem nenhuma quadra marcada nesse horário tem prioridade
 * nessa fila.
 */
export function RequestBookingTimeChangeButton({
  bookingId,
  bookingDate,
  court,
  startTime,
  endTime,
  onRequested,
  size = "sm",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [courtChoice, setCourtChoice] = useState<"same" | "other_floor" | "any">("same");
  const [result, setResult] = useState<JoinResult | null>(null);

  // Quadra 1 = tênis (saibro); 2–4 = pickleball. "Trocar de modalidade"
  // entra na fila da outra: 0 = sentinela "qualquer quadra de pickleball".
  const isTennis = court === 1;
  const otherFloorCourt = isTennis ? 0 : 1;
  const otherFloorLabel = isTennis ? "Pickleball (qualquer quadra)" : "Tênis (saibro)";

  const durationMin = (() => {
    const [sh, sm] = startTime.slice(0, 5).split(":").map(Number);
    const [eh, em] = endTime.slice(0, 5).split(":").map(Number);
    return eh * 60 + em - (sh * 60 + sm);
  })();

  const { open: openHour, close: closeHour } = operatingHoursFor(bookingDate);
  const durationHours = Math.max(1, Math.round(durationMin / 60));
  const starts: string[] = [];
  for (let h = openHour; h <= closeHour - durationHours; h++) {
    starts.push(`${String(h).padStart(2, "0")}:00`);
  }
  const currentStart = startTime.slice(0, 5);
  const [newStart, setNewStart] = useState<string>("");

  const openDialog = () => {
    setResult(null);
    setCourtChoice("same");
    setNewStart(starts.find((s) => s !== currentStart) ?? "");
    setOpen(true);
  };

  const addMinutes = (hhmm: string, minutes: number) => {
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + minutes;
    const eh = Math.floor(total / 60) % 24;
    const em = total % 60;
    return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
  };

  const submit = async () => {
    if (!newStart) {
      toast.error("Selecione o novo horário.");
      return;
    }
    const newEnd = addMinutes(newStart, durationMin);
    const newCourt =
      courtChoice === "same" ? court : courtChoice === "other_floor" ? otherFloorCourt : null;
    // Mesmo horário só é "sem mudança nenhuma" se a quadra pedida também
    // for a mesma — pedir só a troca de piso no mesmo horário é válido.
    if (newStart === currentStart && newCourt === court) {
      toast.error("Este já é o horário e a quadra atuais da reserva.");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("portal_join_court_waitlist", {
      _date: bookingDate,
      _start: `${newStart}:00`,
      _end: `${newEnd}:00`,
      _source_booking_id: bookingId,
      _court_continuity: "same_court",
      _court: newCourt,
    } as never);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as unknown as JoinResult;
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível registrar o pedido.");
      return;
    }
    setResult(res);
    onRequested?.();
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        className={className}
        onClick={openDialog}
      >
        <CalendarClock className="h-3.5 w-3.5 mr-1" /> Antecipar / trocar horário
      </Button>

      <Dialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir troca de horário</DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="rounded-md bg-success/10 border border-success/30 px-3 py-3 text-sm">
              {result.already
                ? "Você já tinha um pedido para este horário."
                : "Pedido registrado com sucesso!"}{" "}
              Você é o <span className="font-semibold">nº {result.position}</span> da fila para esse
              horário. Sua reserva das {currentStart}–{endTime.slice(0, 5)} continua valendo
              normalmente até a troca ser confirmada.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Reserva atual: {currentStart}–{endTime.slice(0, 5)} em{" "}
                {bookingDate.split("-").reverse().join("/")} ({courtLabel(court)}).
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Novo horário de início</Label>
                <Select value={newStart} onValueChange={setNewStart}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o horário" />
                  </SelectTrigger>
                  <SelectContent>
                    {starts.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}–{addMinutes(s, durationMin)}
                        {s === currentStart ? " (horário atual)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quadra</Label>
                <Select
                  value={courtChoice}
                  onValueChange={(v) => setCourtChoice(v as typeof courtChoice)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same">Mesma quadra ({courtLabel(court)})</SelectItem>
                    <SelectItem value="other_floor">Trocar de modalidade — {otherFloorLabel}</SelectItem>
                    <SelectItem value="any">Qualquer quadra disponível</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Isso não cancela sua reserva atual. Você entra na lista de espera do novo horário —
                quem ainda não tem nenhuma quadra marcada nesse horário tem prioridade. Se
                confirmado, a equipe avisa e a reserva atual é cancelada automaticamente.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              {result ? "Fechar" : "Cancelar"}
            </Button>
            {!result && (
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Entrar na lista de espera
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

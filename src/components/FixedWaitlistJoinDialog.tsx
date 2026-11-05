import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
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
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { WEEKDAY_LABELS } from "@/lib/pricing";

interface CourtWindow {
  court: number;
  opens_on: string;
  closes_on: string;
}

interface CourtHours {
  court: number;
  weekday: number;
  open_time: string;
  close_time: string;
}

interface JoinResult {
  ok: boolean;
  error?: string;
  id?: string;
  position?: number;
  total?: number;
  tied?: boolean;
  already?: boolean;
}

function hourSlots(open: string, close: string): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  let [h, m] = open.slice(0, 5).split(":").map(Number);
  const [ch, cm] = close.slice(0, 5).split(":").map(Number);
  while (h * 60 + m < ch * 60 + cm) {
    const start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    let nh = h + 1;
    const end = `${String(nh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    slots.push({ start, end });
    h = nh;
  }
  return slots;
}

interface Props {
  variant: "professor" | "client";
  /** variant="client": o cliente em nome de quem inscrever (conta ativa do portal). */
  clientId?: string;
}

/**
 * Botão + diálogo "Entrar na fila de horário fixo" — compartilhado entre o
 * portal do professor (em nome de um aluno vinculado) e o portal do
 * cliente (em nome próprio). Só mostra quadras com janela de inscrição
 * aberta hoje, e horários vindos da grade configurada por quadra+dia
 * (cobre grids "quebrados").
 */
export function FixedWaitlistJoinDialog({ variant, clientId }: Props) {
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<CourtWindow[]>([]);
  const [hours, setHours] = useState<CourtHours[]>([]);
  const [court, setCourt] = useState<string>("");
  const [weekday, setWeekday] = useState<string>("");
  const [slot, setSlot] = useState<string>("");
  const [students, setStudents] = useState<ClientOption[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<JoinResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setCourt("");
    setWeekday("");
    setSlot("");
    setStudentId("");
    setResult(null);
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: w }, { data: h }] = await Promise.all([
        supabase
          .from("fixed_waitlist_court_settings")
          .select("court, opens_on, closes_on")
          .eq("active", true)
          .lte("opens_on", today)
          .gte("closes_on", today),
        supabase
          .from("fixed_waitlist_court_hours")
          .select("court, weekday, open_time, close_time"),
      ]);
      setWindows((w as CourtWindow[]) ?? []);
      setHours((h as CourtHours[]) ?? []);
    })();
    if (variant === "professor") {
      (async () => {
        const data = await fetchAll<ClientOption & { active: boolean }>(
          "clients",
          "id, full_name, active",
        );
        setStudents(
          data
            .filter((c) => c.active)
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
        );
      })();
    }
  }, [open, variant]);

  const availableCourts = windows.filter((w) =>
    hours.some((h) => h.court === w.court),
  );
  const weekdaysForCourt = hours.filter((h) => h.court === Number(court));
  const hoursRow = weekdaysForCourt.find((h) => h.weekday === Number(weekday));
  const slots = hoursRow ? hourSlots(hoursRow.open_time, hoursRow.close_time) : [];

  const handleSubmit = async () => {
    if (!court || weekday === "" || !slot) {
      toast.error("Selecione quadra, dia da semana e horário.");
      return;
    }
    if (variant === "professor" && !studentId) {
      toast.error("Selecione o aluno.");
      return;
    }
    const [start, end] = slot.split("-");
    setSubmitting(true);
    const { data, error } = await supabase.rpc("fixed_waitlist_join", {
      _court: Number(court),
      _weekday: Number(weekday),
      _start: `${start}:00`,
      _end: `${end}:00`,
      _client_id: variant === "professor" ? studentId : (clientId ?? null),
    } as never);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as unknown as JoinResult;
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível entrar na fila.");
      return;
    }
    setResult(res);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4 mr-2" /> Fila de horário fixo
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entrar na fila de horário fixo</DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="space-y-3">
              <div className="rounded-md bg-success/10 border border-success/30 px-3 py-3 text-sm">
                {result.already
                  ? "Você já está inscrito nessa fila."
                  : "Inscrição registrada com sucesso!"}{" "}
                Você é o <span className="font-semibold">nº {result.position}</span> da fila
                {result.total ? ` (de ${result.total})` : ""}.
              </div>
              {result.tied && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  ⚠️ Há um empate de horário de inscrição nessa posição — em caso de disputa, a
                  equipe resolve por sorteio.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {availableCourts.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  Nenhuma fila de horário fixo está aberta no momento.
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Quadra</Label>
                    <Select value={court} onValueChange={(v) => { setCourt(v); setWeekday(""); setSlot(""); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a quadra" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCourts.map((w) => (
                          <SelectItem key={w.court} value={String(w.court)}>
                            Quadra {w.court}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {court && (
                    <div className="space-y-1">
                      <Label className="text-xs">Dia da semana</Label>
                      <Select value={weekday} onValueChange={(v) => { setWeekday(v); setSlot(""); }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o dia" />
                        </SelectTrigger>
                        <SelectContent>
                          {weekdaysForCourt.map((h) => (
                            <SelectItem key={h.weekday} value={String(h.weekday)}>
                              {WEEKDAY_LABELS[h.weekday]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {court && weekday !== "" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Horário</Label>
                      <Select value={slot} onValueChange={setSlot}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o horário" />
                        </SelectTrigger>
                        <SelectContent>
                          {slots.map((s) => (
                            <SelectItem key={s.start} value={`${s.start}-${s.end}`}>
                              {s.start}–{s.end}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {variant === "professor" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Aluno</Label>
                      <ClientCombobox
                        clients={students}
                        value={studentId}
                        onChange={setStudentId}
                        placeholder="Selecione o aluno"
                        allowClear={false}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {result ? "Fechar" : "Cancelar"}
            </Button>
            {!result && availableCourts.length > 0 && (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Entrar na fila
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

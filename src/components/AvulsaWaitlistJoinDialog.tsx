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
import { Input } from "@/components/ui/input";
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
import { ClipboardList, Loader2 } from "lucide-react";

interface JoinResult {
  ok: boolean;
  error?: string;
  id?: string;
  position?: number;
  already?: boolean;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mesma janela de funcionamento online usada em portal_join_court_waitlist:
// fds abre 07h e fecha 19h; sexta abre 05h e fecha 22h; demais dias 05h–23h.
function operatingHoursFor(dateISO: string): { open: number; close: number } {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dow = new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
  if (dow === 0 || dow === 6) return { open: 7, close: 19 };
  if (dow === 5) return { open: 5, close: 22 };
  return { open: 5, close: 23 };
}

function hourSlotsFor(dateISO: string): { start: string; end: string }[] {
  const { open, close } = operatingHoursFor(dateISO);
  const slots: { start: string; end: string }[] = [];
  for (let h = open; h < close; h++) {
    slots.push({
      start: `${String(h).padStart(2, "0")}:00`,
      end: `${String(h + 1).padStart(2, "0")}:00`,
    });
  }
  return slots;
}

// Horários de início válidos pra um pedido de 2h seguidas — precisa caber
// as 2 horas inteiras dentro do funcionamento online.
function twoHourStartsFor(dateISO: string): string[] {
  const { open, close } = operatingHoursFor(dateISO);
  const starts: string[] = [];
  for (let h = open; h <= close - 2; h++) {
    starts.push(`${String(h).padStart(2, "0")}:00`);
  }
  return starts;
}

interface Props {
  variant: "professor" | "client";
  /** variant="client": o cliente em nome de quem inscrever (conta ativa do portal). */
  clientId?: string;
  /** Texto do botão que abre o diálogo. */
  buttonLabel?: string;
}

/**
 * Botão + diálogo "Entrar na fila avulsa" — pra um dia/horário específico
 * (não recorrente). Reaproveita a
 * mesma RPC portal_join_court_waitlist já usada pelo fluxo contextual de
 * quadra ocupada (WaitlistJoinButton), agora também acessível de forma
 * autônoma pelo portal do professor/cliente.
 */
export function AvulsaWaitlistJoinDialog({ variant, clientId, buttonLabel = "Fila avulsa" }: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [court, setCourt] = useState<string>("any");
  const [duration, setDuration] = useState<"1h" | "2h">("1h");
  const [slot, setSlot] = useState<string>("");
  const [twoHourStart, setTwoHourStart] = useState<string>("");
  const [students, setStudents] = useState<ClientOption[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<JoinResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setCourt("any");
    setDuration("1h");
    setSlot("");
    setTwoHourStart("");
    setStudentId("");
    setResult(null);
    if (variant === "professor") {
      void fetchAll<ClientOption & { active: boolean }>("clients", "id, full_name, active").then(
        (data) =>
          setStudents(
            data
              .filter((c) => c.active)
              .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
          ),
      );
    }
  }, [open, variant]);

  const slots = hourSlotsFor(date);
  const twoHourStarts = twoHourStartsFor(date);
  const twoHourEnd = twoHourStart
    ? `${String(Number(twoHourStart.slice(0, 2)) + 2).padStart(2, "0")}:00`
    : "";

  const handleSubmit = async () => {
    if (duration === "1h" && !slot) {
      toast.error("Selecione o horário.");
      return;
    }
    if (duration === "2h" && !twoHourStart) {
      toast.error("Selecione o horário de início.");
      return;
    }
    if (variant === "professor" && !studentId) {
      toast.error("Selecione o aluno.");
      return;
    }
    const [start, end] =
      duration === "1h" ? slot.split("-") : [twoHourStart, twoHourEnd];
    setSubmitting(true);
    const { data, error } = await supabase.rpc("portal_join_court_waitlist", {
      _date: date,
      _start: `${start}:00`,
      _end: `${end}:00`,
      _court: court === "pickleball" ? 0 : court === "tenis" ? 1 : null,
      _client_id: variant === "professor" ? studentId : (clientId ?? null),
      _court_continuity: duration === "2h" ? "allow_court_change" : "same_court",
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
        <ClipboardList className="h-4 w-4 mr-2" /> {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entrar na fila de espera avulsa</DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="rounded-md bg-success/10 border border-success/30 px-3 py-3 text-sm">
              {result.already
                ? "Você já está inscrito nessa fila."
                : "Inscrição registrada com sucesso!"}{" "}
              Você é o <span className="font-semibold">nº {result.position}</span> da fila.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Data</Label>
                <Input
                  type="date"
                  value={date}
                  min={todayISO()}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlot("");
                    setTwoHourStart("");
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Quadra</Label>
                <Select value={court} onValueChange={setCourt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    <SelectItem value="tenis">Tênis (saibro)</SelectItem>
                    <SelectItem value="pickleball">Pickleball (qualquer quadra)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setDuration("1h"); setTwoHourStart(""); }}
                  className={`rounded-md border p-2 text-sm text-center transition ${
                    duration === "1h"
                      ? "border-primary bg-primary/10 font-medium"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  1 hora
                </button>
                <button
                  type="button"
                  onClick={() => { setDuration("2h"); setSlot(""); }}
                  className={`rounded-md border p-2 text-sm text-center transition ${
                    duration === "2h"
                      ? "border-primary bg-primary/10 font-medium"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  2h seguidas
                </button>
              </div>

              {duration === "1h" ? (
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
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Horário início</Label>
                      <Select value={twoHourStart} onValueChange={setTwoHourStart}>
                        <SelectTrigger>
                          <SelectValue placeholder="Início" />
                        </SelectTrigger>
                        <SelectContent>
                          {twoHourStarts.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Horário fim</Label>
                      <Input value={twoHourEnd} disabled placeholder="Fim" />
                    </div>
                  </div>
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-500/40 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <strong>Atenção:</strong> pra conseguir avisar mais rápido, as 2 horas
                    seguidas podem acontecer em quadras diferentes (uma hora em uma quadra, a
                    próxima em outra).
                  </div>
                </>
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

              <p className="text-xs text-muted-foreground">
                A entrada na lista de espera não garante a reserva — a confirmação é feita pela
                equipe assim que um horário for liberado.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {result ? "Fechar" : "Cancelar"}
            </Button>
            {!result && (
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

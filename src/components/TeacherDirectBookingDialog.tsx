import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CalendarPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { courtLabel, fmtDateBR, hourLabel, hourEndLabel } from "@/lib/court-map";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  court: number;
  hour: number;
  date: string; // yyyy-mm-dd
  teacherId: string;
  teacherName: string;
  onBooked: () => void;
}

interface LinkedClient {
  id: string;
  full_name: string;
  active: boolean;
}

// Em nome de quem fica a locação: o próprio professor, um cliente
// vinculado a ele (id do cliente) ou um nome livre digitado.
const FOR_SELF = "__eu__";
const FREE_NAME = "__outro__";

export function TeacherDirectBookingDialog({
  open,
  onClose,
  court,
  hour,
  date,
  teacherId,
  teacherName,
  onBooked,
}: Props) {
  const [linkedClients, setLinkedClients] = useState<LinkedClient[]>([]);
  const [selected, setSelected] = useState("");
  const [freeName, setFreeName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected("");
    setFreeName("");
    let cancelled = false;
    // Mesma lista de "clientes vinculados" do RequestReservationDialog:
    // vínculo principal (clients.teacher_id) + vínculos extras (client_teachers).
    Promise.all([
      supabase.from("clients").select("id, full_name, active").eq("teacher_id", teacherId),
      supabase
        .from("client_teachers")
        .select("clients!client_id(id, full_name, active)")
        .eq("teacher_id", teacherId),
    ]).then(([{ data: primary }, { data: links }]) => {
      if (cancelled) return;
      const byId = new Map<string, LinkedClient>();
      ((primary ?? []) as LinkedClient[]).forEach((c) => byId.set(c.id, c));
      ((links ?? []) as Array<{ clients: LinkedClient | null }>).forEach((r) => {
        if (r.clients) byId.set(r.clients.id, r.clients);
      });
      setLinkedClients(
        Array.from(byId.values())
          .filter((c) => c.active)
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, teacherId]);

  const forSelf = selected === FOR_SELF;
  const isFreeName = selected === FREE_NAME;
  const clientId = selected && !forSelf && !isFreeName ? selected : null;
  const canSubmit = forSelf || !!clientId || (isFreeName && freeName.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    // RPC ainda não reflete no types.ts gerado — mesmo padrão usado em
    // outras RPCs novas neste arquivo (ex.: visualizador_map_bookings).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("professor_create_direct_booking", {
      _court: court,
      _date: date,
      _hour: hour,
      _client_id: clientId,
      _guest_name: isFreeName ? freeName.trim() : null,
      _for_self: forSelf,
    });
    setSubmitting(false);
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      toast.error(result?.error ?? error?.message ?? "Não foi possível marcar a quadra.");
      return;
    }
    toast.success("Quadra marcada com sucesso.");
    onBooked();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar quadra</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-md border p-3 space-y-1">
            <div>
              <strong>Quadra:</strong> {courtLabel(court)}
            </div>
            <div>
              <strong>Data:</strong> {fmtDateBR(date)}
            </div>
            <div>
              <strong>Horário:</strong> {hourLabel(hour)}–{hourEndLabel(hour)}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Em nome de *</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger>
                <SelectValue placeholder="Para quem é a quadra?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOR_SELF}>{teacherName} (eu)</SelectItem>
                {linkedClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                  </SelectItem>
                ))}
                <SelectItem value={FREE_NAME}>Outro (digitar o nome)</SelectItem>
              </SelectContent>
            </Select>
            {isFreeName && (
              <Input
                placeholder="Nome de quem vai jogar"
                value={freeName}
                onChange={(e) => setFreeName(e.target.value)}
                autoFocus
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4 mr-2" />
            )}
            Marcar quadra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

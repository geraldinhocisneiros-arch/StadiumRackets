import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { toast } from "sonner";
import { ClipboardList, Loader2 } from "lucide-react";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  /** Data pré-selecionada ao abrir (ex.: a data que o mapa está mostrando). */
  defaultDate?: string;
  onAdded?: () => void;
}

/**
 * Botão + diálogo "Lista de espera" pro mapa de quadras — mesma entrada
 * (avulsa, um dia específico) que a página /espera já oferece, só que sem
 * precisar sair do mapa pra cadastrar alguém que ligou pedindo horário.
 */
export function StaffWaitlistAddDialog({ defaultDate, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [clientId, setClientId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [date, setDate] = useState(defaultDate ?? todayISO());
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [court, setCourt] = useState<string>("any");
  const [priority, setPriority] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const openDialog = () => {
    setClientId("");
    setGuestName("");
    setDate(defaultDate ?? todayISO());
    setStartTime("18:00");
    setEndTime("19:00");
    setCourt("any");
    setPriority("0");
    setNotes("");
    setOpen(true);
    setLoadingClients(true);
    void fetchAll<ClientOption & { active: boolean }>("clients", "id, full_name, active").then(
      (data) => {
        setClients(
          data
            .filter((c) => c.active)
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
        );
        setLoadingClients(false);
      },
    );
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId && !guestName.trim()) {
      toast.error("Escolha um cliente ou informe um nome livre.");
      return;
    }
    if (startTime >= endTime) {
      toast.error("Horário final deve ser depois do inicial.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("court_waitlist").insert({
      client_id: clientId || null,
      guest_name: clientId ? null : guestName.trim(),
      desired_date: date,
      start_time: startTime,
      end_time: endTime,
      court: court === "pickleball" ? 0 : court === "tenis" ? 1 : null,
      priority: Number(priority) || 0,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Adicionado à lista de espera.");
    setOpen(false);
    onAdded?.();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <ClipboardList className="h-4 w-4 mr-2" /> Lista de espera
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova entrada na lista de espera</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <div>
              <Label>Cliente</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={(id) => {
                  setClientId(id);
                  if (id) setGuestName("");
                }}
              />
              {loadingClients && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando clientes…
                </p>
              )}
            </div>
            <div>
              <Label>Ou nome livre</Label>
              <Input
                value={guestName}
                onChange={(e) => {
                  setGuestName(e.target.value);
                  if (e.target.value) setClientId("");
                }}
                placeholder="Nome livre (sem cadastro)"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Data desejada</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <Label>Quadra</Label>
                <Select value={court} onValueChange={setCourt}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    <SelectItem value="tenis">Tênis (saibro)</SelectItem>
                    <SelectItem value="pickleball">Pickleball (qualquer quadra)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Início</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Fim</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Prioridade</Label>
                <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
import { MessageCircle, Loader2, CreditCard } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { courtLabel, fmtDateBR, hourLabel, hourEndLabel } from "@/lib/court-map";
import { buildWhatsAppUrl, normalizePhoneForWhatsApp, openWhatsApp } from "@/lib/whatsapp";
import { createCourtBookingPaymentPreference } from "@/lib/payments.functions";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  court: number;
  hour: number;
  date: string; // yyyy-mm-dd
  userName: string;
  userRole: "Cliente" | "Professor";
  /** Necessário pra habilitar o pagamento online (só disponível pra clientes do portal). */
  clientId?: string | null;
  /** Professor: lista os clientes vinculados a ele pra escolher para quem é a reserva. */
  teacherId?: string | null;
}

interface LinkedClient {
  id: string;
  full_name: string;
  active: boolean;
}

const OTHER_CLIENT = "__outro__";

export function RequestReservationDialog({
  open,
  onClose,
  court,
  hour,
  date,
  userName,
  userRole,
  clientId,
  teacherId,
}: Props) {
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [paying, setPaying] = useState(false);
  // Professor reserva pra um aluno: o nome do cliente já vai na mensagem
  // (e na pré-reserva do mapa), sem a secretaria precisar perguntar depois.
  // Lista os clientes vinculados a ele; "Outro" cobre aluno ainda sem vínculo.
  const isTeacher = userRole === "Professor";
  const [linkedClients, setLinkedClients] = useState<LinkedClient[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [otherName, setOtherName] = useState("");
  const createPreferenceFn = useServerFn(createCourtBookingPaymentPreference);

  useEffect(() => {
    if (!open || !isTeacher) return;
    setSelectedClient("");
    setOtherName("");
    const loadLinkedClients = async () => {
      let tid = teacherId ?? null;
      if (!tid) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const { data: t } = await supabase
          .from("teachers")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        tid = t?.id ?? null;
      }
      if (!tid) return;
      return Promise.all([
        supabase.from("clients").select("id, full_name, active").eq("teacher_id", tid),
        supabase
          .from("client_teachers")
          .select("clients!client_id(id, full_name, active)")
          .eq("teacher_id", tid),
      ]);
    };
    loadLinkedClients().then((res) => {
      if (!res) return;
      const [{ data: primary }, { data: links }] = res;
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
  }, [open, isTeacher, teacherId]);

  const clientName =
    selectedClient === OTHER_CLIENT
      ? otherName
      : (linkedClients.find((c) => c.id === selectedClient)?.full_name ?? "");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "whatsapp_reservations_number")
      .maybeSingle()
      .then(({ data }) => {
        setPhone(normalizePhoneForWhatsApp(data?.value ?? null));
        setLoading(false);
      });
  }, [open]);

  const send = async () => {
    if (!phone) {
      toast.error(
        "WhatsApp oficial ainda não configurado. Peça para a diretoria cadastrar em Usuários → Configurações.",
      );
      return;
    }
    const client = clientName.trim();
    if (isTeacher && !client) {
      toast.error("Escolha para qual cliente é a reserva.");
      return;
    }
    setSending(true);
    // Pré-reserva de 7 minutos: segura o horário pra ninguém mais
    // conseguir reservar enquanto a secretaria não responde.
    const { data, error } = await supabase.rpc("request_court_booking_hold", {
      _court: court,
      _date: date,
      _start: `${String(hour).padStart(2, "0")}:00:00`,
      _end: `${String(hour + 1).padStart(2, "0")}:00:00`,
      _label: client
        ? `${userName} (${userRole}) — cliente: ${client}`
        : `${userName} (${userRole})`,
    });
    setSending(false);
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      toast.error(
        result?.error ??
          error?.message ??
          "Não foi possível segurar este horário. Tente novamente.",
      );
      return;
    }
    const message =
      `Olá! Gostaria de solicitar uma reserva de quadra.\n\n` +
      `Nome: ${userName}\n` +
      `Perfil: ${userRole}\n` +
      (client ? `Cliente: ${client}\n` : "") +
      `Quadra: ${courtLabel(court)}\n` +
      `Data: ${fmtDateBR(date)}\n` +
      `Horário: ${hourLabel(hour)}–${hourEndLabel(hour)}\n\n` +
      `Aguardo a confirmação da secretaria.`;
    openWhatsApp(buildWhatsAppUrl(phone, message));
    onClose();
  };

  const payOnline = async () => {
    if (!clientId) {
      toast.error("Pagamento online disponível só pelo portal do cliente.");
      return;
    }
    setPaying(true);
    try {
      const { data: holdRes, error: holdErr } = await supabase.rpc(
        "portal_create_paid_booking_hold",
        {
          _court: court,
          _date: date,
          _start: `${String(hour).padStart(2, "0")}:00:00`,
          _end: `${String(hour + 1).padStart(2, "0")}:00:00`,
          _client_id: clientId,
        },
      );
      const hold = holdRes as { ok: boolean; booking_id?: string; error?: string } | null;
      if (holdErr || !hold?.ok || !hold.booking_id) {
        toast.error(hold?.error ?? holdErr?.message ?? "Não foi possível segurar este horário.");
        return;
      }
      const pref = await createPreferenceFn({ data: { bookingId: hold.booking_id, clientId } });
      window.location.href = pref.initPoint;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível iniciar o pagamento.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar reserva de quadra</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>Você selecionou:</p>
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
          {isTeacher && (
            <div className="space-y-1.5">
              <Label>Cliente *</Label>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Para qual cliente é a reserva?" />
                </SelectTrigger>
                <SelectContent>
                  {linkedClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_CLIENT}>Outro (digitar o nome)</SelectItem>
                </SelectContent>
              </Select>
              {selectedClient === OTHER_CLIENT && (
                <Input
                  placeholder="Nome do cliente"
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          )}
          {clientId && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs space-y-2">
              <div>
                <strong>Pague agora com Pix ou cartão</strong> e a reserva é confirmada
                automaticamente assim que o pagamento cair — sem esperar a secretaria.
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={payOnline}
                disabled={paying || sending}
              >
                {paying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Pagar com Pix ou cartão
              </Button>
            </div>
          )}
          <p>
            Ou envie uma mensagem para o WhatsApp oficial do Stadium Rackets — a recepção
            confirma manualmente.
          </p>
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-500/40 p-3 text-xs text-amber-900 dark:text-amber-200">
            <strong>Atenção:</strong> o envio da mensagem não garante a reserva. Este horário fica
            reservado com prioridade pra você por 7 minutos, aguardando a confirmação da nossa
            secretaria.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending || paying}>
            Voltar
          </Button>
          <Button onClick={send} disabled={loading || sending || paying}>
            {loading || sending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4 mr-2" />
            )}
            Solicitar pelo WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

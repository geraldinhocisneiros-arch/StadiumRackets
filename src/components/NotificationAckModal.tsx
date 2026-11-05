import { useNotificationsContext } from "@/hooks/useNotifications";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Check,
  X,
  MessageCircle,
  CalendarCheck,
  Phone,
  Loader2,
  Receipt,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { useWaitlistTeacherPicker } from "@/hooks/useWaitlistTeacherPicker";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { respondBookingConfirmation } from "@/lib/booking-confirmations.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  buildWhatsAppUrl,
  logWhatsAppSent,
  normalizePhoneForWhatsApp,
  openWhatsApp,
} from "@/lib/whatsapp";
import { courtShort } from "@/lib/court-map";

interface WaitlistCandidate {
  waitlist_id: string;
  client_id: string | null;
  teacher_id: string | null;
  full_name: string | null;
  guest_name: string | null;
  teacher_name: string | null;
  w_start: string;
  w_end: string;
  w_court: number | null;
  priority: number;
  notes: string | null;
}

interface WaitlistPlanBlock {
  start: string;
  end: string;
  court: number;
}

interface WaitlistMetadata {
  dedup_key?: string;
  for_first?: boolean;
  date?: string;
  start_time?: string;
  end_time?: string;
  court?: number | null;
  candidates?: WaitlistCandidate[];
  availability_plan?: WaitlistPlanBlock[];
}

/**
 * Mostra, em um modal bloqueante, qualquer notificação com `requires_ack = true`
 * ainda não lida. A recepção/diretoria precisa clicar em OK para dar ciência.
 */
export function NotificationAckModal({ excludeKinds = [] }: { excludeKinds?: string[] } = {}) {
  const { items, markRead, reload } = useNotificationsContext();
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const confirm = useConfirm();
  const teacherPicker = useWaitlistTeacherPicker();
  const respondFn = useServerFn(respondBookingConfirmation);

  const pending = items.filter(
    (n) => n.requires_ack && !n.read_at && !excludeKinds.includes(n.kind),
  );
  const current = pending[0] ?? null;

  // Avisos que exigem uma decisão específica (confirmar presença, escolher
  // jogo, aceitar/recusar vaga) não entram no "marcar todos" — só os
  // simples "OK, ciente" (ex.: cancelamento de aula pelo professor), que
  // são os que empilham em lote e travam a tela com N cliques repetidos.
  const ACTIONABLE_KINDS = new Set([
    "booking_confirm_4h",
    "waitlist_slot_available",
    "professor_late_cancel",
  ]);
  const bulkAckable = pending.filter((n) => !ACTIONABLE_KINDS.has(n.kind));
  // Com mais de um aviso simples na fila, mostra todos num modal só (lista
  // + um único "OK, ciente") em vez de abrir um modal atrás do outro. Os
  // que exigem decisão continuam aparecendo um a um depois.
  const isDigest = !!current && !ACTIONABLE_KINDS.has(current.kind) && bulkAckable.length > 1;
  const actionablePending = pending.length - bulkAckable.length;

  const isConfirm4h = current?.kind === "booking_confirm_4h";
  const isWaitlist = current?.kind === "waitlist_slot_available";
  const waitlistMeta = (isWaitlist ? (current?.metadata as WaitlistMetadata | null) : null) ?? null;
  const isWaitlistForFirst = isWaitlist && !!waitlistMeta?.for_first;
  const isLateCancel = current?.kind === "professor_late_cancel";
  const navigate = useNavigate();

  // Cancelamento tardio pelo professor: "Lançar no caixa" abre o Caixa com
  // o débito pré-preenchido — o aviso só é fechado quando o lançamento é
  // salvo lá (professor_late_cancel_resolve). "Não cobrar" fecha aqui.
  const onLateCancelCharge = () => {
    if (!current) return;
    void navigate({ to: "/caixa", search: { lateCancel: current.id } });
  };

  const onLateCancelWaive = async () => {
    if (!current) return;
    if (
      !(await confirm({
        title: "Não cobrar este cancelamento?",
        description:
          "O débito da quadra NÃO será lançado na conta do cliente. Use só para casos justificados (ex.: chuva, quadra interditada).",
        confirmText: "Não cobrar",
        cancelText: "Voltar",
      }))
    ) {
      return;
    }
    setAckingId(current.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("professor_late_cancel_resolve", {
        _notification_id: current.id,
        _outcome: "waived",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      await reload();
    } finally {
      setAckingId(null);
    }
  };

  // markRead já tira o aviso da tela na hora (otimista); não precisa
  // esperar o servidor nem travar os botões enquanto isso.
  const onAck = () => {
    if (!current) return;
    void markRead(current.id);
  };

  const onAckAll = () => {
    if (bulkAckable.length === 0) return;
    for (const n of bulkAckable) void markRead(n.id);
  };

  const onRespond = async (action: "confirm" | "cancel") => {
    if (!current) return;
    setAckingId(current.id);
    try {
      await respondFn({ data: { notificationId: current.id, action } });
      toast.success(
        action === "confirm" ? "Presença confirmada" : "Locação cancelada. A quadra foi liberada.",
      );
      setConfirmingCancel(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao responder");
    } finally {
      setAckingId(null);
    }
  };

  const sendWaitlistWhatsApp = async (cand: WaitlistCandidate) => {
    setBusyRow(cand.waitlist_id);
    try {
      let phone: string | null = null;
      let name = cand.full_name ?? cand.teacher_name ?? cand.guest_name ?? "";
      if (cand.client_id) {
        const { data } = await supabase
          .from("clients")
          .select("phone, full_name")
          .eq("id", cand.client_id)
          .maybeSingle();
        phone = normalizePhoneForWhatsApp((data as { phone?: string } | null)?.phone);
        name = (data as { full_name?: string } | null)?.full_name ?? name;
      } else if (cand.teacher_id) {
        const { data } = await supabase
          .from("teachers")
          .select("phone, name")
          .eq("id", cand.teacher_id)
          .maybeSingle();
        phone = normalizePhoneForWhatsApp((data as { phone?: string } | null)?.phone);
        name = (data as { name?: string } | null)?.name ?? name;
      }
      if (!phone) {
        toast.error("Contato manual — sem WhatsApp cadastrado.");
        return;
      }
      const dateBR = waitlistMeta?.date ? waitlistMeta.date.split("-").reverse().join("/") : "";
      const start = (waitlistMeta?.start_time ?? "").slice(0, 5);
      const end = (waitlistMeta?.end_time ?? "").slice(0, 5);
      const court = waitlistMeta?.court ? `${courtShort(waitlistMeta.court)}` : "quadra";
      const msg = `Olá ${name}! Vagou uma quadra que você pediu na lista de espera: ${dateBR} às ${start}-${end} (${court}). Confirma se você vai querer?`;
      openWhatsApp(buildWhatsAppUrl(phone, msg));
      if (cand.client_id) await logWhatsAppSent(cand.client_id, "waitlist_slot_available");
      // Marca como aguardando confirmação
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("waitlist_set_awaiting", {
        _waitlist_id: cand.waitlist_id,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("WhatsApp aberto e candidato marcado como aguardando.");
    } finally {
      setBusyRow(null);
    }
  };

  const markCandidate = async (cand: WaitlistCandidate) => {
    const name = cand.full_name ?? cand.guest_name ?? "esta pessoa";
    const choice = await teacherPicker.pick(
      cand.waitlist_id,
      `Marcar ${name} em ${cand.w_start.slice(0, 5)}–${cand.w_end.slice(0, 5)}?`,
    );
    if (!choice) return;
    setBusyRow(cand.waitlist_id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("waitlist_mark_and_book", {
        _waitlist_id: cand.waitlist_id,
        _teacher_id: choice.teacherId,
        _teacher_set: true,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Quadra reservada.");
      if (current) await markRead(current.id);
    } finally {
      setBusyRow(null);
    }
  };

  const requestClubConfirmation = async () => {
    if (!current) return;
    setAckingId(current.id);
    try {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "whatsapp_reservations_number")
        .maybeSingle();
      const phone = normalizePhoneForWhatsApp((data as { value?: string } | null)?.value ?? null);
      if (!phone) {
        toast.error(
          "WhatsApp oficial ainda não configurado. Peça para a diretoria cadastrar em Usuários → Configurações.",
        );
        return;
      }
      const dateBR = waitlistMeta?.date ? waitlistMeta.date.split("-").reverse().join("/") : "";
      const start = (waitlistMeta?.start_time ?? "").slice(0, 5);
      const end = (waitlistMeta?.end_time ?? "").slice(0, 5);
      const plan = waitlistMeta?.availability_plan;
      const court = plan?.length
        ? `${courtShort(plan[0]!.court)}`
        : waitlistMeta?.court
          ? `${courtShort(waitlistMeta.court)}`
          : "quadra";
      const msg = `Olá! Vagou o horário que eu estava aguardando na lista de espera: ${dateBR} às ${start}-${end} (${court}). Poderiam confirmar pra mim, por favor?`;
      openWhatsApp(buildWhatsAppUrl(phone, msg));
    } finally {
      setAckingId(null);
    }
  };

  return (
    <>
      <Dialog open={!!current}>
        <DialogContent
          className="sm:max-w-lg [&>button.absolute]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {isDigest
                ? `${bulkAckable.length} avisos aguardando ciência`
                : (current?.title ?? "Aviso")}
            </DialogTitle>
          </DialogHeader>
          {isDigest && (
            <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
              {bulkAckable.map((n) => (
                <div key={n.id} className="rounded-md border p-3 text-sm space-y-1">
                  <div className="font-medium">{n.title ?? "Aviso"}</div>
                  {n.body && (
                    <div className="whitespace-pre-line text-muted-foreground">{n.body}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {isDigest && actionablePending > 0 && (
            <div className="text-xs text-muted-foreground">
              +{actionablePending} aviso(s) que pedem resposta aparecem em seguida.
            </div>
          )}
          {!isDigest && current?.body && (
            <div className="whitespace-pre-line text-sm text-muted-foreground">{current.body}</div>
          )}
          {isWaitlist && waitlistMeta?.candidates && waitlistMeta.candidates.length > 0 && (
            <div className="space-y-2 max-h-80 overflow-auto">
              <div className="text-xs font-medium text-muted-foreground">
                Candidatos na lista de espera ({waitlistMeta.candidates.length})
              </div>
              {waitlistMeta.candidates.map((c) => (
                <div key={c.waitlist_id} className="rounded-md border p-2 text-sm space-y-1">
                  <div className="font-medium">
                    {c.full_name ?? c.guest_name ?? "—"}
                    {c.teacher_name && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · prof. {c.teacher_name}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Pediu {c.w_start.slice(0, 5)}-{c.w_end.slice(0, 5)}
                    {c.w_court ? ` · ${courtShort(c.w_court)}` : " · qualquer quadra"}
                    {c.priority > 0 ? ` · prioridade ${c.priority}` : ""}
                  </div>
                  {c.notes && <div className="text-xs">{c.notes}</div>}
                  <div className="flex gap-2 pt-1 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyRow === c.waitlist_id}
                      onClick={() => void sendWaitlistWhatsApp(c)}
                    >
                      <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busyRow === c.waitlist_id}
                      onClick={() => void markCandidate(c)}
                    >
                      <CalendarCheck className="h-3 w-3 mr-1" /> Marcar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!isDigest && pending.length > 1 && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>+{pending.length - 1} aviso(s) aguardando ciência.</span>
              {bulkAckable.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto py-1 px-2 text-xs"
                  onClick={onAckAll}
                  disabled={ackingId != null}
                >
                  Marcar todos como ciente ({bulkAckable.length})
                </Button>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {isConfirm4h ? (
              confirmingCancel ? (
                <div className="w-full space-y-3">
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-semibold mb-1">Cancelar locação?</div>
                    Ao confirmar, sua locação será cancelada e a quadra ficará disponível para
                    outros clientes.
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setConfirmingCancel(false)}
                      disabled={ackingId != null}
                    >
                      Voltar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void onRespond("cancel")}
                      disabled={ackingId != null}
                    >
                      Confirmar cancelamento
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmingCancel(true)}
                    disabled={ackingId != null}
                  >
                    <X className="h-4 w-4 mr-1" /> Não vou comparecer
                  </Button>
                  <Button onClick={() => void onRespond("confirm")} disabled={ackingId != null}>
                    <Check className="h-4 w-4 mr-1" /> Confirmar presença
                  </Button>
                </>
              )
            ) : isWaitlistForFirst ? (
              <>
                <Button variant="outline" onClick={onAck} disabled={ackingId != null}>
                  OK, ciente
                </Button>
                <Button onClick={() => void requestClubConfirmation()} disabled={ackingId != null}>
                  <Phone className="h-4 w-4 mr-1" /> Solicitar confirmação
                </Button>
              </>
            ) : isLateCancel ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void onLateCancelWaive()}
                  disabled={ackingId != null}
                >
                  Não cobrar
                </Button>
                <Button onClick={onLateCancelCharge} disabled={ackingId != null}>
                  <Receipt className="h-4 w-4 mr-1" /> Lançar no caixa
                </Button>
              </>
            ) : isDigest ? (
              <Button onClick={onAckAll} disabled={ackingId != null}>
                OK, ciente de todos ({bulkAckable.length})
              </Button>
            ) : (
              <Button onClick={onAck} disabled={ackingId != null}>
                OK, ciente
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {teacherPicker.element}
    </>
  );
}

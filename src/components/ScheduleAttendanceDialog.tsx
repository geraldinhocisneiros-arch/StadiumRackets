import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  computeAttendanceAmount,
  isChargeable,
  statusBadgeClass,
  statusLabel,
  type AttendanceStatus,
} from "@/lib/attendance-billing";
import type { FixedSchedule } from "@/lib/court-map";
import {
  STAFF_COURTS,
  HALF_SLOTS,
  courtLabel,
  hourLabel,
  hourEndLabel,
  fmtDateBR,
  timeToHours,
  hoursToTime,
  hoursToLabel,
  findFixedExceptionForHour,
  courtShort,
} from "@/lib/court-map";
import type { PriceBand } from "@/lib/pricing";
import { fmtBRL } from "@/lib/format";
import { effectiveClientDiscount } from "@/lib/category";
import {
  offerBookingCancelledNotification,
  offerBookingCourtChangeNotification,
  offerWhatsAppPaymentNotification,
  sendBookingConfirmationRequest,
} from "@/lib/whatsapp";
import { moveFixedToday } from "@/lib/fixed-swap";
import { MessageCircle, History, ArrowLeftRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { BookingHistoryDialog } from "@/components/BookingHistoryDialog";

export interface AttendanceRow {
  id: string;
  client_schedule_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  payment_id: string | null;
  amount: number | null;
}

export interface ClientAttendanceInfo {
  id: string;
  full_name: string;
  default_discount_percent: number | null;
  category_name?: string | null;
}

// Uma pessoa envolvida no slot (o cliente principal ou um dos que dividem o
// horário com ele) — cada uma com seu próprio client_schedule, marcável de
// forma independente.
interface Person {
  schedule: FixedSchedule;
  client: ClientAttendanceInfo | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string;
  hour: number;
  court: number;
  schedule: FixedSchedule;
  siblingsAtSlot: { schedule: FixedSchedule; status: AttendanceStatus | null }[];
  getAttendance: (scheduleId: string) => AttendanceRow | null;
  getClientInfo: (clientId: string) => ClientAttendanceInfo | null;
  client: ClientAttendanceInfo | null;
  priceBands: PriceBand[];
  mensalistaCategoryId: string | null;
  onSaved: () => void;
  onEditSchedule: () => void;
  canMove?: boolean;
  // Chamado depois que "Trocar cliente" cancela o mensalista atual só hoje
  // (sem cobrar) — o pai deve abrir o formulário de "Nova locação" nesta
  // mesma quadra/hora/data pra o operador colocar quem entrou no lugar.
  onSwapClient?: () => void;
  // `schedule` já veio com start/end de hoje sobrepostos por um "Mover só
  // hoje" que esticou a duração além do horário fixo recorrente — nesse
  // caso as exceções do fixo (que cobrem o horário ORIGINAL, liberado pela
  // mudança) não dizem nada sobre a janela nova, então ignora-se elas ao
  // calcular horas ativas/cobrança.
  ignoreExceptionsForBilling?: boolean;
  // Id da court_booking "movida do fixo" por trás desta célula, quando
  // aplicável — e os client_ids de quem entrou nela como PARTICIPANTE extra
  // (não dono da linha), por causa do índice único de court_bookings
  // (quadra/data/horário) quando dois+ fixos divididos caem no mesmo
  // horário exato ao mover (ver move_fixed_today na migration 20261007120000).
  // Cancelar o dono já libera a quadra atualizando esta court_booking; um
  // participante não tem court_booking própria, então cancelar dele precisa
  // tirá-lo de court_booking_participants pra sumir da célula (ver
  // upsertAttendanceCore).
  movedBookingId?: string | null;
  movedParticipantClientIds?: string[];
}

type Mode = "menu" | "confirm_cancel" | "partial_cancel" | "move_today";

const personName = (p: Person) => p.client?.full_name ?? p.schedule.clients?.full_name ?? "cliente";

export function ScheduleAttendanceDialog({
  open,
  onOpenChange,
  date,
  hour,
  court,
  schedule,
  siblingsAtSlot,
  getAttendance,
  getClientInfo,
  client,
  priceBands,
  mensalistaCategoryId,
  onSaved,
  onEditSchedule,
  canMove = false,
  ignoreExceptionsForBilling = false,
  onSwapClient,
  movedBookingId = null,
  movedParticipantClientIds = [],
}: Props) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [cancelTargets, setCancelTargets] = useState<Person[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { isAdmin, isDiretoria, isRecepcionista } = useAuth();
  const canSeeHistory = isAdmin || isDiretoria || isRecepcionista;

  const schedStartH = timeToHours(schedule.start_time);
  const schedEndH = timeToHours(schedule.end_time);
  const [moveCourt, setMoveCourt] = useState<number>(schedule.court ?? 1);
  const [moveStart, setMoveStart] = useState<number>(schedStartH);
  const [moveEnd, setMoveEnd] = useState<number>(schedEndH);

  useEffect(() => {
    if (open) {
      setMode("menu");
      setCancelTargets([]);
      setMoveCourt(schedule.court ?? 1);
      setMoveStart(schedStartH);
      setMoveEnd(schedEndH);
    }
  }, [open, schedule.court, schedStartH, schedEndH]);

  // Duração real do horário fixo do cliente principal (pode ser fracionária
  // num horário "quebrado", ex.: 11:30–13:30 = 2h, não 3 blocos de hora
  // cheia) — usada só no cabeçalho quando não há divisão.
  const scheduleSpanHours = Math.round(Math.max(0, schedEndH - schedStartH) * 100) / 100;

  // Todas as pessoas deste slot: o cliente principal + quem divide com ele.
  // Cada uma tem seu próprio client_schedule e pode ser marcada
  // independentemente (Veio/Faltou/Cancelou), com a cobrança recalculada
  // com base no status das DEMAIS (ver computeAttendanceAmount).
  const people: Person[] = [
    { schedule, client },
    ...siblingsAtSlot.map((s) => ({
      schedule: s.schedule,
      client: getClientInfo(s.schedule.client_id),
    })),
  ];

  const statusFor = (scheduleId: string): AttendanceStatus | null =>
    getAttendance(scheduleId)?.status ?? null;

  // `overrides` cobre o caso de "Cancelar para todos": todo mundo em
  // `cancelTargets` está recebendo o MESMO status nesta mesma ação, mas o
  // laço em `applyCancelReason` escreve um de cada vez — sem isso, ao
  // calcular a divisão do 1º cliente, o 2º ainda apareceria com o status
  // ANTIGO (o `getAttendance` do pai só atualiza depois que a ação toda
  // termina), inflando ou reduzindo a divisão indevidamente.
  const othersStatusesFor = (
    person: Person,
    overrides?: Map<string, AttendanceStatus>,
  ): (AttendanceStatus | null)[] =>
    people
      .filter((p) => p.schedule.id !== person.schedule.id)
      .map((p) => overrides?.get(p.schedule.id) ?? statusFor(p.schedule.id));

  // Horas ativas hoje (sem exceção), duração e janela de cobrança de UM
  // horário fixo específico — parametrizado porque cada pessoa que divide o
  // slot pode ter início/fim levemente diferentes (siblingsAtSlot é
  // filtrado pela hora clicada, não pelo range exato do cliente principal).
  const hoursInfoFor = (sched: FixedSchedule) => {
    const startH = timeToHours(sched.start_time);
    const endH = timeToHours(sched.end_time);
    const s = Math.floor(startH);
    const e = Math.ceil(endH);
    // Só ignora exceções pro schedule PRINCIPAL (o que veio com a janela
    // sobreposta pelo "Mover só hoje") — quem mais divide o slot continua
    // respeitando as próprias exceções normalmente.
    const skipExceptions = ignoreExceptionsForBilling && sched.id === schedule.id;
    const activeHrs: number[] = [];
    for (let h = s; h < e; h++) {
      if (skipExceptions || !findFixedExceptionForHour(sched.exceptions, h)) activeHrs.push(h);
    }
    const totalBlocks = Math.max(1, Math.ceil(endH) - Math.floor(startH));
    const billWindow = (h: number): { start: string; end: string } => ({
      start: hoursToTime(Math.max(startH, h)),
      end: hoursToTime(Math.min(endH, h + 1)),
    });
    return {
      startH,
      endH,
      activeHours: activeHrs,
      spanHours: Math.round(Math.max(0, endH - startH) * 100) / 100,
      totalBlocks,
      billWindow,
    };
  };

  // Preview de "quanto cobra se marcar como Veio" pra uma pessoa, dado o
  // status atual das demais que dividem o slot.
  const previewFor = (person: Person, othersStatuses: (AttendanceStatus | null)[]) => {
    if (!person.client) return null;
    const info = hoursInfoFor(person.schedule);
    let total = 0;
    let splitDen = 1;
    let matched = true;
    let hoursSum = 0;
    const hrs = info.activeHours.length ? info.activeHours : [hour];
    for (const h of hrs) {
      const win = info.billWindow(h);
      const r = computeAttendanceAmount({
        bands: priceBands,
        date,
        startTime: win.start,
        endTime: win.end,
        court,
        discountPercent: effectiveClientDiscount(person.client),
        siblingStatuses: othersStatuses,
        selfStatus: "came",
      });
      total += r.amount;
      splitDen = Math.max(splitDen, r.splitDenominator);
      if (!r.matched) matched = false;
      hoursSum += timeToHours(win.end) - timeToHours(win.start);
    }
    return {
      amount: Math.round(total * 100) / 100,
      splitDenominator: splitDen,
      matched,
      hoursCount: Math.round(hoursSum * 100) / 100,
    };
  };

  // Depois de mudar o status de UMA pessoa, quem mais divide o slot e JÁ
  // estava marcado como cobrável (veio/faltou/cancelou tarde cobrado) pode
  // estar com o valor errado agora — a divisão muda conforme quantos estão
  // cobráveis ao mesmo tempo. Ex.: Graco marcado "Veio" sozinho paga o
  // valor cheio; quando Rafael também é marcado "Veio" depois, sem isso o
  // lançamento do Graco continuaria cheio (dividido só o do Rafael),
  // cobrando 1,5x o valor da quadra no total. Recalcula e corrige o
  // pagamento de cada cobrável afetado (pra mais OU pra menos — cancelar
  // um também devolve o outro pro valor cheio).
  const recalcOtherChargeableAmounts = async (
    justChangedScheduleId: string,
    effectiveOverrides: Map<string, AttendanceStatus>,
  ) => {
    for (const p of people) {
      if (p.schedule.id === justChangedScheduleId) continue;
      const att = getAttendance(p.schedule.id);
      if (!att || !isChargeable(att.status) || !p.client) continue;
      const info = hoursInfoFor(p.schedule);
      const hrs = info.activeHours.length ? info.activeHours : [hour];
      const othersStatuses = othersStatusesFor(p, effectiveOverrides);
      let total = 0;
      let matched = true;
      for (const h of hrs) {
        const win = info.billWindow(h);
        const bill = computeAttendanceAmount({
          bands: priceBands,
          date,
          startTime: win.start,
          endTime: win.end,
          court,
          discountPercent: effectiveClientDiscount(p.client),
          siblingStatuses: othersStatuses,
          selfStatus: att.status,
        });
        if (!bill.matched) matched = false;
        total += bill.amount;
      }
      total = Math.round(total * 100) / 100;
      if (!matched || total === att.amount) continue;
      if (att.payment_id) {
        await supabase.from("payments").update({ amount: total }).eq("id", att.payment_id);
      }
      await supabase.from("client_schedule_attendance").update({ amount: total }).eq("id", att.id);
    }
  };

  // Núcleo de "marcar presença/falta/cancelamento pra UMA pessoa": gera (ou
  // regenera) o pagamento se cobrável, grava o status e, se for
  // cancelamento, libera a quadra só do client_schedule dessa pessoa — quem
  // mais divide o horário e continua vindo não é afetado. Corrige também o
  // pagamento de quem mais divide o slot, se a divisão deles mudou por
  // causa desta marcação (ver recalcOtherChargeableAmounts). Retorna false
  // (e já mostra o toast de erro) se algo falhar.
  const upsertAttendanceCore = async (
    person: Person,
    status: AttendanceStatus,
    batchOverrides?: Map<string, AttendanceStatus>,
  ): Promise<boolean> => {
    const { schedule: sched, client: cli } = person;
    if (!cli) {
      toast.error("Cliente não encontrado.");
      return false;
    }
    if (!mensalistaCategoryId && isChargeable(status)) {
      toast.error("Categoria 'Mensalista' não encontrada no caixa — cadastre-a antes.");
      return false;
    }
    const info = hoursInfoFor(sched);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Se já havia lançamento, remove antes (para regerar com o valor certo).
    const existingAttendance = getAttendance(sched.id);
    if (existingAttendance?.payment_id) {
      await supabase.from("payments").delete().eq("id", existingAttendance.payment_id);
    }

    // Gera pagamento se cobrável — soma o valor de todas as horas ativas
    // do horário fixo (por ex., 2h seguidas).
    let paymentId: string | null = null;
    let amount = 0;
    let splitDenominator = 1;
    if (isChargeable(status)) {
      const hrs = info.activeHours.length ? info.activeHours : [hour];
      let matched = true;
      const othersStatuses = othersStatusesFor(person, batchOverrides);
      for (const h of hrs) {
        const win = info.billWindow(h);
        const bill = computeAttendanceAmount({
          bands: priceBands,
          date,
          startTime: win.start,
          endTime: win.end,
          court,
          discountPercent: effectiveClientDiscount(cli),
          siblingStatuses: othersStatuses,
          selfStatus: status,
        });
        if (!bill.matched) matched = false;
        amount += bill.amount;
        splitDenominator = Math.max(splitDenominator, bill.splitDenominator);
      }
      amount = Math.round(amount * 100) / 100;
      if (!matched || amount <= 0) {
        toast.error("Não achei o preço da quadra para esse horário na tabela de preços.");
        return false;
      }
      const firstHour = hrs[0]!;
      const lastHour = hrs[hrs.length - 1]!;
      // Recorta aos limites reais do horário fixo — evita registrar
      // "11:00–14:00" quando a locação real é "11:30–13:30".
      const startTime = info.billWindow(firstHour).start;
      const endTime = info.billWindow(lastHour).end;
      const realHours = Math.round((timeToHours(endTime) - timeToHours(startTime)) * 100) / 100;
      const noteTag =
        status === "no_show"
          ? "Falta"
          : status === "cancelled_late_charged"
            ? "Cancelou tarde"
            : "Presença";
      const catTag = cli.category_name ? ` · ${cli.category_name}` : "";
      const discTag =
        effectiveClientDiscount(cli) > 0
          ? ` · desc ${effectiveClientDiscount(cli)}%`
          : "";
      const splitTag = splitDenominator > 1 ? ` · dividido/${splitDenominator}` : "";
      const hoursTag = realHours > 1 ? ` · ${realHours}h` : "";
      // Busca o usuário logado agora (não o do contexto, que pode estar
      // desatualizado num computador compartilhado onde outro recepcionista
      // acabou de trocar de sessão no mesmo navegador).
      const { data: freshUserData } = await supabase.auth.getUser();
      const { data: ins, error: payErr } = await supabase
        .from("payments")
        .insert({
          client_id: cli.id,
          category_id: mensalistaCategoryId,
          amount,
          method: "outro",
          paid_at: new Date().toISOString(),
          start_time: startTime,
          end_time: endTime,
          court,
          received: false,
          to_account: true,
          account_direction: "debito",
          notes: `Auto (mapa fixo) · ${courtShort(court)} · ${startTime.slice(0, 5)}–${endTime.slice(0, 5)}${hoursTag} · ${noteTag}${catTag}${discTag}${splitTag}`,
          recorded_by: freshUserData.user?.id ?? user?.id ?? null,
        })
        .select("id")
        .maybeSingle();
      if (payErr || !ins) {
        toast.error(payErr?.message ?? "Falha ao criar pagamento.");
        return false;
      }
      paymentId = ins.id as string;
    }

    const payload = {
      client_schedule_id: sched.id,
      attendance_date: date,
      status,
      payment_id: paymentId,
      amount: isChargeable(status) ? amount : null,
      created_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("client_schedule_attendance")
      .upsert(payload, { onConflict: "client_schedule_id,attendance_date" });
    if (error) {
      toast.error(error.message);
      return false;
    }

    const isCancelStatus =
      status === "cancelled_ok" ||
      status === "cancelled_late_charged" ||
      status === "cancelled_late_waived";
    const reasonMap: Record<string, string> = {
      cancelled_ok: "Cancelou a tempo",
      cancelled_late_charged: "Cancelou tarde (cobrado)",
      cancelled_late_waived: "Cancelou tarde (abonado)",
    };
    if (isCancelStatus) {
      const hrs = info.activeHours.length ? info.activeHours : [hour];
      // Insere UMA exceção por hora ativa, só pro client_schedule desta
      // pessoa — pra que a quadra libere slots de 1 hora que podem ser
      // locados avulso pelo preço correspondente da tabela. Quando a quadra
      // é dividida ("dividido"), isso NÃO libera automaticamente quem mais
      // divide o horário: se ele continua vindo, a quadra continua
      // legitimamente ocupada por ele. Pra cancelar pra todo mundo de uma
      // vez, ver "Cancelar para todos" (que chama isto pra cada pessoa).
      const rows = hrs.map((h) => ({
        client_schedule_id: sched.id,
        exception_date: date,
        start_time: `${String(h).padStart(2, "0")}:00:00`,
        end_time: `${String((h + 1) % 24).padStart(2, "0")}:00:00`,
        reason: reasonMap[status] ?? "Cancelado",
        created_by: user?.id ?? null,
      }));
      const { error: excErr } = await supabase.from("client_schedule_exceptions").insert(rows);
      if (excErr) {
        toast.error(`Marcação salva, mas falhou liberar a quadra: ${excErr.message}`);
        return true;
      }

      // Se este cliente foi "movido" para outra quadra hoje (existe uma
      // court_booking avulsa referenciando o fixo original via notes
      // "Movido do fixo"), cancela também essa locação para ela sair do
      // mapa e ir para o histórico.
      if (sched.client_id) {
        const firstHour = hrs[0]!;
        const lastHour = hrs[hrs.length - 1]!;
        const startTimeCancel = `${String(firstHour).padStart(2, "0")}:00:00`;
        const endTimeCancel = `${String((lastHour + 1) % 24).padStart(2, "0")}:00:00`;
        await supabase
          .from("court_bookings")
          .update({
            cancelled_at: new Date().toISOString(),
            cancelled_by: user?.id ?? null,
            cancel_reason: reasonMap[status] ?? "Cancelado",
          })
          .eq("client_id", sched.client_id)
          .eq("booking_date", date)
          .is("cancelled_at", null)
          .like("notes", "Movido do fixo%")
          .lt("start_time", endTimeCancel)
          .gt("end_time", startTimeCancel);
      }

      // Esta pessoa não é dona de nenhuma court_booking (entrou como
      // participante extra da locação movida de outro fixo — ver
      // movedBookingId/movedParticipantClientIds) — o update acima não
      // acha nada pra cancelar. Sem isto, cancelar ela aqui grava a
      // marcação certinho no histórico mas ela continua aparecendo na
      // célula do mapa como se ainda estivesse ocupando a quadra.
      if (movedBookingId && movedParticipantClientIds.includes(cli.id)) {
        const { error: partDelErr } = await supabase
          .from("court_booking_participants")
          .delete()
          .eq("booking_id", movedBookingId)
          .eq("client_id", cli.id);
        if (partDelErr) {
          toast.error(`Marcação salva, mas falhou tirar ${cli.full_name} da quadra: ${partDelErr.message}`);
          return true;
        }
      }

      void offerBookingCancelledNotification({
        clientId: cli.id,
        court,
        bookingDate: date,
        startTime: `${String(hrs[0] ?? hour).padStart(2, "0")}:00:00`,
        endTime: `${String(((hrs[hrs.length - 1] ?? hour) + 1) % 24).padStart(2, "0")}:00:00`,
        isFixed: true,
        reason: reasonMap[status] ?? "Cancelado",
      });
    }

    if (isChargeable(status) && amount > 0) {
      const firstHour = (info.activeHours.length ? info.activeHours : [hour])[0]!;
      void offerWhatsAppPaymentNotification({
        clientId: cli.id,
        amount,
        accountDirection: "debito",
        paidAt: new Date().toISOString(),
        startTime: `${String(firstHour).padStart(2, "0")}:00`,
      });
    }

    const effectiveOverrides = new Map(batchOverrides ?? []);
    effectiveOverrides.set(sched.id, status);
    await recalcOtherChargeableAmounts(sched.id, effectiveOverrides);

    return true;
  };

  // Ação direta de um botão Veio/Faltou de UMA linha — fecha o diálogo ao
  // terminar, igual ao comportamento de sempre.
  const upsertAttendance = async (person: Person, status: AttendanceStatus) => {
    setBusy(true);
    const ok = await upsertAttendanceCore(person, status);
    setBusy(false);
    if (ok) {
      toast.success(`Registrado: ${statusLabel(status)}`);
      onSaved();
      onOpenChange(false);
    }
  };

  // Aplica o motivo de cancelamento escolhido a todos os `cancelTargets`
  // (1 pessoa vindo do botão "Cancelou" de uma linha, ou todo mundo vindo
  // de "Cancelar para todos").
  const applyCancelReason = async (status: AttendanceStatus) => {
    if (cancelTargets.length === 0) return;
    setBusy(true);
    // Todos os `cancelTargets` recebem o MESMO status nesta ação — passa
    // isso como override pra cada cálculo de divisão já enxergar os outros
    // alvos com o status final, não o que tinham antes de a ação começar.
    const batchOverrides = new Map(cancelTargets.map((p) => [p.schedule.id, status]));
    let allOk = true;
    for (const p of cancelTargets) {
      const ok = await upsertAttendanceCore(p, status, batchOverrides);
      if (!ok) allOk = false;
    }
    setBusy(false);
    onSaved();
    if (allOk) {
      toast.success(
        cancelTargets.length > 1
          ? `Registrado para ${cancelTargets.length} clientes: ${statusLabel(status)}`
          : `Registrado: ${statusLabel(status)}`,
      );
      onOpenChange(false);
    }
  };

  // "Todos vieram": marca todo mundo do slot como "Veio" de uma vez,
  // dividindo a quadra normalmente entre eles — evita o caminho de marcar
  // um de cada vez (que também fica correto graças ao recálculo em
  // upsertAttendanceCore, mas exige reabrir o diálogo pra cada pessoa).
  const applyComeToAll = async () => {
    setBusy(true);
    const batchOverrides = new Map(people.map((p) => [p.schedule.id, "came" as AttendanceStatus]));
    let allOk = true;
    for (const p of people) {
      const ok = await upsertAttendanceCore(p, "came", batchOverrides);
      if (!ok) allOk = false;
    }
    setBusy(false);
    onSaved();
    if (allOk) {
      toast.success(`Registrado para ${people.length} clientes: Veio`);
      onOpenChange(false);
    }
  };

  // "Trocar cliente": libera a quadra HOJE (sem cobrar do mensalista — a
  // troca é pedida pelo professor/recepção, não uma falta dele) e deixa o
  // pai abrir direto o formulário de nova locação nesse mesmo lugar, pra
  // não precisar cancelar e depois abrir a célula de novo separadamente.
  const swapClient = async () => {
    setBusy(true);
    const ok = await upsertAttendanceCore(primary, "cancelled_ok");
    setBusy(false);
    if (ok) {
      toast.success(`${personName(primary)} liberado só hoje — escolha quem entra no lugar`);
      onSaved();
      onOpenChange(false);
      onSwapClient?.();
    }
  };

  const clearAttendance = async (person: Person, opts?: { close?: boolean }) => {
    const att = getAttendance(person.schedule.id);
    if (!att) {
      if (opts?.close) onOpenChange(false);
      return;
    }
    setBusy(true);
    if (att.payment_id) {
      await supabase.from("payments").delete().eq("id", att.payment_id);
    }
    const { error } = await supabase.from("client_schedule_attendance").delete().eq("id", att.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marcação removida.");
    onSaved();
    if (opts?.close) onOpenChange(false);
  };

  // Cancela apenas 1 hora de uma locação de múltiplas horas, criando uma
  // exceção no horário fixo para aquele dia. Se já existia lançamento, ele é
  // removido — o operador deve marcar novamente a(s) hora(s) restante(s).
  const cancelSingleHour = async (person: Person, h: number) => {
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const startTime = `${String(h).padStart(2, "0")}:00:00`;
    const endTime = `${String((h + 1) % 24).padStart(2, "0")}:00:00`;
    const { error: excErr } = await supabase.from("client_schedule_exceptions").insert({
      client_schedule_id: person.schedule.id,
      exception_date: date,
      start_time: startTime,
      end_time: endTime,
      reason: "Cancelou 1 hora",
      created_by: user?.id ?? null,
    });
    if (excErr) {
      setBusy(false);
      toast.error(excErr.message);
      return;
    }
    // Zera lançamento anterior (se houver) para forçar recontagem.
    const existing = getAttendance(person.schedule.id);
    if (existing?.payment_id) {
      await supabase.from("payments").delete().eq("id", existing.payment_id);
    }
    if (existing) {
      await supabase.from("client_schedule_attendance").delete().eq("id", existing.id);
    }
    setBusy(false);
    toast.success(`Hora ${String(h).padStart(2, "0")}:00 cancelada.`);
    if (person.client?.id) {
      void offerBookingCancelledNotification({
        clientId: person.client.id,
        court,
        bookingDate: date,
        startTime,
        endTime,
        isFixed: true,
        reason: "Cancelou 1 hora",
      });
    }
    onSaved();
    onOpenChange(false);
  };

  const submitMoveToday = async () => {
    if (moveEnd <= moveStart) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    const unchanged =
      moveCourt === (schedule.court ?? 0) && moveStart === schedStartH && moveEnd === schedEndH;
    if (
      unchanged &&
      !movedBookingId &&
      !(schedule.exceptions ?? []).some((e) => !e.start_time && !e.end_time)
    ) {
      toast.error("Altere quadra ou horário para mover.");
      return;
    }

    // Tudo numa transação só no banco (ver moveFixedToday): vai junto todo
    // mundo que divide a quadra/horário, troca com quem estiver no destino
    // e, se o destino for o próprio horário fixo, restaura o original. Ou
    // grava tudo, ou nada muda — sem estado pela metade.
    setBusy(true);
    const targetStartTime = hoursToTime(moveStart);
    const targetEndTime = hoursToTime(moveEnd);
    const { data: res, error } = await moveFixedToday({
      scheduleId: schedule.id,
      date,
      court: moveCourt,
      startTime: targetStartTime,
      endTime: targetEndTime,
      bookingId: movedBookingId,
    });
    setBusy(false);
    if (error || !res) {
      toast.error(error ?? "Falha ao mover.");
      return;
    }

    if (res.restored) {
      toast.success(
        res.moved.length > 1
          ? `Locação restaurada para o horário fixo original (${res.moved.length} clientes)`
          : "Locação restaurada para o horário fixo original",
      );
      onSaved();
      onOpenChange(false);
      return;
    }

    const swappedNames = [
      ...(res.swapped_booking?.name ? [res.swapped_booking.name] : []),
      ...res.swapped_fixed.map((m) => m.name),
    ];
    const leadName = schedule.clients?.full_name ?? "Locação";
    const movedLabel =
      res.moved.length > 1 ? `${leadName} e mais ${res.moved.length - 1} cliente(s)` : leadName;
    toast.success(
      swappedNames.length > 0
        ? `Troca feita: ${swappedNames.join(" e ")} foram para ${courtLabel(res.from_court)}, e ${movedLabel} foram para ${courtLabel(res.to_court)}.`
        : res.moved.length > 1
          ? `Locação movida só para hoje (${res.moved.length} clientes)`
          : "Locação movida só para hoje",
    );
    if (schedule.client_id) {
      void offerBookingCourtChangeNotification({
        clientId: schedule.client_id,
        fromCourt: res.from_court,
        toCourt: res.to_court,
        bookingDate: date,
        startTime: targetStartTime,
        endTime: targetEndTime,
        isFixed: true,
      });
    }
    if (res.swapped_booking?.client_id) {
      void offerBookingCourtChangeNotification({
        clientId: res.swapped_booking.client_id,
        fromCourt: res.to_court,
        toCourt: res.from_court,
        bookingDate: date,
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
        bookingDate: date,
        startTime: m.start_time,
        endTime: m.end_time,
        isFixed: true,
      });
    }
    onSaved();
    onOpenChange(false);
  };

  const primary = people[0]!;
  const primaryStatus = statusFor(primary.schedule.id);
  const primaryAttendance = getAttendance(primary.schedule.id);
  const totalHourBlocks = hoursInfoFor(schedule).totalBlocks;
  const activeHours = hoursInfoFor(schedule).activeHours;
  const singleCancelTarget = cancelTargets.length === 1 ? cancelTargets[0]! : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Presença no horário fixo</DialogTitle>
          </DialogHeader>

          <div className="rounded-md border p-3 space-y-1 text-sm">
            {people.length === 1 ? (
              <div>
                <span className="text-muted-foreground">Cliente:</span>{" "}
                <strong>{personName(primary)}</strong>
              </div>
            ) : null}
            <div>
              <span className="text-muted-foreground">Data:</span> {fmtDateBR(date)} ·{" "}
              {courtLabel(court)} · {hourLabel(hour)}–{hourEndLabel(hour)}
              {people.length > 1 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  (dividido em {people.length})
                </span>
              )}
            </div>
            {people.length === 1 && scheduleSpanHours > 1 && (
              <div className="text-xs text-muted-foreground">
                Locação de {scheduleSpanHours}h: {schedule.start_time.slice(0, 5)}–
                {schedule.end_time.slice(0, 5)}
                {activeHours.length !== totalHourBlocks &&
                  ` · ativas hoje: ${activeHours
                    .map((h) => `${String(h).padStart(2, "0")}h`)
                    .join(", ")}`}
              </div>
            )}
            {people.length === 1 &&
              (() => {
                const preview = previewFor(primary, othersStatusesFor(primary));
                return (
                  preview && (
                    <div className="text-xs text-muted-foreground">
                      Cobrança prevista se marcar como "Veio":{" "}
                      <strong>{fmtBRL(preview.amount)}</strong>
                      {preview.hoursCount > 1 ? ` (${preview.hoursCount}h)` : ""}
                      {preview.splitDenominator > 1
                        ? ` (dividido por ${preview.splitDenominator})`
                        : ""}
                      {effectiveClientDiscount(primary.client) > 0
                        ? ` · desconto ${effectiveClientDiscount(primary.client)}%`
                        : ""}
                    </div>
                  )
                );
              })()}
            {people.length === 1 && primaryStatus && (
              <div className="pt-1">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(primaryStatus)}`}
                >
                  Atual: {statusLabel(primaryStatus)}
                </span>
                {primaryAttendance?.amount != null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Lançamento: {fmtBRL(primaryAttendance.amount)}
                  </span>
                )}
              </div>
            )}
          </div>

          {mode === "menu" ? (
            people.length > 1 ? (
              <div className="space-y-2">
                {people.map((person) => {
                  const status = statusFor(person.schedule.id);
                  const att = getAttendance(person.schedule.id);
                  const preview = previewFor(person, othersStatusesFor(person));
                  const info = hoursInfoFor(person.schedule);
                  return (
                    <div key={person.schedule.id} className="rounded-md border p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{personName(person)}</div>
                        {status && (
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(status)}`}
                          >
                            {statusLabel(status)}
                          </span>
                        )}
                      </div>
                      {preview && (
                        <div className="text-xs text-muted-foreground">
                          Se marcar "Veio": <strong>{fmtBRL(preview.amount)}</strong>
                          {preview.splitDenominator > 1
                            ? ` (dividido por ${preview.splitDenominator})`
                            : ""}
                        </div>
                      )}
                      {att?.amount != null && (
                        <div className="text-xs text-muted-foreground">
                          Lançamento: {fmtBRL(att.amount)}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <Button
                          type="button"
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={busy}
                          onClick={() => upsertAttendance(person, "came")}
                        >
                          Veio
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => upsertAttendance(person, "no_show")}
                        >
                          Faltou
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setCancelTargets([person]);
                            setMode(
                              info.activeHours.length > 1 ? "partial_cancel" : "confirm_cancel",
                            );
                          }}
                        >
                          Cancelou
                        </Button>
                        {att && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => clearAttendance(person)}
                          >
                            Limpar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={busy}
                    onClick={applyComeToAll}
                  >
                    Todos vieram ({people.length} clientes)
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setCancelTargets(people);
                      setMode("confirm_cancel");
                    }}
                  >
                    Cancelar para todos ({people.length} clientes)
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={busy}
                  onClick={() => upsertAttendance(primary, "came")}
                >
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Veio
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => upsertAttendance(primary, "no_show")}
                >
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Faltou
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setCancelTargets([primary]);
                    setMode(activeHours.length > 1 ? "partial_cancel" : "confirm_cancel");
                  }}
                >
                  Cancelou
                </Button>
              </div>
            )
          ) : mode === "partial_cancel" ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">
                Cancelar quanto da locação
                {singleCancelTarget ? ` de ${personName(singleCancelTarget)}` : ""}?
              </div>
              <div className="grid grid-cols-1 gap-2">
                {singleCancelTarget &&
                  hoursInfoFor(singleCancelTarget.schedule).activeHours.map((h) => (
                    <Button
                      key={h}
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => cancelSingleHour(singleCancelTarget, h)}
                    >
                      Só a hora {String(h).padStart(2, "0")}:00–
                      {String((h + 1) % 24).padStart(2, "0")}:00
                    </Button>
                  ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setMode("confirm_cancel")}
                >
                  Cancelar toda a locação (
                  {singleCancelTarget
                    ? hoursInfoFor(singleCancelTarget.schedule).activeHours.length
                    : 0}
                  h)
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setMode("menu")}
                >
                  Voltar
                </Button>
              </div>
            </div>
          ) : mode === "move_today" ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">Mover / trocar quadra (só hoje)</div>
              <div>
                <Label className="text-xs">
                  Nova quadra — vazia pra mover, ou de outro cliente do mesmo horário pra trocar
                  com ele
                </Label>
                <Select value={String(moveCourt)} onValueChange={(v) => setMoveCourt(Number(v))}>
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
                    value={String(moveStart)}
                    onValueChange={(v) => {
                      const s = Number(v);
                      setMoveStart(s);
                      if (moveEnd <= s) setMoveEnd(s + 1);
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
                  <Select value={String(moveEnd)} onValueChange={(v) => setMoveEnd(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HALF_SLOTS.filter((h) => h > moveStart)
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
              <div className="text-xs text-muted-foreground">
                Atual: {courtLabel(schedule.court ?? 0)} · {schedule.start_time.slice(0, 5)}–
                {schedule.end_time.slice(0, 5)}. Só altera este dia; nas outras semanas o fixo
                continua igual.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy} onClick={submitMoveToday}>
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Confirmar movimentação
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setMode("menu")}
                >
                  Voltar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">
                Como registrar o cancelamento
                {cancelTargets.length > 1
                  ? ` (${cancelTargets.length} clientes)`
                  : singleCancelTarget
                    ? ` de ${personName(singleCancelTarget)}`
                    : ""}
                ?
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => applyCancelReason("cancelled_ok")}
                >
                  Cancelou a tempo — não cobrar
                </Button>
                <Button
                  type="button"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={busy}
                  onClick={() => applyCancelReason("cancelled_late_charged")}
                >
                  Aviso tardio — cobrar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => applyCancelReason("cancelled_late_waived")}
                >
                  Aviso tardio — abonar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setMode(
                      singleCancelTarget &&
                        hoursInfoFor(singleCancelTarget.schedule).activeHours.length > 1
                        ? "partial_cancel"
                        : "menu",
                    )
                  }
                >
                  Voltar
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onEditSchedule}
              >
                Ver / editar locação
              </Button>
              {canMove && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setMode("move_today")}
                >
                  Mover / trocar quadra
                </Button>
              )}
              {canSeeHistory && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setHistoryOpen(true)}
                >
                  <History className="h-4 w-4 mr-2" />
                  Histórico
                </Button>
              )}

              {schedule.client_id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    sendBookingConfirmationRequest({
                      clientId: schedule.client_id,
                      court,
                      bookingDate: date,
                      startTime: schedule.start_time,
                      endTime: schedule.end_time,
                    })
                  }
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Solicitar confirmação
                </Button>
              )}
              {people.length === 1 && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={swapClient}
                  className="bg-yellow-500 hover:bg-yellow-600 text-yellow-950"
                >
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Trocar cliente
                </Button>
              )}
              {people.length === 1 && primaryAttendance && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => clearAttendance(primary, { close: true })}
                >
                  Limpar marcação
                </Button>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {canSeeHistory && (
        <BookingHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          entityType="client_schedule"
          entityId={schedule.id}
        />
      )}
    </>
  );
}

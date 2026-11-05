import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { fmtBRL, dateISOInRecife } from "@/lib/format";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  offerWhatsAppPaymentNotification,
  sendBookingConfirmationRequest,
  offerBookingReservedNotification,
  offerBookingCourtChangeNotification,
  offerBookingCancelledNotification,
} from "@/lib/whatsapp";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Loader2, MessageCircle, Pencil, History } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  cancelWindowHours,
  isLateCancel,
  lateCancelAppliesTo,
  lateCancelDeadlineLabel,
} from "@/lib/late-cancel";
import { BookingHistoryDialog } from "@/components/BookingHistoryDialog";
import {
  hourLabel,
  hourEndLabel,
  courtLabel,
  courtNoteLabel,
  STAFF_COURTS,
  TENNIS_COURT,
  weekdayShort,
  weekdayOfISO,
  timeToHours,
  hoursToTime,
  hoursToLabel,
  type Booking,
  type FixedSchedule,
  type FixedException,
  isRankingCategoryName,
  isRankingMasculinoName,
  isRankingFemininoName,
  findFixedExceptionForHour,
  isManutencaoName,
  isManutencaoClientName,
  isImportedPlaceholderNote,
  addDaysISO,
  courtShort,
} from "@/lib/court-map";
import { fetchUnmovedFixedGroup, moveBookingOntoFixed, moveFixedToday } from "@/lib/fixed-swap";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { calcPrice, type PriceBand } from "@/lib/pricing";
import { effectiveClientDiscount, normalizeCategoryName } from "@/lib/category";
import {
  COURT_MAP_BOOKING_SELECT,
  toCourtMapBooking,
  type CourtMapBookingRow,
} from "@/lib/court-map-data";
import { WaitlistJoinButton } from "@/components/WaitlistJoinButton";
import { ReceiveOpenDebtOption } from "@/components/ReceiveOpenDebtOption";
import {
  EMPTY_RECEIVE_OPEN_DEBT,
  insertOpenDebtSettlement,
  receiveOpenDebtAmount,
  type ReceiveOpenDebtValue,
} from "@/lib/open-debt";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payment-methods";


interface TeacherOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookingDate: string; // YYYY-MM-DD
  court: number;
  hour: number;
  existing?: Booking | null;
  existingFixed?: FixedSchedule | null;
  canCancel: boolean;
  onSaved: () => void;
  /**
   * Locação avulsa recém-criada, já no formato do mapa — chamado logo após
   * o insert, pra tela mostrá-la na hora em vez de esperar a recarga
   * completa (que disputa a fila de requisições com avisos de WhatsApp,
   * notificações etc. e chegava a levar ~30s).
   */
  onCreated?: (booking: Booking) => void;
  authorNames?: Record<string, string>;
  priceBands?: PriceBand[];
  previous?: {
    clientName: string;
    kind: string;
    cancelledBy?: string;
    reason?: string | null;
    reactivateBookingId?: string | null;
    reactivateExceptionScheduleId?: string | null;
    /** Pré-reserva (7 min) aguardando confirmação — troca o banner/botão pra "Confirmar". */
    isHold?: boolean;
  } | null;
}

const HALF_HOUR_STEP = 0.5;

function timeOptions(min: number, max: number): number[] {
  const start = Math.ceil(min / HALF_HOUR_STEP) * HALF_HOUR_STEP;
  const end = Math.floor(max / HALF_HOUR_STEP) * HALF_HOUR_STEP;
  const options: number[] = [];
  for (let h = start; h <= end + 0.001; h += HALF_HOUR_STEP) {
    options.push(Number(h.toFixed(2)));
  }
  return options;
}

function TimeSelect({
  value,
  onChange,
  min = 5,
  max = 24,
}: {
  value: number;
  onChange: (h: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="font-mono">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {timeOptions(min, max).map((h) => (
          <SelectItem key={h} value={String(h)}>
            {hoursToLabel(h)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Confirmação de cancelamento tardio: quadra de tênis com menos de 24h (vale
// pra todo mundo) ou professor cancelando com menos de 3h (pickleball).
function lateCancelConfirmOptions(
  clientName: string,
  date: string,
  startTime: string,
  court: number,
) {
  const hours = cancelWindowHours(court);
  const isTennis = court === TENNIS_COURT;
  return {
    title: `Cancelamento com menos de ${hours}h`,
    description: `${
      isTennis
        ? "A quadra de tênis é única: o cancelamento sem custo precisa ser feito com 24h de antecedência, pra dar tempo de alugar o horário pra outra pessoa."
        : "Pela regra do clube, o professor cancela sem custo até 3h antes da locação."
    } O prazo era até ${lateCancelDeadlineLabel(date, startTime, court)}. Como já passou, a quadra deve ser cobrada de ${clientName} — a recepção vai receber o aviso para lançar no caixa. Cancelar mesmo assim?`,
    confirmText: "Cancelar e cobrar a quadra",
    cancelText: "Voltar",
  };
}

export function CourtBookingDialog({
  open,
  onOpenChange,
  bookingDate,
  court,
  hour,
  existing,
  existingFixed,
  canCancel,
  onSaved,
  onCreated,
  authorNames = {},
  priceBands = [],
  previous = null,
}: Props) {
  const confirm = useConfirm();
  const [kind, setKind] = useState<"avulsa" | "fixo">("avulsa");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Remover fixo "a partir de" uma data: null = painel fechado.
  const [removeFixedFrom, setRemoveFixedFrom] = useState<string | null>(null);
  const { isAdmin, isDiretoria, isRecepcionista, isProfessor } = useAuth();
  const canSeeHistory = isAdmin || isDiretoria || isRecepcionista;
  const [clientId, setClientId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  // Lembra pra qual cliente a categoria já foi pré-preenchida automaticamente,
  // pra não sobrescrever uma troca manual de categoria (ver efeito abaixo).
  const categoryAutoFilledForClientRef = useRef<string | null>(null);
  const [teacherId, setTeacherId] = useState<string>("");
  const [guestName, setGuestName] = useState("");
  const [guestType, setGuestType] = useState<"" | "convidado" | "batedor">("");
  const [notes, setNotes] = useState("");
  // Observação do horário fixo que vale só para a data aberta.
  const [dayNote, setDayNote] = useState("");
  const [startHour, setStartHour] = useState<number>(hour);
  const [endHour, setEndHour] = useState<number>(hour + 1);
  // Ranking (Masc/Fem) dura 2h por padrão — só aplica enquanto o usuário não
  // mexer manualmente no campo "Fim".
  const [endHourTouched, setEndHourTouched] = useState(false);
  const [weekday, setWeekday] = useState<number>(0);
  const [editCourt, setEditCourt] = useState<number>(court);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelStart, setCancelStart] = useState<number>(hour);
  const [cancelEnd, setCancelEnd] = useState<number>(hour + 1);
  // Fluxo de cancelamento da locação avulsa: "idle" = só o botão "Cancelar
  // locação"; "choice" = pergunta se é trecho ou tudo; "partial" = mostra
  // os campos de Início/Fim/Motivo pra cancelar só um trecho.
  const [cancelStep, setCancelStep] = useState<"idle" | "choice" | "partial">("idle");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveCourt, setMoveCourt] = useState<number>(court);
  const [moveStart, setMoveStart] = useState<number>(hour);
  const [moveEnd, setMoveEnd] = useState<number>(hour + 1);
  // "Pedir troca de horário" — entra na lista de espera pedindo um horário
  // diferente pra ESTA reserva (adiantar/atrasar), sem mexer na reserva
  // atual até que o pedido seja atendido. Diferente de "Mover locação"
  // (que move na hora, exige que o destino já esteja livre agora).
  const [waitlistChangeOpen, setWaitlistChangeOpen] = useState(false);
  const [waitlistChangeStart, setWaitlistChangeStart] = useState<number>(hour);
  const [waitlistChangeEnd, setWaitlistChangeEnd] = useState<number>(hour + 1);
  const [waitlistChangeCourtChoice, setWaitlistChangeCourtChoice] = useState<
    "same" | "other_floor" | "any"
  >("same");
  // Campos opcionais para já gerar o lançamento no caixa junto com a locação.
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("");
  const [payDirection, setPayDirection] = useState<"" | "credito" | "debito">("");
  const [payReceived, setPayReceived] = useState<boolean>(false);
  // Lançamento do segundo jogador (ex.: partida de ranking em que cada
  // jogador paga de um jeito diferente — um na hora, outro na pasta).
  const [wantsPayment2, setWantsPayment2] = useState<boolean>(false);
  const [payAmount2, setPayAmount2] = useState<string>("");
  const [payMethod2, setPayMethod2] = useState<string>("");
  const [payDirection2, setPayDirection2] = useState<"" | "credito" | "debito">("");
  const [payReceived2, setPayReceived2] = useState<boolean>(false);
  // O quadro de "lançar no caixa" fica oculto por padrão ao criar — evita
  // lançar no caixa de hoje uma locação marcada para outro dia.
  const [wantsPayment, setWantsPayment] = useState<boolean>(false);
  // Tela de detalhes (view): lançar pagamento sem precisar entrar no modo
  // "Editar locação".
  const [viewWantsPayment, setViewWantsPayment] = useState<boolean>(false);
  // "Pagar junto": receber o débito em aberto do cliente no mesmo
  // lançamento da quadra (criação da locação ou "Lançar no caixa").
  const [receiveDebt, setReceiveDebt] = useState<ReceiveOpenDebtValue>(EMPTY_RECEIVE_OPEN_DEBT);
  // Painel "Jogadores (dividir quadra)" na tela de detalhes.
  const [viewShowPlayers, setViewShowPlayers] = useState<boolean>(false);
  // Jogo de ranking: lançamento pendente (valor zerado) criado automaticamente
  // ao marcar o jogo no mapa — finalizar aqui atualiza esse registro em vez
  // de criar um novo. payTargetClientId permite escolher quem paga (cliente
  // principal ou um dos participantes).
  const [viewPendingPaymentId, setViewPendingPaymentId] = useState<string | null>(null);
  const [payTargetClientId, setPayTargetClientId] = useState<string>("");
  // Fixo dividido: clientes adicionais que compartilham a mesma quadra/horário.
  const [extraClientIds, setExtraClientIds] = useState<string[]>([]);
  // Compartilhamento de um fixo existente com outros clientes (mesmo slot).
  // Guarda os campos próprios de cada um (professor, notas,
  // vigência) pra poder mover o grupo inteiro junto preservando o que é
  // de cada cliente (ver submitEditFixed).
  const [fixedSiblings, setFixedSiblings] = useState<
    {
      id: string;
      client_id: string;
      teacher_id: string | null;
      notes: string | null;
      valid_from: string | null;
      valid_until: string | null;
      clients: { full_name: string } | null;
    }[]
  >([]);
  const [addSiblingClientId, setAddSiblingClientId] = useState<string>("");
  // Cadastros de cliente que são o próprio professor (clients.linked_teacher_id):
  // id do cliente -> nome do professor. Novas reservas nesses cadastros são
  // recusadas; as que já existem continuam, só com aviso.
  const [linkedTeacherByClient, setLinkedTeacherByClient] = useState<Record<string, string>>({});
  const [addingSibling, setAddingSibling] = useState(false);
  // Participantes adicionais (quadra dividida entre clientes)
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [existingParticipants, setExistingParticipants] = useState<{ client_id: string; full_name: string }[]>([]);



  useEffect(() => {
    if (!open) return;
    (async () => {
      type ClientRow = {
        id: string;
        full_name: string;
        category_id: string | null;
        teacher_id: string | null;
        linked_teacher_id: string | null;
        default_discount_percent: number | null;
        active: boolean;
        client_categories: { name: string } | { name: string }[] | null;
        linked_teacher: { name: string } | { name: string }[] | null;
      };
      // Categorias primeiro e por conta própria: antes elas só eram
      // aplicadas depois de baixar TODOS os clientes (paginado, a parte
      // lenta), e clicar em "RKG Masc"/"RKG Fem" nesse meio-tempo dava
      // "Categoria Ranking ... não encontrada" com a categoria cadastrada.
      void (async () => {
        const cats = await supabase
          .from("client_categories")
          .select("id, name")
          .eq("active", true)
          .order("name");
        if (cats.data) setCategories(cats.data as { id: string; name: string }[]);
      })();
      const [clientRowsAll, t] = await Promise.all([
        fetchAll<ClientRow>(
          "clients",
          "id, full_name, category_id, teacher_id, linked_teacher_id, default_discount_percent, active, client_categories(name), linked_teacher:teachers!clients_linked_teacher_id_fkey(name)",
        ),
        supabase.from("teachers").select("id, name").eq("active", true).order("name"),
      ]);
      const clientRows: ClientRow[] = clientRowsAll
        .filter((r: ClientRow) => r.active)
        .sort((a: ClientRow, b: ClientRow) => a.full_name.localeCompare(b.full_name, "pt-BR"));
      setClients(
        clientRows.map((r) => {
          const cat = Array.isArray(r.client_categories)
            ? r.client_categories[0]
            : r.client_categories;
          return {
            id: r.id,
            full_name: r.full_name,
            category_id: r.category_id,
            category_name: cat?.name ?? null,
            default_discount_percent: r.default_discount_percent,
            teacher_id: r.teacher_id,
          };
        }),
      );
      const linked: Record<string, string> = {};
      for (const r of clientRowsAll) {
        if (!r.linked_teacher_id) continue;
        const lt = Array.isArray(r.linked_teacher) ? r.linked_teacher[0] : r.linked_teacher;
        linked[r.id] = lt?.name ?? "professor";
      }
      setLinkedTeacherByClient(linked);
      setTeachers((t.data ?? []) as TeacherOption[]);
    })();
  }, [open]);

  const linkedTeacherError = (ids: (string | null | undefined)[]) => {
    for (const id of ids) {
      const name = id ? linkedTeacherByClient[id] : undefined;
      if (name) {
        return `Este cadastro é do professor ${name}. Reserve no nome do aluno e selecione o professor.`;
      }
    }
    return null;
  };

  useEffect(() => {
    setMode("view");
    setRemoveFixedFrom(null);
    categoryAutoFilledForClientRef.current = null;
    if (existing) {
      setClientId(existing.client_id ?? "");
      setCategoryId(existing.category_id ?? "");
      setTeacherId(existing.teacher_id ?? "");
      setGuestName(existing.guest_name ?? "");
      setGuestType((existing.guest_type as "" | "convidado" | "batedor" | null) ?? "");
      setNotes(existing.notes ?? "");
      const sH = timeToHours(existing.start_time);
      const eH = timeToHours(existing.end_time);
      setStartHour(sH);
      setEndHour(eH);
      setEditCourt(existing.court);
      // padrão: cancelar apenas a hora clicada (respeitando os limites do bloco)
      const cs = Math.max(hour, sH);
      setCancelStart(cs);
      setCancelEnd(Math.min(cs + 1, eH));
    } else if (existingFixed) {
      setClientId(existingFixed.client_id ?? "");
      setCategoryId("");
      setTeacherId(existingFixed.teacher_id ?? "");
      setNotes(existingFixed.notes ?? "");
      setDayNote(existingFixed.day_note ?? "");
      setGuestType("");
      const sH = timeToHours(existingFixed.start_time);
      const eH = timeToHours(existingFixed.end_time);
      setStartHour(sH);
      setEndHour(eH);
      setWeekday(existingFixed.weekday);
      setEditCourt(existingFixed.court ?? court);
      const cs = Math.max(hour, sH);
      setCancelStart(cs);
      setCancelEnd(Math.min(cs + 1, eH));
      setMoveCourt(existingFixed.court ?? court);
      setMoveStart(sH);
      setMoveEnd(eH);
    } else {
      setClientId("");
      setCategoryId("");
      setTeacherId("");
      setGuestName("");
      setGuestType("");
      setNotes("");
      setStartHour(hour);
      setEndHour(hour + 1);
      setEditCourt(court);
      setKind("avulsa");
    }
    setEndHourTouched(false);
    setPayAmount("");
    setPayMethod("");
    setPayDirection("");
    setPayReceived(false);
    setWantsPayment(false);
    setPayAmount2("");
    setPayMethod2("");
    setPayDirection2("");
    setPayReceived2(false);
    setWantsPayment2(false);
    setViewWantsPayment(false);
    setReceiveDebt(EMPTY_RECEIVE_OPEN_DEBT);
    setViewShowPlayers(false);
    setCancelReason("");
    setCancelStep("idle");
    setMoveOpen(false);
    setExtraClientIds([]);
    setFixedSiblings([]);
    setParticipantIds([]);
    setExistingParticipants(existing?.participants ?? []);
  }, [existing, existingFixed, open, hour, court]);

  // Jogo de ranking marcado no mapa: busca o lançamento pendente (valor
  // zerado) criado automaticamente na hora de marcar o jogo, se existir, para
  // finalizar aqui em vez de duplicar o registro no caixa.
  useEffect(() => {
    if (!open || !existing?.id) {
      setViewPendingPaymentId(null);
      setPayTargetClientId(existing?.client_id ?? "");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("id, client_id")
        .eq("booking_id", existing.id)
        .eq("amount", 0)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setViewPendingPaymentId(data.id);
        setPayTargetClientId(data.client_id ?? existing.client_id ?? "");
        setViewWantsPayment(true);
      } else {
        setViewPendingPaymentId(null);
        setPayTargetClientId(existing.client_id ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, existing?.id, existing?.client_id]);

  // Carrega os demais clientes que dividem o mesmo fixo (mesmo dia da semana,
  // quadra e faixa de horário sobreposta).
  useEffect(() => {
    if (!open || !existingFixed) {
      setFixedSiblings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("client_schedules")
        .select(
          "id, client_id, start_time, end_time, teacher_id, notes, valid_from, valid_until, clients!client_id(full_name)",
        )
        .eq("weekday", existingFixed.weekday)
        .eq("court", existingFixed.court ?? 0)
        .neq("id", existingFixed.id)
        // Mesma janela de vigência do mapa/checagem de conflito: um fixo já
        // encerrado (valid_until no passado) ou ainda não iniciado não
        // divide o horário com o fixo atual — sem isso, um fixo já
        // cancelado por vigência aparecia como se ainda estivesse
        // compartilhando a quadra/horário com o cliente sendo editado.
        .or(`valid_from.is.null,valid_from.lte.${bookingDate}`)
        .or(`valid_until.is.null,valid_until.gte.${bookingDate}`);
      if (cancelled) return;
      const s = timeToHours(existingFixed.start_time);
      const e = timeToHours(existingFixed.end_time);
      const rows = (
        (data ?? []) as Array<{
          id: string;
          client_id: string;
          start_time: string;
          end_time: string;
          teacher_id: string | null;
          notes: string | null;
          valid_from: string | null;
          valid_until: string | null;
          clients: { full_name: string } | { full_name: string }[] | null;
        }>
      )
        .filter((r) => {
          const rs = timeToHours(r.start_time);
          const re = timeToHours(r.end_time);
          return rs < e && re > s;
        })
        .map((r) => ({
          id: r.id,
          client_id: r.client_id,
          teacher_id: r.teacher_id,
          notes: r.notes,
          valid_from: r.valid_from,
          valid_until: r.valid_until,
          clients: Array.isArray(r.clients) ? (r.clients[0] ?? null) : r.clients,
        }));
      setFixedSiblings(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, existingFixed]);

  // Ao trocar de cliente, pré-preenche a categoria com a categoria padrão dele
  // (o usuário ainda pode alterar manualmente no campo Categoria). Só faz isso
  // UMA VEZ por cliente selecionado (categoryAutoFilledForClientRef) — antes,
  // como "categoryId" estava nas dependências, qualquer troca manual da
  // categoria (ex.: avulso → mensalista) reexecutava o efeito e forçava de volta a
  // categoria padrão do cliente, dando a impressão de que o sistema não
  // deixava trocar a categoria na hora de marcar. Exceção: se a categoria
  // atual já é Ranking Masc/Fem (escolhida pelos atalhos RKG), não
  // sobrescreve — o jogo de ranking usa a categoria do próprio jogo, não a
  // categoria padrão de cada jogador.
  // O Professor é pré-preenchido em outro efeito (abaixo), só na locação
  // avulsa nova.
  useEffect(() => {
    if (!clientId) return;
    if (existing && clientId === (existing.client_id ?? "")) return;
    if (categoryAutoFilledForClientRef.current === clientId) return;
    categoryAutoFilledForClientRef.current = clientId;
    if (isRankingCategoryName(categories.find((x) => x.id === categoryId)?.name ?? null)) return;
    const c = clients.find((x) => x.id === clientId);
    if (c?.category_id) setCategoryId(c.category_id);
  }, [clientId, clients, existing, categories, categoryId]);

  // Locação avulsa nova: pré-preenche o Professor com o professor principal
  // do cadastro do cliente (a recepção ainda pode trocar). Só substitui o
  // campo se ele estiver vazio ou ainda com o valor que este efeito mesmo
  // colocou — assim, trocar o cliente atualiza o professor, mas uma escolha
  // manual nunca é sobrescrita. Não mexe em ranking (RKG Masc/Fem), que não
  // tem professor, nem em edição de reserva/fixo existente.
  const teacherAutoFilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      teacherAutoFilledRef.current = null;
      return;
    }
    if (existing || existingFixed || kind !== "avulsa" || !clientId) return;
    if (isRankingCategoryName(categories.find((x) => x.id === categoryId)?.name ?? null)) return;
    if (teacherId && teacherId !== teacherAutoFilledRef.current) return;
    const c = clients.find((x) => x.id === clientId);
    const clientTeacher = c?.teacher_id ?? "";
    if (clientTeacher && !teachers.some((t) => t.id === clientTeacher)) return;
    if (clientTeacher === teacherId) return;
    teacherAutoFilledRef.current = clientTeacher || null;
    setTeacherId(clientTeacher);
  }, [open, existing, existingFixed, kind, clientId, clients, teachers, categories, categoryId, teacherId]);

  // Avisa a recepção quando o cliente selecionado está com saldo negativo,
  // pra lembrar de cobrar a quitação antes de confirmar a reserva.
  const [selectedClientBalance, setSelectedClientBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !clientId) {
      setSelectedClientBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("client_account_balance", { _client_id: clientId });
      if (!cancelled) setSelectedClientBalance(typeof data === "number" ? data : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  // Auto-preenche o valor do caixa com base na tabela de preços quando a
  // categoria é Mensalista (com o desconto padrão do cliente) ou Avulso
  // (preço bruto sem desconto). Nas demais categorias, deixa em branco.
  useEffect(() => {
    if (!open) return;
    if (!clientId || !categoryId) return;
    if (endHour <= startHour) return;
    const cat = categories.find((c) => c.id === categoryId);
    // Jogos de ranking nunca têm valor auto-preenchido — limpa qualquer valor.
    if (isRankingCategoryName(cat?.name ?? null)) {
      setPayAmount("");
      return;
    }
    const norm = normalizeCategoryName(cat?.name ?? "");
    const isMens = norm === "mensalista";
    const isAvulso = norm === "avulso";
    // Demais categorias (ex.: Funcionário) nunca
    // têm valor auto-preenchido — limpa para não deixar um preço de uma
    // categoria anterior "grudado" ao trocar a categoria.
    if (!isMens && !isAvulso) {
      setPayAmount("");
      return;
    }
    const targetCourt = existing ? editCourt : court;
    const calc = calcPrice({
      bands: priceBands,
      weekday: weekdayOfISO(bookingDate),
      startTime: hoursToTime(startHour),
      endTime: hoursToTime(endHour),
      categoryId,
      court: targetCourt,
      date: bookingDate,
    });
    if (!calc || !calc.matched || calc.total <= 0) return;
    const cli = clients.find((x) => x.id === clientId);
    // Desconto é do CLIENTE (negociado, ex.: mensalista com 15%), não da
    // categoria escolhida nesta marcação — aplica tanto pra categoria
    // Mensalista quanto Avulso (mensalista marcado avulso continua com o
    // desconto dele).
    const disc = effectiveClientDiscount(cli);
    const final = Math.round(calc.total * (1 - disc / 100) * 100) / 100;
    setPayAmount(final.toFixed(2));
  }, [
    open,
    clientId,
    categoryId,
    startHour,
    endHour,
    court,
    editCourt,
    existing,
    bookingDate,
    priceBands,
    categories,
    clients,
  ]);

  // Ranking (Masc/Fem) dura 2h por padrão: ajusta o fim automaticamente ao
  // escolher a categoria ou mudar o início, contanto que o usuário não tenha
  // mexido no campo "Fim" manualmente nesta locação.
  useEffect(() => {
    if (!open || existing || existingFixed) return;
    if (endHourTouched) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!isRankingCategoryName(cat?.name ?? null)) return;
    const target = Math.min(24, startHour + 2);
    if (endHour !== target) setEndHour(target);
  }, [open, existing, existingFixed, categoryId, startHour, endHour, categories, endHourTouched]);

  // Atalhos "RKG Masc" / "RKG Fem": jogo de ranking é sempre avulso (não
  // faz sentido como fixo semanal), então já seleciona a categoria de
  // Ranking correspondente (o efeito acima cuida de ajustar o "Fim" para
  // 2h após o "Início" automaticamente) e garante o segundo campo de
  // cliente visível para os dois jogadores.
  const applyRankingPreset = (target: "masculino" | "feminino") => {
    const cat = categories.find((c) =>
      target === "masculino" ? isRankingMasculinoName(c.name) : isRankingFemininoName(c.name),
    );
    if (!cat && categories.length === 0) {
      toast.info("Ainda carregando as categorias — tente de novo em instantes.");
      return;
    }
    if (!cat) {
      toast.error(
        `Categoria "Ranking ${target === "masculino" ? "Masculino" : "Feminino"}" não encontrada. Cadastre-a em Categorias.`,
      );
      return;
    }
    setKind("avulsa");
    setCategoryId(cat.id);
    // Ranking não tem professor: descarta o que veio do cadastro do cliente.
    if (teacherAutoFilledRef.current && teacherId === teacherAutoFilledRef.current) {
      setTeacherId("");
      teacherAutoFilledRef.current = null;
    }
    setEndHourTouched(false);
    setExtraClientIds((prev) => (prev.length > 0 ? prev : [""]));
  };

  // Stadium Rackets: o professor é OPCIONAL na locação avulsa — muita gente
  // aluga a quadra só pra jogar. Quando houver professor (Johny, Guel ou um
  // professor que aluga a quadra), selecione-o para ficar registrado quem é
  // o responsável e entrar no relatório do professor.
  const isTeacherRequired = () => false;

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (endHour <= startHour) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    {
      const err = linkedTeacherError([clientId, ...extraClientIds]);
      if (err) {
        toast.error(err);
        return;
      }
    }
    const debtToReceive =
      kind === "avulsa" && wantsPayment && payDirection !== "debito"
        ? receiveOpenDebtAmount(receiveDebt)
        : 0;
    if (debtToReceive > 0 && !payMethod) {
      toast.error("Escolha a forma de pagamento pra receber o débito em aberto junto.");
      return;
    }
    setSubmitting(true);
    const startTime = hoursToTime(startHour);
    const endTime = hoursToTime(endHour);

    if (kind === "fixo") {
      if (!clientId) {
        setSubmitting(false);
        toast.error("Selecione o cliente para o horário fixo");
        return;
      }
      const weekday = weekdayOfISO(bookingDate);
      // Monta lista sem duplicados: cliente principal + adicionais preenchidos
      const clientIds = Array.from(
        new Set([clientId, ...extraClientIds.filter((id) => id && id !== clientId)]),
      );

      // Conflito com outro horário fixo já cadastrado nessa quadra/dia da
      // semana/horário (de um cliente que não está sendo salvo agora) —
      // bloqueia, porque valeria toda semana, pra sempre. Mesma janela de
      // vigência que o mapa usa pra decidir se a célula está ocupada (ver
      // load() em mapa.tsx): exclui fixos já encerrados (valid_until no
      // passado — forma de cancelar um fixo permanentemente sem apagar o
      // histórico) e ainda não iniciados, senão um fixo cancelado/futuro
      // continua bloqueando um horário que o mapa já mostra como livre
      // (ver também admin_save_client_schedule).
      const { data: fixedRows } = await supabase
        .from("client_schedules")
        .select(
          "client_id, start_time, end_time, valid_from, valid_until, clients!client_id(full_name)",
        )
        .eq("weekday", weekday)
        .eq("court", court)
        .or(`valid_from.is.null,valid_from.lte.${bookingDate}`)
        .or(`valid_until.is.null,valid_until.gte.${bookingDate}`);
      type FixedConflictRow = {
        client_id: string;
        start_time: string;
        end_time: string;
        clients: { full_name: string } | { full_name: string }[] | null;
      };
      const fixedConflict = ((fixedRows ?? []) as FixedConflictRow[]).find((r) => {
        if (clientIds.includes(r.client_id)) return false;
        const rs = timeToHours(r.start_time);
        const re = timeToHours(r.end_time);
        return rs < endHour && re > startHour;
      });
      if (fixedConflict) {
        const name = Array.isArray(fixedConflict.clients)
          ? fixedConflict.clients[0]?.full_name
          : fixedConflict.clients?.full_name;
        setSubmitting(false);
        toast.error(
          `Já existe horário fixo de ${name ?? "outro cliente"} nesse dia/horário/quadra.`,
        );
        return;
      }

      // Já existe uma locação avulsa exatamente nesse dia (bookingDate) e
      // horário/quadra — ela vai "esconder" o fixo no mapa nessa primeira
      // data (só uma ocupação aparece por célula), embora o horário fixo
      // seja salvo normalmente e passe a aparecer nas semanas seguintes. Sem
      // esse aviso, quem tá criando acha que o fixo não foi salvo.
      const { data: bookingRows } = await supabase
        .from("court_bookings")
        .select("client_id, start_time, end_time, clients!client_id(full_name)")
        .eq("court", court)
        .eq("booking_date", bookingDate)
        .is("cancelled_at", null);
      type BookingConflictRow = {
        client_id: string | null;
        start_time: string;
        end_time: string;
        clients: { full_name: string } | { full_name: string }[] | null;
      };
      const bookingConflict = ((bookingRows ?? []) as BookingConflictRow[]).find((r) => {
        if (r.client_id && clientIds.includes(r.client_id)) return false;
        const rs = timeToHours(r.start_time);
        const re = timeToHours(r.end_time);
        return rs < endHour && re > startHour;
      });
      if (bookingConflict) {
        const name = Array.isArray(bookingConflict.clients)
          ? bookingConflict.clients[0]?.full_name
          : bookingConflict.clients?.full_name;
        const proceed = await confirm(
          `Já existe uma locação avulsa de ${name ?? "outro cliente"} em ${bookingDate.split("-").reverse().join("/")} nesse horário/quadra. ` +
            `O horário fixo vai ser salvo, mas só vai aparecer no mapa a partir da semana seguinte, enquanto essa locação avulsa não for cancelada. Continuar mesmo assim?`,
        );
        if (!proceed) {
          setSubmitting(false);
          return;
        }
      }

      const rows = clientIds.map((cid) => ({
        client_id: cid,
        weekday,
        start_time: startTime,
        end_time: endTime,
        court,
        teacher_id: teacherId || null,
        notes: notes.trim() || null,
        // Vale a partir do dia escolhido no mapa — não retroage pras semanas anteriores.
        valid_from: bookingDate,
      }));
      const { error } = await supabase.from("client_schedules").insert(rows);
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        clientIds.length > 1
          ? `Horário fixo criado para ${clientIds.length} clientes (${weekdayShort[weekday]})`
          : `Horário fixo criado para ${weekdayShort[weekday]}`,
      );
      for (const cid of clientIds) {
        void offerBookingReservedNotification({
          clientId: cid,
          court,
          bookingDate,
          startTime,
          endTime,
          isFixed: true,
        });
      }
      onSaved();
      onOpenChange(false);
      return;
    }

    if (!clientId) {
      setSubmitting(false);
      toast.error("Selecione ao menos um cliente");
      return;
    }

    if (isTeacherRequired() && !teacherId) {
      setSubmitting(false);
      toast.error("Selecione o professor da locação avulsa");
      return;
    }

    // Conflito com horário fixo ainda ativo nesse dia/quadra/horário — ao
    // contrário da criação de fixo (que já checa isso acima), a locação
    // avulsa não validava contra fixos, permitindo criar uma locação por
    // cima de um mensalista que só foi cancelado parcialmente (ou nem foi)
    // pra hoje. Só avisa (não bloqueia), pra recepção poder confirmar
    // quando for intencional.
    {
      const clientIdsForFixedCheck = Array.from(
        new Set([clientId, ...extraClientIds.filter((id) => id && id !== clientId)]),
      );
      const weekdayForFixedCheck = weekdayOfISO(bookingDate);
      const { data: fixedRowsCheck } = await supabase
        .from("client_schedules")
        .select(
          "id, client_id, start_time, end_time, clients!client_id(full_name)",
        )
        .eq("weekday", weekdayForFixedCheck)
        .eq("court", court)
        .or(`valid_from.is.null,valid_from.lte.${bookingDate}`)
        .or(`valid_until.is.null,valid_until.gte.${bookingDate}`);
      type FixedCheckRow = {
        id: string;
        client_id: string;
        start_time: string;
        end_time: string;
        clients: { full_name: string } | { full_name: string }[] | null;
      };
      const overlappingFixed = ((fixedRowsCheck ?? []) as FixedCheckRow[]).filter((r) => {
        if (clientIdsForFixedCheck.includes(r.client_id)) return false;
        const rs = timeToHours(r.start_time);
        const re = timeToHours(r.end_time);
        return rs < endHour && re > startHour;
      });
      if (overlappingFixed.length) {
        const { data: excRowsCheck } = await supabase
          .from("client_schedule_exceptions")
          .select("client_schedule_id, start_time, end_time")
          .lte("exception_date", bookingDate)
          .or(`range_end.gte.${bookingDate},and(range_end.is.null,exception_date.eq.${bookingDate})`)
          .in(
            "client_schedule_id",
            overlappingFixed.map((r) => r.id),
          );
        const excByScheduleId = new Map<string, FixedException[]>();
        for (const e of (excRowsCheck ?? []) as {
          client_schedule_id: string;
          start_time: string | null;
          end_time: string | null;
        }[]) {
          const arr = excByScheduleId.get(e.client_schedule_id) ?? [];
          arr.push({ id: "", start_time: e.start_time, end_time: e.end_time, reason: null } as FixedException);
          excByScheduleId.set(e.client_schedule_id, arr);
        }
        const stillActiveFixed = overlappingFixed.find((r) => {
          const rs = timeToHours(r.start_time);
          const re = timeToHours(r.end_time);
          const ovStart = Math.max(rs, startHour);
          const ovEnd = Math.min(re, endHour);
          const exs = excByScheduleId.get(r.id);
          for (let h = Math.floor(ovStart); h < Math.ceil(ovEnd); h++) {
            if (!findFixedExceptionForHour(exs, h)) return true;
          }
          return false;
        });
        if (stillActiveFixed) {
          const name = Array.isArray(stillActiveFixed.clients)
            ? stillActiveFixed.clients[0]?.full_name
            : stillActiveFixed.clients?.full_name;
          const proceed = await confirm(
            `Já existe horário fixo de ${name ?? "outro cliente"} ativo nesse dia/horário/quadra (ainda não cancelado hoje). Continuar mesmo assim?`,
          );
          if (!proceed) {
            setSubmitting(false);
            return;
          }
        }
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: inserted, error } = await supabase.from("court_bookings").insert({
      court,
      booking_date: bookingDate,
      start_time: startTime,
      end_time: endTime,
      source: "avulsa",
      client_id: clientId || null,
      category_id: categoryId || null,
      teacher_id: teacherId || null,
      guest_name: guestType === "convidado" ? (guestName.trim() || null) : null,
      guest_type: guestType || null,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    } as never).select(COURT_MAP_BOOKING_SELECT).single();
    if (error) {
      setSubmitting(false);
      // 23505 = índice único de horário duplicado, 23P01 = exclusão por
      // sobreposição de intervalo (quando essa constraint existir). Nos dois
      // casos alguém gravou nesse mesmo horário um instante antes — mensagem
      // amigável em vez do erro cru do Postgres.
      toast.error(
        error.code === "23505" || error.code === "23P01"
          ? "Essa quadra acabou de ser reservada por outra pessoa nesse horário. Atualize a tela e escolha outro horário."
          : error.message,
      );
      return;
    }
    // Insere clientes adicionais como participantes da locação.
    const uniqueParticipants = Array.from(new Set(extraClientIds.filter((id) => id && id !== clientId)));
    if (inserted?.id && uniqueParticipants.length) {
      const rows = uniqueParticipants.map((cid) => ({ booking_id: inserted.id, client_id: cid }));
      const { error: pErr } = await supabase.from("court_booking_participants").insert(rows);
      if (pErr) toast.error(`Locação criada, mas falhou salvar participantes: ${pErr.message}`);
    }

    // Mostra a locação no mapa já agora; a recarga completa (onSaved, lá no
    // fim) só completa o resto (selo de pago etc.).
    if (inserted?.id && onCreated) {
      const nameOf = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "—";
      onCreated(
        toCourtMapBooking(
          inserted as unknown as CourtMapBookingRow,
          uniqueParticipants.map((cid) => ({ client_id: cid, full_name: nameOf(cid) })),
        ),
      );
    }


    // Só cria lançamento no caixa se o usuário marcou "Lançar no caixa" —
    // se a locação é para outro dia, ele deixa desmarcado de propósito e
    // lança no caixa manualmente no dia certo.
    let amountNum = wantsPayment ? Number(payAmount.replace(",", ".")) || 0 : 0;
    // Segurança extra: se marcou "Lançar no caixa" mas o valor ainda estiver
    // vazio (o cálculo automático não teve tempo de rodar antes do usuário
    // salvar, ex.: tabela de preços ainda carregando), recalcula agora em
    // vez de criar a locação sem nenhuma cobrança para Mensalista/Avulso.
    if (wantsPayment && amountNum <= 0 && clientId && categoryId) {
      const cat = categories.find((c) => c.id === categoryId);
      const norm = normalizeCategoryName(cat?.name ?? "");
      const isMens = norm === "mensalista";
      const isAvulso = norm === "avulso";
      if ((isMens || isAvulso) && !isRankingCategoryName(cat?.name ?? null)) {
        const calc = calcPrice({
          bands: priceBands,
          weekday: weekdayOfISO(bookingDate),
          startTime,
          endTime,
          categoryId,
          court,
          date: bookingDate,
        });
        if (calc?.matched && calc.total > 0) {
          const cli = clients.find((x) => x.id === clientId);
          const disc = effectiveClientDiscount(cli);
          amountNum = Math.round(calc.total * (1 - disc / 100) * 100) / 100;
        }
      }
    }
    const shouldCreatePayment =
      wantsPayment && !!clientId && (amountNum > 0 || payReceived || payDirection !== "");
    if (shouldCreatePayment) {
      if (amountNum < 0) {
        setSubmitting(false);
        toast.error("Valor do lançamento não pode ser negativo.");
        return;
      }
      if (!categoryId) {
        setSubmitting(false);
        toast.error("Selecione a categoria para gerar o lançamento no caixa.");
        return;
      }
      const paidAtIso = new Date().toISOString();
      // Busca o usuário logado agora (não o do contexto, que pode estar
      // desatualizado num computador compartilhado onde outro recepcionista
      // acabou de trocar de sessão no mesmo navegador).
      const { data: freshUserData } = await supabase.auth.getUser();
      const { error: payErr } = await supabase.from("payments").insert({
        client_id: clientId,
        category_id: categoryId,
        amount: amountNum,
        method: (payMethod || "outro") as never,
        paid_at: paidAtIso,
        start_time: startTime,
        end_time: endTime,
        court,
        received: payReceived,
        to_account: payDirection !== "",
        account_direction: payDirection || null,
        notes: `Auto (mapa) · ${courtShort(court)} · ${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`,
        recorded_by: freshUserData.user?.id ?? user?.id ?? null,
        booking_id: inserted?.id ?? null,
      });
      if (payErr) {
        setSubmitting(false);
        toast.error(`Locação criada, mas falhou o lançamento: ${payErr.message}`);
        onSaved();
        onOpenChange(false);
        return;
      }
      if (debtToReceive > 0) {
        const { error: debtErr } = await insertOpenDebtSettlement({
          clientId,
          amount: debtToReceive,
          method: payMethod,
        });
        if (debtErr) toast.error(`Quadra lançada, mas falhou o recebimento do débito: ${debtErr}`);
        else toast.success(`Débito em aberto recebido: ${fmtBRL(debtToReceive)}`);
      }
      void offerWhatsAppPaymentNotification({
        clientId,
        amount: amountNum,
        accountDirection: payDirection || null,
        paidAt: paidAtIso,
        startTime,
      });
    }

    // "Receber junto" marcado sem lançamento da quadra (ex.: valor zerado):
    // o débito em aberto é recebido mesmo assim.
    if (!shouldCreatePayment && debtToReceive > 0 && clientId) {
      const { error: debtErr } = await insertOpenDebtSettlement({
        clientId,
        amount: debtToReceive,
        method: payMethod,
      });
      if (debtErr) toast.error(`Locação criada, mas falhou o recebimento do débito: ${debtErr}`);
      else toast.success(`Débito em aberto recebido: ${fmtBRL(debtToReceive)}`);
    }

    // Segundo jogador (ex.: ranking) — lançamento independente do primeiro,
    // com sua própria forma de pagamento/recebido/C-C.
    const secondClientId = extraClientIds[0] || "";
    const amountNum2 = wantsPayment2 ? Number(payAmount2.replace(",", ".")) || 0 : 0;
    const shouldCreatePayment2 =
      wantsPayment2 && !!secondClientId && (amountNum2 > 0 || payReceived2 || payDirection2 !== "");
    if (shouldCreatePayment2) {
      if (amountNum2 < 0) {
        setSubmitting(false);
        toast.error("Valor do lançamento do segundo jogador não pode ser negativo.");
        return;
      }
      if (!categoryId) {
        setSubmitting(false);
        toast.error("Selecione a categoria para gerar o lançamento no caixa.");
        return;
      }
      const paidAtIso2 = new Date().toISOString();
      const { data: freshUserData2 } = await supabase.auth.getUser();
      const { error: payErr2 } = await supabase.from("payments").insert({
        client_id: secondClientId,
        category_id: categoryId,
        amount: amountNum2,
        method: (payMethod2 || "outro") as never,
        paid_at: paidAtIso2,
        start_time: startTime,
        end_time: endTime,
        court,
        received: payReceived2,
        to_account: payDirection2 !== "",
        account_direction: payDirection2 || null,
        notes: `Auto (mapa) · ${courtShort(court)} · ${startTime.slice(0, 5)}–${endTime.slice(0, 5)} · 2º jogador`,
        recorded_by: freshUserData2.user?.id ?? user?.id ?? null,
        booking_id: inserted?.id ?? null,
      });
      if (payErr2) {
        toast.error(`Locação criada, mas falhou o lançamento do 2º jogador: ${payErr2.message}`);
      } else {
        void offerWhatsAppPaymentNotification({
          clientId: secondClientId,
          amount: amountNum2,
          accountDirection: payDirection2 || null,
          paidAt: paidAtIso2,
          startTime,
        });
      }
    }

    // Ranking: nenhum lançamento é criado automaticamente na criação da
    // locação — fica a critério de quem marcou o jogo clicar em "Lançar no
    // caixa" na tela de detalhes quando quiser, no dia que quiser.

    setSubmitting(false);
    toast.success(
      shouldCreatePayment || shouldCreatePayment2
        ? "Locação e lançamento(s) registrados"
        : "Locação registrada",
    );
    // Recarga do mapa ANTES dos avisos em segundo plano (WhatsApp): cada aba só faz 2 requisições por vez, e na ordem em
    // que foram pedidas — se os avisos entram primeiro, o mapa espera por eles.
    onSaved();
    onOpenChange(false);

    if (clientId) {
      void offerBookingReservedNotification({
        clientId,
        court,
        bookingDate,
        startTime,
        endTime,
      });
    }
    for (const cid of uniqueParticipants) {
      void offerBookingReservedNotification({
        clientId: cid,
        court,
        bookingDate,
        startTime,
        endTime,
      });
    }
  };

  // Remove o fixo a partir da data escolhida: as semanas anteriores ficam
  // registradas (valid_until = véspera). Se a data é antes/no início do
  // fixo, não há nada pra guardar e a linha é apagada como antes.
  const submitRemoveFixed = async () => {
    if (!existingFixed || !removeFixedFrom) return;
    const from = removeFixedFrom;
    const createdOn = existingFixed.created_at
      ? dateISOInRecife(new Date(existingFixed.created_at))
      : null;
    const fixedStart = existingFixed.valid_from ?? createdOn;
    const deleteAll = !!fixedStart && from <= fixedStart;
    const fromLabel = from.split("-").reverse().join("/");
    if (
      !(await confirm(
        deleteAll
          ? "Remover este horário fixo? Ele ainda não tinha começado, então será apagado."
          : `Remover este horário fixo a partir de ${fromLabel}? As semanas anteriores continuam registradas.`,
      ))
    )
      return;
    setSubmitting(true);
    let error: { message: string } | null = null;
    if (deleteAll) {
      ({ error } = await supabase.from("client_schedules").delete().eq("id", existingFixed.id));
    } else {
      const dayBefore = addDaysISO(from, -1);
      const until =
        existingFixed.valid_until && existingFixed.valid_until < dayBefore
          ? existingFixed.valid_until
          : dayBefore;
      ({ error } = await supabase
        .from("client_schedules")
        .update({ valid_until: until })
        .eq("id", existingFixed.id));
    }
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      deleteAll ? "Horário fixo removido" : `Horário fixo removido a partir de ${fromLabel}`,
    );
    setRemoveFixedFrom(null);
    onSaved();
    onOpenChange(false);
  };

  // overrideStart/overrideEnd permitem cancelar a locação inteira direto
  // (escolha "Cancelar locação inteira") sem depender do estado
  // cancelStart/cancelEnd, que só é atualizado de fato no próximo render.
  const submitCancel = async (overrideStart?: number, overrideEnd?: number) => {
    if (!existing) return;
    const bookStart = timeToHours(existing.start_time);
    const bookEnd = timeToHours(existing.end_time);
    const start = overrideStart ?? cancelStart;
    const end = overrideEnd ?? cancelEnd;
    if (end <= start) {
      toast.error("Intervalo inválido");
      return;
    }
    if (start < bookStart || end > bookEnd) {
      toast.error("Intervalo fora do horário da locação");
      return;
    }
    const isFull = start === bookStart && end === bookEnd;
    // Cancelar por cima da reserva de um cliente cadastrado sem deixar claro
    // de quem é e de onde veio foi exatamente o que causou duas reservas
    // legítimas sumirem sem ninguém perceber (uma feita pelo próprio cliente
    // no portal, outra avulsa e paga pela secretaria). Confirmação reforçada,
    // nomeando o cliente, sempre que a locação tiver um cliente cadastrado —
    // reserva avulsa de convidado sem cliente continua com o aviso simples.
    const clientLabel = existing.clients?.full_name;
    // Cancelamento tardio (tênis < 24h, ou professor < 3h no pickleball):
    // avisa que a quadra vai ser cobrada (a recepção recebe o aviso para
    // lançar no caixa — ver trigger court_bookings_late_cancel_fee).
    const lateCancel =
      !!existing.client_id &&
      lateCancelAppliesTo(existing.court, { isProfessor }) &&
      isLateCancel(existing.booking_date, hoursToTime(start), existing.court);
    const confirmed = await confirm(
      lateCancel
        ? lateCancelConfirmOptions(
            clientLabel ?? "o cliente",
            existing.booking_date,
            hoursToTime(start),
            existing.court,
          )
        : clientLabel
        ? {
            title: "Cancelar reserva de um cliente?",
            description: `Esta quadra já está reservada por ${clientLabel}. Cancelar agora vai liberar o horário e notificar o cliente. Tem certeza que quer cancelar a reserva dele?`,
            confirmText: "Sim, cancelar a reserva dele",
            cancelText: "Voltar",
          }
        : isFull
          ? "Cancelar esta locação?"
          : "Cancelar apenas este trecho da locação?",
    );
    if (!confirmed) return;
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    if (isFull) {
      const { error } = await supabase
        .from("court_bookings")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: userId,
          cancel_reason: cancelReason.trim() || null,
        })
        .eq("id", existing.id);
      setSubmitting(false);
      if (error) return toast.error(error.message);
      toast.success("Cancelada");
      if (existing.client_id) {
        void offerBookingCancelledNotification({
          clientId: existing.client_id,
          court: existing.court,
          bookingDate: existing.booking_date,
          startTime: existing.start_time,
          endTime: existing.end_time,
          reason: cancelReason.trim() || null,
        });
      }
      onSaved();
      onOpenChange(false);
      return;
    }

    // Cancelamento parcial: reduz a locação original e, se sobrar um pedaço
    // depois do trecho cancelado, cria uma nova locação para esse resto.
    const toTime = hoursToTime;
    const cancelsStart = start === bookStart;
    const cancelsEnd = end === bookEnd;

    if (cancelsStart) {
      const { error } = await supabase
        .from("court_bookings")
        .update({ start_time: toTime(end) })
        .eq("id", existing.id);
      setSubmitting(false);
      if (error) return toast.error(error.message);
    } else if (cancelsEnd) {
      const { error } = await supabase
        .from("court_bookings")
        .update({ end_time: toTime(start) })
        .eq("id", existing.id);
      setSubmitting(false);
      if (error) return toast.error(error.message);
    } else {
      // Trecho no meio: encurta a original até o início do trecho e cria
      // uma nova locação do fim do trecho até o final original.
      const { error: uErr } = await supabase
        .from("court_bookings")
        .update({ end_time: toTime(start) })
        .eq("id", existing.id);
      if (uErr) {
        setSubmitting(false);
        return toast.error(uErr.message);
      }
      const { error: iErr } = await supabase.from("court_bookings").insert({
        court: existing.court,
        booking_date: existing.booking_date,
        start_time: toTime(end),
        end_time: toTime(bookEnd),
        source: existing.source,
        client_id: existing.client_id,
        teacher_id: existing.teacher_id,
        guest_name: existing.guest_name,
        guest_type: existing.guest_type,
        notes: existing.notes,
        created_by: userId,
      });
      setSubmitting(false);
      if (iErr) return toast.error(iErr.message);
    }
    toast.success("Trecho cancelado");
    if (lateCancel) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase as any).rpc("professor_partial_late_cancel_notice", {
        _booking_id: existing.id,
        _start: hoursToTime(start),
        _end: hoursToTime(end),
      });
    }
    if (existing.client_id) {
      void offerBookingCancelledNotification({
        clientId: existing.client_id,
        court: existing.court,
        bookingDate: existing.booking_date,
        startTime: hoursToTime(start),
        endTime: hoursToTime(end),
        reason: cancelReason.trim() || null,
      });
    }
    onSaved();
    onOpenChange(false);
  };

  // overrideStart/overrideEnd permitem cancelar a aula inteira direto
  // (escolha "Cancelar aula inteira") sem depender do estado
  // cancelStart/cancelEnd, que só é atualizado de fato no próximo render.
  const submitCancelFixedDay = async (overrideStart?: number, overrideEnd?: number) => {
    if (!existingFixed) return;
    const schedStart = timeToHours(existingFixed.start_time);
    const schedEnd = timeToHours(existingFixed.end_time);
    const start = overrideStart ?? cancelStart;
    const end = overrideEnd ?? cancelEnd;
    if (end <= start) {
      toast.error("Intervalo inválido");
      return;
    }
    if (start < schedStart || end > schedEnd) {
      toast.error("Intervalo fora do horário fixo");
      return;
    }
    const fixedCourt = existingFixed.court ?? court;
    const lateCancel =
      !!existingFixed.client_id &&
      lateCancelAppliesTo(fixedCourt, { isProfessor }) &&
      isLateCancel(bookingDate, hoursToTime(start), fixedCourt);
    if (
      lateCancel &&
      !(await confirm(
        lateCancelConfirmOptions(
          existingFixed.clients?.full_name ?? "o cliente",
          bookingDate,
          hoursToTime(start),
          fixedCourt,
        ),
      ))
    ) {
      return;
    }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const isFullDay = start === schedStart && end === schedEnd;
    // Quando a quadra é dividida entre 2+ mensalistas no mesmo horário
    // ("dividido"), cancelar só o fixo principal deixava os demais ainda
    // ativos naquele horário — a quadra continuava "ocupada" para eles e
    // gerava conflito falso ao criar uma locação avulsa no lugar. Cancela
    // o mesmo trecho para todos que dividem o horário.
    const scheduleIds = [existingFixed.id, ...fixedSiblings.map((s) => s.id)];
    const { error } = await supabase.from("client_schedule_exceptions").insert(
      scheduleIds.map((id) => ({
        client_schedule_id: id,
        exception_date: bookingDate,
        reason: cancelReason.trim() || null,
        created_by: user?.id ?? null,
        start_time: isFullDay ? null : hoursToTime(start),
        end_time: isFullDay ? null : hoursToTime(end),
      })),
    );
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      isFullDay
        ? `Aula cancelada só neste dia${fixedSiblings.length ? ` (${scheduleIds.length} clientes)` : ""}`
        : `Trecho cancelado neste dia${fixedSiblings.length ? ` (${scheduleIds.length} clientes)` : ""}`,
    );
    if (lateCancel) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase as any).rpc("professor_fixed_late_cancel_notice", {
        _schedule_ids: scheduleIds,
        _date: bookingDate,
        _start: hoursToTime(start),
        _end: hoursToTime(end),
      });
    }
    for (const cid of [existingFixed.client_id, ...fixedSiblings.map((s) => s.client_id)]) {
      if (!cid) continue;
      void offerBookingCancelledNotification({
        clientId: cid,
        court: existingFixed.court ?? 0,
        bookingDate,
        startTime: isFullDay ? existingFixed.start_time : hoursToTime(start),
        endTime: isFullDay ? existingFixed.end_time : hoursToTime(end),
        isFixed: true,
        reason: cancelReason.trim() || null,
      });
    }
    onSaved();
    onOpenChange(false);
  };

  // overrideCourt/overrideStart/overrideEnd permitem chamar esta função a
  // partir de "Trocar quadra com outra locação" (que escolhe o destino de
  // uma lista, não dos campos moveCourt/moveStart/moveEnd) sem depender do
  // estado — que só atualiza de fato no próximo render.
  const submitMoveFixedToday = async (
    overrideCourt?: number,
    overrideStart?: number,
    overrideEnd?: number,
  ) => {
    if (!existingFixed) return;
    const targetCourt = overrideCourt ?? moveCourt;
    const targetStart = overrideStart ?? moveStart;
    const targetEnd = overrideEnd ?? moveEnd;
    if (targetEnd <= targetStart) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    // Tudo numa transação só no banco (ver moveFixedToday): todo mundo que
    // divide a quadra/horário vai junto, troca com quem estiver no destino
    // e, se o destino for o próprio horário fixo, restaura o original. Ou
    // grava tudo, ou nada muda.
    setSubmitting(true);
    const targetStartTime = hoursToTime(targetStart);
    const targetEndTime = hoursToTime(targetEnd);
    const { data: res, error } = await moveFixedToday({
      scheduleId: existingFixed.id,
      date: bookingDate,
      court: targetCourt,
      startTime: targetStartTime,
      endTime: targetEndTime,
    });
    setSubmitting(false);
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
    toast.success(
      swappedNames.length > 0
        ? `Troca feita: ${swappedNames.join(" e ")} foram para ${courtLabel(res.from_court)}, e ${res.moved.map((m) => m.name).join(" e ")} foram para ${courtLabel(res.to_court)}.`
        : "Locação movida só para hoje",
    );
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
    onSaved();
    onOpenChange(false);
  };

  // "Mover / trocar quadra" da locação avulsa: um formulário só (quadra +
  // início + fim) pra três casos — trocar só de quadra no mesmo horário,
  // trocar só de horário na mesma quadra, ou os dois ao mesmo tempo (ex.:
  // hoje às 11h na Q3, mas às 13h só a Q5 está livre). Se o destino já
  // estiver ocupado, troca automaticamente com quem está lá — nunca falha
  // por violar o índice único de court_bookings.
  const submitMoveBooking = async () => {
    if (!existing) return;
    if (moveEnd <= moveStart) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    const newStart = hoursToTime(moveStart);
    const newEnd = hoursToTime(moveEnd);
    const sameSlot = moveCourt === existing.court && newStart === existing.start_time && newEnd === existing.end_time;
    if (sameSlot) {
      setMoveOpen(false);
      return;
    }
    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    // 1) Horário fixo (ainda não materializado hoje) ocupando o destino?
    // Troca numa transação só no banco (ver moveBookingOntoFixed): a
    // locação vai pro destino e o(s) fixo(s) de lá são liberados hoje e
    // materializados no lugar original desta locação, cada um com o
    // próprio horário — ou nada muda.
    const targetWeekday = weekdayOfISO(bookingDate);
    const occupantGroup = await fetchUnmovedFixedGroup(bookingDate, targetWeekday, moveCourt, newStart, newEnd);
    if (occupantGroup.length > 0) {
      const { data: res, error: moveErr } = await moveBookingOntoFixed({
        bookingId: existing.id,
        court: moveCourt,
        startTime: newStart,
        endTime: newEnd,
      });
      setSubmitting(false);
      if (moveErr || !res) {
        toast.error(moveErr ?? "Falha ao mover.");
        return;
      }
      const swappedFixed = res.swapped_fixed;
      toast.success(
        `Quadras trocadas: ${courtLabel(existing.court)} ↔ ${courtLabel(moveCourt)} (${swappedFixed.map((m) => m.name).join(" e ")}).`,
      );
      if (existing.client_id) {
        void offerBookingCourtChangeNotification({
          clientId: existing.client_id,
          fromCourt: existing.court,
          toCourt: moveCourt,
          bookingDate,
          startTime: newStart,
          endTime: newEnd,
        });
      }
      for (const m of swappedFixed) {
        if (!m.client_id) continue;
        void offerBookingCourtChangeNotification({
          clientId: m.client_id,
          fromCourt: moveCourt,
          toCourt: existing.court,
          bookingDate,
          startTime: m.start_time,
          endTime: m.end_time,
          isFixed: true,
        });
      }
      onSaved();
      onOpenChange(false);
      return;
    }

    // 2) Sem fixo no destino: usa a RPC (transação única) que já resolve
    // tanto mover pra um horário livre quanto trocar com outra locação
    // avulsa que estiver lá — nunca deixa as duas na mesma quadra/horário
    // por um instante, o que dois UPDATEs separados do cliente não
    // garantem.
    const { data: swapData, error } = await supabase.rpc("move_or_swap_booking", {
      _booking_id: existing.id,
      _court: moveCourt,
      _start_time: newStart,
      _end_time: newEnd,
    } as never);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const swapRow = (
      swapData as unknown as
        | {
            swapped_booking_id: string | null;
            swapped_client_id: string | null;
            swapped_start_time: string | null;
            swapped_end_time: string | null;
          }[]
        | null
    )?.[0];
    if (swapRow?.swapped_client_id) {
      toast.success(`Quadras trocadas: ${courtLabel(existing.court)} ↔ ${courtLabel(moveCourt)}.`);
      void offerBookingCourtChangeNotification({
        clientId: swapRow.swapped_client_id,
        fromCourt: moveCourt,
        toCourt: existing.court,
        bookingDate,
        startTime: swapRow.swapped_start_time ?? existing.start_time,
        endTime: swapRow.swapped_end_time ?? existing.end_time,
      });
    } else {
      toast.success("Locação movida");
    }
    if (existing.client_id) {
      void offerBookingCourtChangeNotification({
        clientId: existing.client_id,
        fromCourt: existing.court,
        toCourt: moveCourt,
        bookingDate,
        startTime: newStart,
        endTime: newEnd,
      });
    }
    onSaved();
    onOpenChange(false);
  };


  // Diferente de submitMoveBooking (que move na hora e exige o destino já
  // livre): aqui o horário pedido normalmente NÃO está livre ainda — o
  // pedido entra na fila de espera (court_waitlist) marcado com
  // source_booking_id = esta reserva. A reserva atual continua valendo até
  // que a equipe marque o pedido como atendido (ação que, aí sim, cancela
  // a reserva original automaticamente).
  const submitRequestTimeChange = async () => {
    if (!existing) return;
    if (waitlistChangeEnd <= waitlistChangeStart) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    const newStart = hoursToTime(waitlistChangeStart);
    const newEnd = hoursToTime(waitlistChangeEnd);
    const desiredCourt =
      waitlistChangeCourtChoice === "same"
        ? existing.court
        : waitlistChangeCourtChoice === "other_floor"
          ? existing.court === TENNIS_COURT
            ? 0 // 0 = qualquer quadra de pickleball
            : TENNIS_COURT
          : null;
    // Mesmo horário só é "sem mudança nenhuma" (bloqueado) se a quadra
    // pedida também for a mesma — pedir só a troca de modalidade no mesmo
    // horário é um caso válido.
    if (
      newStart === existing.start_time &&
      newEnd === existing.end_time &&
      desiredCourt === existing.court
    ) {
      toast.error("Este já é o horário e a quadra atuais da reserva.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("court_waitlist").insert({
      desired_date: bookingDate,
      start_time: newStart,
      end_time: newEnd,
      court: desiredCourt,
      client_id: existing.client_id,
      teacher_id: existing.teacher_id,
      guest_name: existing.client_id ? null : existing.guest_name,
      source_booking_id: existing.id,
      court_continuity: "same_court",
    });
    setSubmitting(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Já existe um pedido de troca de horário em aberto para esta reserva."
          : error.message,
      );
      return;
    }
    toast.success(
      "Cliente entrou na lista de espera para o novo horário. A reserva atual (" +
        existing.start_time.slice(0, 5) + "–" + existing.end_time.slice(0, 5) +
        ") é mantida até o pedido ser atendido.",
    );
    setWaitlistChangeOpen(false);
    onSaved();
  };




  const submitReactivateException = async (exceptionId: string) => {
    setSubmitting(true);
    const { error } = await supabase
      .from("client_schedule_exceptions")
      .delete()
      .eq("id", exceptionId);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cancelamento revertido");
    onSaved();
    onOpenChange(false);
  };

  const submitReactivateBooking = async () => {
    if (!existing) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("court_bookings")
      .update({
        cancelled_at: null,
        cancelled_by: null,
        cancel_reason: null,
      })
      .eq("id", existing.id);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reserva reativada");
    onSaved();
    onOpenChange(false);
  };

  const submitEditBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!existing) return;
    if (endHour <= startHour) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    // Trocar a locação para um cadastro de professor conta como reserva nova.
    if (clientId !== (existing.client_id ?? "")) {
      const err = linkedTeacherError([clientId]);
      if (err) {
        toast.error(err);
        return;
      }
    }
    setSubmitting(true);
    const startTime = hoursToTime(startHour);
    const endTime = hoursToTime(endHour);
    const { data: { user } } = await supabase.auth.getUser();

    // "Desfazer o move": se esta locação foi criada movendo um fixo (notes começa
    // com "Movido do fixo") e o novo destino coincide exatamente com o fixo do
    // mesmo cliente neste dia (mesma quadra e mesmos horários), então:
    // apaga a exceção do fixo (dia inteiro) + apaga esta locação.
    // Efeito visual: o fixo volta a aparecer normalmente.
    const isMovedFromFixed =
      typeof existing.notes === "string" && existing.notes.startsWith("Movido do fixo");
    if (isMovedFromFixed && existing.client_id) {
      const weekday = weekdayOfISO(bookingDate);
      const { data: sched } = await supabase
        .from("client_schedules")
        .select("id")
        .eq("client_id", existing.client_id)
        .eq("weekday", weekday)
        .eq("court", editCourt)
        .eq("start_time", startTime)
        .eq("end_time", endTime)
        .maybeSingle();
      if (sched?.id) {
        // Existe fixo compatível → remove a exceção do dia e apaga o booking.
        const { error: delExcErr } = await supabase
          .from("client_schedule_exceptions")
          .delete()
          .eq("client_schedule_id", sched.id)
          .eq("exception_date", bookingDate)
          .is("start_time", null)
          .is("end_time", null);
        if (!delExcErr) {
          const { error: delBookErr } = await supabase
            .from("court_bookings")
            .delete()
            .eq("id", existing.id);
          setSubmitting(false);
          if (delBookErr) {
            toast.error(delBookErr.message);
            return;
          }
          toast.success("Locação restaurada como fixo");
          onSaved();
          onOpenChange(false);
          return;
        }
      }
    }

    const { error } = await supabase
      .from("court_bookings")
      .update({
        court: editCourt,
        start_time: startTime,
        end_time: endTime,
        client_id: clientId || null,
        category_id: categoryId || null,
        teacher_id: teacherId || null,
        guest_name: guestType === "convidado" ? (guestName.trim() || null) : null,
        guest_type: guestType || null,
        notes: notes.trim() || null,
      })
      .eq("id", existing.id);
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }


    // Se preencheu valor/checkboxes, cria também o lançamento no caixa.
    // Mesma segurança extra do submitCreate: recalcula se o valor ainda
    // estiver vazio, para não deixar de cobrar Mensalista/Avulso por causa
    // de uma corrida entre o carregamento da tabela de preços e o salvar.
    let amountNum = wantsPayment ? Number(payAmount.replace(",", ".")) || 0 : 0;
    if (wantsPayment && amountNum <= 0 && clientId && categoryId) {
      const cat = categories.find((c) => c.id === categoryId);
      const norm = normalizeCategoryName(cat?.name ?? "");
      const isMens = norm === "mensalista";
      const isAvulso = norm === "avulso";
      if ((isMens || isAvulso) && !isRankingCategoryName(cat?.name ?? null)) {
        const calc = calcPrice({
          bands: priceBands,
          weekday: weekdayOfISO(bookingDate),
          startTime,
          endTime,
          categoryId,
          court: editCourt,
          date: bookingDate,
        });
        if (calc?.matched && calc.total > 0) {
          const cli = clients.find((x) => x.id === clientId);
          const disc = effectiveClientDiscount(cli);
          amountNum = Math.round(calc.total * (1 - disc / 100) * 100) / 100;
        }
      }
    }
    // Só lança no caixa se "Lançar no caixa" estiver marcado — sem isso,
    // qualquer edição da locação (ex.: só trocar o professor) recalculava o
    // valor da tabela de preços e criava um lançamento sozinho, sem o
    // operador pedir (mesma trava que já existe em submitCreate).
    const shouldCreatePayment =
      wantsPayment &&
      !!clientId &&
      (amountNum > 0 || payReceived || payDirection !== "");
    if (shouldCreatePayment) {
      if (amountNum < 0) {
        setSubmitting(false);
        toast.error("Valor do lançamento não pode ser negativo.");
        return;
      }
      if (!categoryId) {
        setSubmitting(false);
        toast.error("Selecione a categoria para gerar o lançamento no caixa.");
        return;
      }
      const paidAtIso = new Date().toISOString();
      // Busca o usuário logado agora (não o do contexto, que pode estar
      // desatualizado num computador compartilhado onde outro recepcionista
      // acabou de trocar de sessão no mesmo navegador).
      const { data: freshUserData } = await supabase.auth.getUser();
      const { error: payErr } = await supabase.from("payments").insert({
        client_id: clientId,
        category_id: categoryId,
        amount: amountNum,
        method: (payMethod || "outro") as never,
        paid_at: paidAtIso,
        start_time: startTime,
        end_time: endTime,
        court: editCourt,
        received: payReceived,
        to_account: payDirection !== "",
        account_direction: payDirection || null,
        notes: `Auto (mapa) · ${courtShort(editCourt)} · ${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`,
        recorded_by: freshUserData.user?.id ?? user?.id ?? null,
        booking_id: existing.id,
      });
      if (payErr) {
        setSubmitting(false);
        toast.error(`Locação atualizada, mas falhou o lançamento: ${payErr.message}`);
        onSaved();
        onOpenChange(false);
        return;
      }
      void offerWhatsAppPaymentNotification({
        clientId,
        amount: amountNum,
        accountDirection: payDirection || null,
        paidAt: paidAtIso,
        startTime,
      });
    }

    setSubmitting(false);
    toast.success(
      shouldCreatePayment ? "Locação atualizada e lançamento registrado" : "Locação atualizada",
    );
    if (clientId && existing.court !== editCourt) {
      void offerBookingCourtChangeNotification({
        clientId,
        fromCourt: existing.court,
        toCourt: editCourt,
        bookingDate,
        startTime,
        endTime,
      });
    }
    onSaved();
    onOpenChange(false);
  };



  const submitEditFixed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!existingFixed) return;
    if (endHour <= startHour) {
      toast.error("Horário final deve ser maior que o inicial");
      return;
    }
    setSubmitting(true);
    const startTime = hoursToTime(startHour);
    const endTime = hoursToTime(endHour);
    // Passa pela RPC (não UPDATE cru) porque ela valida conflito contra
    // outros horários fixos já cadastrados na mesma quadra/dia/horário antes
    // de salvar — transferir este fixo pro dia/horário/quadra de outro
    // cliente não pode mais juntar os dois silenciosamente na mesma célula
    // (ver admin_save_client_schedule).
    const { valid_from, valid_until } = existingFixed as unknown as {
      valid_from?: string | null;
      valid_until?: string | null;
    };
    // Ids do grupo inteiro (este + irmãos que dividem o horário) — passado
    // como _group_ids pra nenhum deles contar como conflito contra os
    // outros ao serem movidos, um de cada vez, pro mesmo horário novo.
    const groupIds = [existingFixed.id, ...fixedSiblings.map((s) => s.id)];
    const { data, error } = await supabase.rpc("admin_save_client_schedule", {
      _id: existingFixed.id,
      _client_id: existingFixed.client_id,
      _weekday: weekday,
      _start_time: startTime,
      _end_time: endTime,
      _court: editCourt,
      _teacher_id: teacherId || null,
      _notes: notes.trim() || null,
      _valid_from: valid_from ?? null,
      _valid_until: valid_until ?? null,
      _group_ids: groupIds,
    });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    const res = data as { ok: boolean; error?: string } | null;
    if (!res?.ok) {
      setSubmitting(false);
      toast.error(res?.error ?? "Não foi possível salvar.");
      return;
    }

    // Horário fixo dividido com outros clientes (mesma quadra/dia/horário
    // ANTES da edição): move o grupo inteiro junto pro novo dia/horário/
    // quadra, senão os demais ficam pra trás sozinhos no horário antigo,
    // como se tivessem sido "abandonados" pela troca de um só.
    const siblingFailures: string[] = [];
    for (const sib of fixedSiblings) {
      const { data: sibData, error: sibError } = await supabase.rpc("admin_save_client_schedule", {
        _id: sib.id,
        _client_id: sib.client_id,
        _weekday: weekday,
        _start_time: startTime,
        _end_time: endTime,
        _court: editCourt,
        _teacher_id: sib.teacher_id,
        _notes: sib.notes,
        _valid_from: sib.valid_from,
        _valid_until: sib.valid_until,
        _group_ids: groupIds,
      });
      const sibRes = sibData as { ok: boolean; error?: string } | null;
      if (sibError || !sibRes?.ok) {
        siblingFailures.push(
          `${sib.clients?.full_name ?? "cliente"}: ${sibError?.message ?? sibRes?.error ?? "erro desconhecido"}`,
        );
      }
    }
    setSubmitting(false);

    if (siblingFailures.length > 0) {
      toast.error(
        `Horário fixo atualizado, mas não deu pra mover junto: ${siblingFailures.join("; ")}`,
      );
    } else {
      toast.success("Horário fixo atualizado");
    }
    onSaved();
    onOpenChange(false);
  };

  // Bloqueio de manutenção: não é uma reserva de verdade — sem cobrança,
  // sem participantes.
  const isManutencao = isManutencaoName(existing?.category_name ?? null);

  // Lançar pagamento direto na tela de detalhes, sem precisar entrar em
  // "Editar locação".
  const submitViewPayment = async () => {
    if (!existing) return;
    const amountNum = Number(payAmount.replace(",", ".")) || 0;
    if (amountNum < 0) {
      toast.error("Valor do lançamento não pode ser negativo.");
      return;
    }
    const targetClientId = payTargetClientId || existing.client_id;
    if (!targetClientId) {
      toast.error("Esta locação não tem cliente vinculado.");
      return;
    }
    if (!categoryId) {
      toast.error("Selecione a categoria para gerar o lançamento no caixa.");
      return;
    }
    const debtToReceive = payDirection !== "debito" ? receiveOpenDebtAmount(receiveDebt) : 0;
    if (debtToReceive > 0 && !payMethod) {
      toast.error("Escolha a forma de pagamento pra receber o débito em aberto junto.");
      return;
    }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const paidAtIso = new Date().toISOString();
    const payload = {
      client_id: targetClientId,
      category_id: categoryId,
      amount: amountNum,
      method: (payMethod || "outro") as never,
      paid_at: paidAtIso,
      start_time: existing.start_time,
      end_time: existing.end_time,
      court: existing.court,
      received: payReceived,
      to_account: payDirection !== "",
      account_direction: payDirection || null,
      notes: `Auto (mapa) · ${courtShort(existing.court)} · ${existing.start_time.slice(0, 5)}–${existing.end_time.slice(0, 5)}`,
      recorded_by: user?.id ?? null,
    };
    // Se já existia um lançamento pendente (valor zerado) pra esta locação —
    // criado ao marcar o jogo de ranking no mapa — atualiza esse registro em
    // vez de criar um novo, pra não duplicar no caixa.
    const { error } = viewPendingPaymentId
      ? await supabase.from("payments").update(payload).eq("id", viewPendingPaymentId)
      : await supabase.from("payments").insert({ ...payload, booking_id: existing.id });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    if (debtToReceive > 0) {
      const { error: debtErr } = await insertOpenDebtSettlement({
        clientId: targetClientId,
        amount: debtToReceive,
        method: payMethod,
        paidAtIso,
      });
      if (debtErr) toast.error(`Quadra lançada, mas falhou o recebimento do débito: ${debtErr}`);
      else toast.success(`Débito em aberto recebido: ${fmtBRL(debtToReceive)}`);
    }
    setSubmitting(false);
    setReceiveDebt(EMPTY_RECEIVE_OPEN_DEBT);
    void offerWhatsAppPaymentNotification({
      clientId: targetClientId,
      amount: amountNum,
      accountDirection: payDirection || null,
      paidAt: paidAtIso,
      startTime: existing.start_time,
    });
    toast.success("Lançamento criado");
    setViewWantsPayment(false);
    setViewPendingPaymentId(null);
    setPayAmount("");
    setPayMethod("");
    setPayDirection("");
    setPayReceived(false);
    onSaved();
    onOpenChange(false);
  };

  // Aviso de cadastro de professor (clients.linked_teacher_id): reserva que
  // já existia nele continua valendo (aviso amarelo); cliente escolhido pra
  // uma reserva nova é recusado (aviso vermelho, mesmo texto do bloqueio).
  const linkedTeacherNotice = (() => {
    let originalIds: (string | null)[] = [];
    if (existing) originalIds = [existing.client_id];
    else if (existingFixed) {
      originalIds = [existingFixed.client_id, ...fixedSiblings.map((s) => s.client_id)];
    }
    const kept = originalIds.find((id) => id && linkedTeacherByClient[id]);
    if (kept && (!existing || clientId === existing.client_id)) {
      return {
        kept: true,
        text:
          `Esta reserva está no cadastro do professor ${linkedTeacherByClient[kept]}. ` +
          "Ela continua valendo, mas novas reservas nesse cadastro não são permitidas — " +
          "reserve no nome do aluno e selecione o professor.",
      };
    }
    const err = linkedTeacherError(existingFixed ? [] : [clientId, ...extraClientIds]);
    return err ? { kept: false, text: err } : null;
  })();

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? "Detalhes da locação"
              : existingFixed
              ? "Horário fixo do cliente"
              : "Nova locação"}
          </DialogTitle>
          <div className="text-sm text-muted-foreground">
            {courtLabel(court)} • {hourLabel(hour)}–{hourEndLabel(hour)} •{" "}
            {bookingDate.split("-").reverse().join("/")}
          </div>
        </DialogHeader>

        {linkedTeacherNotice && (
          <div
            className={
              linkedTeacherNotice.kept
                ? "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100"
                : "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            }
          >
            {linkedTeacherNotice.text}
          </div>
        )}

        {previous && !existing && !existingFixed && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
            <div className="space-y-0.5">
              <div className="font-semibold text-amber-900 dark:text-amber-100">
                {previous.isHold ? "Pré-reserva aguardando confirmação" : "Este horário foi liberado"}
              </div>
              {previous.isHold ? (
                <div>
                  Solicitado por: <strong>{previous.clientName}</strong>
                </div>
              ) : (
                <div>
                  Anteriormente: <strong>{previous.clientName}</strong> ({previous.kind})
                </div>
              )}
              {previous.cancelledBy && (
                <div>Cancelado por: {previous.cancelledBy}</div>
              )}
              {previous.reason && <div>Motivo: {previous.reason}</div>}
            </div>
            {canCancel && previous.reactivateBookingId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  // Se o cancelamento era de um fixo (professor cancelou e o
                  // sistema registrou como court_bookings cancelado), apagar
                  // o registro devolve o horário ao fixo original (cor verde).
                  const isFixedCancellation =
                    (previous.kind ?? "").toLowerCase().includes("fixo");
                  // Antes de mexer na reserva, buscamos os dados para localizar
                  // o fixo correspondente (para limpar presença cancelada).
                  const { data: bookingRow } = await supabase
                    .from("court_bookings")
                    .select("client_id, court, start_time, end_time, booking_date")
                    .eq("id", previous.reactivateBookingId!)
                    .maybeSingle();
                  let error: { message: string } | null = null;
                  if (isFixedCancellation) {
                    // Pode existir mais de um registro cancelado para o mesmo
                    // slot (ex.: professor cancelou duas vezes). Removemos
                    // todos para que o fixo original volte a aparecer.
                    let q = supabase
                      .from("court_bookings")
                      .delete()
                      .not("cancelled_at", "is", null);
                    if (bookingRow?.client_id && bookingRow.court != null) {
                      q = q
                        .eq("client_id", bookingRow.client_id)
                        .eq("court", bookingRow.court)
                        .eq("booking_date", bookingRow.booking_date ?? bookingDate)
                        .eq("start_time", bookingRow.start_time)
                        .eq("end_time", bookingRow.end_time);
                    } else {
                      q = q.eq("id", previous.reactivateBookingId!);
                    }
                    const res = await q;
                    error = res.error;
                    // Também limpa qualquer exceção do fixo que possa ter
                    // sido criada para o mesmo dia/hora.
                    if (!error && bookingRow?.client_id && bookingRow.court != null) {
                      const wd = new Date(`${bookingDate}T12:00:00-03:00`).getDay();
                      const { data: scheds } = await supabase
                        .from("client_schedules")
                        .select("id")
                        .eq("client_id", bookingRow.client_id)
                        .eq("court", bookingRow.court)
                        .eq("weekday", wd);
                      const ids = (scheds ?? []).map((s) => s.id);
                      if (ids.length) {
                        await supabase
                          .from("client_schedule_exceptions")
                          .delete()
                          .eq("exception_date", bookingDate)
                          .in("client_schedule_id", ids);
                      }
                    }
                  } else {
                    const res = await supabase
                      .from("court_bookings")
                      .update({
                        cancelled_at: null,
                        cancelled_by: null,
                        cancel_reason: null,
                      })
                      .eq("id", previous.reactivateBookingId!);
                    error = res.error;
                  }
                  if (error) {
                    setSubmitting(false);
                    toast.error(error.message);
                    return;
                  }

                  // Limpa presença cancelada (badge "C") do fixo, se aplicável.
                  if (bookingRow?.client_id) {
                    const wd = new Date(`${bookingDate}T12:00:00-03:00`).getDay();
                    const startH = Number(String(bookingRow.start_time).slice(0, 2));
                    const { data: scheds } = await supabase
                      .from("client_schedules")
                      .select("id, start_time, end_time")
                      .eq("client_id", bookingRow.client_id)
                      .eq("court", bookingRow.court)
                      .eq("weekday", wd);
                    const matching = (scheds ?? [])
                      .filter((s) =>
                        Number(String(s.start_time).slice(0, 2)) <= startH &&
                        Number(String(s.end_time).slice(0, 2)) > startH,
                      )
                      .map((s) => s.id);
                    if (matching.length) {
                      await supabase
                        .from("client_schedule_attendance")
                        .delete()
                        .eq("attendance_date", bookingDate)
                        .in("client_schedule_id", matching)
                        .in("status", ["cancelled_ok", "cancelled_late_charged", "cancelled_late_waived"]);
                    }
                  }
                  toast.success(
                    isFixedCancellation ? "Locação reativada" : "Reserva reativada",
                  );
                  try { await onSaved(); } catch { /* noop */ }
                  setSubmitting(false);
                  onOpenChange(false);
                }}
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reativar reserva anterior
              </Button>
            )}
            {canCancel && previous.reactivateExceptionScheduleId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  const { error } = await supabase
                    .from("client_schedule_exceptions")
                    .delete()
                    .eq("client_schedule_id", previous.reactivateExceptionScheduleId!)
                    .eq("exception_date", bookingDate);
                  if (error) {
                    setSubmitting(false);
                    toast.error(error.message);
                    return;
                  }
                  // Limpa presença de cancelamento (badge "C") do fixo nessa data.
                  await supabase
                    .from("client_schedule_attendance")
                    .delete()
                    .eq("client_schedule_id", previous.reactivateExceptionScheduleId!)
                    .eq("attendance_date", bookingDate)
                    .in("status", ["cancelled_ok", "cancelled_late_charged", "cancelled_late_waived"]);
                  // Também remove eventuais registros duplicados em
                  // court_bookings (cancelamento gerado pelo professor)
                  // para que o fixo original volte a aparecer no mapa.
                  const { data: sched } = await supabase
                    .from("client_schedules")
                    .select("client_id, court, start_time, end_time")
                    .eq("id", previous.reactivateExceptionScheduleId!)
                    .maybeSingle();
                  if (sched?.client_id && sched.court != null) {
                    await supabase
                      .from("court_bookings")
                      .delete()
                      .not("cancelled_at", "is", null)
                      .eq("client_id", sched.client_id)
                      .eq("court", sched.court)
                      .eq("booking_date", bookingDate)
                      .eq("start_time", sched.start_time)
                      .eq("end_time", sched.end_time);
                    // Se o fixo tinha sido "movido só neste dia" (ex.: para outro
                    // horário/quadra), reativar o horário original deixaria o
                    // cliente duplicado no mapa (original + movido). Cancela
                    // também a locação avulsa gerada pelo "Mover só hoje".
                    const movedNotes = `Movido do fixo (${courtNoteLabel(sched.court)} ${sched.start_time.slice(0, 5)}–${sched.end_time.slice(0, 5)})`;
                    await supabase
                      .from("court_bookings")
                      .update({
                        cancelled_at: new Date().toISOString(),
                        cancelled_by: (await supabase.auth.getUser()).data.user?.id ?? null,
                        cancel_reason: "Horário fixo original reativado",
                      })
                      .eq("client_id", sched.client_id)
                      .eq("booking_date", bookingDate)
                      .is("cancelled_at", null)
                      .eq("notes", movedNotes);
                  }
                  toast.success("Locação reativada");
                  try { await onSaved(); } catch { /* noop */ }
                  setSubmitting(false);
                  onOpenChange(false);
                }}
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reativar locação anterior
              </Button>
            )}
          </div>
        )}

        {existingFixed && mode === "edit" ? (
          <EditFixedForm
            weekday={weekday}
            setWeekday={setWeekday}
            startHour={startHour}
            setStartHour={setStartHour}
            endHour={endHour}
            setEndHour={setEndHour}
            editCourt={editCourt}
            setEditCourt={setEditCourt}
            teacherId={teacherId}
            setTeacherId={setTeacherId}
            notes={notes}
            setNotes={setNotes}
            teachers={teachers}
            submitting={submitting}
            onCancel={() => setMode("view")}
            onSubmit={submitEditFixed}
            clientName={existingFixed.clients?.full_name ?? "—"}
            siblingNames={fixedSiblings.map((s) => s.clients?.full_name ?? "—")}
          />

        ) : existing && mode === "edit" ? (
          <EditBookingForm
            startHour={startHour}
            setStartHour={setStartHour}
            endHour={endHour}
            setEndHour={setEndHour}
            editCourt={editCourt}
            setEditCourt={setEditCourt}
            clientId={clientId}
            setClientId={setClientId}
            teacherId={teacherId}
            setTeacherId={setTeacherId}
            guestName={guestName}
            setGuestName={setGuestName}
            guestType={guestType}
            setGuestType={setGuestType}
            extraClientIds={extraClientIds}
            setExtraClientIds={setExtraClientIds}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            categories={categories}
            notes={notes}
            setNotes={setNotes}
            clients={clients}
            setClients={setClients}
            teachers={teachers}
            submitting={submitting}
            onCancel={() => setMode("view")}
            onSubmit={submitEditBooking}
            payAmount={payAmount}
            setPayAmount={setPayAmount}
            payMethod={payMethod}
            setPayMethod={setPayMethod}
            payDirection={payDirection}
            setPayDirection={setPayDirection}
            payReceived={payReceived}
            setPayReceived={setPayReceived}
          />

        ) : existingFixed ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Cliente:</span>{" "}
                {[
                  existingFixed.clients?.full_name ?? "—",
                  ...fixedSiblings.map((s) => s.clients?.full_name ?? "—"),
                ].join(" + ")}
                {fixedSiblings.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (dividido em {fixedSiblings.length + 1})
                  </span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Dia:</span>{" "}
                {weekdayShort[existingFixed.weekday]} •{" "}
                {existingFixed.start_time.slice(0, 5)}–
                {existingFixed.end_time.slice(0, 5)}
              </div>
              {existingFixed.teachers?.name && (
                <div>
                  <span className="text-muted-foreground">Professor:</span>{" "}
                  {existingFixed.teachers.name}
                </div>
              )}
              {existingFixed.notes && !isImportedPlaceholderNote(existingFixed.notes) && (
                <div className="rounded-md border border-yellow-400/60 bg-yellow-100 px-2 py-1.5 font-semibold text-yellow-900 dark:border-yellow-600/50 dark:bg-yellow-900/40 dark:text-yellow-100">
                  <span className="font-normal text-yellow-800/80 dark:text-yellow-200/80">
                    Observações:
                  </span>{" "}
                  {existingFixed.notes}
                </div>
              )}
              {existingFixed.day_note && !canCancel && (
                <div className="rounded-md border border-yellow-400/60 bg-yellow-100 px-2 py-1.5 font-semibold text-yellow-900 dark:border-yellow-600/50 dark:bg-yellow-900/40 dark:text-yellow-100">
                  <span className="font-normal text-yellow-800/80 dark:text-yellow-200/80">
                    Observação de {bookingDate.split("-").reverse().join("/")}:
                  </span>{" "}
                  {existingFixed.day_note}
                </div>
              )}
              {existingFixed.created_by && authorNames[existingFixed.created_by] && (
                <div className="text-xs text-muted-foreground">
                  Cadastrado por {authorNames[existingFixed.created_by]}
                </div>
              )}
              {existingFixed.created_at && (
                <div className="text-xs text-muted-foreground">
                  Criado em{" "}
                  {dateISOInRecife(new Date(existingFixed.created_at))
                    .split("-")
                    .reverse()
                    .join("/")}
                </div>
              )}
              {(existingFixed.valid_from || existingFixed.valid_until) && (
                <div className="text-xs text-muted-foreground">
                  Vale{" "}
                  {existingFixed.valid_from
                    ? `a partir de ${existingFixed.valid_from.split("-").reverse().join("/")}`
                    : ""}
                  {existingFixed.valid_until
                    ? ` até ${existingFixed.valid_until.split("-").reverse().join("/")}`
                    : ""}
                </div>
              )}
            </div>


            {/* Observação (view rápido) para horário fixo — vale só neste dia */}
            {canCancel && (
              <div className="space-y-2 rounded-md border border-yellow-400/60 bg-yellow-50 p-3 text-sm dark:border-yellow-600/50 dark:bg-yellow-900/20">
                <Label className="text-sm" htmlFor={`day-note-${existingFixed.id}`}>
                  Observação (só neste dia)
                </Label>
                <Textarea
                  id={`day-note-${existingFixed.id}`}
                  value={dayNote}
                  onChange={(e) => setDayNote(e.target.value)}
                  rows={2}
                  placeholder="Ex.: hoje vem com convidado, trazer bolas novas…"
                />
                <div className="flex justify-end gap-2">
                  {existingFixed.day_note && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={submitting}
                      onClick={async () => {
                        setSubmitting(true);
                        const { error } = await supabase
                          .from("client_schedule_day_notes")
                          .delete()
                          .eq("client_schedule_id", existingFixed.id)
                          .eq("note_date", bookingDate);
                        setSubmitting(false);
                        if (error) return toast.error(error.message);
                        toast.success("Observação do dia removida");
                        onSaved();
                        onOpenChange(false);
                      }}
                    >
                      Remover observação
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      submitting ||
                      dayNote.trim() === (existingFixed.day_note ?? "").trim() ||
                      (!dayNote.trim() && !existingFixed.day_note)
                    }
                    onClick={async () => {
                      setSubmitting(true);
                      const text = dayNote.trim();
                      let error: { message: string } | null = null;
                      if (text) {
                        const { data: { user } } = await supabase.auth.getUser();
                        ({ error } = await supabase
                          .from("client_schedule_day_notes")
                          .upsert(
                            {
                              client_schedule_id: existingFixed.id,
                              note_date: bookingDate,
                              notes: text,
                              created_by: user?.id ?? null,
                            },
                            { onConflict: "client_schedule_id,note_date" },
                          ));
                      } else {
                        ({ error } = await supabase
                          .from("client_schedule_day_notes")
                          .delete()
                          .eq("client_schedule_id", existingFixed.id)
                          .eq("note_date", bookingDate));
                      }
                      setSubmitting(false);
                      if (error) return toast.error(error.message);
                      toast.success(text ? "Observação do dia salva" : "Observação do dia removida");
                      onSaved();
                      onOpenChange(false);
                    }}
                  >
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Salvar observação
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Vale apenas para {bookingDate.split("-").reverse().join("/")} — as outras semanas do horário fixo não são afetadas.
                </p>
              </div>
            )}





            {(() => {
              const schedStart = timeToHours(existingFixed.start_time);
              const schedEnd = timeToHours(existingFixed.end_time);
              const exs = existingFixed.exceptions ?? [];
              const fmtExRange = (e: FixedException) =>
                !e.start_time || !e.end_time
                  ? "Dia inteiro"
                  : `${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}`;
              return (
                <>
                  {exs.length > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
                      <div className="font-medium">
                        Cancelamentos em{" "}
                        {bookingDate.split("-").reverse().join("/")}:
                      </div>
                      {exs.map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-2 flex-wrap"
                        >
                          <div>
                            <div>{fmtExRange(e)}</div>
                            {e.reason && (
                              <div className="text-xs text-muted-foreground">
                                Motivo: {e.reason}
                              </div>
                            )}
                            {e.created_by && authorNames[e.created_by] && (
                              <div className="text-xs text-muted-foreground">
                                Cancelado por {authorNames[e.created_by]}
                              </div>
                            )}
                          </div>
                          {canCancel && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => submitReactivateException(e.id)}
                              disabled={submitting}
                            >
                              Reativar
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canCancel && (() => {
                    const isFullDay = cancelStart === schedStart && cancelEnd === schedEnd;
                    return (
                      <>
                        {cancelStep === "choice" && (
                          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                            <Label className="text-sm">Cancelar a aula inteira ou só um trecho?</Label>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => submitCancelFixedDay(schedStart, schedEnd)}
                                disabled={submitting}
                              >
                                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Cancelar aula inteira
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setCancelStart(schedStart);
                                  setCancelEnd(schedEnd);
                                  setCancelStep("partial");
                                }}
                                disabled={submitting}
                              >
                                Cancelar apenas um trecho
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setCancelStep("idle")}
                                disabled={submitting}
                              >
                                Voltar
                              </Button>
                            </div>
                          </div>
                        )}
                        {cancelStep === "partial" && (
                          <div className="space-y-2 rounded-md border p-3">
                            <Label className="text-sm">Cancelar trecho da aula neste dia</Label>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Início</Label>
                                <TimeSelect
                                  value={cancelStart}
                                  min={schedStart}
                                  max={schedEnd - 0.5}
                                  onChange={(s) => {
                                    setCancelStart(s);
                                    if (cancelEnd <= s) setCancelEnd(s + 1);
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Fim</Label>
                                <TimeSelect
                                  value={cancelEnd}
                                  min={cancelStart + 0.5}
                                  max={schedEnd}
                                  onChange={setCancelEnd}
                                />
                              </div>
                            </div>
                            <Input
                              value={cancelReason}
                              onChange={(e) => setCancelReason(e.target.value)}
                              placeholder="Motivo (opcional)"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => submitCancelFixedDay()}
                                disabled={submitting}
                              >
                                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {isFullDay ? "Cancelar aula só neste dia" : "Cancelar trecho neste dia"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setCancelStep("idle")}
                                disabled={submitting}
                              >
                                Voltar
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Libera a quadra apenas neste dia no trecho selecionado. Nas outras
                              semanas a aula segue normal.
                            </p>
                          </div>
                        )}
                        {cancelStep === "idle" && (
                          <div className="rounded-md border p-3">
                            <Button
                              type="button"
                              variant="destructive"
                              className="w-full"
                              onClick={() => setCancelStep("choice")}
                              disabled={submitting}
                            >
                              Cancelar locação
                            </Button>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {canCancel && (
                    <div className="space-y-2 rounded-md border p-3">
                      {!moveOpen ? (
                        <Button
                          type="button"
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => setMoveOpen(true)}
                        >
                          Mover / trocar quadra (só hoje)
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-sm">
                            Mover {existingFixed.clients?.full_name ?? "cliente"} só em{" "}
                            {bookingDate.split("-").reverse().join("/")} — escolha uma quadra vazia
                            pra mover, ou a quadra de outro cliente do mesmo horário pra trocar com
                            ele
                          </Label>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Quadra</Label>
                              <Select
                                value={String(moveCourt)}
                                onValueChange={(v) => setMoveCourt(Number(v))}
                              >
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
                            <div className="space-y-1">
                              <Label className="text-xs">Início</Label>
                              <TimeSelect
                                value={moveStart}
                                min={5}
                                max={23.5}
                                onChange={(s) => {
                                  setMoveStart(s);
                                  if (moveEnd <= s) setMoveEnd(s + 1);
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Fim</Label>
                              <TimeSelect
                                value={moveEnd}
                                min={moveStart + 0.5}
                                max={24}
                                onChange={setMoveEnd}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="flex-1"
                              onClick={() => submitMoveFixedToday()}
                              disabled={submitting}
                            >
                              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Confirmar mudança de hoje
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setMoveOpen(false)}
                              disabled={submitting}
                            >
                              Cancelar
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Libera o horário fixo original só hoje e cria a
                            locação na nova quadra/horário. O fixo continua nas
                            demais semanas. Se o destino já estiver ocupado,
                            troca automaticamente com quem está lá.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {!canCancel && existingFixed && (
              <div>
                <WaitlistJoinButton
                  bookingDate={bookingDate}
                  court={court}
                  startHour={timeToHours(existingFixed.start_time)}
                  endHour={timeToHours(existingFixed.end_time)}
                  className="w-full"
                />
              </div>
            )}

            {canCancel && (
              <DialogFooter className="flex-col sm:flex-row flex-wrap gap-2 sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setMode("edit")}
                    disabled={submitting}
                  >
                    <Pencil className="h-4 w-4 mr-2" /> Editar horário fixo
                  </Button>
                  {existingFixed?.client_id && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        sendBookingConfirmationRequest({
                          clientId: existingFixed.client_id,
                          court,
                          bookingDate,
                          startTime: existingFixed.start_time,
                          endTime: existingFixed.end_time,
                        })
                      }
                      disabled={submitting}
                    >
                      <MessageCircle className="h-4 w-4 mr-2" /> Solicitar confirmação
                    </Button>
                  )}
                  {canSeeHistory && existingFixed?.id && (
                    <Button variant="outline" onClick={() => setHistoryOpen(true)} disabled={submitting}>
                      <History className="h-4 w-4 mr-2" /> Histórico
                    </Button>
                  )}
                </div>
                {removeFixedFrom === null ? (
                  <Button
                    variant="destructive"
                    onClick={() => setRemoveFixedFrom(bookingDate)}
                    disabled={submitting}
                  >
                    Remover horário fixo
                  </Button>
                ) : (
                  <div className="w-full space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <Label htmlFor="remove-fixed-from" className="text-sm">
                      Remover a partir de
                    </Label>
                    <Input
                      id="remove-fixed-from"
                      type="date"
                      value={removeFixedFrom}
                      onChange={(e) => setRemoveFixedFrom(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      As semanas antes dessa data continuam registradas.
                    </p>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => setRemoveFixedFrom(null)}
                        disabled={submitting}
                      >
                        Voltar
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={submitRemoveFixed}
                        disabled={submitting || !removeFixedFrom}
                      >
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Confirmar remoção
                      </Button>
                    </div>
                  </div>
                )}
              </DialogFooter>
            )}
          </div>
        ) : existing ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Origem:</span>{" "}
                <span className="font-medium capitalize">
                  {existing.source.replace("_", " ")}
                </span>
              </div>
              {existing.clients?.full_name && (
                <div>
                  <span className="text-muted-foreground">Cliente:</span>{" "}
                  {existing.clients.full_name}
                </div>
              )}
              {existing.teachers?.name && (
                <div>
                  <span className="text-muted-foreground">Professor:</span>{" "}
                  {existing.teachers.name}
                </div>
              )}
              {existing.guest_name && (
                <div>
                  <span className="text-muted-foreground">Acompanhante:</span>{" "}
                  {existing.guest_name}
                  {existing.guest_type ? ` (${existing.guest_type})` : ""}
                </div>
              )}
              {existing.notes && !isImportedPlaceholderNote(existing.notes) && (
                <div className="rounded-md border border-yellow-400/60 bg-yellow-100 px-2 py-1.5 font-semibold text-yellow-900 dark:border-yellow-600/50 dark:bg-yellow-900/40 dark:text-yellow-100">
                  <span className="font-normal text-yellow-800/80 dark:text-yellow-200/80">
                    Observações:
                  </span>{" "}
                  {existing.notes}
                </div>
              )}
              {existing.created_by && authorNames[existing.created_by] && (
                <div className="text-xs text-muted-foreground">
                  Marcado por {authorNames[existing.created_by]}
                </div>
              )}
              {existing.cancelled_at && (
                <div className="text-xs text-destructive">
                  Cancelada
                  {existing.cancelled_by && authorNames[existing.cancelled_by]
                    ? ` por ${authorNames[existing.cancelled_by]}`
                    : ""}
                  {existing.cancel_reason ? ` — ${existing.cancel_reason}` : ""}
                </div>
              )}
            </div>

            {isManutencao && (
              <div className="rounded-md border border-red-600/40 bg-red-500/5 p-3 text-sm text-red-800 dark:text-red-200">
                Quadra bloqueada para manutenção — sem cobrança.
              </div>
            )}


            {/* Participantes (quadra dividida entre clientes) */}
            {!isManutencao && existing.participants && existing.participants.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-1">
                {existing.participants && existing.participants.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Participantes:</span>{" "}
                    {existing.participants.map((p) => p.full_name).join(", ")}
                  </div>
                )}
              </div>
            )}

            {!isManutencao && !canCancel && !existing.cancelled_at && (
              <div>
                <WaitlistJoinButton
                  bookingDate={bookingDate}
                  court={court}
                  startHour={timeToHours(existing.start_time)}
                  endHour={timeToHours(existing.end_time)}
                  className="w-full"
                />
              </div>
            )}

            {!isManutencao && canCancel && !existing.cancelled_at && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setViewShowPlayers((v) => !v)}
                >
                  Jogadores (dividir quadra)
                </Button>
              </div>
            )}

            {!isManutencao && canCancel && !existing.cancelled_at && viewShowPlayers && (
              <BookingParticipantsPanel
                bookingId={existing.id}
                currentParticipants={existingParticipants}
                categoryName={
                  existing.category_name ??
                  categories.find((c) => c.id === (existing.category_id ?? ""))?.name ??
                  null
                }
                clients={clients}
                setClients={setClients}
                mainClientId={existing.client_id ?? null}
                mainClientName={existing.clients?.full_name ?? null}
                onChanged={onSaved}
              />
            )}

            {!isManutencao && !existing.cancelled_at && (
              <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={viewWantsPayment}
                    onCheckedChange={(v) => setViewWantsPayment(v === true)}
                  />
                  Lançar no caixa
                </label>
                {viewPendingPaymentId && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-100">
                    Lançamento pendente do jogo (valor zerado) — selecione a pessoa, informe o valor e a forma de pagamento para finalizar.
                  </div>
                )}
                {viewWantsPayment && (
                  <>
                    {!categoryId && (
                      <div className="space-y-1">
                        <Label className="text-xs">Categoria</Label>
                        <Select
                          value={categoryId || "__none"}
                          onValueChange={(v) => setCategoryId(v === "__none" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a categoria" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— Nenhuma —</SelectItem>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {existingParticipants.some((p) => p.client_id !== existing.client_id) && (
                      <div className="space-y-1">
                        <Label className="text-xs">Cobrar de</Label>
                        <Select
                          value={payTargetClientId || existing.client_id || ""}
                          onValueChange={setPayTargetClientId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a pessoa" />
                          </SelectTrigger>
                          <SelectContent>
                            {existing.client_id && (
                              <SelectItem value={existing.client_id}>
                                {existing.clients?.full_name ?? "Cliente"}
                              </SelectItem>
                            )}
                            {existingParticipants
                              .filter((p) => p.client_id !== existing.client_id)
                              .map((p) => (
                                <SelectItem key={p.client_id} value={p.client_id}>
                                  {p.full_name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Valor (R$)</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder="0,00"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Forma de pagamento</Label>
                        <Select
                          value={payMethod || "__none"}
                          onValueChange={(v) => setPayMethod(v === "__none" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— Nenhuma —</SelectItem>
                            {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                              <SelectItem key={v} value={v}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={payDirection === "debito"}
                          onCheckedChange={(v) => setPayDirection(v === true ? "debito" : "")}
                        />
                        Debitar da conta corrente
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={payDirection === "credito"}
                          onCheckedChange={(v) => setPayDirection(v === true ? "credito" : "")}
                        />
                        Creditar na conta corrente
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={payReceived}
                          onCheckedChange={(v) => setPayReceived(v === true)}
                        />
                        Pagamento recebido
                      </label>
                    </div>
                    {payDirection !== "debito" && (
                      <ReceiveOpenDebtOption
                        clientId={payTargetClientId || existing.client_id}
                        value={receiveDebt}
                        onChange={setReceiveDebt}
                      />
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={submitting}
                      onClick={submitViewPayment}
                    >
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Lançar
                    </Button>
                  </>
                )}
              </div>
            )}


            {canCancel && existing.cancelled_at && (
              <div className="rounded-md border p-3">
                <Button
                  type="button"
                  size="lg"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={submitting}
                  onClick={submitReactivateBooking}
                >
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Reativar reserva
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Volta a marcar o horário como reservado para este cliente.
                </p>
              </div>
            )}

            {canCancel && !existing.cancelled_at && (
              <div className="space-y-2 rounded-md border p-3">
                {!moveOpen ? (
                  <Button
                    type="button"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setMoveCourt(existing.court);
                      setMoveStart(timeToHours(existing.start_time));
                      setMoveEnd(timeToHours(existing.end_time));
                      setMoveOpen(true);
                    }}
                  >
                    Mover / trocar quadra
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm">
                      Mover para outra quadra e/ou horário em{" "}
                      {bookingDate.split("-").reverse().join("/")} — se o destino já tiver alguém,
                      troca automaticamente
                    </Label>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Quadra</Label>
                        <Select
                          value={String(moveCourt)}
                          onValueChange={(v) => setMoveCourt(Number(v))}
                        >
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
                      <div className="space-y-1">
                        <Label className="text-xs">Início</Label>
                        <TimeSelect
                          value={moveStart}
                          min={5}
                          max={23.5}
                          onChange={(s) => {
                            setMoveStart(s);
                            if (moveEnd <= s) setMoveEnd(s + 1);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Fim</Label>
                        <TimeSelect
                          value={moveEnd}
                          min={moveStart + 0.5}
                          max={24}
                          onChange={setMoveEnd}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1"
                        onClick={submitMoveBooking}
                        disabled={submitting}
                      >
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Confirmar mudança
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setMoveOpen(false)}
                        disabled={submitting}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canCancel && !existing.cancelled_at && (
              <div className="space-y-2 rounded-md border p-3">
                {!waitlistChangeOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setWaitlistChangeStart(timeToHours(existing.start_time));
                      setWaitlistChangeEnd(timeToHours(existing.end_time));
                      setWaitlistChangeCourtChoice("same");
                      setWaitlistChangeOpen(true);
                    }}
                  >
                    Pedir troca de horário (lista de espera)
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm">
                      Horário desejado em {bookingDate.split("-").reverse().join("/")} — o cliente
                      entra na lista de espera e a reserva atual ({existing.start_time.slice(0, 5)}–
                      {existing.end_time.slice(0, 5)}) só é cancelada quando o pedido for atendido.
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Início</Label>
                        <TimeSelect
                          value={waitlistChangeStart}
                          min={5}
                          max={23.5}
                          onChange={(s) => {
                            setWaitlistChangeStart(s);
                            if (waitlistChangeEnd <= s) setWaitlistChangeEnd(s + 1);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Fim</Label>
                        <TimeSelect
                          value={waitlistChangeEnd}
                          min={waitlistChangeStart + 0.5}
                          max={24}
                          onChange={setWaitlistChangeEnd}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Quadra</Label>
                      <Select
                        value={waitlistChangeCourtChoice}
                        onValueChange={(v) =>
                          setWaitlistChangeCourtChoice(v as typeof waitlistChangeCourtChoice)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="same">
                            Mesma quadra ({courtLabel(existing.court)})
                          </SelectItem>
                          <SelectItem value="other_floor">
                            Trocar de modalidade —{" "}
                            {existing.court === TENNIS_COURT ? "Pickleball (qualquer quadra)" : "Tênis (saibro)"}
                          </SelectItem>
                          <SelectItem value="any">Qualquer quadra disponível</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Quem ainda não tem nenhuma quadra marcada nesse horário tem prioridade nessa
                      fila; este pedido só é chamado depois deles.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1"
                        onClick={submitRequestTimeChange}
                        disabled={submitting}
                      >
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Entrar na lista de espera
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setWaitlistChangeOpen(false)}
                        disabled={submitting}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canCancel && (() => {
              const bookStart = timeToHours(existing.start_time);
              const bookEnd = timeToHours(existing.end_time);
              const isFull = cancelStart === bookStart && cancelEnd === bookEnd;
              return (
                <>
                  {cancelStep === "choice" && (
                    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <Label className="text-sm">Cancelar a locação inteira ou só um trecho?</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => submitCancel(bookStart, bookEnd)}
                          disabled={submitting}
                        >
                          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Cancelar locação inteira
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCancelStart(bookStart);
                            setCancelEnd(bookEnd);
                            setCancelStep("partial");
                          }}
                          disabled={submitting}
                        >
                          Cancelar apenas um trecho
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelStep("idle")}
                          disabled={submitting}
                        >
                          Voltar
                        </Button>
                      </div>
                    </div>
                  )}
                  {cancelStep === "partial" && (
                    <div className="space-y-2 rounded-md border p-3">
                      <Label className="text-sm">Cancelar trecho da locação</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Início</Label>
                          <TimeSelect
                            value={cancelStart}
                            min={bookStart}
                            max={bookEnd - 0.5}
                            onChange={(s) => {
                              setCancelStart(s);
                              if (cancelEnd <= s) setCancelEnd(s + 1);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Fim</Label>
                          <TimeSelect
                            value={cancelEnd}
                            min={cancelStart + 0.5}
                            max={bookEnd}
                            onChange={setCancelEnd}
                          />
                        </div>
                      </div>
                      <Input
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Motivo (opcional)"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => submitCancel()}
                          disabled={submitting}
                        >
                          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {isFull ? "Cancelar locação" : "Cancelar trecho"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelStep("idle")}
                          disabled={submitting}
                        >
                          Voltar
                        </Button>
                      </div>
                    </div>
                  )}
                  <DialogFooter className="flex-col sm:flex-row flex-wrap gap-2 sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setMode("edit")}
                        disabled={submitting}
                      >
                        <Pencil className="h-4 w-4 mr-2" /> Editar locação
                      </Button>
                      {existing?.client_id && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            sendBookingConfirmationRequest({
                              clientId: existing.client_id!,
                              court: existing.court,
                              bookingDate: existing.booking_date,
                              startTime: existing.start_time,
                              endTime: existing.end_time,
                            })
                          }
                          disabled={submitting}
                        >
                          <MessageCircle className="h-4 w-4 mr-2" /> Solicitar confirmação
                        </Button>
                      )}
                      {canSeeHistory && existing?.id && (
                        <Button variant="outline" onClick={() => setHistoryOpen(true)} disabled={submitting}>
                          <History className="h-4 w-4 mr-2" /> Histórico
                        </Button>
                      )}
                    </div>
                    {cancelStep === "idle" && (
                      <Button
                        variant="destructive"
                        onClick={() => setCancelStep("choice")}
                        disabled={submitting}
                      >
                        Cancelar locação
                      </Button>
                    )}
                  </DialogFooter>
                </>
              );
            })()}
          </div>
        ) : (
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de locação</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border p-0.5 text-sm">
                  <button
                    type="button"
                    onClick={() => setKind("avulsa")}
                    className={`px-3 py-1.5 rounded ${
                      kind === "avulsa" ? "bg-primary text-primary-foreground" : ""
                    }`}
                  >
                    Avulsa (só este dia)
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("fixo")}
                    className={`px-3 py-1.5 rounded ${
                      kind === "fixo" ? "bg-primary text-primary-foreground" : ""
                    }`}
                  >
                    Fixo semanal ({weekdayShort[weekdayOfISO(bookingDate)]})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => applyRankingPreset("masculino")}
                  title="Preenche categoria Ranking Masculino, 2h de duração e abre os campos de jogadores"
                  className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                    isRankingMasculinoName(categories.find((c) => c.id === categoryId)?.name)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "hover:bg-muted"
                  }`}
                >
                  RKG Masc
                </button>
                <button
                  type="button"
                  onClick={() => applyRankingPreset("feminino")}
                  title="Preenche categoria Ranking Feminino, 2h de duração e abre os campos de jogadores"
                  className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                    isRankingFemininoName(categories.find((c) => c.id === categoryId)?.name)
                      ? "bg-pink-600 text-white border-pink-600"
                      : "hover:bg-muted"
                  }`}
                >
                  RKG Fem
                </button>
              </div>
              {kind === "fixo" && (
                <p className="text-xs text-muted-foreground">
                  Este horário ficará reservado para o cliente em todas as{" "}
                  {weekdayShort[weekdayOfISO(bookingDate)]}s, na{" "}
                  {courtLabel(court)}.
                </p>
              )}
            </div>
            {/* 3. Clientes (unificado: principal + adicionais) */}
            <div className="space-y-2 rounded-md border p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Cliente(s) *</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExtraClientIds((prev) => [...prev, ""])}
                >
                  + Adicionar cliente
                </Button>
              </div>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={setClientId}
                onClientCreated={(c) =>
                  setClients((prev) =>
                    prev.some((p) => p.id === c.id)
                      ? prev
                      : [...prev, c].sort((a, b) => a.full_name.localeCompare(b.full_name)),
                  )
                }
                placeholder="Selecione o cliente"
              />
              {selectedClientBalance !== null && selectedClientBalance < 0 && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                  ⚠️ Cliente negativado ({fmtBRL(selectedClientBalance)}) — lembre-se de solicitar a
                  quitação do pagamento antes da reserva.
                </div>
              )}
              {extraClientIds.map((cid, idx) => (
                <div key={idx} className="flex gap-2">
                  <div className="flex-1">
                    <ClientCombobox
                      clients={clients}
                      value={cid}
                      onChange={(v) =>
                        setExtraClientIds((prev) => prev.map((p, i) => (i === idx ? v : p)))
                      }
                      onClientCreated={(c) =>
                        setClients((prev) =>
                          prev.some((p) => p.id === c.id)
                            ? prev
                            : [...prev, c].sort((a, b) => a.full_name.localeCompare(b.full_name)),
                        )
                      }
                      placeholder="Cliente adicional"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExtraClientIds((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    Remover
                  </Button>
                </div>
              ))}
              {kind === "fixo" && extraClientIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Cada cliente adicionado terá seu próprio horário fixo no mesmo slot —
                  o valor é cobrado individualmente conforme a categoria de cada um.
                </p>
              )}
            </div>

            {/* 4. Categoria */}
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={categoryId || "__none"}
                onValueChange={(v) => setCategoryId(v === "__none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Nenhuma —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>


            <TeacherSelect
              value={teacherId}
              onChange={setTeacherId}
              teachers={teachers}
              required={isTeacherRequired()}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Início</Label>
                <TimeSelect
                  value={startHour}
                  min={5}
                  max={23}
                  onChange={(s) => {
                    setStartHour(s);
                    if (endHour <= s) setEndHour(s + 1);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <TimeSelect
                  value={endHour}
                  min={startHour + 0.5}
                  max={24}
                  onChange={(e) => {
                    setEndHour(e);
                    setEndHourTouched(true);
                  }}
                />
              </div>
            </div>



            {/* 8. Lançamento no caixa (apenas avulsa) */}
            {kind === "avulsa" && (
              <div className="space-y-3 rounded-md border p-3 bg-muted/30">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={wantsPayment}
                    onCheckedChange={(v) => setWantsPayment(v === true)}
                  />
                  Lançar no caixa
                </label>
                {!wantsPayment && (
                  <p className="text-xs text-muted-foreground">
                    Marque se quiser já registrar o pagamento agora. Se a locação for
                    para outro dia, deixe desmarcado e lance no caixa no dia certo.
                  </p>
                )}
                {wantsPayment && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Valor (R$)</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder="0,00"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Forma de pagamento</Label>
                        <Select
                          value={payMethod || "__none"}
                          onValueChange={(v) => setPayMethod(v === "__none" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— Nenhuma —</SelectItem>
                            {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                              <SelectItem key={v} value={v}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={payDirection === "debito"}
                          onCheckedChange={(v) => setPayDirection(v === true ? "debito" : "")}
                        />
                        Debitar da conta corrente
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={payDirection === "credito"}
                          onCheckedChange={(v) => setPayDirection(v === true ? "credito" : "")}
                        />
                        Creditar na conta corrente
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={payReceived}
                          onCheckedChange={(v) => setPayReceived(v === true)}
                        />
                        Pagamento recebido
                      </label>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Preencha o valor para gerar automaticamente o lançamento no caixa
                      vinculado ao cliente, categoria, quadra e horário.
                    </div>
                    {payDirection !== "debito" && (
                      <ReceiveOpenDebtOption
                        clientId={clientId}
                        value={receiveDebt}
                        onChange={setReceiveDebt}
                      />
                    )}
                  </>
                )}
                {wantsPayment && extraClientIds[0] && (
                  <div className="space-y-3 rounded-md border p-3 bg-background">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox
                        checked={wantsPayment2}
                        onCheckedChange={(v) => setWantsPayment2(v === true)}
                      />
                      Lançar também para{" "}
                      {clients.find((c) => c.id === extraClientIds[0])?.full_name ??
                        "o segundo jogador"}
                    </label>
                    {!wantsPayment2 && (
                      <p className="text-xs text-muted-foreground">
                        Marque se o segundo jogador também for pago agora — cada um pode ter
                        forma de pagamento diferente (ex.: um paga na hora, outro fica na
                        pasta).
                      </p>
                    )}
                    {wantsPayment2 && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Valor (R$)</Label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={payAmount2}
                              onChange={(e) => setPayAmount2(e.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Forma de pagamento</Label>
                            <Select
                              value={payMethod2 || "__none"}
                              onValueChange={(v) => setPayMethod2(v === "__none" ? "" : v)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">— Nenhuma —</SelectItem>
                                {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                                  <SelectItem key={v} value={v}>
                                    {l}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={payDirection2 === "debito"}
                              onCheckedChange={(v) => setPayDirection2(v === true ? "debito" : "")}
                            />
                            Debitar da conta corrente
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={payDirection2 === "credito"}
                              onCheckedChange={(v) => setPayDirection2(v === true ? "credito" : "")}
                            />
                            Creditar na conta corrente
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={payReceived2}
                              onCheckedChange={(v) => setPayReceived2(v === true)}
                            />
                            Pagamento recebido
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}


            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {kind === "fixo"
                  ? "Criar horário fixo"
                  : previous?.isHold
                    ? "Confirmar"
                    : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
    {canSeeHistory && (existing?.id || existingFixed?.id) && (
      <BookingHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entityType={existingFixed?.id ? "client_schedule" : "court_booking"}
        entityId={(existingFixed?.id || existing?.id) as string}
      />
    )}
    </>
  );
}

const COURT_OPTS = STAFF_COURTS;
const WEEKDAY_OPTS = [
  { v: 0, label: "Domingo" },
  { v: 1, label: "Segunda" },
  { v: 2, label: "Terça" },
  { v: 3, label: "Quarta" },
  { v: 4, label: "Quinta" },
  { v: 5, label: "Sexta" },
  { v: 6, label: "Sábado" },
];

function HourRange({
  startHour,
  setStartHour,
  endHour,
  setEndHour,
}: {
  startHour: number;
  setStartHour: (v: number) => void;
  endHour: number;
  setEndHour: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Label>Início</Label>
        <TimeSelect
          value={startHour}
          min={5}
          max={23}
          onChange={(s) => {
            setStartHour(s);
            if (endHour <= s) setEndHour(s + 1);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label>Fim</Label>
        <TimeSelect
          value={endHour}
          min={startHour + 0.5}
          max={24}
          onChange={setEndHour}
        />
      </div>
    </div>
  );
}

function CourtSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Quadra</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {COURT_OPTS.map((c) => (
            <SelectItem key={c} value={String(c)}>
              {courtLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TeacherSelect({
  value,
  onChange,
  teachers,
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  teachers: TeacherOption[];
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{required ? "Professor *" : "Professor (opcional)"}</Label>
      <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{required ? "— Selecione o professor —" : "— Nenhum —"}</SelectItem>
          {teachers.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EditBookingForm(props: {
  startHour: number;
  setStartHour: (v: number) => void;
  endHour: number;
  setEndHour: (v: number) => void;
  editCourt: number;
  setEditCourt: (v: number) => void;
  clientId: string;
  setClientId: (v: string) => void;
  teacherId: string;
  setTeacherId: (v: string) => void;
  guestName: string;
  setGuestName: (v: string) => void;
  guestType: "" | "convidado" | "batedor";
  setGuestType: (v: "" | "convidado" | "batedor") => void;
  extraClientIds: string[];
  setExtraClientIds: React.Dispatch<React.SetStateAction<string[]>>;
  categoryId: string;
  setCategoryId: (v: string) => void;
  categories: { id: string; name: string }[];
  notes: string;
  setNotes: (v: string) => void;
  clients: ClientOption[];
  setClients: React.Dispatch<React.SetStateAction<ClientOption[]>>;
  teachers: TeacherOption[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  payAmount: string;
  setPayAmount: (v: string) => void;
  payMethod: string;
  setPayMethod: (v: string) => void;
  payDirection: "" | "credito" | "debito";
  setPayDirection: (v: "" | "credito" | "debito") => void;
  payReceived: boolean;
  setPayReceived: (v: boolean) => void;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      <HourRange
        startHour={props.startHour}
        setStartHour={props.setStartHour}
        endHour={props.endHour}
        setEndHour={props.setEndHour}
      />
      <CourtSelect value={props.editCourt} onChange={props.setEditCourt} />
      <div className="space-y-2">
        <Label>Cliente (opcional)</Label>
        <ClientCombobox
          clients={props.clients}
          value={props.clientId}
          onChange={props.setClientId}
          onClientCreated={(c) =>
            props.setClients((prev) =>
              prev.some((p) => p.id === c.id)
                ? prev
                : [...prev, c].sort((a, b) => a.full_name.localeCompare(b.full_name)),
            )
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Categoria</Label>
        <Select
          value={props.categoryId || "__none"}
          onValueChange={(v) => props.setCategoryId(v === "__none" ? "" : v)}
        >
          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">— Nenhuma —</SelectItem>
            {props.categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>


      <TeacherSelect value={props.teacherId} onChange={props.setTeacherId} teachers={props.teachers} />
      <div className="space-y-2">
        <Label>Nome livre (se não for cliente cadastrado)</Label>
        <Input value={props.guestName} onChange={(e) => props.setGuestName(e.target.value)} />
      </div>
      <div className="space-y-3 rounded-md border p-3 bg-muted/30">
        <div className="text-sm font-medium">Lançamento no caixa (opcional)</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Valor (R$)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={props.payAmount}
              onChange={(e) => props.setPayAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Forma de pagamento</Label>
            <Select
              value={props.payMethod || "__none"}
              onValueChange={(v) => props.setPayMethod(v === "__none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Nenhuma —</SelectItem>
                {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={props.payDirection === "debito"}
              onCheckedChange={(v) => props.setPayDirection(v === true ? "debito" : "")}
            />
            Debitar da conta corrente
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={props.payDirection === "credito"}
              onCheckedChange={(v) => props.setPayDirection(v === true ? "credito" : "")}
            />
            Creditar na conta corrente
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={props.payReceived}
              onCheckedChange={(v) => props.setPayReceived(v === true)}
            />
            Pagamento recebido
          </label>
        </div>
        <div className="text-xs text-muted-foreground">
          Preencha o valor para gerar automaticamente o lançamento no caixa
          vinculado ao cliente, categoria, quadra e horário.
        </div>
      </div>
      <div className="space-y-2">
        <Label>Observações</Label>
        <Textarea value={props.notes} onChange={(e) => props.setNotes(e.target.value)} rows={2} />
      </div>
      <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={props.submitting}>
          Voltar
        </Button>
        <Button type="submit" disabled={props.submitting}>
          {props.submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Salvar alterações
        </Button>
      </DialogFooter>
    </form>
  );
}


function EditFixedForm(props: {
  weekday: number;
  setWeekday: (v: number) => void;
  startHour: number;
  setStartHour: (v: number) => void;
  endHour: number;
  setEndHour: (v: number) => void;
  editCourt: number;
  setEditCourt: (v: number) => void;
  teacherId: string;
  setTeacherId: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  teachers: TeacherOption[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  clientName: string;
  siblingNames?: string[];
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <span className="text-muted-foreground">Cliente:</span>{" "}
        <span className="font-medium">{props.clientName}</span>
        {props.siblingNames && props.siblingNames.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Dividido com {props.siblingNames.join(", ")} — mover dia/horário/quadra aqui move o grupo todo junto.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label>Dia da semana</Label>
        <Select value={String(props.weekday)} onValueChange={(v) => props.setWeekday(Number(v))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {WEEKDAY_OPTS.map((w) => (
              <SelectItem key={w.v} value={String(w.v)}>{w.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <HourRange
        startHour={props.startHour}
        setStartHour={props.setStartHour}
        endHour={props.endHour}
        setEndHour={props.setEndHour}
      />
      <CourtSelect value={props.editCourt} onChange={props.setEditCourt} />
      <TeacherSelect value={props.teacherId} onChange={props.setTeacherId} teachers={props.teachers} />

      <div className="space-y-2">
        <Label>Observações</Label>
        <Textarea value={props.notes} onChange={(e) => props.setNotes(e.target.value)} rows={2} />
      </div>
      <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={props.submitting}>
          Voltar
        </Button>
        <Button type="submit" disabled={props.submitting}>
          {props.submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Salvar alterações
        </Button>
      </DialogFooter>
    </form>
  );
}

// ============================================================
// Painel de gerenciamento de participantes (view mode) — quadra dividida
// entre clientes: trocar/adicionar/remover jogadores da locação.
// ============================================================
export function BookingParticipantsPanel({
  bookingId,
  currentParticipants,
  clients,
  setClients,
  mainClientId,
  mainClientName,
  onChanged,
}: {
  bookingId: string;
  currentParticipants: { client_id: string; full_name: string }[];
  categoryName?: string | null;
  clients: ClientOption[];
  setClients: React.Dispatch<React.SetStateAction<ClientOption[]>>;
  mainClientName?: string | null;
  mainClientId: string | null;
  onChanged: () => void;
}) {
  const [newParticipant, setNewParticipant] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // Troca de jogador (titular ou participante) — ex.: jogo de ranking em
  // que um dos dois jogadores muda, sem precisar cancelar e recriar a
  // locação. "swapTarget" null = titular; string = client_id do
  // participante sendo trocado.
  const [swapTarget, setSwapTarget] = useState<string | null | "main">(null);
  const [swapValue, setSwapValue] = useState<string>("");

  const alreadyInBooking = (cid: string) =>
    cid === mainClientId || currentParticipants.some((p) => p.client_id === cid);

  const confirmSwapMain = async () => {
    if (!swapValue) return;
    if (alreadyInBooking(swapValue)) {
      toast.error("Este cliente já está na locação.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("court_bookings")
      .update({ client_id: swapValue })
      .eq("id", bookingId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Jogador trocado.");
    setSwapTarget(null);
    setSwapValue("");
    onChanged();
  };

  const confirmSwapParticipant = async (oldClientId: string) => {
    if (!swapValue) return;
    if (alreadyInBooking(swapValue)) {
      toast.error("Este cliente já está na locação.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("court_booking_participants")
      .update({ client_id: swapValue })
      .eq("booking_id", bookingId)
      .eq("client_id", oldClientId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Jogador trocado.");
    setSwapTarget(null);
    setSwapValue("");
    onChanged();
  };

  const addParticipant = async () => {
    if (!newParticipant) return;
    if (newParticipant === mainClientId) {
      toast.error("Este cliente já é o titular da locação.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("court_booking_participants").insert({
      booking_id: bookingId,
      client_id: newParticipant,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Participante adicionado.");
    setNewParticipant("");
    onChanged();
  };

  const removeParticipant = async (clientId: string) => {
    setSaving(true);
    const { error } = await supabase
      .from("court_booking_participants")
      .delete()
      .eq("booking_id", bookingId)
      .eq("client_id", clientId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Participante removido.");
    onChanged();
  };

  const swapPicker = (
    <div className="flex items-center gap-1">
      <div className="w-40">
        <ClientCombobox
          clients={clients}
          value={swapValue}
          onChange={setSwapValue}
          onClientCreated={(c) =>
            setClients((prev) =>
              prev.some((p) => p.id === c.id)
                ? prev
                : [...prev, c].sort((a, b) => a.full_name.localeCompare(b.full_name)),
            )
          }
          placeholder="Novo jogador"
        />
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => (swapTarget === "main" ? confirmSwapMain() : confirmSwapParticipant(swapTarget as string))}
        disabled={!swapValue || saving}
      >
        Confirmar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setSwapTarget(null);
          setSwapValue("");
        }}
        disabled={saving}
      >
        Cancelar
      </Button>
    </div>
  );

  return (
    <div className="rounded-md border p-3 space-y-3">
      {(mainClientId || currentParticipants.length > 0) && (
        <div>
          <Label className="text-sm">Jogadores desta locação</Label>
          <ul className="mt-1 space-y-1">
            {mainClientId && (
              <li className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {mainClientName ?? "—"}{" "}
                  <span className="text-xs text-muted-foreground">(titular)</span>
                </span>
                {swapTarget === "main" ? (
                  swapPicker
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSwapTarget("main");
                      setSwapValue("");
                    }}
                    disabled={saving}
                  >
                    Trocar
                  </Button>
                )}
              </li>
            )}
            {currentParticipants.map((p) => (
              <li key={p.client_id} className="flex items-center justify-between gap-2 text-sm">
                <span>{p.full_name}</span>
                {swapTarget === p.client_id ? (
                  swapPicker
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSwapTarget(p.client_id);
                        setSwapValue("");
                      }}
                      disabled={saving}
                    >
                      Trocar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeParticipant(p.client_id)} disabled={saving}>
                      Remover
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <Label className="text-sm">Adicionar participante</Label>
        <div className="flex gap-2 mt-2">
          <div className="flex-1">
            <ClientCombobox
              clients={clients}
              value={newParticipant}
              onChange={setNewParticipant}
              onClientCreated={(c) =>
                setClients((prev) =>
                  prev.some((p) => p.id === c.id)
                    ? prev
                    : [...prev, c].sort((a, b) => a.full_name.localeCompare(b.full_name)),
                )
              }
              placeholder="Adicionar cliente"
            />
          </div>
          <Button type="button" size="sm" onClick={addParticipant} disabled={!newParticipant || saving}>
            Adicionar
          </Button>
        </div>
      </div>

    </div>
  );
}

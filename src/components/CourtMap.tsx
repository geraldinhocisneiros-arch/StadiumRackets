import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  COURTS,
  STAFF_COURTS,
  HALF_SLOTS,
  courtLabel,
  hourLabel,
  timeToHours,
  hoursToLabel,
  SOURCE_COLOR,
  FIXED_COLOR,
  bookingCellColorClass,
  findFixedExceptionForHour,
  isMovedFromFixedBooking,
  isImportedPlaceholderNote,
  type Booking,
  type FixedSchedule,
  type FixedException,
} from "@/lib/court-map";
import { calcOnlinePrice, calcPrice, weekdayFromYmd, type PriceBand } from "@/lib/pricing";
import { isFullHourOnline, isPastSlot } from "@/lib/operating-hours";
import { fmtBRL } from "@/lib/format";


export interface CourtCell {
  kind: "empty" | "booking" | "fixed";
  booking?: Booking;
  fixed?: FixedSchedule;
  // Se preenchido, esta hora do fixo está cancelada por esta exceção.
  cancelledException?: FixedException | null;
  // Demais horários fixos compartilhando este mesmo slot (mesma quadra/hora).
  fixedSiblings?: FixedSchedule[];
  // Quando definido, força que esta célula seja agrupada por hora — usado
  // para "quebrar" um cancelamento longo em vários slots de 1h disponíveis.
  splitHour?: number;
}

export interface ManualAvailability {
  id: string;
  court: number;
  start_time: string; // HH:MM[:SS]
  end_time: string;
  hourly_price: number;
}

interface Props {
  bookings: Booking[];
  fixedSchedules: FixedSchedule[]; // já filtrados pelo weekday da data
  onCellClick?: (court: number, hour: number, cell: CourtCell) => void;
  highlightAvailability?: boolean; // destaca slots livres em verde com "Disponível"
  hideOccupantDetails?: boolean; // portal cliente: oculta nomes e mostra só "Ocupado"
  ownClientId?: string | null; // portal cliente: revela detalhes das reservas próprias mesmo com hideOccupantDetails; sempre destaca a célula em amarelo
  ownTeacherId?: string | null; // portal professor: revela detalhes das aulas do próprio professor; sempre destaca a célula em amarelo, mesmo com hideOccupantDetails=false
  priceBands?: PriceBand[]; // exibe R$/1h nos slots disponíveis
  priceCategoryId?: string | null; // categoria do cliente (portal) para precificação
  date?: string; // "YYYY-MM-DD" — usado para descobrir o weekday nas faixas de preço
  // Exibe o preço promocional (starts_on/ends_on) quando aplicável. Só deve
  // ser true no Portal do Cliente (compra online paga no Mercado Pago —
  // ver nota em src/lib/pricing.ts): recepção/staff nunca cobra o valor
  // promocional, então nunca deve VER esse valor no mapa. Default false.
  includePromo?: boolean;
  // Mapa da recepção/diretoria: em vez de cobrar o promocional, só AVISA ao
  // lado do preço normal que o horário está mais barato para o cliente
  // AVULSO que comprar online pelo portal. O valor do slot continua sendo o
  // normal (é o que a recepção cobra). Nunca ligar em telas que clientes
  // veem (portal, Modo TV), senão mensalista enxerga a promoção.
  onlinePromoHint?: boolean;
  // Categoria "Avulso": base do aviso acima e, no portal (includePromo),
  // do preço promocional de quem ainda não tem categoria.
  onlinePromoCategoryId?: string | null;
  attendanceByScheduleId?: Record<string, { status: string }>; // selo de presença no slot fixo
  attendanceByBookingId?: Record<string, { status: string }>; // selo de presença em locações "movido do fixo"
  paidBookingIds?: Set<string>; // locações avulsas com pagamento lançado no caixa — selo "$"
  onlinePaidBookingIds?: Set<string>; // pagas online (Mercado Pago) — célula amarela
  currentUserId?: string | null; // usado para marcar "(cancelada por você)" ao professor logado
  stickyHeader?: boolean; // se true (default), cabeçalho "Hora/quadras" gruda ao topo durante a rolagem
  manualAvailabilities?: ManualAvailability[]; // disponibilizações manuais ativas para a data
  showManualBadge?: boolean; // exibe chip "Manual" nas células liberadas manualmente (apenas staff)
  onManualAvailabilityClick?: (avail: ManualAvailability, hour: number) => void;
  /**
   * Quando true, respeita o horário oficial de funcionamento online: slots
   * fora da janela nunca aparecem como "Disponível", não têm preço nem
   * permitem clique para solicitar reserva. Use no Portal do Cliente, Portal
   * do Professor e no mapa interno quando quiser refletir a experiência
   * online. Staff (recepcionista/diretoria/admin) deixa como `false` para
   * poder cadastrar manualmente fora do horário.
   */
  enforceOnlineHours?: boolean;
  /**
   * Contagem de pessoas na fila de espera considerando SOBREPOSIÇÃO real de
   * intervalos: dada uma locação `[start, end]`, retorna quantas filas
   * desejam intervalos que se sobrepõem a esse período e se o próprio
   * usuário está em alguma delas.
   */
  waitlistLookup?: (
    court: number,
    startTime: string,
    endTime: string,
  ) => {
    count: number;
    mine: boolean;
    /** Janelas reais que bateram — pode ser mais estreita que [startTime,endTime) numa célula de várias horas. */
    windows?: { start: string; end: string; cnt: number }[];
  };
  /** Callback ao clicar no chip "Fila" (staff) — abre modal com detalhes. */
  onWaitlistBadgeClick?: (court: number, startTime: string, endTime: string) => void;
  /**
   * Clientes com alerta de limite de débito ativo no momento (independe da
   * data exibida no mapa) — exibe um selo laranja na locação pra avisar a
   * equipe antes de cobrar/cancelar por engano. Só passado no mapa staff.
   */
  debtLimitByClient?: Record<string, { fullName: string; phone: string | null; debtAmount: number }>;
  /** Callback ao clicar no selo de limite de débito — normalmente abre o WhatsApp. */
  onDebtLimitBadgeClick?: (clientId: string) => void;
  /**
   * Débito em aberto por cliente (saldo negativo, fora as exceções) — exibe
   * o selo "💰 R$ X" na locação avulsa ou fixa pra recepção lembrar de
   * cobrar. Só passado no mapa staff.
   */
  openDebtByClient?: Record<string, number>;
  /**
   * Modo somente leitura (ex.: Modo TV): mantém 100% do visual — cores,
   * badges, "Disponível", "Hist.", chips de fila, preço, disponibilizações
   * manuais — mas remove qualquer interação (cliques, edição, reativação,
   * botões de ação). Útil para painéis de exibição.
   */
  readOnly?: boolean;
}

// Sem ocupação ativa: vazia, locação cancelada ou fixo cancelado no dia.
const isFreeCell = (cell: CourtCell | undefined): boolean =>
  !cell ||
  cell.kind === "empty" ||
  (cell.kind === "booking" && !!cell.booking?.cancelled_at) ||
  (cell.kind === "fixed" && !!cell.cancelledException);

// Altura de cada meia-hora, em rem. Um slot cheio de 1h = 2 * HALF_H = 3.5rem.
const HALF_H = 2.35;

const ATTENDANCE_BADGE: Record<string, { cls: string; short: string; title: string }> = {
  came: { cls: "bg-emerald-600 text-white", short: "V", title: "Veio" },
  no_show: { cls: "bg-red-600 text-white", short: "F", title: "Faltou" },
  cancelled_ok: { cls: "bg-slate-500 text-white", short: "C", title: "Cancelou a tempo" },
  cancelled_late_charged: {
    cls: "bg-amber-600 text-white",
    short: "C$",
    title: "Cancelou tarde — cobrado",
  },
  cancelled_late_waived: {
    cls: "bg-amber-500/70 text-white",
    short: "C~",
    title: "Cancelou tarde — abonado",
  },
};

export function CourtMap({
  bookings,
  fixedSchedules,
  onCellClick,
  highlightAvailability = false,
  hideOccupantDetails = false,
  ownClientId = null,
  ownTeacherId = null,
  priceBands,
  priceCategoryId = null,
  date,
  includePromo = false,
  onlinePromoHint = false,
  onlinePromoCategoryId = null,
  attendanceByScheduleId,
  attendanceByBookingId,
  paidBookingIds,
  onlinePaidBookingIds,
  currentUserId = null,
  stickyHeader = true,
  manualAvailabilities,
  showManualBadge = false,
  onManualAvailabilityClick,
  enforceOnlineHours = false,
  waitlistLookup,
  onWaitlistBadgeClick,
  debtLimitByClient,
  onDebtLimitBadgeClick,
  openDebtByClient,
  readOnly = false,
}: Props) {
  const courts: readonly number[] = COURTS;
  interface Slot {
    cell: CourtCell;
    isStart: boolean;
    span: number; // em unidades de meia-hora
  }

  const grid = useMemo(() => {
    // Ocupação por (court, halfIndex) — índice dentro de HALF_SLOTS.
    const raw = new Map<string, CourtCell>();
    const activeBookings = bookings.filter((x) => !x.cancelled_at);
    const cancelledBookings = bookings.filter((x) => x.cancelled_at);

    // Só conta como "ocorrência cancelada" do fixo se for exatamente o
    // booking-fantasma criado pelo cancelamento do professor (ver
    // confirmCancel em mapa.tsx): mesmo client_id, mesma quadra, mesmo
    // horário EXATO do fixo (não só uma sobreposição com a hora clicada) e
    // source "professor". Antes bastava qualquer court_booking cancelada do
    // mesmo cliente/quadra tocando a hora — inclusive uma avulsa qualquer
    // sem nenhuma relação com o fixo — para a célula aparecer como
    // "Disponível" por cima de um mensalista ativo.
    //
    // No Portal do Cliente isso piorava mais ainda: client_id de quem não é
    // o próprio cliente vem mascarado como NULL tanto no fixo quanto nas
    // reservas (ver portal_map_schedules/portal_map_bookings), então sem a
    // checagem de não-nulo qualquer cancelamento alheio no mesmo
    // quadra/hora "casava" com qualquer fixo alheio só por os dois
    // client_id virem null — reportado: sócia via a Q1 das 12h como
    // disponível com um horário fixo do Humberto Nunes ativo por trás.
    const cancelledBookingForFixedHour = (schedule: FixedSchedule): FixedException | null => {
      if (!schedule.client_id) return null;
      const booking = cancelledBookings.find(
        (b) =>
          schedule.court !== null &&
          b.court === schedule.court &&
          b.source === "professor" &&
          !!b.client_id &&
          b.client_id === schedule.client_id &&
          b.start_time === schedule.start_time &&
          b.end_time === schedule.end_time,
      );
      if (!booking) return null;
      return {
        id: `booking:${booking.id}`,
        start_time: booking.start_time,
        end_time: booking.end_time,
        reason: booking.cancel_reason ?? "Cancelado",
      };
    };

    // Uma locação de professor (source='professor') pode ser só a
    // materialização de hoje do próprio horário fixo do cliente (criada ao
    // cancelar/reativar pela agenda ou pelo mapa do professor) — mesmo
    // cliente, mesma quadra, mesmo horário exato de um fixo ativo. Nesse
    // caso a célula deve continuar aparecendo como fixo (verde-musgo), não
    // como uma locação avulsa de professor (azul-claro) — visualmente é a
    // mesma aula de sempre, não uma segunda locação por cima da quadra.
    const isSameOccurrenceAsFixed = (b: Booking): boolean => {
      if (!b.client_id) return false;
      return fixedSchedules.some(
        (f) =>
          f.court === b.court &&
          f.client_id === b.client_id &&
          f.start_time === b.start_time &&
          f.end_time === b.end_time &&
          !findFixedExceptionForHour(f.exceptions, Math.floor(timeToHours(f.start_time))),
      );
    };

    for (const b of activeBookings) {
      if (isSameOccurrenceAsFixed(b)) continue;
      const s = timeToHours(b.start_time);
      const e = timeToHours(b.end_time);
      // Alinha por meia-hora: começa no piso de meia-hora, termina no teto.
      const startIdx = Math.max(0, Math.floor(s * 2) - HALF_SLOTS[0]! * 2);
      const endIdx = Math.min(HALF_SLOTS.length, Math.ceil(e * 2) - HALF_SLOTS[0]! * 2);
      for (let i = startIdx; i < endIdx; i++) {
        raw.set(`${b.court}-${i}`, { kind: "booking", booking: b });
      }
    }
    // Agrupa fixos por slot (várias pessoas podem dividir o mesmo horário/quadra).
    const fixedBySlot = new Map<string, FixedSchedule[]>();
    for (const sch of fixedSchedules) {
      if (!sch.court) continue;
      const s = timeToHours(sch.start_time);
      const e = timeToHours(sch.end_time);
      const startIdx = Math.max(0, Math.floor(s * 2) - HALF_SLOTS[0]! * 2);
      const endIdx = Math.min(HALF_SLOTS.length, Math.ceil(e * 2) - HALF_SLOTS[0]! * 2);
      for (let i = startIdx; i < endIdx; i++) {
        const key = `${sch.court}-${i}`;
        const arr = fixedBySlot.get(key) ?? [];
        arr.push(sch);
        fixedBySlot.set(key, arr);
      }
    }
    for (const [key, list] of fixedBySlot.entries()) {
      if (raw.has(key)) continue;
      const [, iStr] = key.split("-");
      const halfIdx = Number(iStr);
      const hourOfSlot = Math.floor(HALF_SLOTS[halfIdx]!);
      // Um mesmo horário/quadra "dividido" (dupla) tem uma exceção por
      // cliente — cancelar a aula de um deles não pode ficar escondido
      // atrás do primeiro nome do grupo. Calcula a exceção de CADA
      // integrante e usa só quem segue ativo pra montar a célula; se
      // sobrar alguém, a aula do(s) outro(s) simplesmente some da célula
      // (mesmo comportamento de quando só há 1 pessoa no horário).
      //
      // cancelledBookingForFixedHour só entra quando list.length === 1:
      // esse heurístico existe pra cobrir a aula reativada pela agenda do
      // professor (sempre 1 aluno só, sem client_schedule_exceptions
      // formal) — mas ele só verifica client+quadra+hora, sem nenhuma
      // relação garantida com ESTE horário fixo. Numa quadra dividida,
      // qualquer avulsa cancelada coincidindo por acaso com o horário de
      // UM dos dois (ex.: uma reserva avulsa qualquer, sem nenhuma
      // relação com o fixo, cancelada depois) já bastava pra esse cliente
      // sumir da célula sem aviso nenhum — reportado: "só aparece um dos
      // dois na quadra dividida". Com 2+ pessoas, só a exceção OFICIAL
      // (client_schedule_exceptions) pode tirar alguém da célula.
      const withExc = list.map((sch) => ({
        sch,
        exc:
          findFixedExceptionForHour(sch.exceptions, hourOfSlot) ??
          (list.length === 1 ? cancelledBookingForFixedHour(sch) : null),
      }));
      const active = withExc.filter((w) => !w.exc);
      const chosen = active.length > 0 ? active : withExc;
      const primary = chosen[0]!.sch;
      const exc = chosen[0]!.exc;
      // Se a aula fixa cancelada tem 2h ou mais no dia, quebra o "buraco"
      // em blocos de 1h para que a disponibilidade fique hora a hora.
      const excStart = exc?.start_time ?? primary.start_time;
      const excEnd = exc?.end_time ?? primary.end_time;
      const excDur = exc ? timeToHours(excEnd) - timeToHours(excStart) : 0;
      const splitHour = exc && excDur >= 2 ? hourOfSlot : undefined;
      raw.set(key, {
        kind: "fixed",
        fixed: primary,
        cancelledException: exc,
        fixedSiblings: chosen.slice(1).map((w) => w.sch),
        splitHour,
      });
    }
    for (const b of cancelledBookings) {
      const s = timeToHours(b.start_time);
      const e = timeToHours(b.end_time);
      const startIdx = Math.max(0, Math.floor(s * 2) - HALF_SLOTS[0]! * 2);
      const endIdx = Math.min(HALF_SLOTS.length, Math.ceil(e * 2) - HALF_SLOTS[0]! * 2);
      // Se a locação cancelada tinha 1h30 ou mais, quebra o bloco em slots
      // de 1h para que fiquem disponíveis hora a hora no mapa.
      const shouldSplit = e - s >= 1.5;
      for (let i = startIdx; i < endIdx; i++) {
        const key = `${b.court}-${i}`;
        if (!raw.has(key)) {
          const splitHour = shouldSplit ? Math.floor(HALF_SLOTS[i]!) : undefined;
          raw.set(key, { kind: "booking", booking: b, splitHour });
        }
      }
    }

    // Identidade da célula. Para agrupamento de disponibilidade, TODAS as
    // meias-horas que não possuem ocupação ATIVA (vazias, locação cancelada
    // ou aula fixa cancelada por exceção) compartilham a mesma identidade
    // "free". Assim, dois cancelamentos consecutivos (ex.: Bobby 10:00–11:30
    // + Eduardo 11:30–13:30) formam um único intervalo livre e o cálculo
    // hora-a-hora resulta em 10:00, 11:00 e 12:00 disponíveis (13:00 não,
    // porque só há 30 min consecutivos livres até a próxima ocupação).
    const identity = (c: CourtCell): string => {
      if (c.kind === "empty") return "free";
      if (c.kind === "booking") {
        const b = c.booking!;
        if (b.cancelled_at) return "free";
        return `b:${b.id}`;
      }
      const f = c.fixed!;
      if (c.cancelledException) return "free";
      return `f:${f.id}`;
    };

    const result = new Map<string, Slot>();
    for (const c of courts) {
      let i = 0;
      const total = HALF_SLOTS.length;
      while (i < total) {
        const cell = raw.get(`${c}-${i}`) ?? { kind: "empty" as const };
        const id = identity(cell);
        if (id === "free") {
          // Slots livres só se agrupam em blocos de EXATAMENTE 1 hora,
          // começando em hora inteira e quando a meia-hora seguinte também
          // estiver livre (independentemente da origem do cancelamento).
          const h = HALF_SLOTS[i]!;
          if (Number.isInteger(h) && i + 1 < total) {
            const nextCell = raw.get(`${c}-${i + 1}`) ?? { kind: "empty" as const };
            if (identity(nextCell) === "free") {
              result.set(`${c}-${i}`, { cell, isStart: true, span: 2 });
              result.set(`${c}-${i + 1}`, { cell: nextCell, isStart: false, span: 0 });
              i += 2;
              continue;
            }
          }
          result.set(`${c}-${i}`, { cell, isStart: true, span: 1 });
          i++;
          continue;
        }
        // Ocupação ativa (booking ou fixo) — agrupa por identidade.
        let span = 1;
        while (i + span < total) {
          const nextCell = raw.get(`${c}-${i + span}`);
          if (!nextCell || identity(nextCell) !== id) break;
          span++;
        }
        result.set(`${c}-${i}`, { cell, isStart: true, span });
        for (let k = 1; k < span; k++) {
          result.set(`${c}-${i + k}`, { cell, isStart: false, span: 0 });
        }
        i += span;
      }
    }
    return result;
  }, [bookings, fixedSchedules, courts]);

  // Índice de disponibilizações manuais por (quadra, hora inteira).
  // Uma disponibilização de 60 min ocupa a hora exata; se durar mais, cobre
  // as horas completas que estiverem inteiramente dentro do intervalo.
  const manualByHour = useMemo(() => {
    const map = new Map<string, ManualAvailability>();
    if (!manualAvailabilities?.length) return map;
    for (const m of manualAvailabilities) {
      const s = timeToHours(m.start_time);
      const e = timeToHours(m.end_time);
      for (let h = Math.ceil(s); h + 1 <= e; h++) {
        map.set(`${m.court}-${h}`, m);
      }
    }
    return map;
  }, [manualAvailabilities]);

  // halfOnly: desenha só esta meia-hora, mesmo que ela faça parte de um
  // bloco livre de 1h.
  const renderCellContent = (c: number, h: number, i: number, halfOnly = false) => {
    const slot = grid.get(`${c}-${i}`);
    if (slot && !slot.isStart && !halfOnly) return null;
    const cell = slot?.cell ?? { kind: "empty" as const };
    const span = halfOnly ? 1 : (slot?.span ?? 1);
    const isCancelled =
      (cell.kind === "booking" && !!cell.booking?.cancelled_at) ||
      (cell.kind === "fixed" && !!cell.cancelledException);

    // Só oferecemos disponibilidade em blocos de 1h cheios (span=2 em
    // meias-horas, começando em hora inteira). Meias-horas soltas
    // (ex.: 13:00–13:30 quando 13:30 já está ocupado) não podem ser
    // reservadas online.
    const hourInt = Math.floor(h);
    const isOutsideOnline =
      enforceOnlineHours &&
      !!date &&
      Number.isInteger(h) &&
      (!isFullHourOnline(date, hourInt) || isPastSlot(date, hourInt));
    const isFullHourAvailable =
      Number.isInteger(h) &&
      span === 2 &&
      !isOutsideOnline &&
      (cell.kind === "empty" ||
        (cell.kind === "fixed" && !!cell.cancelledException) ||
        (cell.kind === "booking" && !!cell.booking?.cancelled_at));

    // Partial: uma parte da hora cheia está livre (ex.: 30min de sobra
    // após cancelar 10:00–11:30 → a célula das 11:00 é parcialmente livre).
    // Não é clicável nem exibida como "Disponível", pois não alugamos 30min.
    const isPartiallyFreeCancelled =
      !isFullHourAvailable &&
      ((cell.kind === "booking" && !!cell.booking?.cancelled_at) ||
        (cell.kind === "fixed" && !!cell.cancelledException));

    return (
      <div
        role="button"
        tabIndex={0}
        title={
          highlightAvailability && isPartiallyFreeCancelled
            ? "Apenas 30 minutos livres — reserva mínima é de 1 hora"
            : undefined
        }
        onClick={readOnly ? undefined : () => {
          // No modo "disponibilidade" (portal e busca), só permite clicar
          // quando o slot for uma hora cheia disponível ou uma locação
          // ativa (para cancelamento próprio). Bloqueia meias-horas soltas.
          if (highlightAvailability) {
            const isActiveBooking =
              cell.kind === "booking" && !cell.booking?.cancelled_at;
            const isActiveFixed = cell.kind === "fixed" && !cell.cancelledException;
            if (!isFullHourAvailable && !isActiveBooking && !isActiveFixed) return;
          }
          onCellClick?.(c, Math.floor(h), cell);
        }}
        onKeyDown={readOnly ? undefined : (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (highlightAvailability) {
            const isActiveBooking = cell.kind === "booking" && !cell.booking?.cancelled_at;
            const isActiveFixed = cell.kind === "fixed" && !cell.cancelledException;
            if (!isFullHourAvailable && !isActiveBooking && !isActiveFixed) return;
          }
          onCellClick?.(c, Math.floor(h), cell);
        }}
        className={cn(
          readOnly
            ? "cursor-default"
            : "cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring/40",
          "relative flex h-full w-full flex-col items-start justify-start overflow-hidden rounded-sm px-2 py-1 text-left leading-tight transition",
          highlightAvailability && isPartiallyFreeCancelled && !readOnly && "cursor-not-allowed",
          cell.kind === "empty" &&
            (highlightAvailability && isFullHourAvailable
              ? "bg-yellow-400/25 border border-yellow-500/50 hover:bg-yellow-400/35 dark:bg-yellow-400/15"
              : "hover:bg-accent/50"),
          cell.kind === "booking" &&
            (() => {
              const b = cell.booking!;
              const isOwn =
                !!b.is_own ||
                (ownClientId && b.client_id === ownClientId) ||
                (ownTeacherId && b.teacher_id === ownTeacherId);
              if (b.cancelled_at) {
                if (highlightAvailability) {
                  return isFullHourAvailable
                    ? "bg-yellow-400/25 border border-yellow-500/50 hover:bg-yellow-400/35 dark:bg-yellow-400/15"
                    : "bg-muted/40 border border-dashed border-border/60";
                }
                return "bg-amber-500/10 border border-amber-500/50 text-amber-950 dark:text-amber-100";
              }
              if (b.hold_expires_at) {
                // Pré-reserva (pagamento online ainda não confirmado, ou
                // pedido via WhatsApp aguardando a secretaria) — precisa ser
                // claramente diferente de uma locação confirmada de verdade,
                // senão a recepção (ou o próprio cliente) pode achar que já
                // está tudo certo e a quadra pode "sumir" se o pagamento não
                // cair a tempo. Cor bem mais saturada que o cancelamento
                // (amber-500/10) + borda tracejada + texto explícito no
                // rótulo (ver BookingLabel) — não depende só da cor.
                return "bg-amber-400/60 border-2 border-dashed border-amber-700 text-amber-950 dark:bg-amber-500/40 dark:border-amber-500 dark:text-amber-50";
              }
              if (isOwn) {
                return "bg-yellow-300/80 border-2 border-yellow-500 text-yellow-950 ring-2 ring-yellow-500/60 dark:bg-yellow-400/50 dark:text-yellow-50";
              }
              if (!hideOccupantDetails && onlinePaidBookingIds?.has(b.id)) {
                // Pago online (Mercado Pago): amarelo forte, bem diferente
                // de qualquer outra locação.
                return "bg-yellow-400 border-2 border-yellow-600 text-yellow-950 hover:bg-yellow-300";
              }
              if (hideOccupantDetails && !isOwn) {
                return "bg-muted border border-border/60 text-muted-foreground";
              }
              if (isMovedFromFixedBooking(b)) {
                return `${FIXED_COLOR} border`;
              }
              // Professor com teachers.map_color_as_avulsa tem suas reservas
              // coloridas como avulsa (verde) no mapa.
              const sourceFallback =
                b.source === "professor" && b.teachers?.map_color_as_avulsa
                  ? SOURCE_COLOR.avulsa
                  : SOURCE_COLOR[b.source];
              return `${bookingCellColorClass(b.category_name, sourceFallback, b.category_color, b.clients?.full_name)} border`;
            })(),
          cell.kind === "fixed" &&
            (() => {
              const f = cell.fixed!;
              const isOwn =
                !!f.is_own ||
                (ownClientId && f.client_id === ownClientId) ||
                (ownTeacherId && f.teacher_id === ownTeacherId);
              if (cell.cancelledException) {
                if (highlightAvailability) {
                  return isFullHourAvailable
                    ? "bg-yellow-400/25 border border-yellow-500/50 hover:bg-yellow-400/35 dark:bg-yellow-400/15"
                    : "bg-muted/40 border border-dashed border-border/60";
                }
                return "bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-100";
              }
              if (isOwn) {
                return "bg-yellow-300/80 border-2 border-yellow-500 text-yellow-950 ring-2 ring-yellow-500/60 dark:bg-yellow-400/50 dark:text-yellow-50";
              }
              if (hideOccupantDetails && !isOwn) {
                return "bg-muted border border-border/60 text-muted-foreground";
              }
              return `${FIXED_COLOR} border`;
            })(),
        )}
      >
        {isCancelled && !(highlightAvailability && (cell.kind === "fixed" || cell.kind === "booking")) && (
          <span
            className="pointer-events-none absolute inset-x-1 top-1/2 z-10 border-t-2 border-destructive/80"
            aria-hidden="true"
          />
        )}
        {cell.kind === "booking" &&
          !(highlightAvailability && cell.booking!.cancelled_at) &&
          (!hideOccupantDetails ||
            !!cell.booking!.is_own ||
            (ownClientId && cell.booking!.client_id === ownClientId) ||
            (ownTeacherId && cell.booking!.teacher_id === ownTeacherId)) && (
            <BookingLabel booking={cell.booking!} span={span} currentUserId={currentUserId} />
          )}
        {cell.kind === "booking" &&
          hideOccupantDetails &&
          !(ownClientId && cell.booking!.client_id === ownClientId) &&
          !(ownTeacherId && cell.booking!.teacher_id === ownTeacherId) &&
          !cell.booking!.is_own &&
          !cell.booking!.cancelled_at && <OccupiedLabel />}
        {cell.kind === "fixed" &&
          !(highlightAvailability && cell.cancelledException) &&
          (hideOccupantDetails &&
          !(ownTeacherId && cell.fixed!.teacher_id === ownTeacherId) &&
          !(ownClientId && cell.fixed!.client_id === ownClientId) &&
          !cell.fixed!.is_own ? (
            <OccupiedLabel />
          ) : (
            <FixedLabel
              fixed={cell.fixed!}
              span={span}
              cancelled={!!cell.cancelledException}
              startHour={Math.floor(h)}
              siblings={cell.fixedSiblings ?? []}
            />
          ))}
        {cell.kind === "fixed" &&
          !cell.cancelledException &&
          !hideOccupantDetails &&
          attendanceByScheduleId?.[cell.fixed!.id] &&
          (() => {
            const st = attendanceByScheduleId[cell.fixed!.id]!.status;
            const b = ATTENDANCE_BADGE[st];
            if (!b) return null;
            return (
              <span
                title={b.title}
                className={`pointer-events-none absolute top-0.5 right-0.5 z-10 rounded px-1 text-[9px] font-bold ${b.cls}`}
              >
                {b.short}
              </span>
            );
          })()}
        {cell.kind === "booking" &&
          !cell.booking!.cancelled_at &&
          !hideOccupantDetails &&
          attendanceByBookingId?.[cell.booking!.id] &&
          (() => {
            const st = attendanceByBookingId[cell.booking!.id]!.status;
            const b = ATTENDANCE_BADGE[st];
            if (!b) return null;
            return (
              <span
                title={b.title}
                className={`pointer-events-none absolute top-0.5 right-0.5 z-10 rounded px-1 text-[9px] font-bold ${b.cls}`}
              >
                {b.short}
              </span>
            );
          })()}
        {cell.kind === "booking" &&
          !cell.booking!.cancelled_at &&
          !hideOccupantDetails &&
          !attendanceByBookingId?.[cell.booking!.id] &&
          paidBookingIds?.has(cell.booking!.id) && (
            <span
              title={
                onlinePaidBookingIds?.has(cell.booking!.id)
                  ? "Pago online (Mercado Pago)"
                  : "Pagamento lançado no caixa"
              }
              className="pointer-events-none absolute top-0.5 right-0.5 z-10 rounded bg-emerald-600 px-1 text-[9px] font-bold text-white"
            >
              $
            </span>
          )}
        {cell.kind === "booking" &&
          !cell.booking!.cancelled_at &&
          !hideOccupantDetails &&
          cell.booking!.client_id &&
          debtLimitByClient?.[cell.booking!.client_id] &&
          (() => {
            const info = debtLimitByClient[cell.booking!.client_id!];
            return (
              <button
                type="button"
                title={`Limite de débito atingido — ${fmtBRL(info.debtAmount)}. Clique para avisar por WhatsApp.`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDebtLimitBadgeClick?.(cell.booking!.client_id!);
                }}
                className="pointer-events-auto absolute top-0.5 left-0.5 z-20 inline-flex h-4 w-4 items-center justify-center rounded-full border border-orange-600/70 bg-orange-500 text-[10px] font-bold text-white shadow-sm hover:bg-orange-600"
              >
                !
              </button>
            );
          })()}
        {!hideOccupantDetails &&
          openDebtByClient &&
          (() => {
            const debtClientId =
              cell.kind === "booking" && cell.booking && !cell.booking.cancelled_at
                ? cell.booking.client_id
                : cell.kind === "fixed" && cell.fixed && !cell.cancelledException
                  ? cell.fixed.client_id
                  : null;
            const debt = debtClientId ? openDebtByClient[debtClientId] : undefined;
            if (!debt) return null;
            // Canto inferior direito, compacto ("💰108"), com fundo
            // avermelhado translúcido pra não cobrir o nome do cliente/
            // professor. Se a célula tem o chip de fila de espera (que
            // também fica embaixo à direita), sobe pra ficar acima dele.
            const slotStart =
              cell.kind === "booking" ? cell.booking!.start_time : cell.fixed!.start_time;
            const slotEnd = cell.kind === "booking" ? cell.booking!.end_time : cell.fixed!.end_time;
            const wl =
              slot?.isStart && slotStart && slotEnd
                ? waitlistLookup?.(c, slotStart.slice(0, 5), slotEnd.slice(0, 5))
                : undefined;
            const hasWaitlistChip = !!wl && (wl.count > 0 || wl.mine);
            return (
              <span
                title={`Cliente com débito em aberto de ${fmtBRL(debt)} — lembre de cobrar (dá pra receber junto ao lançar no caixa).`}
                className={cn(
                  "pointer-events-auto absolute right-0.5 z-20 rounded border border-rose-500/40 bg-rose-500/20 px-0.5 text-[9px] font-bold leading-[14px] text-rose-800 dark:text-rose-200",
                  hasWaitlistChip ? "bottom-[22px]" : "bottom-0.5",
                )}
              >
                💰{Math.round(debt).toLocaleString("pt-BR")}
              </span>
            );
          })()}
        {!hideOccupantDetails &&
          (() => {
            const notes =
              cell.kind === "booking" &&
              cell.booking &&
              !cell.booking.cancelled_at &&
              !isMovedFromFixedBooking(cell.booking)
                ? cell.booking.notes
                : cell.kind === "fixed" && cell.fixed && !cell.cancelledException
                  ? [
                      cell.fixed.day_note ? `Só hoje: ${cell.fixed.day_note}` : null,
                      cell.fixed.notes && !isImportedPlaceholderNote(cell.fixed.notes)
                        ? cell.fixed.notes
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null;
            if (!notes || isImportedPlaceholderNote(notes)) return null;
            return (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="pointer-events-auto absolute bottom-0.5 left-0.5 z-20 inline-flex h-4 w-4 items-center justify-center rounded-full border border-yellow-500/60 bg-yellow-300 text-[9px] shadow-sm dark:border-yellow-400/60 dark:bg-yellow-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      📝
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] whitespace-normal text-xs">
                    {notes}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })()}
        {(() => {
          // Chip de fila de espera nas locações ativas.
          if (!slot?.isStart) return null;
          let startT: string | null = null;
          let endT: string | null = null;
          if (cell.kind === "booking" && cell.booking && !cell.booking.cancelled_at) {
            startT = cell.booking.start_time?.slice(0, 5) ?? null;
            endT = cell.booking.end_time?.slice(0, 5) ?? null;
          } else if (cell.kind === "fixed" && cell.fixed && !cell.cancelledException) {
            startT = cell.fixed.start_time?.slice(0, 5) ?? null;
            endT = cell.fixed.end_time?.slice(0, 5) ?? null;
          } else if (highlightAvailability && isFullHourAvailable) {
            // Quadra ficou disponível (vazia, ou um fixo/avulsa cancelado
            // parcialmente só nesta hora — ex.: liberar só 19h de um fixo
            // de 18h às 20h) e tem gente esperando exatamente esse horário.
            // O chip aqui é o aviso de "avisar o cliente da fila", não só
            // um contador.
            startT = `${String(hourInt).padStart(2, "0")}:00`;
            endT = `${String(hourInt + 1).padStart(2, "0")}:00`;
          }
          if (!startT || !endT) return null;
          const lookup = waitlistLookup?.(c, startT, endT) ?? { count: 0, mine: false };
          const count = lookup.count;
          const isMine = lookup.mine;
          if (!count && !isMine) return null;
          const isNowAvailable = highlightAvailability && isFullHourAvailable;
          // Numa célula de várias horas (ex.: fixo 18:00–20:00), quem tá na
          // fila pode ter pedido só uma parte dela (ex.: 19:00–20:00) — sem
          // isso o selo parecia dizer "fila às 18h" quando é só de parte do
          // horário. Mostra a janela real sempre que ela for mais estreita
          // que a célula inteira.
          const distinctWindows = Array.from(
            new Set((lookup.windows ?? []).map((w) => `${w.start}–${w.end}`)),
          );
          const windowSuffix =
            !isMine && distinctWindows.length > 0 && !(distinctWindows.length === 1 && distinctWindows[0] === `${startT}–${endT}`)
              ? ` (${distinctWindows.join(", ")})`
              : "";
          const label = isMine
            ? "Na espera"
            : isNowAvailable
              ? `Avisar fila: ${count}${windowSuffix}`
              : `Fila: ${count}${windowSuffix}`;
          const clickable = !!onWaitlistBadgeClick && count > 0;
          return (
            <button
              type="button"
              disabled={!clickable}
              onClick={(e) => {
                e.stopPropagation();
                if (clickable) onWaitlistBadgeClick!(c, startT!, endT!);
              }}
              className={cn(
                "pointer-events-auto absolute z-20 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm",
                isNowAvailable ? "top-0.5 right-0.5 animate-pulse" : "bottom-0.5 right-0.5",
                isMine
                  ? "border-sky-500/60 bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100"
                  : isNowAvailable
                    ? "border-orange-600/70 bg-orange-500 text-white hover:bg-orange-600"
                    : "border-orange-500/60 bg-orange-100 text-orange-900 hover:bg-orange-200 dark:bg-orange-900/60 dark:text-orange-100",
                !clickable && "cursor-default",
              )}
              title={
                isMine
                  ? "Você está na fila deste horário"
                  : isNowAvailable
                    ? "Quadra liberou e tem gente esperando — clique para avisar"
                    : "Ver fila de espera"
              }
            >
              ⏳ {label}
            </button>
          );
        })()}
        {highlightAvailability && isFullHourAvailable && (() => {
          // Dados do histórico (cancelamento) para o tooltip do badge.
          type HistData = {
            title: string;
            clientName?: string;
            teacherName?: string | null;
            reason?: string | null;
            cancelledAt?: string | null;
            originalRange?: string | null;
            teacherId?: string | null;
          };
          let hist: HistData | null = null;
          if (cell.kind === "fixed" && cell.cancelledException) {
            const wasBooking = cell.cancelledException.id.startsWith("booking:");
            hist = {
              title: wasBooking ? "Locação avulsa cancelada" : "Aula fixa cancelada só neste dia",
              clientName: cell.fixed?.clients?.full_name ?? "Cliente",
              teacherName: cell.fixed?.teachers?.name ?? null,
              reason: cell.cancelledException.reason ?? null,
              cancelledAt: cell.cancelledException.created_at ?? null,
              originalRange:
                cell.fixed?.start_time && cell.fixed?.end_time
                  ? `${cell.fixed.start_time.slice(0, 5)}–${cell.fixed.end_time.slice(0, 5)}`
                  : null,
              teacherId: cell.fixed?.teacher_id ?? null,
            };
          } else if (cell.kind === "booking" && cell.booking?.cancelled_at) {
            hist = {
              title: "Locação cancelada",
              clientName:
                cell.booking.clients?.full_name ?? cell.booking.guest_name ?? "Cliente",
              teacherName: cell.booking.teachers?.name ?? null,
              reason: cell.booking.cancel_reason ?? null,
              cancelledAt: cell.booking.cancelled_at,
              originalRange:
                cell.booking.start_time && cell.booking.end_time
                  ? `${cell.booking.start_time.slice(0, 5)}–${cell.booking.end_time.slice(0, 5)}`
                  : null,
              teacherId: cell.booking.teacher_id ?? null,
            };
          }

          const isStaffLike = !hideOccupantDetails && !ownClientId && !ownTeacherId;
          const isOwnTeacher =
            !!ownTeacherId && !!hist?.teacherId && hist.teacherId === ownTeacherId;
          const showReactivate = !readOnly && !!hist && (isStaffLike || isOwnTeacher);
          const fmtDateTime = (iso: string | null | undefined) => {
            if (!iso) return null;
            const d = new Date(iso);
            if (isNaN(d.getTime())) return null;
            return d.toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          };

          return (
            <>
              {/* Badge "Histórico" — canto superior direito, clicável (mobile) e com tooltip (desktop) */}
              {hist && (
                <Popover>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label="Ver histórico da locação"
                            onClick={(e) => e.stopPropagation()}
                            className="pointer-events-auto absolute right-0.5 top-0.5 z-20 inline-flex min-h-[24px] min-w-[40px] items-center justify-center rounded-full border border-border/60 bg-muted/90 px-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40 sm:text-[10px]"
                          >
                            Hist.
                          </button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="hidden max-w-[240px] text-xs sm:block">
                        <div className="font-semibold">{hist.title}</div>
                        <div className="opacity-70">Toque/clique para detalhes</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <PopoverContent
                    side="top"
                    align="end"
                    className="w-[260px] text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-sm font-semibold">{hist.title}</div>
                    <div className="mt-2 space-y-1">
                      {hist.clientName && (
                        <div>
                          <span className="opacity-70">Cliente: </span>
                          <span className="font-medium">{hist.clientName}</span>
                        </div>
                      )}
                      {hist.teacherName && (
                        <div>
                          <span className="opacity-70">Professor: </span>
                          <span className="font-medium">{hist.teacherName}</span>
                        </div>
                      )}
                      {date && (
                        <div>
                          <span className="opacity-70">Data: </span>
                          <span>
                            {(() => {
                              const [y, m, d] = date.split("-");
                              return `${d}/${m}/${y}`;
                            })()}
                          </span>
                        </div>
                      )}
                      {hist.originalRange && (
                        <div>
                          <span className="opacity-70">Horário original: </span>
                          <span>{hist.originalRange}</span>
                        </div>
                      )}
                      {fmtDateTime(hist.cancelledAt) && (
                        <div>
                          <span className="opacity-70">Cancelado em: </span>
                          <span>{fmtDateTime(hist.cancelledAt)}</span>
                        </div>
                      )}
                      {hist.reason && (
                        <div>
                          <span className="opacity-70">Motivo: </span>
                          <span>{hist.reason}</span>
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              {/* Conteúdo principal — reserva espaço no topo para não colidir com o badge */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 top-0 flex flex-col items-center justify-center gap-0.5 px-1 pt-6 text-center text-[10px] font-semibold uppercase tracking-wide text-yellow-900 dark:text-yellow-200">
                <span>Disponível</span>

                {/* Chip "Sua aula" (apenas para o professor responsável) */}
                {hist && isOwnTeacher && (
                  <span className="pointer-events-none rounded-full border border-yellow-500/60 bg-yellow-300/60 px-1.5 py-[1px] text-[9px] font-semibold normal-case tracking-normal text-yellow-950 dark:bg-yellow-400/40 dark:text-yellow-50">
                    Sua aula
                  </span>
                )}

                {/* Botão discreto "Reativar" */}
                {showReactivate && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCellClick?.(c, Math.floor(h), cell);
                    }}
                    className="pointer-events-auto rounded-full border border-yellow-600/40 bg-background/70 px-2 py-[1px] text-[9px] font-medium normal-case tracking-normal text-yellow-900 hover:bg-yellow-500/10 dark:text-yellow-200"
                  >
                    Reativar
                  </button>
                )}

                {(() => {
                  const hh = Math.floor(h);
                  const manual = manualByHour.get(`${c}-${hh}`);
                  if (manual) {
                    return (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onManualAvailabilityClick?.(manual, hh);
                          }}
                          className="text-[10px] font-medium normal-case tracking-normal text-yellow-900 dark:text-yellow-200 underline-offset-2 hover:underline"
                        >
                          {fmtBRL(manual.hourly_price)}/h
                        </button>
                        {showManualBadge && (
                          <span className="rounded-full border border-yellow-600/50 bg-yellow-50 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-100">
                            Manual
                          </span>
                        )}
                      </>
                    );
                  }
                  const wd = date ? weekdayFromYmd(date) : null;
                  if (!priceBands || priceBands.length === 0 || wd == null) return null;
                  const startTime = `${String(hh).padStart(2, "0")}:00`;
                  const endTime = `${String(hh + 1).padStart(2, "0")}:00`;
                  const calcArgs = {
                    bands: priceBands,
                    weekday: wd,
                    startTime,
                    endTime,
                    categoryId: priceCategoryId,
                    court: c,
                    date: date,
                  };
                  // Portal (includePromo): mesmo cálculo da cobrança online,
                  // inclusive a regra do cliente sem categoria.
                  const calc = includePromo
                    ? calcOnlinePrice({ ...calcArgs, avulsoCategoryId: onlinePromoCategoryId })
                    : calcPrice({ ...calcArgs, includePromo: false });
                  if (!calc || !calc.matched || calc.total <= 0) return null;
                  const priceEl = (
                    <span className="text-[10px] font-medium normal-case tracking-normal text-yellow-900 dark:text-yellow-200">
                      {fmtBRL(calc.total)}/h
                    </span>
                  );
                  if (!onlinePromoHint || includePromo) return priceEl;
                  // Compara avulso com e sem promoção: só mostra o aviso se a
                  // promoção realmente baixa o preço do avulso neste slot.
                  const avulsoArgs = {
                    bands: priceBands,
                    weekday: wd,
                    startTime,
                    endTime,
                    categoryId: onlinePromoCategoryId,
                    court: c,
                    date,
                  };
                  const avulsoNormal = calcPrice({ ...avulsoArgs, includePromo: false });
                  const avulsoOnline = calcPrice({ ...avulsoArgs, includePromo: true });
                  if (
                    !avulsoNormal?.matched ||
                    !avulsoOnline?.matched ||
                    avulsoOnline.total <= 0 ||
                    avulsoOnline.total >= avulsoNormal.total - 0.005
                  ) {
                    return priceEl;
                  }
                  return (
                    <>
                      {priceEl}
                      <span
                        title="Promoção só para cliente AVULSO que comprar online, direto no site. Lançamento pela recepção/diretoria segue o valor normal."
                        className="rounded-full border border-emerald-600/50 bg-emerald-50 px-1.5 py-[1px] text-[9px] font-semibold normal-case tracking-normal text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
                      >
                        Site {fmtBRL(avulsoOnline.total)}
                      </span>
                    </>
                  );
                })()}
              </span>
            </>
          );
        })()}
      </div>
    );
  };



  return (
    <div className="relative">
      <div
        className={cn(
          "w-full max-w-full overflow-x-auto rounded-md border",
          // O cabeçalho (Hora/quadras) só consegue ficar "grudado" no topo de
          // forma confiável se este contêiner tiver uma altura própria e
          // rolagem vertical real: overflow-x:auto sozinho já faz o navegador
          // tratar overflow-y:visible como auto por baixo dos panos (regra do
          // próprio CSS), o que quebra o sticky relativo à página — o
          // cabeçalho passa a "flutuar" sobre as primeiras linhas em vez de
          // ficar fixo no topo. Com altura limitada + overflow-y-auto, o mapa
          // vira um painel com rolagem própria (mesmo padrão de planilha
          // online) e o sticky funciona de verdade, em qualquer tela.
          // 100vh no celular é o viewport "cheio" (como se a barra de endereço
          // do navegador nunca aparecesse); o navegador recalcula isso ao
          // mostrar/esconder a barra durante a rolagem, e o painel (e o
          // cabeçalho sticky dentro dele) pula de tamanho no meio do gesto —
          // exatamente o "a barra sobe e sobrepõe outras coisas" relatado no
          // celular. 100dvh acompanha a altura real visível a cada momento.
          stickyHeader
            ? "overflow-y-auto max-h-[calc(100dvh-var(--map-sticky-top,0px)-1rem)]"
            : "overflow-y-visible",
        )}
      >
        <div
          className={cn(
            "grid w-full text-[12px]",
            "max-sm:min-w-[30rem]",
          )}
          style={{
            gridTemplateColumns: `4rem repeat(${courts.length}, minmax(0, 1fr))`,
            gridTemplateRows: `1.75rem repeat(${HALF_SLOTS.length}, ${HALF_H}rem)`,
          }}
        >
          <div
            className={cn(
              "sticky left-0 z-20 flex items-center bg-muted p-1 text-left font-semibold shadow-[0_1px_0_0_hsl(var(--border))] border-b border-r",
              stickyHeader && "z-40 top-0",
            )}
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            Hora
          </div>
          {courts.map((c, courtIdx) => (
            <div
              key={`head-${c}`}
              className={cn(
                "z-10 flex items-center justify-center truncate p-1 text-center font-semibold shadow-[0_1px_0_0_hsl(var(--border))] border-b border-r last:border-r-0",
                "bg-muted",
                stickyHeader && "sticky z-30 top-0",
              )}
              style={{ gridColumn: courtIdx + 2, gridRow: 1 }}
            >
              {courtLabel(c)}
            </div>
          ))}
          {HALF_SLOTS.map((h, i) =>
            Number.isInteger(h) ? (
              <div
                key={`time-${h}`}
                className="sticky left-0 z-20 flex items-start bg-background p-2 font-mono text-muted-foreground border-b border-r"
                style={{ gridColumn: 1, gridRow: `${i + 2} / span 2` }}
              >
                {hourLabel(h)}
              </div>
            ) : null,
          )}
          {courts.map((c, courtIdx) =>
            HALF_SLOTS.map((h, i) => {
              const slot = grid.get(`${c}-${i}`);
              if (slot && !slot.isStart) return null;
              const span = slot?.span ?? 1;
              const endsAtFullHour = Number.isInteger(HALF_SLOTS[i + span - 1]! + 0.5);
              return (
                <div
                  key={`cell-${c}-${i}`}
                  className={cn(
                    "relative overflow-hidden p-0.5 border-r last:border-r-0",
                    endsAtFullHour ? "border-b" : "border-b border-b-dashed border-b-border/40",
                  )}
                  style={{ gridColumn: courtIdx + 2, gridRow: `${i + 2} / span ${span}` }}
                >
                  {renderCellContent(c, h, i)}
                </div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

function OccupiedLabel() {
  return (
    <div className="flex items-center justify-center h-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Ocupado
    </div>
  );
}

function ClientLink({
  clientId,
  children,
  className,
}: {
  clientId?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  if (!clientId) return <>{children}</>;
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        navigate({ to: "/clientes/$clientId", params: { clientId } });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          navigate({ to: "/clientes/$clientId", params: { clientId } });
        }
      }}
      className={cn("cursor-pointer hover:underline underline-offset-2", className)}
    >
      {children}
    </span>
  );
}

function BookingLabel({
  booking,
  span,
  currentUserId,
}: {
  booking: Booking;
  span: number;
  currentUserId?: string | null;
}) {
  const cancelled = !!booking.cancelled_at;
  // Pré-reserva ainda não confirmada — pagamento online pendente (tem
  // client_id) ou pedido via WhatsApp aguardando a secretaria (sem
  // client_id, guest_name literal "PRÉ-RESERVA — ..."). Enquanto isso, a
  // quadra pode "sumir" (expira e libera sozinha) se ninguém confirmar —
  // precisa ficar óbvio que isto NÃO é uma locação confirmada, tanto pra
  // recepção quanto pro próprio cliente. O selo abaixo já deixa isso
  // explícito, então o nome não precisa repetir o texto cru "PRÉ-RESERVA —
  // ... (aguardando confirmação)" do pedido via WhatsApp.
  const isHold = !cancelled && !!booking.hold_expires_at;
  const holdExpiresLabel = isHold
    ? new Date(booking.hold_expires_at!).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const cleanedGuestName =
    isHold && booking.guest_name
      ? booking.guest_name
          .replace(/^PRÉ-RESERVA — /, "")
          .replace(/ \(aguardando confirmação\)$/, "")
      : booking.guest_name;
  const baseName =
    booking.clients?.full_name ??
    cleanedGuestName ??
    (booking.teachers?.name ? `Prof. ${booking.teachers.name}` : "Avulsa");
  const baseClientId = booking.clients?.id ?? null;
  const extras = booking.participants ?? [];
  const startLbl = hoursToLabel(timeToHours(booking.start_time));
  const endLbl = hoursToLabel(timeToHours(booking.end_time));
  const cancelledByMe =
    cancelled && !!currentUserId && booking.cancelled_by === currentUserId;
  const teacherName = booking.teachers?.name;
  const showTeacherLine =
    !!teacherName &&
    !!booking.clients?.full_name &&
    baseName !== `Prof. ${teacherName}`;
  return (
    <div className="leading-tight">
      {isHold && (
        <div className="mb-0.5">
          <span className="inline-flex max-w-full items-center gap-1 whitespace-normal break-words rounded-full border-2 border-amber-700 bg-amber-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-950 dark:border-amber-400 dark:bg-amber-600 dark:text-amber-50">
            ⏳ {booking.client_id ? "Aguardando pagamento" : "Aguardando confirmação"}
            {holdExpiresLabel ? ` · expira ${holdExpiresLabel}` : ""}
          </span>
        </div>
      )}
      <div className={cn("font-medium whitespace-normal break-words", cancelled && "line-through opacity-70")}>
        <ClientLink clientId={baseClientId}>{baseName}</ClientLink>
        {extras.map((p, idx) => (
          <span key={`${p.client_id}-${idx}`}>
            {" + "}
            <ClientLink clientId={p.client_id}>{p.full_name}</ClientLink>
          </span>
        ))}
      </div>
      {cancelled && (
        <div className="text-[10px] font-semibold uppercase tracking-normal text-destructive">
          Cancelado
          {cancelledByMe && (
            <span className="ml-1 italic normal-case font-medium">(por você)</span>
          )}
        </div>
      )}
      {showTeacherLine && (
        <div className="text-[10px] opacity-80 whitespace-normal break-words">
          Prof. {teacherName}
        </div>
      )}
      {span > 1 && (
        <div className="text-[10px] opacity-70 whitespace-normal break-words">
          {startLbl}–{endLbl}
        </div>
      )}
      {booking.guest_type && (
        <div className="text-[10px] opacity-80 whitespace-normal break-words">
          {booking.guest_type === "convidado" && "com convidado"}
          {booking.guest_type === "batedor" && "com batedor"}
          {booking.guest_name ? ` • ${booking.guest_name}` : ""}
        </div>
      )}
    </div>
  );
}

function FixedLabel({
  fixed,
  span,
  cancelled,
  siblings = [],
}: {
  fixed: FixedSchedule;
  span: number;
  cancelled: boolean;
  startHour: number;
  siblings?: FixedSchedule[];
}) {
  const rangeLabel = `${hoursToLabel(timeToHours(fixed.start_time))}–${hoursToLabel(timeToHours(fixed.end_time))}`;
  const firstName = (s?: FixedSchedule) =>
    s?.clients?.full_name?.split(" ")[0] ?? "Cliente";
  const primaryName = fixed.clients?.full_name ?? "Fixo";
  const primaryClientId = fixed.clients?.id ?? fixed.client_id ?? null;
  const showSiblings = siblings.length > 0;
  return (
    <div className="leading-tight">
      <div
        className={cn(
          "font-medium whitespace-normal break-words",
          cancelled && "line-through opacity-70",
        )}
        title={
          showSiblings
            ? [primaryName, ...siblings.map((s) => s.clients?.full_name ?? "")].join(", ")
            : undefined
        }
      >
        <ClientLink clientId={primaryClientId}>
          {showSiblings ? firstName(fixed) : primaryName}
        </ClientLink>
        {showSiblings &&
          siblings.map((s, idx) => (
            <span key={`${s.id}-${idx}`}>
              {" + "}
              <ClientLink clientId={s.clients?.id ?? s.client_id ?? null}>
                {firstName(s)}
              </ClientLink>
            </span>
          ))}
      </div>
      {cancelled && (
        <div className="text-[10px] font-semibold uppercase tracking-normal text-destructive">
          Cancelado
        </div>
      )}
      <div className="text-[10px] opacity-70 whitespace-normal break-words">
        {cancelled
          ? `${rangeLabel}${fixed.teachers?.name ? ` • Prof. ${fixed.teachers.name}` : ""}`
          : span > 1
          ? `${rangeLabel}${fixed.teachers?.name ? ` • ${fixed.teachers.name}` : ""}`
          : `Fixo${fixed.teachers?.name ? ` • ${fixed.teachers.name}` : ""}${showSiblings ? ` • dividido (${siblings.length + 1})` : ""}`}
      </div>
    </div>
  );
}


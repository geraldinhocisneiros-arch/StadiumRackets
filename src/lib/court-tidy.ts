// Lógica do lembrete "arrumar quadra": a cada virada de hora cheia, quadras
// onde uma locação termina e outra começa em seguida precisam ser arrumadas
// pela manutenção antes do próximo cliente. Ver useCourtTidyReminder para o
// agendamento (10 minutos antes de cada hora cheia, exceto 06h).

import {
  COURTS,
  timeToHours,
  weekdayOfISO,
  findFixedExceptionForHour,
  TENNIS_COURT,
  isManutencaoClientName,
  type Booking,
  type FixedSchedule,
} from "@/lib/court-map";

// Bloqueios que não precisam do aviso pra manutenção depois (o próprio
// bloqueio já é a manutenção da quadra).
function tidiesUpAfterItself(clientName: string | null): boolean {
  return isManutencaoClientName(clientName);
}

// Checkpoint das 06h sempre pulado — cedo demais, a secretaria ainda não
// abriu quando ele dispararia (10 min antes, às 05:50).
export const TIDY_REMINDER_SKIP_HOURS = new Set<number>([6]);

// Só a quadra de tênis é de saibro e precisa ser arrumada (varrida/molhada)
// entre locações. As quadras de pickleball não entram na varredura.
const TIDY_COURTS = COURTS.filter((c) => c === TENNIS_COURT);

function bookingEndsAt(b: Booking, court: number, hour: number): boolean {
  return !b.cancelled_at && b.court === court && timeToHours(b.end_time) === hour;
}

function bookingStartsAt(b: Booking, court: number, hour: number): boolean {
  return !b.cancelled_at && b.court === court && timeToHours(b.start_time) === hour;
}

// Nome do cliente que começa a ocupar a quadra em `hour` (avulsa ou fixo),
// ou null se ninguém começa exatamente nessa hora.
function startingClientName(
  court: number,
  hour: number,
  bookings: Booking[],
  fixedSchedules: FixedSchedule[],
  weekday: number,
): string | null {
  const startingBooking = bookings.find((b) => bookingStartsAt(b, court, hour));
  if (startingBooking)
    return startingBooking.clients?.full_name ?? startingBooking.guest_name ?? null;
  const startingFixed = fixedSchedules.find((f) => fixedStartsAt(f, court, hour, weekday));
  if (startingFixed) return startingFixed.clients?.full_name ?? null;
  return null;
}

// Fixo ativo terminando exatamente em `hour`: precisa estar sem exceção
// cobrindo a última hora da sessão (hour-1 até hour).
function fixedEndsAt(f: FixedSchedule, court: number, hour: number, weekday: number): boolean {
  if (f.court !== court || f.weekday !== weekday) return false;
  if (timeToHours(f.end_time) !== hour) return false;
  return !findFixedExceptionForHour(f.exceptions, hour - 1);
}

// Fixo ativo começando exatamente em `hour`: sem exceção cobrindo essa hora.
function fixedStartsAt(f: FixedSchedule, court: number, hour: number, weekday: number): boolean {
  if (f.court !== court || f.weekday !== weekday) return false;
  if (timeToHours(f.start_time) !== hour) return false;
  return !findFixedExceptionForHour(f.exceptions, hour);
}

export interface TidyResult {
  // Virada de verdade: uma locação termina e a próxima já começa na mesma
  // hora do checkpoint — precisa ser arrumada JÁ, antes do próximo cliente.
  priority: number[];
  // Fica livre agora (sem locação imediatamente em seguida), mas já tem
  // locação marcada pra próxima hora cheia — dá tempo de arrumar depois das
  // prioritárias, deixando pronta antes daquele horário chegar.
  later: number[];
  // Vai entrar em manutenção agora — não precisa ser arrumada (a
  // manutenção não depende da recepção deixar a quadra pronta, ela mesma
  // vai mexer na quadra), mas a equipe ainda precisa ser avisada que a
  // manutenção vai começar ali.
  enteringMaintenance: number[];
}

/**
 * Quadras com locação terminando exatamente às `checkpointHour`. Fica de
 * fora do "arrumar" a quadra cuja locação terminando é um bloqueio de
 * "Manutenção" (ver tidiesUpAfterItself). Quando é a "Manutenção" quem
 * está COMEÇANDO, a quadra também sai do "arrumar" (a manutenção não
 * precisa que a recepção prepare nada) e vai para `enteringMaintenance`
 * — um aviso à parte, só pra equipe saber que a manutenção vai começar.
 *
 * Dentre as que sobram pro "arrumar", separa por urgência: `priority` já
 * tem cliente entrando na mesma hora (arrumar agora, antes de mais nada);
 * `later` só fica livre agora mas tem locação marcada pra hora seguinte
 * (arrumar depois das prioritárias, com folga até lá) — e também não entra
 * em `later` se essa próxima locação for manutenção, já que ela vai
 * aparecer em `enteringMaintenance` no checkpoint certo, quando começar de
 * verdade.
 */
export function computeCourtsNeedingTidy(params: {
  date: string;
  checkpointHour: number;
  bookings: Booking[];
  fixedSchedules: FixedSchedule[];
}): TidyResult {
  const { date, checkpointHour, bookings, fixedSchedules } = params;
  const weekday = weekdayOfISO(date);
  const priority: number[] = [];
  const later: number[] = [];
  const enteringMaintenance: number[] = [];

  for (const court of TIDY_COURTS) {
    const immediateStartName = startingClientName(
      court,
      checkpointHour,
      bookings,
      fixedSchedules,
      weekday,
    );
    if (isManutencaoClientName(immediateStartName)) {
      enteringMaintenance.push(court);
      continue;
    }

    const endingBooking = bookings.find((b) => bookingEndsAt(b, court, checkpointHour));
    const endingFixed = endingBooking
      ? null
      : (fixedSchedules.find((f) => fixedEndsAt(f, court, checkpointHour, weekday)) ?? null);
    if (!endingBooking && !endingFixed) continue;

    const endingClientName = endingBooking
      ? (endingBooking.clients?.full_name ?? endingBooking.guest_name ?? null)
      : (endingFixed?.clients?.full_name ?? null);
    if (tidiesUpAfterItself(endingClientName)) continue;

    if (immediateStartName != null) {
      priority.push(court);
      continue;
    }

    const nextHourStartName = startingClientName(
      court,
      checkpointHour + 1,
      bookings,
      fixedSchedules,
      weekday,
    );
    if (nextHourStartName != null && !isManutencaoClientName(nextHourStartName)) {
      later.push(court);
    }
  }

  return { priority, later, enteringMaintenance };
}

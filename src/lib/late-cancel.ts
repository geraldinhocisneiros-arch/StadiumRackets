// Regras de cancelamento tardio (mesma conta do banco — ver
// public.court_cancel_window_hours / public.court_cancel_is_late: precisão
// de minuto, horário de Recife).
//
// • Quadra de TÊNIS (saibro, quadra 1): é a única quadra de tênis do clube,
//   então precisa ser cancelada com pelo menos 24h de antecedência — dá tempo
//   de a recepção alugar o horário pra outra pessoa. Vale para qualquer
//   cancelamento de locação com cliente (recepção, portal do cliente ou
//   professor). Depois disso a quadra é cobrada: a recepção recebe o aviso
//   "Cancelamento com menos de 24h" com o botão "Lançar no caixa".
// • Quadras de PICKLEBALL: mantém a regra do professor — o professor cancela
//   a locação do aluno sem custo até 3h antes do início.

import { TENNIS_COURT } from "@/lib/court-map";

export const TENNIS_CANCEL_WINDOW_HOURS = 24;
export const PROFESSOR_CANCEL_WINDOW_HOURS = 3;

/** Antecedência mínima (em horas) para cancelar sem custo nesta quadra. */
export function cancelWindowHours(court: number | null | undefined): number {
  return court === TENNIS_COURT ? TENNIS_CANCEL_WINDOW_HOURS : PROFESSOR_CANCEL_WINDOW_HOURS;
}

/** Na quadra de tênis a regra vale pra todo mundo; nas demais, só pro professor. */
export function lateCancelAppliesTo(
  court: number | null | undefined,
  opts: { isProfessor: boolean },
): boolean {
  return court === TENNIS_COURT || opts.isProfessor;
}

/** Recife é UTC-3 fixo (sem horário de verão). */
function recifeSlotToUtcMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y!, m! - 1, d!, hh! + 3, mm ?? 0);
}

export function isLateCancel(
  date: string,
  startTime: string,
  court: number | null | undefined,
  now: Date = new Date(),
): boolean {
  const nowMinute = Math.floor(now.getTime() / 60000) * 60000;
  const windowMs = cancelWindowHours(court) * 60 * 60 * 1000;
  return nowMinute > recifeSlotToUtcMs(date, startTime) - windowMs;
}

/**
 * Último momento para cancelar sem cobrança, em texto: "08:00" (mesmo dia)
 * ou "10/11 às 18:00" (quando a janela volta para o dia anterior).
 */
export function lateCancelDeadlineLabel(
  date: string,
  startTime: string,
  court: number | null | undefined,
): string {
  const deadline = new Date(recifeSlotToUtcMs(date, startTime) - cancelWindowHours(court) * 3600_000);
  // Volta pro "relógio de Recife" (UTC-3) para formatar.
  const local = new Date(deadline.getTime() - 3 * 3600_000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  const sameDay =
    local.getUTCFullYear() === Number(date.slice(0, 4)) &&
    local.getUTCMonth() + 1 === Number(date.slice(5, 7)) &&
    local.getUTCDate() === Number(date.slice(8, 10));
  if (sameDay) return `${hh}:${mi}`;
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm} às ${hh}:${mi}`;
}

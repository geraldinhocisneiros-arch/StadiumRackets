// Helpers para vigência dos horários fixos e exceções por período.
// Um `client_schedule` só ocorre numa data D quando:
//  - weekday bate com D
//  - (valid_from IS NULL OR D >= valid_from) e
//    (valid_until IS NULL OR D <= valid_until)
//  - não há exceção "dia inteiro" cobrindo D (ver `isFullDayExceptionOn`)
//
// Uma exceção pode ser de um único dia (`range_end` NULL) ou cobrir um
// intervalo (`exception_date <= D <= range_end`).

export interface ScheduleWindow {
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface RangedException {
  client_schedule_id: string;
  exception_date: string;
  range_end?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

/** Retorna true se um `client_schedule` está vigente na data ISO (YYYY-MM-DD). */
export function isScheduleActiveOn(schedule: ScheduleWindow, isoDate: string): boolean {
  if (schedule.valid_from && isoDate < schedule.valid_from) return false;
  if (schedule.valid_until && isoDate > schedule.valid_until) return false;
  return true;
}

/** Retorna true se a exceção cobre a data ISO. */
export function exceptionCoversDate(ex: RangedException, isoDate: string): boolean {
  const start = ex.exception_date;
  const end = ex.range_end ?? ex.exception_date;
  return start <= isoDate && isoDate <= end;
}

/** True se existe alguma exceção "dia inteiro" (sem start/end) desse fixo na data. */
export function isFullDayExceptionOn(
  exceptions: RangedException[],
  scheduleId: string,
  isoDate: string,
): boolean {
  return exceptions.some(
    (e) =>
      e.client_schedule_id === scheduleId &&
      !e.start_time &&
      !e.end_time &&
      exceptionCoversDate(e, isoDate),
  );
}

/** Retorna as exceções aplicáveis (qualquer tipo) a um fixo numa data. */
export function exceptionsForScheduleOn(
  exceptions: RangedException[],
  scheduleId: string,
  isoDate: string,
): RangedException[] {
  return exceptions.filter(
    (e) => e.client_schedule_id === scheduleId && exceptionCoversDate(e, isoDate),
  );
}

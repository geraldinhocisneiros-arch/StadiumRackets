// Turmas fixas de pickleball.
//
// Turma = um horário semanal (quadra, dia, horário, professor). Matrícula =
// uma linha de client_schedules com class_id preenchido — por isso o resto
// do sistema já enxerga a quadra ocupada. A diferença para o fixo do tênis:
// o aluno paga UMA mensalidade por mês e a presença NÃO gera cobrança.
// Ver supabase/migrations/20261117000000_turmas_pickleball.sql.

export interface PickleballClass {
  id: string;
  name: string;
  court: number;
  weekday: number;
  start_time: string;
  end_time: string;
  teacher_id: string | null;
  capacity: number | null;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
}

export interface PickleballClassMember {
  id: string; // client_schedules.id
  class_id: string;
  client_id: string;
  class_monthly_amount: number | null;
  valid_from: string | null;
  valid_until: string | null;
  full_name: string;
  phone: string | null;
}

/** Horário fixo que é matrícula de turma (não cobra por aula). */
export const isClassSchedule = (s: { class_id?: string | null } | null | undefined): boolean =>
  !!s?.class_id;

const inRange = (from: string | null, until: string | null, date: string) =>
  (!from || from <= date) && (!until || until >= date);

export const classIsActiveOn = (
  c: Pick<PickleballClass, "valid_from" | "valid_until">,
  date: string,
) => inRange(c.valid_from, c.valid_until, date);

export const memberIsActiveOn = (
  m: Pick<PickleballClassMember, "valid_from" | "valid_until">,
  date: string,
) => inRange(m.valid_from, m.valid_until, date);

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-12-01" → "dezembro/2026" */
export const monthLabel = (iso: string): string =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

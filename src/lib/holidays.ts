/**
 * Feriados oficiais nacionais, estaduais (PE) e municipais (Recife).
 * Datas móveis calculadas a partir da Páscoa (algoritmo de Meeus/Jones/Butcher).
 */

export type HolidayScope = "nacional" | "estadual" | "municipal";

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  scope: HolidayScope;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toISO(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function isoFromUTC(d: Date) {
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function getHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const goodFriday = addDays(easter, -2);
  const carnavalTue = addDays(easter, -47);
  const corpusChristi = addDays(easter, 60);

  const list: Holiday[] = [
    // Nacionais fixos
    { date: toISO(year, 1, 1), name: "Confraternização Universal", scope: "nacional" },
    { date: toISO(year, 4, 21), name: "Tiradentes", scope: "nacional" },
    { date: toISO(year, 5, 1), name: "Dia do Trabalho", scope: "nacional" },
    { date: toISO(year, 9, 7), name: "Independência do Brasil", scope: "nacional" },
    { date: toISO(year, 10, 12), name: "Nossa Senhora Aparecida", scope: "nacional" },
    { date: toISO(year, 11, 2), name: "Finados", scope: "nacional" },
    { date: toISO(year, 11, 15), name: "Proclamação da República", scope: "nacional" },
    { date: toISO(year, 11, 20), name: "Consciência Negra", scope: "nacional" },
    { date: toISO(year, 12, 25), name: "Natal", scope: "nacional" },
    // Nacionais móveis
    { date: isoFromUTC(carnavalTue), name: "Carnaval", scope: "nacional" },
    { date: isoFromUTC(goodFriday), name: "Sexta-feira Santa", scope: "nacional" },
    { date: isoFromUTC(corpusChristi), name: "Corpus Christi", scope: "nacional" },
    // Pernambuco / Recife
    { date: toISO(year, 3, 6), name: "Revolução Pernambucana (PE)", scope: "estadual" },
    { date: toISO(year, 6, 24), name: "São João (Recife)", scope: "municipal" },
    { date: toISO(year, 6, 29), name: "São Pedro (Recife)", scope: "municipal" },
    { date: toISO(year, 7, 16), name: "N. Sra. do Carmo (padroeira de PE)", scope: "estadual" },
    { date: toISO(year, 12, 8), name: "N. Sra. da Conceição (padroeira do Recife)", scope: "municipal" },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

export function findHoliday(dateISO: string): Holiday | null {
  if (!dateISO || dateISO.length < 10) return null;
  const year = Number(dateISO.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return getHolidays(year).find((h) => h.date === dateISO) ?? null;
}

export function getUpcomingHolidays(fromISO: string, months = 6): Holiday[] {
  const y = Number(fromISO.slice(0, 4));
  const list = [...getHolidays(y), ...getHolidays(y + 1)];
  const cutoff = new Date(fromISO + "T00:00:00Z");
  const end = new Date(cutoff);
  end.setUTCMonth(end.getUTCMonth() + months);
  return list.filter((h) => {
    const d = new Date(h.date + "T00:00:00Z");
    return d >= cutoff && d <= end;
  });
}

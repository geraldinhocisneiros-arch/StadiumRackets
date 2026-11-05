export const TENNIS_CLASS_VALUES = [
  "iniciante",
  "5_classe",
  "4_classe",
  "3_classe",
  "2_classe",
  "1_classe",
] as const;

export type TennisClass = (typeof TENNIS_CLASS_VALUES)[number];

export const TENNIS_CLASS_LABELS: Record<TennisClass, string> = {
  iniciante: "Iniciante",
  "5_classe": "5ª classe",
  "4_classe": "4ª classe",
  "3_classe": "3ª classe",
  "2_classe": "2ª classe",
  "1_classe": "1ª classe",
};

export const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function daysInMonth(month: number | null): number {
  if (!month) return 31;
  if (month === 2) return 29;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

export function formatBirthday(day: number | null | undefined, month: number | null | undefined): string {
  if (!day || !month) return "—";
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

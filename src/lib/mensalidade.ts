// Mensalidade da escolinha (tênis/pickleball) lançada no Caixa com o mês
// de referência (payments.reference_month, sempre dia 1º do mês).

import { todayISO } from "@/lib/format";

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

/** Recebe o nome da categoria já normalizado (sem acento, minúsculo). */
export const isEscolinhaCategory = (catNorm: string): boolean => catNorm.startsWith("escolinha");

/**
 * Escolinha Pickleball: a mensalidade é gerada como débito na conta
 * (Turmas → Gerar mensalidades), então o pagamento entra como CRÉDITO na
 * conta e abate o débito. Escolinha Tênis não tem gerador: pagamento direto.
 */
export const isEscolinhaPickleballCategory = (catNorm: string): boolean =>
  isEscolinhaCategory(catNorm) && catNorm.includes("pickle");

const ref = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;

/** Mês atual (fuso de Recife) como "2026-11-01". */
export const currentMonthRef = (): string => todayISO().slice(0, 7) + "-01";

/** "2026-11-01" → "nov/26" */
export const shortMonthRef = (iso: string): string =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]!.slice(0, 3)}/${iso.slice(2, 4)}`;

/** "2026-11-01" → "novembro/2026" */
export const longMonthRef = (iso: string): string =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

/**
 * Opções do seletor: 2 meses antes até 2 depois do atual (pagamento
 * atrasado ou adiantado). Inclui o mês já gravado no lançamento, se estiver
 * fora dessa faixa.
 */
export function mensalidadeMonthOptions(selected?: string): Array<[string, string]> {
  const t = todayISO();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const out: string[] = [];
  for (let d = -2; d <= 2; d++) {
    const idx = y * 12 + (m - 1) + d;
    out.push(ref(Math.floor(idx / 12), (idx % 12) + 1));
  }
  if (selected && !out.includes(selected)) out.push(selected);
  out.sort();
  return out.map((v) => [v, longMonthRef(v)]);
}

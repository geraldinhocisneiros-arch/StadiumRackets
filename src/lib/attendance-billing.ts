// Cálculo de valor para presença de clientes fixos gerada pelo mapa de quadras.
// Base = tabela de preços da quadra/hora. Divisão 50/50 quando há 2 fixos
// cobráveis no mesmo slot; 100% para o presente se o outro cancelou a tempo.
// Desconto do cliente aplicado depois da divisão.

import { calcPrice, weekdayFromYmd, type PriceBand } from "@/lib/pricing";

export type AttendanceStatus =
  | "came"
  | "no_show"
  | "cancelled_ok"
  | "cancelled_late_charged"
  | "cancelled_late_waived";

// Status que geram cobrança no caixa.
export const CHARGEABLE_STATUSES: AttendanceStatus[] = [
  "came",
  "no_show",
  "cancelled_late_charged",
];

export const isChargeable = (s: AttendanceStatus | null | undefined) =>
  s != null && CHARGEABLE_STATUSES.includes(s);

// Fixos ("mensalistas") que entram no fluxo de presença. No Stadium
// Rackets todo fixo entra (não há aulas em grupo cobradas fora do caixa);
// mantido como função pra centralizar a regra caso isso mude.
export const isBillableFixed = (_fullName?: string | null) => true;

interface BillArgs {
  bands: PriceBand[];
  date: string; // "YYYY-MM-DD"
  // Janela real a cobrar — normalmente uma hora cheia ("11:00"–"12:00"),
  // mas pode ser mais curta na ponta de um horário fixo "quebrado" (início
  // ou fim em :30), ex.: "11:30"–"12:00".
  startTime: string;
  endTime: string;
  court: number;
  discountPercent: number; // 0..100
  // Status dos DEMAIS fixos cobráveis (não excluídos) que compartilham o slot
  // (não inclui este cliente). null = ainda não marcado.
  siblingStatuses: (AttendanceStatus | null)[];
  // Status para ESTE cliente.
  selfStatus: AttendanceStatus;
}

export interface BillResult {
  amount: number; // valor final após divisão e desconto
  baseAmount: number; // valor da quadra na hora, sem divisão
  splitDenominator: number; // 1, 2, …
  matched: boolean; // tabela de preços cobriu o slot
}

export function computeAttendanceAmount(args: BillArgs): BillResult {
  const wd = weekdayFromYmd(args.date);
  const calc =
    wd == null
      ? null
      : calcPrice({
          bands: args.bands,
          weekday: wd,
          startTime: args.startTime,
          endTime: args.endTime,
          court: args.court,
          date: args.date,
        });
  const base = calc?.total ?? 0;
  const matched = !!calc?.matched;

  // Divisão: conta este (se cobrável) + siblings cobráveis.
  const selfCount = isChargeable(args.selfStatus) ? 1 : 0;
  const siblingCount = args.siblingStatuses.filter((s) => isChargeable(s)).length;
  const split = Math.max(1, selfCount + siblingCount);

  const share = isChargeable(args.selfStatus) ? base / split : 0;
  const pct = Math.min(Math.max(args.discountPercent, 0), 100);
  const finalAmount =
    pct > 0 && share > 0
      ? Math.round(share * (1 - pct / 100) * 100) / 100
      : Math.round(share * 100) / 100;

  return {
    amount: finalAmount,
    baseAmount: Math.round(base * 100) / 100,
    splitDenominator: split,
    matched,
  };
}

export const statusLabel = (s: AttendanceStatus): string => {
  switch (s) {
    case "came":
      return "Veio";
    case "no_show":
      return "Faltou";
    case "cancelled_ok":
      return "Cancelou a tempo";
    case "cancelled_late_charged":
      return "Cancelou tarde · cobrado";
    case "cancelled_late_waived":
      return "Cancelou tarde · abonado";
  }
};

export const statusBadgeClass = (s: AttendanceStatus): string => {
  switch (s) {
    case "came":
      return "bg-emerald-600 text-white";
    case "no_show":
      return "bg-red-600 text-white";
    case "cancelled_ok":
      return "bg-slate-500 text-white";
    case "cancelled_late_charged":
      return "bg-amber-600 text-white";
    case "cancelled_late_waived":
      return "bg-amber-500/70 text-white";
  }
};

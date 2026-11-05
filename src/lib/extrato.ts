// Regras de leitura do extrato da conta corrente, compartilhadas entre o
// sistema interno (ficha do cliente) e o portal do cliente — os dois
// precisam mostrar exatamente as mesmas linhas e o mesmo saldo.

import { courtShort } from "@/lib/court-map";

export interface EntryPaymentInfo {
  category?: string | null;
  court?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

// "Lançamento do caixa" não diz nada — troca pela categoria do pagamento e
// acrescenta quadra e horário quando existirem.
export function describeEntryText(description: string | null, info?: EntryPaymentInfo) {
  const desc = description ?? "";
  const cat = info?.category ?? "";
  const generic = desc.trim().toLowerCase() === "lançamento do caixa";
  const base = (generic && cat ? cat : desc) || cat || "—";
  // Descrições geradas pelo sistema (ex.: "Luz · PB1 · 21:00–23:00") já
  // trazem quadra e horário — não repete.
  const court = info?.court && !base.includes(courtShort(info.court)) ? courtShort(info.court) : "";
  const start = info?.start_time?.slice(0, 5);
  const end = info?.end_time?.slice(0, 5);
  const rawTime = start && end ? `${start}–${end}` : (start ?? "");
  const time = rawTime && !base.includes(rawTime) ? rawTime : "";
  return [base, court, time].filter(Boolean).join(" · ");
}

interface BalanceEntry {
  id: string;
  entry_type: string;
  amount: number;
  entry_date: string;
  created_at: string;
}

export const entryDelta = (e: { entry_type: string; amount: number }) =>
  e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);

// Saldo acumulado depois de cada lançamento (ordem cronológica).
export function runningBalances<T extends BalanceEntry>(entries: T[]) {
  const sorted = [...entries].sort((a, b) =>
    a.entry_date === b.entry_date
      ? a.created_at.localeCompare(b.created_at)
      : a.entry_date.localeCompare(b.entry_date),
  );
  const map: Record<string, number> = {};
  let run = 0;
  for (const e of sorted) {
    run += entryDelta(e);
    map[e.id] = run;
  }
  return { sorted, map };
}

// Resumo de um mês (YYYY-MM) no formato de fatura.
export function monthSummaryOf(
  entries: { entry_type: string; amount: number; entry_date: string }[],
  ym: string,
) {
  let opening = 0;
  let debits = 0;
  let credits = 0;
  for (const e of entries) {
    const amt = Number(e.amount);
    if (e.entry_date < `${ym}-01`) opening += entryDelta(e);
    else if (e.entry_date.startsWith(ym)) {
      if (e.entry_type === "credito") credits += amt;
      else debits += amt;
    }
  }
  return { opening, debits, credits, closing: opening - debits + credits };
}

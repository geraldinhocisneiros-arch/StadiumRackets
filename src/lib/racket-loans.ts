import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Raquetes de empréstimo da recepção (1 a 4). Cada empréstimo fica em
// racket_loans; o empréstimo sem returned_at é o que está "na rua". O número
// da raquete é lido sempre como `court` (alias na consulta) por
// compatibilidade com o componente.

export type LoanKind = "racket";

export const LOAN_TABLE = {
  racket: "racket_loans",
} as const satisfies Record<LoanKind, string>;

export const LOAN_ITEM_COLUMN = {
  racket: "racket",
} as const satisfies Record<LoanKind, string>;

export const RACKETS = [1, 2, 3, 4] as const;

export interface RemoteLoan {
  id: string;
  court: number;
  holder_name: string;
  client_id: string | null;
  booking_id: string | null;
  notes: string | null;
  lent_at: string;
  lent_by: string | null;
  returned_at: string | null;
  returned_by: string | null;
  return_notes: string | null;
}

/** Sugestão de quem levou o item (quem está jogando agora). */
export interface RemoteHolderSuggestion {
  name: string;
  client_id: string | null;
  booking_id: string | null;
  timeLabel: string;
}

/** Depois disso o empréstimo aparece em vermelho (provável esquecimento). */
export const REMOTE_OVERDUE_HOURS = 3;

export const LOAN_COLUMNS =
  "id, court, holder_name, client_id, booking_id, notes, lent_at, lent_by, returned_at, returned_by, return_notes";

/** Colunas do empréstimo, com o número do item sempre exposto como `court`. */
export const loanColumns = (_kind: LoanKind): string =>
  LOAN_COLUMNS.replace("court", "court:racket");

export function isLoanOverdue(loan: Pick<RemoteLoan, "lent_at">, now = Date.now()): boolean {
  return now - new Date(loan.lent_at).getTime() > REMOTE_OVERDUE_HOURS * 3600_000;
}

export function fmtLoanTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export async function fetchOpenLoans(
  kind: LoanKind = "racket",
): Promise<Record<number, RemoteLoan>> {
  const { data, error } = await supabase
    .from(LOAN_TABLE[kind])
    .select(loanColumns(kind))
    .is("returned_at", null);
  if (error) throw error;
  const map: Record<number, RemoteLoan> = {};
  ((data ?? []) as unknown as RemoteLoan[]).forEach((l) => {
    map[l.court] = l;
  });
  return map;
}

/** Empréstimos em aberto, recarregando a cada minuto. */
export function useOpenRemoteLoans(enabled = true, kind: LoanKind = "racket") {
  const [openLoans, setOpenLoans] = useState<Record<number, RemoteLoan>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setOpenLoans(await fetchOpenLoans(kind));
    } catch (e) {
      console.warn(`Falha ao carregar empréstimos (${kind}):`, e);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const t = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(t);
  }, [enabled, reload]);

  return { openLoans, loading, reload };
}

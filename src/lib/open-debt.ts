import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/format";
import { courtShort } from "@/lib/court-map";

/**
 * Chave Pix da Stadium Rackets usada nas mensagens de cobrança.
 * TODO: preencher com a chave Pix (CNPJ) da Stadium Rackets. Enquanto
 * estiver vazia, as mensagens saem sem a linha do Pix.
 */
export const CLUB_PIX_KEY = "";

/** Trecho "faça o Pix" das mensagens de cobrança (vazio sem chave cadastrada). */
export function pixLine(): string {
  return CLUB_PIX_KEY ? `*Chave Pix (CNPJ): ${CLUB_PIX_KEY}*\n` : "";
}

export interface OpenDebt {
  /** Valor total em aberto (positivo). */
  debt: number;
  /** Parte do débito no bucket "geral" — a que o "receber junto" quita. */
  geralDebt: number;
}

/** Estado da opção "receber também o débito em aberto" (mapa e Caixa). */
export interface ReceiveOpenDebtValue {
  checked: boolean;
  /** Valor a receber do débito (texto do input, como os demais valores do caixa). */
  amount: string;
}

export const EMPTY_RECEIVE_OPEN_DEBT: ReceiveOpenDebtValue = { checked: false, amount: "" };

/** Valor a lançar como quitação, ou 0 se a opção não estiver marcada. */
export function receiveOpenDebtAmount(v: ReceiveOpenDebtValue): number {
  if (!v.checked) return 0;
  return Math.max(0, Math.round((Number(v.amount.replace(",", ".")) || 0) * 100) / 100);
}

export interface OpenDebtItem {
  entry_date: string;
  description: string;
  amount: number;
  booking_date: string | null;
  court: number | null;
  start_time: string | null;
}

/**
 * Débito em aberto dos clientes (saldo negativo, fora a lista de exceções
 * do limite de débito). Sem ids = todos os negativos. Só funciona pra
 * admin/diretoria/recepção — pros demais papéis volta vazio.
 */
export async function fetchOpenDebtByClient(
  clientIds?: string[],
): Promise<Record<string, OpenDebt>> {
  if (clientIds && clientIds.length === 0) return {};
  const { data, error } = await supabase.rpc(
    "clients_open_debt",
    clientIds ? { _client_ids: clientIds } : {},
  );
  if (error) {
    console.error("[open-debt] clients_open_debt", error);
    return {};
  }
  const map: Record<string, OpenDebt> = {};
  for (const r of data ?? []) {
    map[r.client_id] = { debt: Number(r.debt_amount) || 0, geralDebt: Number(r.geral_debt) || 0 };
  }
  return map;
}

export async function fetchClientOpenDebt(clientId: string): Promise<OpenDebt | null> {
  const map = await fetchOpenDebtByClient([clientId]);
  return map[clientId] ?? null;
}

/** Débitos lançados desde a última vez que a conta ficou zerada/positiva. */
export async function fetchOpenDebtItems(clientId: string): Promise<OpenDebtItem[]> {
  const { data, error } = await supabase.rpc("client_open_debt_items", { _client_id: clientId });
  if (error) {
    console.error("[open-debt] client_open_debt_items", error);
    return [];
  }
  return (data ?? []) as OpenDebtItem[];
}

function ddmm(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function hourLabel(t: string): string {
  const [h, m] = t.split(":");
  return m && m !== "00" ? `${Number(h)}h${m}` : `${Number(h)}h`;
}

function itemLabel(it: OpenDebtItem): string {
  if (it.court != null && it.start_time) return `Locação ${courtShort(it.court)} ${hourLabel(it.start_time)}`;
  const desc = (it.description ?? "").trim() || "Lançamento";
  return desc.length > 40 ? `${desc.slice(0, 39)}…` : desc;
}

const MAX_ITEMS_IN_MESSAGE = 5;

/**
 * Linhas "• 05/09 — Locação Q2 19h — R$ 60,00" dos débitos em aberto.
 * Mostra só os mais recentes pra mensagem não virar extrato.
 */
export function formatOpenDebtItems(items: OpenDebtItem[], debt: number): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(-MAX_ITEMS_IN_MESSAGE);
  const hidden = items.length - shown.length;
  const lines: string[] = [];
  if (hidden > 0) {
    lines.push(
      `• desde ${ddmm(items[0].entry_date)}: mais ${hidden} lançamento${hidden > 1 ? "s" : ""} anterior${hidden > 1 ? "es" : ""}`,
    );
  }
  for (const it of shown) {
    lines.push(
      `• ${ddmm(it.booking_date ?? it.entry_date)} — ${itemLabel(it)} — ${fmtBRL(Number(it.amount))}`,
    );
  }
  const sum = items.reduce((s, it) => s + Number(it.amount || 0), 0);
  const paidPart = Math.round((sum - debt) * 100) / 100;
  if (paidPart > 0.009) {
    lines.push(`(já descontado o pagamento parcial de ${fmtBRL(paidPart)})`);
  }
  return lines;
}

/**
 * Parágrafo de lembrete do débito em aberto, pra anexar no fim das
 * mensagens de WhatsApp já existentes (pagamento, reserva nova). Volta
 * null quando o cliente não está negativo ou está na lista de exceções.
 * `dependentFirstName` preenchido = mensagem vai pro responsável financeiro.
 */
export async function buildOpenDebtReminder(
  clientId: string,
  dependentFirstName?: string | null,
): Promise<string | null> {
  const open = await fetchClientOpenDebt(clientId);
  if (!open || open.debt <= 0) return null;
  const items = await fetchOpenDebtItems(clientId);
  const lines = formatOpenDebtItems(items, open.debt);
  const quem = dependentFirstName ? `${dependentFirstName} tem` : "você tem";
  return (
    `*Lembrete:* ${quem} um saldo em aberto de *${fmtBRL(open.debt)}*` +
    (lines.length ? `, referente a:\n${lines.join("\n")}` : ".") +
    (CLUB_PIX_KEY
      ? `\n\nQuando vier ao clube, passe na recepção pra atualizar, ou se preferir, já pode fazer o Pix:\n` +
        pixLine() +
        `Depois é só mandar o comprovante aqui.`
      : `\n\nQuando vier ao clube, passe na recepção pra atualizar.`)
  );
}

/**
 * Marca nas observações do lançamento que o débito foi recebido junto
 * (mapa ou Caixa) — é por ela que o relatório de cobrança vai medir quanto
 * entrou por esse caminho.
 */
export const OPEN_DEBT_SETTLEMENT_NOTE = "Quitação de débito em aberto (recebido junto)";

/**
 * Lança no caixa o crédito que quita (total ou parcialmente) o débito em
 * aberto do bucket "geral". Usa "Pendência avulsa" e, na falta dela,
 * "Mensalista" — as duas geram crédito na conta corrente.
 */
export async function insertOpenDebtSettlement(params: {
  clientId: string;
  amount: number;
  method: string;
  paidAtIso?: string;
}): Promise<{ error: string | null }> {
  const amount = Math.round(params.amount * 100) / 100;
  if (amount <= 0) return { error: null };
  const { data: cats } = await supabase.from("client_categories").select("id, name");
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const byName = (n: string) => (cats ?? []).find((c) => norm(c.name) === n)?.id ?? null;
  const categoryId = byName("pendencia avulsa") ?? byName("mensalista");
  if (!categoryId) {
    return {
      error: 'Não encontrei a categoria "Pendência avulsa" pra quitar o débito. Avise o suporte.',
    };
  }
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("payments").insert({
    client_id: params.clientId,
    category_id: categoryId,
    amount,
    method: params.method as never,
    paid_at: params.paidAtIso ?? new Date().toISOString(),
    received: true,
    to_account: true,
    account_direction: "credito",
    notes: OPEN_DEBT_SETTLEMENT_NOTE,
    recorded_by: userData.user?.id ?? null,
  });
  return { error: error?.message ?? null };
}

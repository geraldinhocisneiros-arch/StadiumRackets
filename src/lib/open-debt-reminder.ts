import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/format";
import { addDaysISO, findFixedExceptionForHour, timeToHours, courtShort } from "@/lib/court-map";
import { fetchCourtMapData } from "@/lib/court-map-data";
import {
  CLUB_PIX_KEY,
  pixLine,
  fetchOpenDebtByClient,
  fetchOpenDebtItems,
  formatOpenDebtItems,
} from "@/lib/open-debt";
import { buildWhatsAppUrl, normalizePhoneForWhatsApp } from "@/lib/whatsapp";

/** Hora (Recife) a partir da qual o pop-up de véspera aparece pra recepção. */
export const OPEN_DEBT_REMINDER_HOUR = 11;
/** Contexto do log de WhatsApp do aviso de véspera. */
export const OPEN_DEBT_D1_CONTEXT = "open_debt_d1";
/** No máximo uma cobrança por cliente nesse intervalo. */
const COBRANCA_COOLDOWN_DAYS = 7;
/** Envios que contam como "já cobrado" pra o limite semanal. */
const COBRANCA_SEND_CONTEXTS = [OPEN_DEBT_D1_CONTEXT, "overdue"];

export interface ReminderSlot {
  court: number;
  start: string;
  end: string;
}

export interface OpenDebtReminderRow {
  clientId: string;
  fullName: string;
  debt: number;
  slots: ReminderSlot[];
  /** URL wa.me já montada (null = sem telefone). */
  whatsappUrl: string | null;
  /** Nome de quem recebe a mensagem (cliente ou responsável financeiro). */
  recipientName: string;
}

function slotLabel(s: ReminderSlot): string {
  return `${courtShort(s.court)} ${s.start.slice(0, 5)}–${s.end.slice(0, 5)}`;
}

export function formatReminderSlots(slots: ReminderSlot[]): string {
  return slots.map(slotLabel).join(" · ");
}

/** Cliente → locações de amanhã (avulsas, participantes e fixos ativos). */
async function fetchTomorrowSlotsByClient(
  tomorrow: string,
): Promise<Map<string, ReminderSlot[]> | null> {
  const data = await fetchCourtMapData(tomorrow);
  if (data.failed) return null;
  const byClient = new Map<string, ReminderSlot[]>();
  const add = (clientId: string | null | undefined, slot: ReminderSlot) => {
    if (!clientId) return;
    const arr = byClient.get(clientId) ?? [];
    if (!arr.some((s) => s.court === slot.court && s.start === slot.start)) arr.push(slot);
    byClient.set(clientId, arr);
  };
  for (const b of data.bookings) {
    if (b.cancelled_at || b.hold_expires_at) continue;
    const slot = { court: b.court, start: b.start_time, end: b.end_time };
    add(b.client_id, slot);
    for (const p of b.participants ?? []) add(p.client_id, slot);
  }
  for (const f of data.fixed) {
    if (!f.client_id || f.court == null) continue;
    const start = timeToHours(f.start_time);
    const end = timeToHours(f.end_time);
    let active = false;
    for (let h = Math.floor(start); h < end; h++) {
      if (!findFixedExceptionForHour(f.exceptions, h)) {
        active = true;
        break;
      }
    }
    if (active) add(f.client_id, { court: f.court, start: f.start_time, end: f.end_time });
  }
  for (const arr of byClient.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
  return byClient;
}

async function buildD1Message(params: {
  clientId: string;
  fullName: string;
  phone: string | null;
  financialResponsible: string | null;
  debt: number;
}): Promise<{ url: string | null; recipientName: string }> {
  let recipientPhone = params.phone;
  let recipientFirstName = params.fullName.split(" ")[0];
  let dependentFirstName: string | null = null;
  if (params.financialResponsible?.trim()) {
    const { data: respRows } = await supabase
      .from("clients")
      .select("full_name, phone")
      .ilike("full_name", params.financialResponsible.trim())
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      recipientPhone = resp.phone;
      recipientFirstName = resp.full_name.split(" ")[0];
      dependentFirstName = params.fullName.split(" ")[0];
    }
  }
  const phone = normalizePhoneForWhatsApp(recipientPhone);
  if (!phone) return { url: null, recipientName: recipientFirstName };

  const items = await fetchOpenDebtItems(params.clientId);
  const lines = formatOpenDebtItems(items, params.debt);
  const quem = dependentFirstName ? `${dependentFirstName} tem` : "você tem";
  const quemVem = dependentFirstName ? `${dependentFirstName} vier` : "vier";
  const message =
    `Olá, ${recipientFirstName}! Tudo bem? Passando pra lembrar que ${quem} um saldo em aberto de *${fmtBRL(params.debt)}* aqui no clube` +
    (lines.length ? `, referente a:\n${lines.join("\n")}` : ".") +
    (CLUB_PIX_KEY
      ? `\n\nQuando ${quemVem} jogar amanhã, passe na recepção pra atualizar, ou se preferir, já pode fazer o Pix:\n` +
        `${pixLine()}\n` +
        `Depois é só mandar o comprovante aqui. Obrigado e bom jogo!`
      : `\n\nQuando ${quemVem} jogar amanhã, passe na recepção pra atualizar. Obrigado e bom jogo!`);
  return { url: buildWhatsAppUrl(phone, message), recipientName: recipientFirstName };
}

/**
 * Lista do pop-up de véspera: clientes com saldo negativo (fora as
 * exceções), com locação amanhã, que não receberam cobrança nos últimos 7
 * dias e que ainda não foram resolvidos hoje no pop-up. null = falha ao
 * carregar (quem chama mantém o que já tinha).
 */
export async function fetchOpenDebtReminderRows(
  today: string,
): Promise<OpenDebtReminderRow[] | null> {
  const debts = await fetchOpenDebtByClient();
  if (Object.keys(debts).length === 0) return [];
  const slotsByClient = await fetchTomorrowSlotsByClient(addDaysISO(today, 1));
  if (!slotsByClient) return null;

  const candidates = Object.keys(debts).filter((id) => slotsByClient.has(id));
  if (candidates.length === 0) return [];

  const since = new Date(Date.now() - COBRANCA_COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString();
  const [sendsRes, actionsRes, clientsRes] = await Promise.all([
    supabase
      .from("whatsapp_notifications")
      .select("client_id")
      .in("client_id", candidates)
      .in("context", COBRANCA_SEND_CONTEXTS)
      .gte("sent_at", since),
    supabase
      .from("open_debt_reminder_actions")
      .select("client_id")
      .eq("reminder_date", today)
      .in("client_id", candidates),
    supabase
      .from("clients")
      .select("id, full_name, phone, financial_responsible")
      .in("id", candidates),
  ]);
  if (sendsRes.error || actionsRes.error || clientsRes.error) return null;

  const done = new Set<string>([
    ...(sendsRes.data ?? []).map((r) => r.client_id),
    ...(actionsRes.data ?? []).map((r) => r.client_id),
  ]);
  const pending = (clientsRes.data ?? []).filter((c) => !done.has(c.id));

  const rows = await Promise.all(
    pending.map(async (c) => {
      const debt = debts[c.id]!.debt;
      const { url, recipientName } = await buildD1Message({
        clientId: c.id,
        fullName: c.full_name,
        phone: c.phone,
        financialResponsible: c.financial_responsible,
        debt,
      });
      return {
        clientId: c.id,
        fullName: c.full_name,
        debt,
        slots: slotsByClient.get(c.id) ?? [],
        whatsappUrl: url,
        recipientName,
      } satisfies OpenDebtReminderRow;
    }),
  );
  rows.sort((a, b) => (a.slots[0]?.start ?? "").localeCompare(b.slots[0]?.start ?? ""));
  return rows;
}

/** Registra no pop-up do dia que o cliente foi resolvido (some pra todos). */
export async function recordOpenDebtReminderAction(
  clientId: string,
  today: string,
  action: "sent" | "skipped",
): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("open_debt_reminder_actions").upsert(
    {
      client_id: clientId,
      reminder_date: today,
      action,
      acted_by: userData.user?.id ?? null,
      acted_at: new Date().toISOString(),
    },
    { onConflict: "client_id,reminder_date" },
  );
  return error?.message ?? null;
}

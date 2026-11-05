import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fmtBRL, fmtDate } from "@/lib/format";
import { buildOpenDebtReminder } from "@/lib/open-debt";
import { courtLongLabel, courtShort } from "@/lib/court-map";

/** Normaliza telefone para o formato wa.me (somente dígitos, com DDI 55 quando ausente). */
export function normalizePhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

/** Monta a URL wa.me com mensagem pré-preenchida. */
export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/**
 * Reutiliza a mesma aba/janela nomeada do WhatsApp quando ela foi aberta pelo app.
 */
export function openWhatsApp(url: string) {
  const whatsappWindow = window.open(url, "stadium_whatsapp_web");
  whatsappWindow?.focus();
}

/**
 * Retorna true se o usuário atual pode enviar notificações WhatsApp para clientes.
 * Apenas admin/diretoria/recepcionista. Professores (e demais papéis) ficam bloqueados.
 */
let _staffCache: { userId: string; allowed: boolean } | null = null;
export async function canSendClientWhatsApp(): Promise<boolean> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return false;
    if (_staffCache && _staffCache.userId === userId) return _staffCache.allowed;
    const { data: rows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (rows ?? []).map((r) => r.role as string);
    const allowed =
      roles.includes("admin") || roles.includes("diretoria") || roles.includes("recepcionista");
    _staffCache = { userId, allowed };
    return allowed;
  } catch {
    return false;
  }
}

/**
 * Contextos que geram follow-up de cobrança: só a cobrança da aba
 * Inadimplentes ("overdue" — também usada pelos botões de 2ª mensagem e
 * lembrete do Acompanhamento de cobrança). Por pedido explícito, o aviso
 * diário de véspera ("open_debt_d1"), a calculadora de crédito
 * ("month_end_credit_reminder") e os avisos da aba Caixa, do limite de
 * débito ficam de fora, mesmo sendo cobrança.
 */
const COBRANCA_CONTEXTS = new Set(["overdue"]);

/** Registra no banco que um WhatsApp foi enviado para o cliente. */
export async function logWhatsAppSent(clientId: string, context?: string) {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.error("[whatsapp] getUser error", userErr);
    const userId = userData.user?.id ?? null;
    if (!userId) {
      console.warn("[whatsapp] sem usuário autenticado — log não será gravado");
      return;
    }
    const { error } = await supabase.from("whatsapp_notifications").insert({
      client_id: clientId,
      sent_by: userId,
      context: context ?? null,
    });
    if (error) console.error("[whatsapp] insert error", error);

    // Toda mensagem de cobrança cria/atualiza um follow-up pendente, pra
    // a equipe conseguir acompanhar e marcar como resolvido quando o
    // cliente pagar — ver "Acompanhamento de cobrança" no menu.
    if (context && COBRANCA_CONTEXTS.has(context)) {
      const { error: followupError } = await supabase.rpc("cobranca_followup_register_send", {
        _client_id: clientId,
        _context: context,
      });
      if (followupError) console.error("[whatsapp] followup register error", followupError);
    }
  } catch (e) {
    console.error("[whatsapp] log exception", e);
  }
}

interface NotifyParams {
  clientId: string;
  amount: number;
  accountDirection?: string | null;
  /** ISO timestamp do pagamento (paid_at). Usado para agrupar lançamentos do mesmo horário. */
  paidAt?: string | null;
  /** Horário de início da quadra (HH:MM[:SS]). Usado para agrupar lançamentos do mesmo slot. */
  startTime?: string | null;
  /** Nome da categoria do pagamento (ex: estorno). */
  categoryName?: string | null;
}

/**
 * Soma o valor de TODOS os lançamentos do cliente no mesmo dia e no mesmo horário de início.
 * Retorna { total, count } — count = quantos lançamentos foram considerados.
 */
async function getCombinedAmountForSlot(
  clientId: string,
  paidAt: string,
  startTime: string,
): Promise<{ total: number; count: number }> {
  const day = new Date(paidAt);
  if (Number.isNaN(day.getTime())) return { total: 0, count: 0 };
  const startOfDay = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0,
  ).toISOString();
  const endOfDay = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + 1,
    0,
    0,
    0,
    0,
  ).toISOString();
  const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime;

  const { data } = await supabase
    .from("payments")
    .select("amount, start_time")
    .eq("client_id", clientId)
    .gte("paid_at", startOfDay)
    .lt("paid_at", endOfDay);

  const rows = (data ?? []).filter((r) => {
    if (!r.start_time) return false;
    const s = r.start_time.length === 5 ? `${r.start_time}:00` : r.start_time;
    return s === normalizedStart;
  });
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return { total, count: rows.length };
}

interface FamilyMember {
  id: string;
  firstName: string;
  fullName: string;
  balance: number;
  isResponsible: boolean;
}

/**
 * Lista o responsável + todos os dependentes com seus saldos individuais.
 * Ordem: responsável primeiro, depois dependentes em ordem alfabética.
 */
async function getFamilyBalances(
  responsibleId: string,
  responsibleFullName: string,
): Promise<FamilyMember[]> {
  const { data: deps } = await supabase
    .from("clients")
    .select("id, full_name")
    .ilike("financial_responsible", responsibleFullName);

  const seen = new Set<string>([responsibleId]);
  const members: { id: string; full_name: string; isResponsible: boolean }[] = [
    { id: responsibleId, full_name: responsibleFullName, isResponsible: true },
  ];
  for (const d of deps ?? []) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    members.push({ id: d.id, full_name: d.full_name, isResponsible: false });
  }

  const balances = await Promise.all(
    members.map(async (m) => {
      const { data } = await supabase.rpc("client_account_balance", { _client_id: m.id });
      return Number(data ?? 0);
    }),
  );

  const result: FamilyMember[] = members.map((m, i) => ({
    id: m.id,
    firstName: m.full_name.split(" ")[0],
    fullName: m.full_name,
    balance: balances[i],
    isResponsible: m.isResponsible,
  }));

  const resp = result.find((m) => m.isResponsible)!;
  const others = result
    .filter((m) => !m.isResponsible)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));
  return [resp, ...others];
}

function formatFamilyBlock(members: FamilyMember[], title: string): string {
  const total = members.reduce((s, m) => s + m.balance, 0);
  let header: string;
  if (total < 0) header = `*${title}: NEGATIVO EM ${fmtBRL(Math.abs(total))}*`;
  else if (total > 0) header = `*${title}: ${fmtBRL(total)} (positivo)*`;
  else header = `*${title}: zerado*`;

  const lines = members.map((m) => {
    const v =
      m.balance < 0
        ? `-${fmtBRL(Math.abs(m.balance))}`
        : m.balance > 0
          ? `+${fmtBRL(m.balance)}`
          : fmtBRL(0);
    return `  • ${m.firstName}: ${v}`;
  });
  return [header, ...lines].join("\n");
}

async function buildNotificationMessage(params: NotifyParams): Promise<
  | {
      url: string;
      firstName: string;
    }
  | { error: string }
> {
  const { clientId, amount, accountDirection, paidAt, startTime, categoryName } = params;

  const { data: client } = await supabase
    .from("clients")
    .select("full_name, phone, financial_responsible")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { error: "Cliente não encontrado." };

  // Se houver responsável financeiro, tenta localizar o telefone dele e enviar para ele.
  let recipientPhone = client.phone;
  let recipientFirstName = client.full_name.split(" ")[0];
  let dependentFirstName: string | null = null;
  let responsibleId: string | null = null;
  let responsibleFullName: string | null = null;

  if (client.financial_responsible && client.financial_responsible.trim()) {
    const respName = client.financial_responsible.trim();
    const { data: respRows } = await supabase
      .from("clients")
      .select("id, full_name, phone")
      .ilike("full_name", respName)
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      recipientPhone = resp.phone;
      recipientFirstName = resp.full_name.split(" ")[0];
      dependentFirstName = client.full_name.split(" ")[0];
      responsibleId = resp.id;
      responsibleFullName = resp.full_name;
    }
  }

  const phone = normalizePhoneForWhatsApp(recipientPhone);
  if (!phone) return { error: "Cliente sem telefone cadastrado." };

  // Se temos paidAt + startTime, combina lançamentos do mesmo slot.
  let displayAmount = amount;
  let combinedCount = 1;
  if (paidAt && startTime) {
    const { total, count } = await getCombinedAmountForSlot(clientId, paidAt, startTime);
    if (count > 1 && total > 0) {
      displayAmount = total;
      combinedCount = count;
    }
  }

  let saldoBlock: string;
  if (responsibleId && responsibleFullName) {
    const family = await getFamilyBalances(responsibleId, responsibleFullName);
    saldoBlock = formatFamilyBlock(
      family,
      `Saldo consolidado da conta (${family[0].firstName} + dependentes)`,
    );
  } else {
    const { data: balanceData } = await supabase.rpc("client_account_balance", {
      _client_id: clientId,
    });
    const balance = Number(balanceData ?? 0);
    saldoBlock =
      balance < 0
        ? `*Saldo NEGATIVO EM: ${fmtBRL(Math.abs(balance))}*`
        : balance > 0
          ? `*Saldo positivo: ${fmtBRL(balance)}*`
          : "*Saldo zerado*";
  }

  const catNorm = (categoryName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const isEstorno = catNorm === "estorno";

  const tipo = isEstorno
    ? "estorno"
    : accountDirection === "credito"
      ? "crédito"
      : accountDirection === "debito"
        ? "débito"
        : "lançamento";

  const contaRef = dependentFirstName ? `na conta de ${dependentFirstName}` : "na sua conta";

  // Formata data e hora do registro de pagamento
  let quandoLinha = "";
  if (paidAt) {
    const d = new Date(paidAt);
    if (!Number.isNaN(d.getTime())) {
      const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Recife" }).format(d);
      const horaSlot = startTime
        ? startTime.length >= 5
          ? startTime.slice(0, 5)
          : startTime
        : null;
      const hora =
        horaSlot ??
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Recife",
        }).format(d);
      quandoLinha = `*Data:* ${dia} às *${hora}*`;
    }
  }

  const linhaLancamento =
    combinedCount > 1
      ? `Realizamos ${combinedCount} ${tipo}s totalizando *${fmtBRL(displayAmount)}* ${contaRef} referentes à utilização da quadra.`
      : `Realizamos o ${tipo} de *${fmtBRL(displayAmount)}* ${contaRef} referente à utilização da quadra.`;

  const intro = dependentFirstName
    ? `Olá ${recipientFirstName}! Stadium Rackets.\n\n*Esta mensagem é referente ao seu dependente ${dependentFirstName}* (não à sua conta pessoal).`
    : `Olá ${recipientFirstName}! Stadium Rackets.`;

  const debtReminder = await buildOpenDebtReminder(clientId, dependentFirstName);

  const message =
    `${intro}\n\n` +
    `${linhaLancamento}\n` +
    (quandoLinha ? `${quandoLinha}\n` : "") +
    `\n${saldoBlock}\n\n` +
    (debtReminder ? `${debtReminder}\n\n` : "") +
    `Qualquer dúvida estamos à disposição. Obrigado!`;

  return { url: buildWhatsAppUrl(phone, message), firstName: recipientFirstName };
}

/**
 * Após registrar um pagamento, oferece um toast com botão "Enviar WhatsApp".
 */
export async function offerWhatsAppPaymentNotification(
  params: NotifyParams,
  onSent?: (clientId: string) => void,
) {
  const result = await buildNotificationMessage(params);
  if ("error" in result) {
    if (result.error === "Cliente sem telefone cadastrado.") {
      toast.info("Cliente sem telefone cadastrado — não é possível enviar WhatsApp.");
    }
    return;
  }
  const { url, firstName } = result;

  toast.success(`Avisar ${firstName} no WhatsApp?`, {
    id: `wa-${params.clientId}-${Date.now()}`,
    description: "Clique para enviar a mensagem com o saldo atualizado.",
    duration: 10000,
    action: {
      label: "Enviar WhatsApp",
      onClick: () => {
        openWhatsApp(url);
        void logWhatsAppSent(params.clientId, "payment");
        onSent?.(params.clientId);
      },
    },
  });
}

/**
 * Abre o WhatsApp com mensagem de cobrança de saldo em aberto (inadimplência).
 * Se o cliente tiver responsável financeiro com telefone, envia para ele.
 */
export async function sendOverdueBalanceReminder(clientId: string) {
  const { data: client } = await supabase
    .from("clients")
    .select("full_name, phone, financial_responsible")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    toast.error("Cliente não encontrado.");
    return;
  }

  let recipientPhone = client.phone;
  let recipientFirstName = client.full_name.split(" ")[0];
  let dependentFirstName: string | null = null;
  let responsibleId: string | null = null;
  let responsibleFullName: string | null = null;

  if (client.financial_responsible && client.financial_responsible.trim()) {
    const respName = client.financial_responsible.trim();
    const { data: respRows } = await supabase
      .from("clients")
      .select("id, full_name, phone")
      .ilike("full_name", respName)
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      recipientPhone = resp.phone;
      recipientFirstName = resp.full_name.split(" ")[0];
      dependentFirstName = client.full_name.split(" ")[0];
      responsibleId = resp.id;
      responsibleFullName = resp.full_name;
    }
  }

  const phone = normalizePhoneForWhatsApp(recipientPhone);
  if (!phone) {
    toast.info("Cliente sem telefone cadastrado — não é possível enviar WhatsApp.");
    return;
  }

  let message: string;
  if (responsibleId && responsibleFullName) {
    const family = await getFamilyBalances(responsibleId, responsibleFullName);
    const total = family.reduce((s, m) => s + m.balance, 0);
    if (total >= 0) {
      toast.info("A conta familiar não possui saldo em aberto.");
      return;
    }
    const block = formatFamilyBlock(
      family,
      `Saldo em aberto consolidado (${family[0].firstName} + dependentes)`,
    );
    const intro = `Olá ${recipientFirstName}! Stadium Rackets.\n\nSegue atualização da conta familiar:`;
    message = `${intro}\n\n` + `${block}\n\n` + `Qualquer dúvida estamos à disposição. Obrigado!`;
  } else {
    const { data: balanceData } = await supabase.rpc("client_account_balance", {
      _client_id: clientId,
    });
    const balance = Number(balanceData ?? 0);
    if (balance >= 0) {
      toast.info("Este cliente não possui saldo em aberto.");
      return;
    }
    const valorAberto = fmtBRL(Math.abs(balance));
    const intro = `Olá *${recipientFirstName}*! Stadium Rackets.`;
    const linhaSaldo = `Identificamos um *saldo em aberto* na sua conta no valor de *${valorAberto}*.`;
    message =
      `${intro}\n\n` + `${linhaSaldo}\n\n` + `Qualquer dúvida estamos à disposição. Obrigado!`;
  }

  openWhatsApp(buildWhatsAppUrl(phone, message));
  void logWhatsAppSent(clientId, "overdue");
}

/**
 * Alerta de limite de débito atingido (clientes mensalistas) — mensagem
 * literal fixa pelo pedido, nome/valor substituídos pelos dados reais do
 * cliente. Abre o WhatsApp já preenchido; o envio em si só acontece
 * quando o usuário clica em enviar dentro do próprio WhatsApp.
 */
export function sendDebtLimitAlertWhatsApp(params: {
  clientId: string;
  fullName: string;
  phone: string | null;
  debtAmount: number;
}) {
  const phone = normalizePhoneForWhatsApp(params.phone);
  if (!phone) {
    toast.info("Cliente sem telefone cadastrado — não é possível enviar WhatsApp.");
    return;
  }
  const message = `Olá, ${params.fullName}! Stadium Rackets.

Seu saldo devedor no Stadium Rackets é de ${fmtBRL(params.debtAmount)}.

Sua próxima locação está em risco. Para mantê-la e seu plano mensal ativos, é preciso quitar o débito e adicionar crédito para cobrir as locações restantes do mês — só zerar o saldo não é suficiente, pois os horários de mensalistas são pagos antecipadamente.

Sem regularização, as locações podem ser suspensas e o plano cancelado, com perda do horário.

Cancelamentos com 3h+ de antecedência mantêm o crédito para uso futuro.

Fale com a gente para regularizar!`;
  openWhatsApp(buildWhatsAppUrl(phone, message));
  void logWhatsAppSent(params.clientId, "debt_limit_alert");
}

interface FamilyMonthEndMember {
  clientId: string;
  fullName: string;
  phone: string | null;
  isResponsible: boolean;
  currentBalance: number;
  amountNeeded: number;
}

/**
 * Cliente + responsável financeiro/dependentes (se houver), cada um com
 * seu próprio saldo e locações restantes do mês — mesma resolução por
 * nome usada em getFamilyBalances.
 */
async function getFamilyMonthEndProjection(clientId: string): Promise<FamilyMonthEndMember[]> {
  const { data } = await supabase.rpc("client_family_month_end_projection", {
    _client_id: clientId,
  } as never);
  return ((data as never as
    | {
        client_id: string;
        full_name: string;
        phone: string | null;
        is_responsible: boolean;
        current_balance: number;
        amount_needed: number;
      }[]
    | null) ?? []
  ).map((r) => ({
    clientId: r.client_id,
    fullName: r.full_name,
    phone: r.phone,
    isResponsible: r.is_responsible,
    currentBalance: Number(r.current_balance),
    amountNeeded: Number(r.amount_needed),
  }));
}

/**
 * Aviso proativo pro cliente (qualquer um, não só quem já estourou o
 * limite de débito) de que o crédito atual não é suficiente pra cobrir
 * as locações do horário fixo que ainda faltam no mês — usado pelo
 * cálculo de projeção de fim de mês no cadastro do cliente. Quando o
 * cliente tem um responsável financeiro ou dependentes (cada um com sua
 * própria conta), informa quanto cada um precisa adicionar e o total.
 */
export async function sendMonthEndCreditWhatsApp(params: { clientId: string }) {
  const family = await getFamilyMonthEndProjection(params.clientId);
  if (family.length === 0) {
    toast.error("Cliente não encontrado.");
    return;
  }
  const responsible = family.find((m) => m.isResponsible) ?? family[0];
  const phone = normalizePhoneForWhatsApp(responsible.phone);
  if (!phone) {
    toast.info("Cliente sem telefone cadastrado — não é possível enviar WhatsApp.");
    return;
  }

  let body: string;
  if (family.length === 1) {
    const m = family[0];
    const balanceLabel =
      m.currentBalance < 0 ? `*${fmtBRL(m.currentBalance)} (negativo)*` : fmtBRL(m.currentBalance);
    body = `Seu saldo atual no Stadium Rackets é de ${balanceLabel}, mas suas locações do horário fixo que ainda faltam este mês não estão totalmente cobertas por esse crédito.

*Para terminar o mês sem ficar negativo, é necessário adicionar ${fmtBRL(m.amountNeeded)} de crédito.*`;
  } else {
    const totalNeeded = family.reduce((s, m) => s + m.amountNeeded, 0);
    const lines = family
      .filter((m) => m.amountNeeded > 0)
      .map((m) => `  • ${m.fullName.split(" ")[0]}: ${fmtBRL(m.amountNeeded)}`)
      .join("\n");
    body = `Vocês têm locações do horário fixo que ainda faltam este mês e não estão totalmente cobertas pelo crédito atual de cada um:

${lines}

*Para terminar o mês sem ficar negativo, é necessário adicionar ao todo ${fmtBRL(totalNeeded)} de crédito (o valor de cada um está acima).*`;
  }

  const message = `Olá, ${responsible.fullName}! Stadium Rackets.

${body}

Fale com a gente para regularizar!`;
  openWhatsApp(buildWhatsAppUrl(phone, message));
  void logWhatsAppSent(params.clientId, "month_end_credit_reminder");
}

/**
 * Envia diretamente — abre o WhatsApp Web/App com mensagem pronta.
 */
export async function sendWhatsAppPaymentNotification(params: NotifyParams) {
  const result = await buildNotificationMessage(params);
  if ("error" in result) {
    toast.error(result.error);
    return;
  }
  openWhatsApp(result.url);
  void logWhatsAppSent(params.clientId, "payment");
}

/**
 * Abre WhatsApp com mensagem solicitando confirmação de uma locação
 * (fixa ou avulsa). Envia para o responsável financeiro se houver.
 */
export async function sendBookingConfirmationRequest(params: {
  clientId: string;
  court: number;
  bookingDate: string; // YYYY-MM-DD
  startTime: string; // "HH:MM" ou "HH:MM:SS"
  endTime: string; // "HH:MM" ou "HH:MM:SS"
}) {
  const { clientId, court, bookingDate, startTime, endTime } = params;

  const { data: client } = await supabase
    .from("clients")
    .select("full_name, phone, financial_responsible")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    toast.error("Cliente não encontrado.");
    return;
  }

  let recipientPhone = client.phone;
  let recipientFirstName = client.full_name.split(" ")[0];
  let dependentFirstName: string | null = null;

  if (client.financial_responsible && client.financial_responsible.trim()) {
    const { data: respRows } = await supabase
      .from("clients")
      .select("full_name, phone")
      .ilike("full_name", client.financial_responsible.trim())
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      recipientPhone = resp.phone;
      recipientFirstName = resp.full_name.split(" ")[0];
      dependentFirstName = client.full_name.split(" ")[0];
    }
  }

  const phone = normalizePhoneForWhatsApp(recipientPhone);
  if (!phone) {
    toast.info("Cliente sem telefone cadastrado — não é possível enviar WhatsApp.");
    return;
  }

  const [y, m, d] = bookingDate.split("-").map(Number);
  const dateBR = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const weekdayName = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR", {
    weekday: "long",
  });
  const wd = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
  const s = startTime.length >= 5 ? startTime.slice(0, 5) : startTime;
  const e = endTime.length >= 5 ? endTime.slice(0, 5) : endTime;
  const quadra = courtLongLabel(court);

  const todayBR = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [todayDay, todayMonth, todayYear] = todayBR.split("/");
  const isToday = bookingDate === `${todayYear}-${todayMonth}-${todayDay}`;

  const intro = dependentFirstName
    ? `Olá ${recipientFirstName}! Stadium Rackets.\n\n*Esta mensagem é referente ao seu dependente ${dependentFirstName}.*`
    : `Olá ${recipientFirstName}! Stadium Rackets.`;

  const holiday = (await import("./holidays")).findHoliday(bookingDate);
  const motivo = holiday ? `\n\n- *MOTIVO: FERIADO — ${holiday.name.toUpperCase()}*` : "";

  const message =
    `${intro}\n\n` +
    `Poderia confirmar a locação abaixo, por favor?${motivo}\n\n` +
    (isToday ? `- *${wd}, ${dateBR} - HOJE*\n` : `- *${wd}, ${dateBR}*\n`) +
    `- *${s} às ${e}*\n` +
    `- *${quadra}*\n\n` +
    `Se não puder vir, avise com antecedência para liberarmos a quadra. Obrigado!`;

  openWhatsApp(buildWhatsAppUrl(phone, message));
  void logWhatsAppSent(clientId, "booking_confirmation");
}

/**
 * Oferece um toast para avisar o cliente sobre a reserva criada.
 * Não abre automaticamente — usuário decide clicar.
 */
export async function offerBookingReservedNotification(params: {
  clientId: string;
  court: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  isFixed?: boolean;
}) {
  if (!(await canSendClientWhatsApp())) return;
  const { data: client } = await supabase
    .from("clients")
    .select("full_name, phone, financial_responsible")
    .eq("id", params.clientId)
    .maybeSingle();
  if (!client) return;

  let phone = client.phone;
  let firstName = client.full_name.split(" ")[0];
  let dependentFirstName: string | null = null;

  if (client.financial_responsible && client.financial_responsible.trim()) {
    const { data: respRows } = await supabase
      .from("clients")
      .select("full_name, phone")
      .ilike("full_name", client.financial_responsible.trim())
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      phone = resp.phone;
      firstName = resp.full_name.split(" ")[0];
      dependentFirstName = client.full_name.split(" ")[0];
    }
  }

  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return;

  const [y, m, d] = params.bookingDate.split("-").map(Number);
  const dateBR = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const weekday = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR", {
    weekday: "long",
  });
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const s = params.startTime.slice(0, 5);
  const e = params.endTime.slice(0, 5);
  const quadra = courtLongLabel(params.court);

  const intro = dependentFirstName
    ? `Olá ${firstName}! Stadium Rackets.\n\n*Referente ao seu dependente ${dependentFirstName}.*`
    : `Olá ${firstName}! Stadium Rackets.`;

  const label = params.isFixed ? "seu horário fixo" : "sua reserva";
  const debtReminder = await buildOpenDebtReminder(params.clientId, dependentFirstName);
  const message =
    `${intro}\n\n` +
    `Confirmamos ${label}:\n\n` +
    `- *${wd}, ${dateBR}*\n` +
    `- *${s} às ${e}*\n` +
    `- *${quadra}*\n\n` +
    (debtReminder ? `${debtReminder}\n\n` : "") +
    `Qualquer coisa, é só nos avisar.`;

  toast.success(`Avisar ${firstName} no WhatsApp?`, {
    id: `wa-booking-${params.clientId}-${Date.now()}`,
    description: "Reserva criada. Envie a confirmação ao cliente.",
    duration: 10000,
    action: {
      label: "Enviar WhatsApp",
      onClick: () => {
        openWhatsApp(buildWhatsAppUrl(normalized, message));
        void logWhatsAppSent(params.clientId, "booking_created");
      },
    },
  });
}

/**
 * Oferece um toast para avisar o cliente sobre a MUDANÇA DE QUADRA de uma reserva.
 * Não abre automaticamente — usuário decide clicar.
 * Se fromCourt === toCourt, não faz nada.
 */
export async function offerBookingCourtChangeNotification(params: {
  clientId: string;
  fromCourt: number;
  toCourt: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  isFixed?: boolean;
}) {
  if (params.fromCourt === params.toCourt) return;
  if (!(await canSendClientWhatsApp())) return;

  const { data: client } = await supabase
    .from("clients")
    .select("full_name, phone, financial_responsible")
    .eq("id", params.clientId)
    .maybeSingle();
  if (!client) return;

  let phone = client.phone;
  let firstName = client.full_name.split(" ")[0];
  let dependentFirstName: string | null = null;

  if (client.financial_responsible && client.financial_responsible.trim()) {
    const { data: respRows } = await supabase
      .from("clients")
      .select("full_name, phone")
      .ilike("full_name", client.financial_responsible.trim())
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      phone = resp.phone;
      firstName = resp.full_name.split(" ")[0];
      dependentFirstName = client.full_name.split(" ")[0];
    }
  }

  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return;

  const [y, m, d] = params.bookingDate.split("-").map(Number);
  const dateBR = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const weekday = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR", {
    weekday: "long",
  });
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const s = params.startTime.slice(0, 5);
  const e = params.endTime.slice(0, 5);

  const todayBR = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [tD, tM, tY] = todayBR.split("/");
  const isToday = params.bookingDate === `${tY}-${tM}-${tD}`;

  const quadraLabel = (n: number) => courtLongLabel(n);

  const intro = dependentFirstName
    ? `Olá ${firstName}! Stadium Rackets.\n\n*Referente ao seu dependente ${dependentFirstName}.*`
    : `Olá ${firstName}! Stadium Rackets.`;

  const message =
    `${intro}\n\n` +
    `Precisamos avisar que houve uma *mudança de quadra* na ${params.isFixed ? "sua aula fixa" : "sua reserva"}:\n\n` +
    (isToday ? `- *${wd}, ${dateBR} - HOJE*\n` : `- *${wd}, ${dateBR}*\n`) +
    `- *${s} às ${e}*\n` +
    `- De *${quadraLabel(params.fromCourt)}* → *${quadraLabel(params.toCourt)}*\n\n` +
    `O horário permanece o mesmo. Qualquer dúvida, é só nos avisar.`;

  toast.success(`Avisar ${firstName} sobre mudança de quadra?`, {
    id: `wa-move-${params.clientId}-${Date.now()}`,
    description: `${courtShort(params.fromCourt)} → ${courtShort(params.toCourt)} · ${s}–${e}`,
    duration: 12000,
    action: {
      label: "Enviar WhatsApp",
      onClick: () => {
        openWhatsApp(buildWhatsAppUrl(normalized, message));
        void logWhatsAppSent(params.clientId, "booking_court_change");
      },
    },
  });
}

/**
 * Oferece um toast para avisar o cliente sobre o CANCELAMENTO de uma locação.
 * Não abre automaticamente — usuário decide clicar.
 */
export async function offerBookingCancelledNotification(params: {
  clientId: string;
  court: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  isFixed?: boolean;
  reason?: string | null;
}) {
  if (!(await canSendClientWhatsApp())) return;
  const { data: client } = await supabase
    .from("clients")
    .select("full_name, phone, financial_responsible")
    .eq("id", params.clientId)
    .maybeSingle();
  if (!client) return;

  let phone = client.phone;
  let firstName = client.full_name.split(" ")[0];
  let dependentFirstName: string | null = null;

  if (client.financial_responsible && client.financial_responsible.trim()) {
    const { data: respRows } = await supabase
      .from("clients")
      .select("full_name, phone")
      .ilike("full_name", client.financial_responsible.trim())
      .limit(1);
    const resp = respRows?.[0];
    if (resp && normalizePhoneForWhatsApp(resp.phone)) {
      phone = resp.phone;
      firstName = resp.full_name.split(" ")[0];
      dependentFirstName = client.full_name.split(" ")[0];
    }
  }

  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return;

  const [y, m, d] = params.bookingDate.split("-").map(Number);
  const dateBR = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const weekday = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR", {
    weekday: "long",
  });
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const s = params.startTime.slice(0, 5);
  const e = params.endTime.slice(0, 5);
  const quadra = courtLongLabel(params.court);

  const todayBR = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [tD, tM, tY] = todayBR.split("/");
  const isToday = params.bookingDate === `${tY}-${tM}-${tD}`;

  const intro = dependentFirstName
    ? `Olá ${firstName}! Stadium Rackets.\n\n*Referente ao seu dependente ${dependentFirstName}.*`
    : `Olá ${firstName}! Stadium Rackets.`;

  const label = params.isFixed ? "sua aula fixa" : "sua reserva";
  const reasonLine =
    params.reason && params.reason.trim() ? `\n- Motivo: ${params.reason.trim()}\n` : "";

  const message =
    `${intro}\n\n` +
    `Informamos que *${label}* foi *cancelada*:\n\n` +
    (isToday ? `- *${wd}, ${dateBR} - HOJE*\n` : `- *${wd}, ${dateBR}*\n`) +
    `- *${s} às ${e}*\n` +
    `- *${quadra}*\n` +
    reasonLine +
    `\nQualquer dúvida ou para remarcar, é só nos avisar.`;

  toast.success(`Avisar ${firstName} sobre cancelamento?`, {
    id: `wa-cancel-${params.clientId}-${Date.now()}`,
    description: `${quadra} · ${s}–${e}`,
    duration: 12000,
    action: {
      label: "Enviar WhatsApp",
      onClick: () => {
        openWhatsApp(buildWhatsAppUrl(normalized, message));
        void logWhatsAppSent(params.clientId, "booking_cancelled");
      },
    },
  });
}

/**
 * Abre WhatsApp com mensagem para o professor pedindo confirmação das aulas
 * numa data específica. Se a data cair num feriado oficial (nacional/PE/Recife),
 * o motivo é incluído automaticamente.
 */
export async function sendTeacherHolidayConfirmationRequest(params: {
  teacherName: string;
  phone: string | null | undefined;
  date: string; // YYYY-MM-DD
}) {
  const phone = normalizePhoneForWhatsApp(params.phone);
  if (!phone) {
    toast.info("Professor sem telefone cadastrado — edite o cadastro para incluir o WhatsApp.");
    return;
  }
  const [y, m, d] = params.date.split("-").map(Number);
  const dateBR = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const weekdayName = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR", {
    weekday: "long",
  });
  const wd = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
  const firstName = params.teacherName.split(" ")[0];
  const holiday = (await import("./holidays")).findHoliday(params.date);
  const motivo = holiday ? `\n\n- *MOTIVO: FERIADO — ${holiday.name.toUpperCase()}*` : "";
  const message =
    `Olá Prof. ${firstName}! Stadium Rackets.\n\n` +
    `Poderia confirmar se dará suas aulas no dia abaixo, por favor?${motivo}\n\n` +
    `- *${wd}, ${dateBR}*\n\n` +
    `Se não for dar aulas, avise-nos com antecedência para reorganizarmos a agenda dos alunos. Obrigado!`;
  openWhatsApp(buildWhatsAppUrl(phone, message));
}

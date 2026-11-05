// Cálculos da área "Inteligência" (somente diretoria). Tudo aqui é puro:
// recebe as linhas já carregadas do banco e devolve agregados prontos para
// os gráficos e as "leituras" em texto. A página /inteligencia só carrega
// os dados e desenha.
//
// Convenções (as mesmas de Relatórios):
// - Receita = pagamento com received=true, fora das categorias que não são
//   receita (Saldo Anterior, Terno de bola, Grip), valor = amount − repasse.
// - Datas em Recife (UTC-3 fixo): paid_at é convertido para o dia local.
// - Locação fixa (client_schedules) não vira linha em court_bookings: ela é
//   "expandida" aqui, dia a dia, respeitando validade, exceções e presença.

import { calcPrice, type PriceBand } from "@/lib/pricing";
import { getOperatingHours } from "@/lib/operating-hours";
import {
  isEmployeeCategoryName,
  isNonRevenueCategory,
  isSaldoAnterior,
  normalizeCategoryName,
} from "@/lib/category";
import { findHoliday } from "@/lib/holidays";
import { COURTS, courtShort } from "@/lib/court-map";

// ---------------------------------------------------------------- tipos ---

export interface IntelCategory {
  id: string;
  name: string;
}

export interface IntelClient {
  id: string;
  full_name: string;
  phone: string | null;
  category_id: string | null;
  active: boolean;
  created_at: string;
  teacher_id: string | null;
}

export interface IntelPayment {
  id: string;
  client_id: string | null;
  category_id: string | null;
  amount: number;
  passthrough_amount: number | null;
  paid_at: string;
  received: boolean;
}

export interface IntelBooking {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  court: number | null;
  client_id: string | null;
  category_id: string | null;
  source: string;
  teacher_id: string | null;
  cancelled_at: string | null;
}

export interface IntelParticipant {
  booking_id: string;
  client_id: string;
}

export interface IntelSchedule {
  id: string;
  client_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
  valid_from: string | null;
  valid_until: string | null;
  teacher_id: string | null;
  created_at: string;
}

export interface IntelException {
  client_schedule_id: string;
  exception_date: string;
  range_end: string | null;
  start_time: string | null;
  end_time: string | null;
  reason?: string | null;
}

export interface IntelAttendance {
  client_schedule_id: string;
  attendance_date: string;
  status: string;
}

export interface IntelWaitlist {
  desired_date: string;
  start_time: string;
  status: string;
  created_at: string;
}

export interface IntelFixedWaitlist {
  desired_weekday: number;
  start_time: string;
  status: string;
  created_at: string;
}

export interface IntelFailure {
  created_at: string;
  booking_date: string | null;
  start_hour: number | null;
  stage: string;
}

export interface IntelTeacher {
  id: string;
  name: string;
}

export interface IntelData {
  categories: IntelCategory[];
  clients: IntelClient[];
  payments: IntelPayment[];
  bookings: IntelBooking[];
  participants: IntelParticipant[];
  schedules: IntelSchedule[];
  exceptions: IntelException[];
  attendance: IntelAttendance[];
  priceBands: PriceBand[];
  waitlist: IntelWaitlist[];
  fixedWaitlist: IntelFixedWaitlist[];
  failures: IntelFailure[];
  teachers: IntelTeacher[];
  maintenanceClientIds: Set<string>;
  today: string; // YYYY-MM-DD (Recife)
}

/** Uso de quadra já normalizado (avulsa, aula ou ocorrência de fixo). */
export interface Session {
  date: string;
  weekday: number;
  startMin: number;
  endMin: number;
  court: number | null;
  clientIds: string[];
  categoryId: string | null;
  kind: "reserva" | "fixo";
  teacherId: string | null;
}

// ------------------------------------------------------------- helpers ---

/**
 * Início do uso do sistema na Stadium Rackets: nada antes disso entra nas
 * análises, mesmo que exista lançamento com data anterior (ex.: importação).
 */
export const INTEL_START = "2026-11-01";

export const COURT_COUNT = COURTS.length;
export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export const toMin = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const minToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** paid_at (timestamptz) → dia em Recife (UTC-3 fixo). */
export const recifeDay = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

export const ymOf = (ymd: string) => ymd.slice(0, 7);

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]}/${String(y).slice(2)}`;
};

export const addMonthsYm = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export const monthsBetween = (fromYm: string, toYm: string): string[] => {
  const out: string[] = [];
  let cur = fromYm;
  while (cur <= toYm && out.length < 240) {
    out.push(cur);
    cur = addMonthsYm(cur, 1);
  }
  return out;
};

export const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000,
  );

export const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

export const lastDayOfMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export const pct = (n: number, d = 0) => `${round(n * 100, d).toLocaleString("pt-BR")}%`;

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Agrupa categorias em famílias que fazem sentido para a diretoria. */
export const categoryGroup = (name: string | null | undefined): string => {
  const n = normalizeCategoryName(name);
  if (!n) return "Sem categoria";
  if (n === "mensalista" || n === "debito avulso") return "Mensalista";
  if (n.startsWith("ranking")) return "Ranking";
  if (n.includes("avuls")) return "Avulso";
  if (n.includes("aluno") || n.includes("aula") || n.includes("professor"))
    return "Aulas";
  return name ?? "Outras";
};

export class IntelContext {
  catName = new Map<string, string>();
  clientById = new Map<string, IntelClient>();
  avulsoCategoryId: string | null = null;

  data: IntelData;

  constructor(raw: IntelData) {
    // Nada anterior ao início real de uso do sistema entra em análise
    // nenhuma (há lançamentos soltos com datas antigas, ex.: dez/2024).
    const data: IntelData = {
      ...raw,
      payments: raw.payments.filter((p) => recifeDay(p.paid_at) >= INTEL_START),
      bookings: raw.bookings.filter((b) => b.booking_date >= INTEL_START),
      waitlist: raw.waitlist.filter((w) => w.desired_date >= INTEL_START),
      failures: raw.failures.filter((f) => !f.booking_date || f.booking_date >= INTEL_START),
      attendance: raw.attendance.filter((a) => a.attendance_date >= INTEL_START),
    };
    this.data = data;
    data.categories.forEach((c) => this.catName.set(c.id, c.name));
    data.clients.forEach((c) => this.clientById.set(c.id, c));
    this.avulsoCategoryId =
      data.categories.find((c) => normalizeCategoryName(c.name) === "avulso")?.id ?? null;
  }

  paymentCategory(p: IntelPayment): string {
    if (p.category_id && this.catName.has(p.category_id)) return this.catName.get(p.category_id)!;
    const c = p.client_id ? this.clientById.get(p.client_id) : null;
    if (c?.category_id && this.catName.has(c.category_id)) return this.catName.get(c.category_id)!;
    return "";
  }

  clientCategory(clientId: string | null): string {
    const c = clientId ? this.clientById.get(clientId) : null;
    return (c?.category_id && this.catName.get(c.category_id)) || "";
  }

  isRevenue(p: IntelPayment): boolean {
    if (!p.received) return false;
    const cat = this.paymentCategory(p);
    return !isNonRevenueCategory(cat) && !isSaldoAnterior(cat);
  }

  net(p: IntelPayment) {
    return Number(p.amount) - Number(p.passthrough_amount ?? 0);
  }

  /** Preço de tabela do Avulso para um uso de quadra (valor por quadra). */
  tablePrice(s: {
    date: string;
    weekday: number;
    startMin: number;
    endMin: number;
    court: number | null;
  }) {
    const calc = calcPrice({
      bands: this.data.priceBands,
      weekday: s.weekday,
      startTime: minToTime(s.startMin),
      endTime: minToTime(s.endMin),
      categoryId: this.avulsoCategoryId,
      court: s.court ?? 1,
      date: s.date,
    });
    return calc && calc.matched ? calc.total : 0;
  }
}

/**
 * Início das análises = 1º dia do mês do primeiro faturamento real a partir
 * de INTEL_START (pagamento recebido, fora de Saldo Anterior/Terno de
 * bola/Grip). Reservas e lançamentos soltos com data antiga não contam.
 */
export function systemStart(data: IntelData): string {
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const clientCat = new Map(data.clients.map((c) => [c.id, c.category_id]));
  let first = data.today;
  for (const p of data.payments) {
    if (recifeDay(p.paid_at) < INTEL_START) continue;
    if (!p.received || Number(p.amount) - Number(p.passthrough_amount ?? 0) <= 0) continue;
    const catId = p.category_id ?? (p.client_id ? clientCat.get(p.client_id) : null) ?? null;
    if (isNonRevenueCategory(catId ? catName.get(catId) : "")) continue;
    const d = recifeDay(p.paid_at);
    if (d < first) first = d;
  }
  return `${first.slice(0, 7)}-01`;
}

// ------------------------------------------------------------ sessões ---

/**
 * Todos os usos de quadra entre from e to (inclusive): reservas não
 * canceladas + ocorrências das locações fixas (respeitando validade,
 * exceções e presença "cancelou"). Bloqueios de manutenção ficam de fora.
 */
export function buildSessions(ctx: IntelContext, from: string, to: string): Session[] {
  const { data } = ctx;
  const out: Session[] = [];
  const partsByBooking = new Map<string, string[]>();
  for (const p of data.participants) {
    const arr = partsByBooking.get(p.booking_id) ?? [];
    arr.push(p.client_id);
    partsByBooking.set(p.booking_id, arr);
  }
  const start = systemStart(data);

  for (const b of data.bookings) {
    if (b.cancelled_at) continue;
    if (b.booking_date < from || b.booking_date > to) continue;
    if (b.client_id && data.maintenanceClientIds.has(b.client_id)) continue;
    const s = toMin(b.start_time);
    const e = toMin(b.end_time);
    if (s == null || e == null || e <= s) continue;
    const ids = new Set<string>();
    if (b.client_id) ids.add(b.client_id);
    (partsByBooking.get(b.id) ?? []).forEach((id) => ids.add(id));
    out.push({
      date: b.booking_date,
      weekday: weekdayOf(b.booking_date),
      startMin: s,
      endMin: e,
      court: b.court,
      clientIds: [...ids],
      categoryId: b.category_id ?? ctx.clientById.get(b.client_id ?? "")?.category_id ?? null,
      kind: "reserva",
      teacherId: b.teacher_id,
    });
  }

  const excBySched = new Map<string, IntelException[]>();
  for (const e of data.exceptions) {
    const arr = excBySched.get(e.client_schedule_id) ?? [];
    arr.push(e);
    excBySched.set(e.client_schedule_id, arr);
  }
  const cancelledAtt = new Set<string>();
  for (const a of data.attendance) {
    if (a.status.startsWith("cancelled"))
      cancelledAtt.add(`${a.client_schedule_id}|${a.attendance_date}`);
  }
  const lastDay = to < data.today ? to : data.today;

  for (const sc of data.schedules) {
    if (data.maintenanceClientIds.has(sc.client_id)) continue;
    const s0 = toMin(sc.start_time);
    const e0 = toMin(sc.end_time);
    if (s0 == null || e0 == null || e0 <= s0) continue;
    let first = from;
    if (sc.valid_from && sc.valid_from > first) first = sc.valid_from;
    const created = recifeDay(sc.created_at);
    // Fixos criados no início do sistema já existiam antes: não corta.
    if (created > start && created > first) first = created;
    let last = lastDay;
    if (sc.valid_until && sc.valid_until < last) last = sc.valid_until;
    if (first > last) continue;
    // avança até o primeiro dia da semana certo
    let d = first;
    const diff = (sc.weekday - weekdayOf(d) + 7) % 7;
    d = addDays(d, diff);
    const excs = excBySched.get(sc.id) ?? [];
    for (; d <= last; d = addDays(d, 7)) {
      if (cancelledAtt.has(`${sc.id}|${d}`)) continue;
      let s = s0;
      let e = e0;
      let skip = false;
      for (const ex of excs) {
        const exEnd = ex.range_end ?? ex.exception_date;
        if (d < ex.exception_date || d > exEnd) continue;
        const xs = toMin(ex.start_time);
        const xe = toMin(ex.end_time);
        if (xs == null || xe == null) {
          skip = true;
          break;
        }
        // Exceção parcial: corta o pedaço coberto, fica com o maior resto.
        const left = Math.max(0, Math.min(e, xs) - s);
        const right = Math.max(0, e - Math.max(s, xe));
        if (xe <= s || xs >= e) continue;
        if (left >= right) e = s + left;
        else s = e - right;
        if (e <= s) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      out.push({
        date: d,
        weekday: sc.weekday,
        startMin: s,
        endMin: e,
        court: sc.court,
        clientIds: [sc.client_id],
        categoryId: ctx.clientById.get(sc.client_id)?.category_id ?? null,
        kind: "fixo",
        teacherId: sc.teacher_id,
      });
    }
  }
  return out;
}

// ----------------------------------------------------------- evolução ---

export interface MonthRow {
  ym: string;
  label: string;
  caixa: number;
  competencia: number;
  clientes: number;
  ticket: number;
  partial: boolean;
  byGroup: Record<string, number>;
}

export interface EvolutionResult {
  months: MonthRow[];
  groups: string[];
  byYear: Array<Record<string, number | string | null>>;
  years: string[];
  seasonality: Array<{ label: string; index: number }> | null;
  completeMonths: number;
  mtd: { current: number; previous: number; day: number } | null;
  insights: string[];
}

export function computeEvolution(ctx: IntelContext): EvolutionResult {
  const { data } = ctx;
  const startYm = ymOf(systemStart(data));
  const curYm = ymOf(data.today);
  const months = monthsBetween(startYm, curYm);
  const rows = new Map<string, MonthRow>();
  const clientsByMonth = new Map<string, Set<string>>();
  months.forEach((ym) =>
    rows.set(ym, {
      ym,
      label: monthLabel(ym),
      caixa: 0,
      competencia: 0,
      clientes: 0,
      ticket: 0,
      partial: ym === curYm,
      byGroup: {},
    }),
  );
  const groupTotals = new Map<string, number>();

  for (const p of data.payments) {
    if (!ctx.isRevenue(p)) continue;
    const day = recifeDay(p.paid_at);
    const ym = ymOf(day);
    const row = rows.get(ym);
    const v = ctx.net(p);
    if (row) {
      row.caixa += v;
      const g = categoryGroup(ctx.paymentCategory(p));
      row.byGroup[g] = (row.byGroup[g] ?? 0) + v;
      groupTotals.set(g, (groupTotals.get(g) ?? 0) + v);
    }
    // Competência: hoje cada pagamento cai no próprio mês (não há
    // mensalidade paga para vários meses de uma vez).
    const n = 1;
    for (let i = 0; i < n; i++) {
      const m = addMonthsYm(ym, i);
      const r = rows.get(m);
      if (!r) continue;
      r.competencia += v / n;
      if (p.client_id) {
        const set = clientsByMonth.get(m) ?? new Set<string>();
        set.add(p.client_id);
        clientsByMonth.set(m, set);
      }
    }
  }
  rows.forEach((r) => {
    r.clientes = clientsByMonth.get(r.ym)?.size ?? 0;
    r.ticket = r.clientes ? r.competencia / r.clientes : 0;
  });

  const groupsSorted = [...groupTotals.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const groups = groupsSorted.slice(0, 6);
  if (groupsSorted.length > 6) {
    rows.forEach((r) => {
      let other = 0;
      for (const [g, v] of Object.entries(r.byGroup)) {
        if (!groups.includes(g)) {
          other += v;
          delete r.byGroup[g];
        }
      }
      if (other) r.byGroup["Outras"] = other;
    });
    groups.push("Outras");
  }

  // Meses sem nenhum faturamento (antes de a equipe usar o sistema, ou um
  // lançamento solto com data antiga) não entram em nada: nem na curva, nem
  // em médias, nem na sazonalidade.
  const monthRows = [...rows.values()].filter((r) => r.partial || r.caixa > 0 || r.competencia > 0);
  // Curvas sobrepostas por ano (competência).
  const years = [...new Set(monthRows.map((r) => r.ym.slice(0, 4)))];
  const byYear = MONTH_SHORT.map((m, i) => {
    const o: Record<string, number | string | null> = { mes: m };
    years.forEach((y) => {
      const r = rows.get(`${y}-${pad(i + 1)}`);
      o[y] = r && !r.partial && monthRows.includes(r) ? round(r.competencia) : null;
    });
    return o;
  });

  // O primeiro mês do sistema costuma estar incompleto (começou no meio).
  const firstDay = systemStart(data);
  const firstYm = ymOf(firstDay);
  const complete = monthRows.filter(
    (r) => !r.partial && !(r.ym === firstYm && !firstDay.endsWith("-01")),
  );
  let seasonality: EvolutionResult["seasonality"] = null;
  if (complete.length >= 12) {
    const last12 = complete.slice(-12);
    const avg = last12.reduce((s, r) => s + r.competencia, 0) / 12;
    seasonality = last12.map((r) => ({ label: r.label, index: avg ? r.competencia / avg : 0 }));
  }

  // Mês atual até hoje × mês anterior até o mesmo dia.
  let mtd: EvolutionResult["mtd"] = null;
  const day = Number(data.today.slice(8, 10));
  const prevYm = addMonthsYm(curYm, -1);
  if (rows.has(prevYm)) {
    let current = 0;
    let previous = 0;
    for (const p of data.payments) {
      if (!ctx.isRevenue(p)) continue;
      const d = recifeDay(p.paid_at);
      const dd = Number(d.slice(8, 10));
      if (dd > day) continue;
      if (ymOf(d) === curYm) current += ctx.net(p);
      else if (ymOf(d) === prevYm) previous += ctx.net(p);
    }
    mtd = { current, previous, day };
  }

  const insights: string[] = [];
  if (complete.length >= 2) {
    const best = [...complete].sort((a, b) => b.competencia - a.competencia)[0];
    const worst = [...complete].sort((a, b) => a.competencia - b.competencia)[0];
    insights.push(
      `Melhor mês completo até agora: ${best.label} (${brl(best.competencia)} em competência). Pior: ${worst.label} (${brl(worst.competencia)}) — diferença de ${pct(best.competencia / Math.max(1, worst.competencia) - 1)}.`,
    );
    const a = complete[complete.length - 2];
    const b = complete[complete.length - 1];
    if (a.clientes && b.clientes) {
      const dClients = b.clientes / a.clientes - 1;
      const dTicket = b.ticket / Math.max(1, a.ticket) - 1;
      insights.push(
        `De ${a.label} para ${b.label}: clientes pagantes ${dClients >= 0 ? "+" : ""}${pct(dClients)} e ticket médio por cliente ${dTicket >= 0 ? "+" : ""}${pct(dTicket)}. ${
          Math.abs(dClients) > Math.abs(dTicket)
            ? "A variação veio mais da quantidade de clientes do que do valor pago por cada um."
            : "A variação veio mais do valor pago por cliente do que da quantidade de clientes."
        }`,
      );
    }
    const gap = monthRows.reduce((s, r) => s + Math.abs(r.caixa - r.competencia), 0);
    if (gap > 0.05 * monthRows.reduce((s, r) => s + r.caixa, 0)) {
      insights.push(
        "Caixa e competência divergem bastante. Para avaliar desempenho, olhe a competência; para planejar contas a pagar, o caixa.",
      );
    }
  }
  if (!seasonality) {
    insights.push(
      `Sazonalidade confiável exige ao menos 12 meses completos — hoje o sistema tem ${complete.length}. O índice aparece aqui automaticamente quando completar 12, e a comparação ano contra ano a partir do 13º.`,
    );
  } else {
    const low = [...seasonality].sort((a, b) => a.index - b.index).slice(0, 3);
    insights.push(
      `Meses mais fracos dos últimos 12: ${low.map((l) => `${l.label} (${pct(l.index)} da média)`).join(", ")}. É aí que a reserva de caixa e as campanhas precisam estar prontas.`,
    );
  }
  if (mtd && mtd.previous > 0) {
    const d = mtd.current / mtd.previous - 1;
    insights.push(
      `Até o dia ${mtd.day} deste mês entraram ${brl(mtd.current)}, ${d >= 0 ? "+" : ""}${pct(d)} em relação ao mesmo ponto do mês passado (${brl(mtd.previous)}).`,
    );
  }

  return {
    months: monthRows,
    groups,
    byYear,
    years,
    seasonality,
    completeMonths: complete.length,
    mtd,
    insights,
  };
}

// ---------------------------------------------------------- ocupação ---

export interface SlotCell {
  weekday: number;
  hour: number;
  capacity: number; // horas-quadra disponíveis
  occupied: number; // horas-quadra usadas
  rate: number;
  idleValue: number; // valor de tabela das horas ociosas
  byGroup: Record<string, number>;
}

export interface OccupancyResult {
  cells: SlotCell[];
  hours: number[];
  byCourt: Array<{ court: string; rate: number; occupied: number }>;
  byGroup: Array<{ group: string; hours: number }>;
  totalRate: number;
  idleValue: number;
  primeKeys: Set<string>; // "weekday|hour" com ocupação >= limiar
  primeThreshold: number;
  insights: string[];
}

export const slotKey = (weekday: number, hour: number) => `${weekday}|${hour}`;

export function computeOccupancy(
  ctx: IntelContext,
  sessions: Session[],
  from: string,
  to: string,
  primeThreshold = 0.75,
): OccupancyResult {
  const lastDay = to < ctx.data.today ? to : ctx.data.today;
  const cells = new Map<string, SlotCell>();
  const cell = (wd: number, h: number) => {
    const k = slotKey(wd, h);
    let c = cells.get(k);
    if (!c) {
      c = { weekday: wd, hour: h, capacity: 0, occupied: 0, rate: 0, idleValue: 0, byGroup: {} };
      cells.set(k, c);
    }
    return c;
  };
  // Capacidade = quadras × horas de funcionamento de cada dia do período.
  const courtCap = new Map<number, number>();
  // Preço de tabela por faixa (dia da semana × hora). Promoções não entram
  // (calcPrice ignora sem includePromo), então a data não muda o valor.
  const priceBySlot = new Map<string, number>();
  const slotPrice = (date: string, wd: number, h: number) => {
    const k = slotKey(wd, h);
    if (!priceBySlot.has(k)) {
      priceBySlot.set(
        k,
        ctx.tablePrice({ date, weekday: wd, startMin: h * 60, endMin: h * 60 + 60, court: 1 }),
      );
    }
    return priceBySlot.get(k)!;
  };
  const occByDayCourtHour = new Map<string, number>();
  for (const s of sessions) {
    if (s.date < from || s.date > lastDay) continue;
    for (let h = Math.floor(s.startMin / 60); h * 60 < s.endMin; h++) {
      const ov = Math.min(s.endMin, h * 60 + 60) - Math.max(s.startMin, h * 60);
      if (ov <= 0) continue;
      const k = `${s.date}|${s.court ?? `x${s.clientIds[0] ?? ""}`}|${h}`;
      occByDayCourtHour.set(k, Math.min(1, (occByDayCourtHour.get(k) ?? 0) + ov / 60));
      const g = categoryGroup(
        s.categoryId ? ctx.catName.get(s.categoryId) : s.teacherId ? "Aulas" : "",
      );
      const c = cell(s.weekday, h);
      c.byGroup[g] = (c.byGroup[g] ?? 0) + ov / 60;
    }
  }
  const occAgg = new Map<string, number>();
  const courtOcc = new Map<number, number>();
  occByDayCourtHour.forEach((v, k) => {
    const [date, court, h] = k.split("|");
    const key = slotKey(weekdayOf(date), Number(h));
    occAgg.set(key, (occAgg.get(key) ?? 0) + v);
    if (!court.startsWith("x")) courtOcc.set(Number(court), (courtOcc.get(Number(court)) ?? 0) + v);
  });

  for (let d = from; d <= lastDay; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    const { start, end } = getOperatingHours(d);
    for (let h = start; h < end; h++) {
      const c = cell(wd, h);
      c.capacity += COURT_COUNT;
      slotPrice(d, wd, h);
      for (let q = 1; q <= COURT_COUNT; q++) courtCap.set(q, (courtCap.get(q) ?? 0) + 1);
    }
  }
  let cap = 0;
  let occ = 0;
  let idle = 0;
  cells.forEach((c, k) => {
    c.occupied = Math.min(c.capacity || Infinity, occAgg.get(k) ?? 0);
    c.rate = c.capacity ? c.occupied / c.capacity : 0;
    const price = priceBySlot.get(k) ?? 0;
    c.idleValue = Math.max(0, c.capacity - c.occupied) * price;
    cap += c.capacity;
    occ += c.capacity ? c.occupied : 0;
    idle += c.idleValue;
  });

  const all = [...cells.values()].filter((c) => c.capacity > 0);
  const hours = [...new Set(all.map((c) => c.hour))].sort((a, b) => a - b);
  const primeKeys = new Set(
    all.filter((c) => c.rate >= primeThreshold).map((c) => slotKey(c.weekday, c.hour)),
  );

  const groupHours = new Map<string, number>();
  all.forEach((c) =>
    Object.entries(c.byGroup).forEach(([g, v]) => groupHours.set(g, (groupHours.get(g) ?? 0) + v)),
  );

  const byCourt = [...courtCap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([q, capQ]) => ({
      court: `${courtShort(q)}`,
      occupied: courtOcc.get(q) ?? 0,
      rate: capQ ? (courtOcc.get(q) ?? 0) / capQ : 0,
    }));

  const insights: string[] = [];
  const totalRate = cap ? occ / cap : 0;
  if (all.length) {
    insights.push(
      `Ocupação geral no período: ${pct(totalRate)} das horas-quadra de funcionamento (${round(occ).toLocaleString("pt-BR")} de ${round(cap).toLocaleString("pt-BR")}).`,
    );
    const top = [...all].sort((a, b) => b.rate - a.rate).slice(0, 3);
    insights.push(
      `Horários mais disputados: ${top.map((c) => `${WEEKDAY_SHORT[c.weekday]} ${c.hour}h (${pct(c.rate)})`).join(", ")}. ${primeKeys.size} faixas passam de ${pct(primeThreshold)} — consideradas "horário nobre" nas outras análises.`,
    );
    const bottom = [...all]
      .filter((c) => c.capacity >= COURT_COUNT * 2)
      .sort((a, b) => b.idleValue - a.idleValue)
      .slice(0, 3);
    if (bottom.length) {
      insights.push(
        `Onde mais dinheiro fica parado (horas vazias × preço de tabela): ${bottom
          .map((c) => `${WEEKDAY_SHORT[c.weekday]} ${c.hour}h (${pct(c.rate)} ocupado)`)
          .join(", ")}. Candidatos a promoção, aula em grupo ou parceria.`,
      );
    }
    insights.push(
      `O teto teórico das horas ociosas é ${brl(idle)} a preço de tabela do Avulso. Não é dinheiro "perdido" — nunca vai lotar tudo —, mas mostra o tamanho da oportunidade e onde ela está.`,
    );
    const courts = byCourt.filter((c) => c.rate > 0);
    if (courts.length > 1) {
      const lo = [...courts].sort((a, b) => a.rate - b.rate)[0];
      const hi = [...courts].sort((a, b) => b.rate - a.rate)[0];
      if (hi.rate - lo.rate > 0.15)
        insights.push(
          `${hi.court} é a quadra mais usada (${pct(hi.rate)}) e ${lo.court} a menos (${pct(lo.rate)}). Vale entender por quê (piso, iluminação, localização) antes de investir em manutenção.`,
        );
    }
  }

  return {
    cells: all,
    hours,
    byCourt,
    byGroup: [...groupHours.entries()]
      .map(([group, hours]) => ({ group, hours }))
      .sort((a, b) => b.hours - a.hours),
    totalRate,
    idleValue: idle,
    primeKeys,
    primeThreshold,
    insights,
  };
}

// ----------------------------------------------------------- retenção ---

export interface RiskRow {
  clientId: string;
  name: string;
  phone: string | null;
  category: string;
  level: "alto" | "medio";
  baselinePerWeek: number;
  recentPerWeek: number;
  lastActivity: string | null;
  daysSince: number | null;
  monthlyRevenue: number;
  reasons: string[];
}

export interface RetentionResult {
  risks: RiskRow[];
  /** Clientes que esfriaram mas têm férias/afastamento lançado: fora da lista. */
  onLeave: number;
  revenueAtRisk: number;
  flow: Array<{
    ym: string;
    label: string;
    novos: number;
    perdidos: number;
    ativos: number;
    final: boolean;
  }>;
  cohorts: Array<{
    ym: string;
    label: string;
    size: number;
    cells: Array<number | null>;
    base: boolean;
  }>;
  maxCohortCols: number;
  migrations: Array<{ from: string; to: string; count: number }>;
  insights: string[];
}

export function computeRetention(ctx: IntelContext, sessions: Session[]): RetentionResult {
  const { data } = ctx;
  const today = data.today;
  const start = systemStart(data);

  // Dias com atividade (uso de quadra) por cliente; pagamentos contam como
  // sinal de vida para quem não joga (ex.: cliente que só paga).
  const playDays = new Map<string, Set<string>>();
  const anyDays = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, id: string, d: string) => {
    let s = m.get(id);
    if (!s) m.set(id, (s = new Set()));
    s.add(d);
  };
  for (const s of sessions)
    for (const id of s.clientIds) {
      add(playDays, id, s.date);
      add(anyDays, id, s.date);
    }
  const revenueByClientMonth = new Map<string, Map<string, number>>();
  const catByClientMonth = new Map<string, Map<string, Map<string, number>>>();
  for (const p of data.payments) {
    if (!p.client_id || !ctx.isRevenue(p)) continue;
    const d = recifeDay(p.paid_at);
    if (d < start) continue;
    add(anyDays, p.client_id, d);
    const ym = ymOf(d);
    const v = ctx.net(p);
    const byM = revenueByClientMonth.get(p.client_id) ?? new Map();
    byM.set(ym, (byM.get(ym) ?? 0) + v);
    revenueByClientMonth.set(p.client_id, byM);
    const cats = catByClientMonth.get(p.client_id) ?? new Map<string, Map<string, number>>();
    const cm = cats.get(ym) ?? new Map<string, number>();
    const g = categoryGroup(ctx.paymentCategory(p));
    cm.set(g, (cm.get(g) ?? 0) + v);
    cats.set(ym, cm);
    catByClientMonth.set(p.client_id, cats);
  }

  // ---- risco: 8 semanas de base (dias -84..-29) × últimas 4 semanas.
  const baseFrom = addDays(today, -84);
  const baseTo = addDays(today, -29);
  const recentFrom = addDays(today, -28);
  // Férias/afastamento lançado (lesão, viagem) nas últimas 4 semanas ou
  // adiante: o cliente parou de jogar com aviso, não está indo embora.
  const scheduleClient = new Map(data.schedules.map((sc) => [sc.id, sc.client_id]));
  const onLeaveIds = new Set<string>();
  for (const e of data.exceptions) {
    if (!isVacationReason(e.reason)) continue;
    if ((e.range_end ?? e.exception_date) < recentFrom) continue;
    const id = scheduleClient.get(e.client_schedule_id);
    if (id) onLeaveIds.add(id);
  }
  let onLeave = 0;
  const last3 = [1, 2, 3].map((i) => addMonthsYm(ymOf(today), -i));
  const risks: RiskRow[] = [];
  const baseWeeks = Math.max(
    1,
    Math.min(8, daysBetween(start > baseFrom ? start : baseFrom, baseTo) / 7),
  );
  if (start <= baseTo) {
    for (const c of data.clients) {
      if (!c.active || data.maintenanceClientIds.has(c.id)) continue;
      // Funcionário não paga quadra: parar de jogar não é saída de cliente.
      if (isEmployeeCategoryName(ctx.clientCategory(c.id))) continue;
      const days = [...(playDays.get(c.id) ?? [])];
      const base = days.filter((d) => d >= baseFrom && d <= baseTo).length;
      const recent = days.filter((d) => d >= recentFrom && d <= today).length;
      const basePW = base / baseWeeks;
      const recentPW = recent / 4;
      const reasons: string[] = [];
      let level: RiskRow["level"] | null = null;
      const cooled =
        (basePW >= 0.5 && recent === 0) || (basePW >= 0.75 && recentPW <= basePW * 0.5);
      if (cooled && onLeaveIds.has(c.id)) {
        onLeave++;
      } else if (basePW >= 0.5 && recent === 0) {
        level = "alto";
        reasons.push("parou de jogar nas últimas 4 semanas");
      } else if (basePW >= 0.75 && recentPW <= basePW * 0.5) {
        level = "medio";
        reasons.push(`frequência caiu ${pct(1 - recentPW / basePW)}`);
      }
      const endedFixed = data.schedules.find(
        (s) =>
          s.client_id === c.id &&
          s.valid_until &&
          s.valid_until < today &&
          s.valid_until >= addDays(today, -60),
      );
      const stillFixed = data.schedules.some(
        (s) => s.client_id === c.id && (!s.valid_until || s.valid_until >= today),
      );
      if (endedFixed && !stillFixed) {
        reasons.push(
          `saiu do horário fixo em ${endedFixed.valid_until!.split("-").reverse().join("/")}`,
        );
        level = level ?? "medio";
      }
      if (!level) continue;
      const all = [...(anyDays.get(c.id) ?? [])].sort();
      const lastActivity = all.length ? all[all.length - 1] : null;
      const byM = revenueByClientMonth.get(c.id);
      const monthlyRevenue = last3.reduce((s, ym) => s + (byM?.get(ym) ?? 0), 0) / 3;
      risks.push({
        clientId: c.id,
        name: c.full_name,
        phone: c.phone,
        category: ctx.clientCategory(c.id) || "—",
        level,
        baselinePerWeek: basePW,
        recentPerWeek: recentPW,
        lastActivity,
        daysSince: lastActivity ? daysBetween(lastActivity, today) : null,
        monthlyRevenue,
        reasons,
      });
    }
  }
  risks.sort((a, b) =>
    a.level === b.level ? b.monthlyRevenue - a.monthlyRevenue : a.level === "alto" ? -1 : 1,
  );
  const revenueAtRisk = risks.reduce((s, r) => s + r.monthlyRevenue, 0);

  // ---- fluxo mensal: ativos, novos, perdidos (ativo = jogou ou pagou no mês).
  const startYm = ymOf(start);
  const curYm = ymOf(today);
  const months = monthsBetween(startYm, curYm);
  const activeByMonth = new Map<string, Set<string>>();
  anyDays.forEach((days, id) => {
    if (data.maintenanceClientIds.has(id)) return;
    days.forEach((d) => {
      const ym = ymOf(d);
      const s = activeByMonth.get(ym) ?? new Set<string>();
      s.add(id);
      activeByMonth.set(ym, s);
    });
  });
  const firstMonth = new Map<string, string>();
  const lastMonth = new Map<string, string>();
  activeByMonth.forEach((ids, ym) =>
    ids.forEach((id) => {
      if (!firstMonth.has(id) || ym < firstMonth.get(id)!) firstMonth.set(id, ym);
      if (!lastMonth.has(id) || ym > lastMonth.get(id)!) lastMonth.set(id, ym);
    }),
  );
  // "Perdido" no mês M = ativo em M e sem atividade em M+1 e M+2 (só dá para
  // afirmar quando M+2 já terminou).
  const flow = months.map((ym) => {
    const ativos = activeByMonth.get(ym)?.size ?? 0;
    let novos = 0;
    firstMonth.forEach((f) => f === ym && novos++);
    const n1 = activeByMonth.get(addMonthsYm(ym, 1)) ?? new Set();
    const n2 = activeByMonth.get(addMonthsYm(ym, 2)) ?? new Set();
    const final = addMonthsYm(ym, 2) < curYm;
    let perdidos = 0;
    if (final) activeByMonth.get(ym)?.forEach((id) => !n1.has(id) && !n2.has(id) && perdidos++);
    return {
      ym,
      label: monthLabel(ym),
      novos: ym === startYm ? 0 : novos,
      perdidos,
      ativos,
      final,
    };
  });

  // ---- coortes por mês de entrada.
  const cohorts = months
    .filter((ym) => ym < curYm)
    .map((ym) => {
      const members = [...firstMonth.entries()].filter(([, f]) => f === ym).map(([id]) => id);
      const cells: Array<number | null> = [];
      for (let i = 0; addMonthsYm(ym, i) <= curYm; i++) {
        const m = addMonthsYm(ym, i);
        const act = activeByMonth.get(m) ?? new Set();
        cells.push(
          members.length ? members.filter((id) => act.has(id)).length / members.length : null,
        );
      }
      return { ym, label: monthLabel(ym), size: members.length, cells, base: ym === startYm };
    })
    .filter((c) => c.size > 0);
  const maxCohortCols = cohorts.reduce((m, c) => Math.max(m, c.cells.length), 0);

  // ---- migração de categoria: grupo dominante (por receita) mês a mês.
  const mig = new Map<string, number>();
  catByClientMonth.forEach((byMonth) => {
    const seq = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, cm]) => [...cm.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] !== seq[i - 1]) {
        const k = `${seq[i - 1]}→${seq[i]}`;
        mig.set(k, (mig.get(k) ?? 0) + 1);
      }
    }
  });
  const migrations = [...mig.entries()]
    .map(([k, count]) => {
      const [f, t] = k.split("→");
      return { from: f, to: t, count };
    })
    .sort((a, b) => b.count - a.count);

  const insights: string[] = [];
  const high = risks.filter((r) => r.level === "alto");
  if (risks.length) {
    insights.push(
      `${risks.length} clientes ativos mostram sinal de saída (${high.length} em risco alto), somando ${brl(revenueAtRisk)} por mês de receita média recente. Essa é a lista de ligações da recepção desta semana — comece pelo topo.`,
    );
  } else if (start > baseTo) {
    insights.push(
      "O alerta de esfriamento precisa de pelo menos 12 semanas de histórico de uso para comparar a frequência.",
    );
  }
  const finals = flow.filter((f) => f.final);
  if (finals.length) {
    const lost = finals.reduce((s, f) => s + f.perdidos, 0);
    const novos = finals.reduce((s, f) => s + f.novos, 0);
    const avgActive = finals.reduce((s, f) => s + f.ativos, 0) / finals.length;
    insights.push(
      `Nos meses já fechados: ${novos} clientes novos e ${lost} perdidos (sem atividade por 2 meses seguidos). Churn médio de ${pct(lost / finals.length / Math.max(1, avgActive), 1)} da base por mês${
        novos > 0 && lost / novos > 0.7
          ? ` — para cada 10 que entram, ${Math.round((lost / novos) * 10)} saem; retenção rende mais que captação aqui.`
          : "."
      }`,
    );
  }
  const c1 = cohorts.filter((c) => !c.base && c.cells.length >= 3 && c.size >= 3);
  if (c1.length) {
    const m2 = c1.reduce((s, c) => s + (c.cells[2] ?? 0), 0) / c1.length;
    insights.push(
      `Dos clientes novos, em média ${pct(m2)} continuam ativos dois meses depois de entrar. ${
        m2 < 0.5
          ? "Mais da metade não fica: o problema está na experiência inicial (primeiras aulas, encaixe de horário, contato pós-primeira visita)."
          : "A retenção inicial é boa."
      }`,
    );
  }
  const upgrades = migrations.filter(
    (m) => m.from === "Avulso" && m.to === "Mensalista",
  );
  const downgrades = migrations.filter(
    (m) => m.from === "Mensalista" && m.to === "Avulso",
  );
  if (upgrades.length || downgrades.length) {
    insights.push(
      `Migração de categoria: ${upgrades.reduce((s, m) => s + m.count, 0)} subiram de Avulso para Mensalista e ${downgrades.reduce((s, m) => s + m.count, 0)} desceram para Avulso.`,
    );
  }

  if (onLeave) {
    insights.push(
      `${onLeave} cliente(s) que pararam ou diminuíram estão com férias/afastamento lançado e ficaram fora da lista de ligações.`,
    );
  }
  return { risks, revenueAtRisk, onLeave, flow, cohorts, maxCohortCols, migrations, insights };
}

// -------------------------------------------------- demanda reprimida ---

export interface DemandResult {
  cells: Array<{ weekday: number; hour: number; count: number; rate: number | null }>;
  hours: number[];
  totals: {
    avulsa: number;
    avulsaAtendida: number;
    fixa: number;
    fixaAguardando: number;
    falhas: number;
  };
  topFixed: Array<{ label: string; count: number }>;
  insights: string[];
}

const OPEN_WAIT = new Set(["waiting", "awaiting_confirmation", "notified", "contacted"]);

export function computeDemand(
  ctx: IntelContext,
  occ: OccupancyResult,
  from: string,
  to: string,
): DemandResult {
  const { data } = ctx;
  const counts = new Map<string, number>();
  const inc = (wd: number, h: number) =>
    counts.set(slotKey(wd, h), (counts.get(slotKey(wd, h)) ?? 0) + 1);
  let avulsa = 0;
  let atendida = 0;
  for (const w of data.waitlist) {
    if (w.desired_date < from || w.desired_date > to) continue;
    const h = toMin(w.start_time);
    if (h == null) continue;
    avulsa++;
    if (w.status === "fulfilled" || w.status === "confirmed") atendida++;
    inc(weekdayOf(w.desired_date), Math.floor(h / 60));
  }
  let fixa = 0;
  let aguardando = 0;
  const fixedBySlot = new Map<string, number>();
  for (const w of data.fixedWaitlist) {
    const d = recifeDay(w.created_at);
    const open = OPEN_WAIT.has(w.status);
    if (!open && (d < from || d > to)) continue;
    const h = toMin(w.start_time);
    if (h == null) continue;
    fixa++;
    if (open) {
      aguardando++;
      const k = slotKey(w.desired_weekday, Math.floor(h / 60));
      fixedBySlot.set(k, (fixedBySlot.get(k) ?? 0) + 1);
    }
    inc(w.desired_weekday, Math.floor(h / 60));
  }
  let falhas = 0;
  for (const f of data.failures) {
    if (!f.booking_date || f.start_hour == null) continue;
    if (f.booking_date < from || f.booking_date > to) continue;
    if (f.stage === "carregamento") continue;
    falhas++;
    inc(weekdayOf(f.booking_date), f.start_hour);
  }
  const occRate = new Map(occ.cells.map((c) => [slotKey(c.weekday, c.hour), c.rate]));
  const cells = [...counts.entries()].map(([k, count]) => {
    const [wd, h] = k.split("|").map(Number);
    return { weekday: wd, hour: h, count, rate: occRate.get(k) ?? null };
  });
  const hours = [...new Set([...cells.map((c) => c.hour), ...occ.hours])].sort((a, b) => a - b);
  const topFixed = [...fixedBySlot.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, count]) => {
      const [wd, h] = k.split("|").map(Number);
      return { label: `${WEEKDAY_SHORT[wd]} ${h}h`, count };
    });

  const insights: string[] = [];
  const total = avulsa + fixa + falhas;
  if (total) {
    const hot = [...cells].sort((a, b) => b.count - a.count).slice(0, 3);
    insights.push(
      `${total} pedidos não atendidos de imediato no período (${avulsa} na lista de espera avulsa, ${fixa} na fila de fixo, ${falhas} tentativas recusadas no portal). Mais procurados: ${hot
        .map((c) => `${WEEKDAY_SHORT[c.weekday]} ${c.hour}h (${c.count})`)
        .join(", ")}.`,
    );
    if (avulsa)
      insights.push(`Da lista de espera avulsa, ${pct(atendida / avulsa)} acabou atendida.`);
    const pricing = cells.filter((c) => (c.rate ?? 0) >= occ.primeThreshold && c.count >= 3);
    if (pricing.length) {
      insights.push(
        `${pricing.length} faixas estão lotadas e ainda têm fila: ${pricing
          .slice(0, 5)
          .map((c) => `${WEEKDAY_SHORT[c.weekday]} ${c.hour}h`)
          .join(
            ", ",
          )}. É a evidência mais forte para reajuste de preço nessas faixas — a demanda existe mesmo sem vaga.`,
      );
    }
    if (aguardando)
      insights.push(
        `${aguardando} pessoas aguardam vaga de horário fixo agora. Cada uma é receita recorrente parada na porta.`,
      );
  } else {
    insights.push("Nenhum pedido não atendido registrado no período.");
  }
  return {
    cells,
    hours,
    totals: { avulsa, avulsaAtendida: atendida, fixa, fixaAguardando: aguardando, falhas },
    topFixed,
    insights,
  };
}

// ------------------------------------------------------- concentração ---

export interface ConcentrationResult {
  clients: Array<{
    clientId: string;
    name: string;
    category: string;
    revenue: number;
    share: number;
    cum: number;
    abc: "A" | "B" | "C";
  }>;
  curve: Array<{ x: number; y: number }>;
  aCount: number;
  total: number;
  byTeacher: Array<{ name: string; revenue: number; share: number; clients: number }>;
  byGroup: Array<{ group: string; revenue: number; share: number }>;
  insights: string[];
}

export function computeConcentration(
  ctx: IntelContext,
  fromYm: string,
  toYm: string,
): ConcentrationResult {
  const { data } = ctx;
  const byClient = new Map<string, number>();
  const byGroup = new Map<string, number>();
  let total = 0;
  for (const p of data.payments) {
    if (!ctx.isRevenue(p)) continue;
    const ym = ymOf(recifeDay(p.paid_at));
    if (ym < fromYm || ym > toYm) continue;
    const v = ctx.net(p);
    total += v;
    const g = categoryGroup(ctx.paymentCategory(p));
    byGroup.set(g, (byGroup.get(g) ?? 0) + v);
    if (p.client_id) byClient.set(p.client_id, (byClient.get(p.client_id) ?? 0) + v);
  }
  const sorted = [...byClient.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const clientTotal = sorted.reduce((s, [, v]) => s + v, 0);
  let cum = 0;
  const clients = sorted.map(([id, revenue]) => {
    cum += revenue;
    const c = cum / Math.max(1, clientTotal);
    const prev = (cum - revenue) / Math.max(1, clientTotal);
    return {
      clientId: id,
      name: ctx.clientById.get(id)?.full_name ?? "—",
      category: ctx.clientCategory(id) || "—",
      revenue,
      share: revenue / Math.max(1, clientTotal),
      cum: c,
      abc: (prev < 0.8 ? "A" : prev < 0.95 ? "B" : "C") as "A" | "B" | "C",
    };
  });
  const step = Math.max(1, Math.floor(clients.length / 50));
  const curve = [{ x: 0, y: 0 }];
  clients.forEach((c, i) => {
    if (i % step === 0 || i === clients.length - 1)
      curve.push({ x: round(((i + 1) / clients.length) * 100, 1), y: round(c.cum * 100, 1) });
  });
  const aCount = clients.filter((c) => c.abc === "A").length;

  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name]));
  const teach = new Map<string, { revenue: number; clients: number }>();
  for (const c of clients) {
    const tid = ctx.clientById.get(c.clientId)?.teacher_id;
    if (!tid) continue;
    const t = teach.get(tid) ?? { revenue: 0, clients: 0 };
    t.revenue += c.revenue;
    t.clients++;
    teach.set(tid, t);
  }
  const byTeacher = [...teach.entries()]
    .map(([id, t]) => ({
      name: teacherName.get(id) ?? "—",
      revenue: t.revenue,
      clients: t.clients,
      share: t.revenue / Math.max(1, total),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const insights: string[] = [];
  if (clients.length) {
    const top10 = clients.slice(0, 10).reduce((s, c) => s + c.share, 0);
    insights.push(
      `${aCount} clientes (${pct(aCount / clients.length)} da base pagante) respondem por 80% da receita identificada. Os 10 maiores, sozinhos, somam ${pct(top10)}.`,
    );
    insights.push(
      'Os clientes "A" merecem tratamento de conta-chave: contato pessoal da gerência, prioridade de horário e aviso antecipado de qualquer reajuste.',
    );
  }
  if (byTeacher.length && byTeacher[0].share > 0.1) {
    insights.push(
      `Os alunos vinculados a ${byTeacher[0].name} representam ${pct(byTeacher[0].share)} do faturamento. Se esse professor sair, quanto disso fica? Vale ter um plano para esse cenário.`,
    );
  }
  return {
    clients,
    curve,
    aCount,
    total,
    byTeacher,
    byGroup: [...byGroup.entries()]
      .map(([group, revenue]) => ({ group, revenue, share: revenue / Math.max(1, total) }))
      .sort((a, b) => b.revenue - a.revenue),
    insights,
  };
}

// -------------------------------------------------------- diagnóstico ---

/**
 * Datas que mexem com o movimento e não são feriado oficial (os feriados
 * vêm de holidays.ts). Eleição cai no domingo e tira gente da quadra.
 */
const NATIONAL_EVENTS: Array<{ date: string; name: string }> = [
  { date: "2026-10-04", name: "Eleições (1º turno)" },
  { date: "2026-10-25", name: "Eleições (2º turno)" },
];

export const calendarEventOf = (ymd: string): string | null =>
  findHoliday(ymd)?.name ?? NATIONAL_EVENTS.find((e) => e.date === ymd)?.name ?? null;

const isVacationReason = (r: string | null | undefined) => !!r && /f[ée]rias|viag/i.test(r);
// Fixo remanejado de quadra (manutenção) continua jogando: não é ausência.
const isMoveReason = (r: string | null | undefined) => !!r && /^movido/i.test(r.trim());

export interface DiagnosisWindow {
  ym: string;
  label: string;
  from: string;
  to: string;
}

export interface DiagnosisCalendarDay {
  date: string;
  name: string;
  hours: number;
  typical: number;
  lost: number;
}

export interface DiagnosisFactor {
  title: string;
  /** R$ a menos no período por causa deste fator (negativo = ajudou). */
  impact: number | null;
  estimated: boolean;
  weight: "principal" | "contribui" | "pouco" | "a favor" | "info";
  text: string;
  details: string[];
}

export interface DiagnosisResult {
  cur: DiagnosisWindow;
  prev: DiagnosisWindow;
  day: number;
  closed: boolean;
  revenue: {
    current: number;
    previous: number;
    avgSameDays: number | null;
    avgMonths: number;
    fullMonthAvg: number | null;
    previousFullMonth: number;
    projection: number | null;
  };
  clients: { current: number; previous: number };
  groups: Array<{
    group: string;
    current: number;
    previous: number;
    delta: number;
    average: number | null;
  }>;
  usage: {
    current: number;
    previous: number;
    currentFixo: number;
    previousFixo: number;
    revPerHour: number;
  };
  fixed: {
    weeklyHoursBefore: number;
    weeklyHoursNow: number;
    lost: Array<{
      name: string;
      endedOn: string;
      weeklyHours: number;
      prevRevenue: number;
      curRevenue: number;
      monthly: number;
    }>;
    added: Array<{ name: string; startedOn: string; weeklyHours: number }>;
  };
  absences: {
    current: { hours: number; vacationHours: number };
    previous: { hours: number; vacationHours: number };
    clients: Array<{ name: string; hours: number; dates: number; vacation: boolean }>;
  };
  calendar: {
    current: DiagnosisCalendarDay[];
    previous: DiagnosisCalendarDay[];
    expectedCurrent: number;
    expectedPrevious: number;
    weekendCurrent: number;
    weekendPrevious: number;
  };
  factors: DiagnosisFactor[];
  headline: string[];
}

/**
 * Por que o mês está como está: compara o mês escolhido com o anterior no
 * MESMO número de dias (mês em andamento vai até ontem, o último dia
 * completo) e mede cada suspeito — família de receita, fixos que saíram, férias/cancelamentos de fixo, feriados e
 * eventos, e a composição de dias da semana. Os fatores se sobrepõem (um
 * fixo que saiu também derruba "Mensalista"), então não são somados.
 */
export function computeDiagnosis(
  ctx: IntelContext,
  sessions: Session[],
  ym: string,
): DiagnosisResult | { error: string } {
  const { data } = ctx;
  const today = data.today;
  const start = systemStart(data);
  const startYm = ymOf(start);
  const curYm = ymOf(today);
  const closed = ym < curYm;
  if (ym > curYm) return { error: "Mês ainda não começou." };
  const curTo = closed ? lastDayOfMonth(ym) : addDays(today, -1);
  if (ymOf(curTo) !== ym)
    return { error: "O mês começou hoje: ainda não há nenhum dia completo para analisar." };
  const day = Number(curTo.slice(8, 10));
  const prevYm = addMonthsYm(ym, -1);
  if (prevYm < startYm) return { error: "Não há mês anterior com dados no sistema para comparar." };
  // Mês fechado compara com meses inteiros; em andamento, até o mesmo dia.
  const sameDayTo = (m: string) => {
    const last = lastDayOfMonth(m);
    if (closed) return last;
    const d = `${m}-${pad(day)}`;
    return d < last ? d : last;
  };
  const cur: DiagnosisWindow = { ym, label: monthLabel(ym), from: `${ym}-01`, to: curTo };
  const prev: DiagnosisWindow = {
    ym: prevYm,
    label: monthLabel(prevYm),
    from: `${prevYm}-01`,
    to: sameDayTo(prevYm),
  };
  const inW = (d: string, w: { from: string; to: string }) => d >= w.from && d <= w.to;

  // ---- receita
  const revenue = data.payments
    .filter((p) => ctx.isRevenue(p))
    .map((p) => ({ p, day: recifeDay(p.paid_at), v: ctx.net(p) }));
  const sumIn = (w: { from: string; to: string }) =>
    revenue.reduce((s, r) => (inW(r.day, w) ? s + r.v : s), 0);
  const current = sumIn(cur);
  const previous = sumIn(prev);
  const pastMonths = monthsBetween(startYm, prevYm);
  const avgSameDays = pastMonths.length
    ? pastMonths.reduce((s, m) => s + sumIn({ from: `${m}-01`, to: sameDayTo(m) }), 0) /
      pastMonths.length
    : null;
  const fullOf = (m: string) => sumIn({ from: `${m}-01`, to: lastDayOfMonth(m) });
  const fullMonthAvg = pastMonths.length
    ? pastMonths.reduce((s, m) => s + fullOf(m), 0) / pastMonths.length
    : null;
  const previousFullMonth = fullOf(prevYm);
  // Projeção: o que já entrou + o que o mês anterior fez do mesmo dia até o fim.
  const projection = closed ? null : current + (previousFullMonth - previous);

  const clientsIn = (w: DiagnosisWindow) =>
    new Set(revenue.filter((r) => r.p.client_id && inW(r.day, w)).map((r) => r.p.client_id)).size;

  // Por tipo de receita: mês atual, mês anterior e média de todos os meses
  // anteriores no mesmo número de dias.
  const groupMap = new Map<string, { current: number; previous: number; past: number }>();
  const pastWindows = pastMonths.map((m) => ({ from: `${m}-01`, to: sameDayTo(m) }));
  for (const r of revenue) {
    const which = inW(r.day, cur) ? "current" : inW(r.day, prev) ? "previous" : null;
    const inPast = pastWindows.some((w) => inW(r.day, w));
    if (!which && !inPast) continue;
    const g = categoryGroup(ctx.paymentCategory(r.p));
    const o = groupMap.get(g) ?? { current: 0, previous: 0, past: 0 };
    if (which) o[which] += r.v;
    if (inPast) o.past += r.v;
    groupMap.set(g, o);
  }
  const groups = [...groupMap.entries()]
    .map(([group, o]) => ({
      group,
      current: o.current,
      previous: o.previous,
      delta: o.current - o.previous,
      average: pastMonths.length ? o.past / pastMonths.length : null,
    }))
    .sort((a, b) => a.delta - b.delta);

  // ---- uso de quadra
  // hoursByDate e clientHoursPrev somam cada cliente (base das estimativas
  // em R$, que também são por cliente). usage* conta a quadra uma vez só:
  // turma com vários alunos no mesmo horário ocupa uma quadra, não várias.
  const hoursByDate = new Map<string, number>();
  let clientHoursPrev = 0;
  let usageCur = 0;
  let usagePrev = 0;
  let fixoCur = 0;
  let fixoPrev = 0;
  const seenSlot = new Set<string>();
  for (const s of sessions) {
    const h = (s.endMin - s.startMin) / 60;
    hoursByDate.set(s.date, (hoursByDate.get(s.date) ?? 0) + h);
    const which = inW(s.date, cur) ? "cur" : inW(s.date, prev) ? "prev" : null;
    if (!which) continue;
    if (which === "prev") clientHoursPrev += h;
    const slot = `${s.date}|${s.court ?? `x${s.clientIds[0] ?? ""}`}|${s.startMin}|${s.endMin}`;
    if (seenSlot.has(slot)) continue;
    seenSlot.add(slot);
    if (which === "cur") {
      usageCur += h;
      if (s.kind === "fixo") fixoCur += h;
    } else {
      usagePrev += h;
      if (s.kind === "fixo") fixoPrev += h;
    }
  }
  const revPerHour = clientHoursPrev > 0 ? previous / clientHoursPrev : 0;

  // ---- horário fixo: quem saiu e quem entrou
  const created = (sc: IntelSchedule) => recifeDay(sc.created_at);
  const activeOn = (sc: IntelSchedule, d: string) =>
    (!sc.valid_from || sc.valid_from <= d) &&
    (!sc.valid_until || sc.valid_until >= d) &&
    (created(sc) <= d || created(sc) <= start);
  const dur = (sc: IntelSchedule) =>
    Math.max(0, (toMin(sc.end_time) ?? 0) - (toMin(sc.start_time) ?? 0)) / 60;
  const schedules = data.schedules.filter((sc) => !data.maintenanceClientIds.has(sc.client_id));
  const before = schedules.filter((sc) => activeOn(sc, prev.from));
  const now = schedules.filter((sc) => activeOn(sc, cur.to));
  const nowClients = new Set(now.map((sc) => sc.client_id));
  const beforeClients = new Set(before.map((sc) => sc.client_id));
  const clientRevIn = (id: string, w: { from: string; to: string }) =>
    revenue.reduce((s, r) => (r.p.client_id === id && inW(r.day, w) ? s + r.v : s), 0);
  const nameOf = (id: string) => ctx.clientById.get(id)?.full_name ?? "—";

  const lostMap = new Map<string, { endedOn: string; weeklyHours: number }>();
  for (const sc of before) {
    if (nowClients.has(sc.client_id)) continue;
    const o = lostMap.get(sc.client_id) ?? { endedOn: "", weeklyHours: 0 };
    o.weeklyHours += dur(sc);
    const end = sc.valid_until ?? "";
    if (end > o.endedOn) o.endedOn = end;
    lostMap.set(sc.client_id, o);
  }
  const monthlyBefore = (id: string) => {
    const ms = [1, 2, 3].map((i) => addMonthsYm(ym, -i)).filter((m) => m >= startYm);
    return ms.length
      ? ms.reduce((s, m) => s + clientRevIn(id, { from: `${m}-01`, to: lastDayOfMonth(m) }), 0) /
          ms.length
      : 0;
  };
  const lost = [...lostMap.entries()]
    .map(([id, o]) => ({
      name: nameOf(id),
      endedOn: o.endedOn,
      weeklyHours: o.weeklyHours,
      prevRevenue: clientRevIn(id, prev),
      curRevenue: clientRevIn(id, cur),
      monthly: monthlyBefore(id),
    }))
    .sort((a, b) => b.prevRevenue - a.prevRevenue);
  const addedMap = new Map<string, { startedOn: string; weeklyHours: number }>();
  for (const sc of now) {
    if (beforeClients.has(sc.client_id)) continue;
    const o = addedMap.get(sc.client_id) ?? { startedOn: "9999", weeklyHours: 0 };
    o.weeklyHours += dur(sc);
    const st = [sc.valid_from ?? "", created(sc)].sort()[1];
    if (st < o.startedOn) o.startedOn = st;
    addedMap.set(sc.client_id, o);
  }
  const added = [...addedMap.entries()]
    .map(([id, o]) => ({ name: nameOf(id), ...o }))
    .sort((a, b) => b.weeklyHours - a.weeklyHours);
  // Horas de quadra por semana: turma no mesmo horário conta uma vez.
  const weeklyCourtHours = (list: IntelSchedule[]) => {
    const seen = new Set<string>();
    let h = 0;
    for (const sc of list) {
      const k = `${sc.weekday}|${sc.court ?? `x${sc.client_id}`}|${sc.start_time}|${sc.end_time}`;
      if (seen.has(k)) continue;
      seen.add(k);
      h += dur(sc);
    }
    return h;
  };
  const weeklyHoursBefore = weeklyCourtHours(before);
  const weeklyHoursNow = weeklyCourtHours(now);

  // ---- ausências de fixo (férias, cancelamentos) — feriado fica de fora,
  // ele é medido no calendário.
  const excBySched = new Map<string, IntelException[]>();
  for (const e of data.exceptions) {
    const arr = excBySched.get(e.client_schedule_id) ?? [];
    arr.push(e);
    excBySched.set(e.client_schedule_id, arr);
  }
  const cancelledAtt = new Set(
    data.attendance
      .filter((a) => a.status.startsWith("cancelled"))
      .map((a) => `${a.client_schedule_id}|${a.attendance_date}`),
  );
  const absenceByClient = new Map<
    string,
    { hours: number; dates: Set<string>; vacation: boolean }
  >();
  const absencesIn = (w: DiagnosisWindow, collect: boolean) => {
    let hours = 0;
    let vacationHours = 0;
    for (const sc of schedules) {
      const s0 = toMin(sc.start_time);
      const e0 = toMin(sc.end_time);
      if (s0 == null || e0 == null || e0 <= s0) continue;
      let d = addDays(w.from, (sc.weekday - weekdayOf(w.from) + 7) % 7);
      for (; d <= w.to; d = addDays(d, 7)) {
        if (!activeOn(sc, d) || calendarEventOf(d)) continue;
        let missed = 0;
        let vacation = false;
        if (cancelledAtt.has(`${sc.id}|${d}`)) missed = (e0 - s0) / 60;
        else {
          for (const ex of excBySched.get(sc.id) ?? []) {
            if (d < ex.exception_date || d > (ex.range_end ?? ex.exception_date)) continue;
            if (isMoveReason(ex.reason)) continue;
            const xs = toMin(ex.start_time) ?? s0;
            const xe = toMin(ex.end_time) ?? e0;
            const cut = Math.max(0, Math.min(e0, xe) - Math.max(s0, xs)) / 60;
            if (cut > missed) {
              missed = cut;
              vacation = isVacationReason(ex.reason);
            }
          }
        }
        if (!missed) continue;
        hours += missed;
        if (vacation) vacationHours += missed;
        if (collect) {
          const o = absenceByClient.get(sc.client_id) ?? {
            hours: 0,
            dates: new Set<string>(),
            vacation: false,
          };
          o.hours += missed;
          o.dates.add(d);
          o.vacation ||= vacation;
          absenceByClient.set(sc.client_id, o);
        }
      }
    }
    return { hours, vacationHours };
  };
  const absCur = absencesIn(cur, true);
  const absPrev = absencesIn(prev, false);
  const absenceClients = [...absenceByClient.entries()]
    .map(([id, o]) => ({
      name: nameOf(id),
      hours: o.hours,
      dates: o.dates.size,
      vacation: o.vacation,
    }))
    .sort((a, b) => b.hours - a.hours);

  // ---- calendário: feriados/eventos × dia da semana típico
  const typicalBefore = (from: string) => {
    const tot = new Array(7).fill(0);
    const cnt = new Array(7).fill(0);
    for (let d = addDays(from, -56); d < from; d = addDays(d, 1)) {
      if (d < start || calendarEventOf(d)) continue;
      const wd = weekdayOf(d);
      tot[wd] += hoursByDate.get(d) ?? 0;
      cnt[wd]++;
    }
    return tot.map((t, i) => (cnt[i] ? t / cnt[i] : null)) as Array<number | null>;
  };
  const eventDays = (w: DiagnosisWindow): DiagnosisCalendarDay[] => {
    const typ = typicalBefore(w.from);
    const out: DiagnosisCalendarDay[] = [];
    for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
      const name = calendarEventOf(d);
      if (!name) continue;
      const hours = hoursByDate.get(d) ?? 0;
      const typical = typ[weekdayOf(d)] ?? hours;
      out.push({ date: d, name, hours, typical, lost: Math.max(0, typical - hours) });
    }
    return out;
  };
  const calCur = eventDays(cur);
  const calPrev = eventDays(prev);
  // Composição de dias: as mesmas médias por dia da semana aplicadas aos dois
  // períodos — a diferença vem só de quantos sábados/domingos cada um teve.
  const typCur = typicalBefore(cur.from);
  const expected = (w: DiagnosisWindow) => {
    let s = 0;
    for (let d = w.from; d <= w.to; d = addDays(d, 1)) s += typCur[weekdayOf(d)] ?? 0;
    return s;
  };
  const weekend = (w: DiagnosisWindow) => {
    let n = 0;
    for (let d = w.from; d <= w.to; d = addDays(d, 1)) if ([0, 6].includes(weekdayOf(d))) n++;
    return n;
  };
  const expectedCurrent = expected(cur);
  const expectedPrevious = expected(prev);

  // ---- fatores
  const drop = previous - current;
  // Diferença de menos de 3% é empate: aí o peso de cada fator é medido
  // contra 10% do mês anterior, senão tudo vira "explica boa parte".
  const relevantDrop = drop > previous * 0.03;
  const base = relevantDrop ? drop : Math.max(1, previous * 0.1);
  const weigh = (impact: number | null): DiagnosisFactor["weight"] => {
    if (impact == null) return "info";
    if (impact < 0) return "a favor";
    const share = impact / base;
    return share >= 0.3 ? "principal" : share >= 0.1 ? "contribui" : "pouco";
  };
  const hfmtD = (h: number) => `${round(h, 1).toLocaleString("pt-BR")}h`;
  const dmy = (d: string) => d.split("-").reverse().join("/");
  const dm = (d: string) => dmy(d).slice(0, 5);
  const factors: DiagnosisFactor[] = [];

  const downs = groups.filter((g) => g.delta < 0);
  const ups = groups.filter((g) => g.delta > 0);
  factors.push({
    title: "Onde o dinheiro caiu (por tipo de receita)",
    impact: null,
    estimated: false,
    weight: "info",
    text: downs.length
      ? `Caiu em ${downs
          .slice(0, 3)
          .map((g) => `${g.group} (${brl(g.delta)})`)
          .join(", ")}${
          ups.length
            ? `; subiu em ${ups
                .slice(-2)
                .reverse()
                .map((g) => `${g.group} (+${brl(g.delta)})`)
                .join(", ")}`
            : ""
        }.`
      : "Nenhum tipo de receita caiu em relação ao mesmo período do mês anterior.",
    details: [],
  });

  // Quem sai costuma acertar a conta na saída: o caixa do mês até sobe, e a
  // perda real aparece nos meses seguintes. Por isso o peso usa a média
  // mensal que esses clientes pagavam, não só a diferença do período.
  const lostImpact = Math.max(
    0,
    lost.reduce((s, l) => s + l.prevRevenue - l.curRevenue, 0),
  );
  const lostMonthly = lost.reduce((s, l) => s + l.monthly, 0);
  factors.push({
    title: "Locações fixas que saíram",
    impact: lost.length ? lostImpact : 0,
    estimated: false,
    weight: lost.length ? weigh(Math.max(lostImpact, lostMonthly * (day / 30))) : "pouco",
    text: lost.length
      ? `${lost.length} cliente(s) deixaram de ter horário fixo desde ${dmy(prev.from)} (${hfmtD(lost.reduce((s, l) => s + l.weeklyHours, 0))} por semana). Pagaram ${brl(lost.reduce((s, l) => s + l.prevRevenue, 0))} no período de ${prev.label} e ${brl(lost.reduce((s, l) => s + l.curRevenue, 0))} agora (quem sai costuma acertar a conta na saída). A perda que fica para os próximos meses: cerca de ${brl(lostMonthly)} por mês, que era a média que eles pagavam. Entraram ${added.length} cliente(s) com fixo novo. Quadra reservada para fixo: de ${hfmtD(weeklyHoursBefore)} para ${hfmtD(weeklyHoursNow)} por semana.`
      : `Nenhum cliente perdeu o horário fixo desde ${dmy(prev.from)}. Fixo por semana: de ${hfmtD(weeklyHoursBefore)} para ${hfmtD(weeklyHoursNow)}.`,
    details: lost.map(
      (l) =>
        `${l.name} — saiu em ${l.endedOn ? dmy(l.endedOn) : "?"}, ${hfmtD(l.weeklyHours)}/semana, pagava em média ${brl(l.monthly)}/mês`,
    ),
  });

  const absImpact = revPerHour ? (absCur.hours - absPrev.hours) * revPerHour : null;
  factors.push({
    title: "Férias e cancelamentos de horário fixo",
    impact: absImpact,
    estimated: true,
    weight: weigh(absImpact),
    text: `Fixos deixaram de jogar ${hfmtD(absCur.hours)} neste período (${hfmtD(absCur.vacationHours)} marcadas como férias/viagem), contra ${hfmtD(absPrev.hours)} no mesmo período de ${prev.label}${absPrev.vacationHours ? ` (${hfmtD(absPrev.vacationHours)} de férias)` : ""}. ${absenceClients.length} cliente(s) com ausência. Cancelamentos em feriado ficam no item de calendário.`,
    details: absenceClients
      .slice(0, 15)
      .map(
        (c) =>
          `${c.name} — ${c.dates} dia(s), ${hfmtD(c.hours)}${c.vacation ? " (férias/viagem)" : ""}`,
      ),
  });

  const lostCal = calCur.reduce((s, d) => s + d.lost, 0);
  const lostCalPrev = calPrev.reduce((s, d) => s + d.lost, 0);
  const calImpact = revPerHour ? (lostCal - lostCalPrev) * revPerHour : null;
  factors.push({
    title: "Feriados e datas do calendário",
    impact: calImpact,
    estimated: true,
    weight: weigh(calImpact),
    text: calCur.length
      ? `${calCur.map((d) => `${dm(d.date)} ${WEEKDAY_SHORT[weekdayOf(d.date)]} (${d.name})`).join(", ")}: ${hfmtD(lostCal)} de quadra a menos que um ${calCur.length > 1 ? "dia" : WEEKDAY_SHORT[weekdayOf(calCur[0].date)]} normal. ${calPrev.length ? `No mesmo período de ${prev.label} também houve ${calPrev.map((d) => `${dm(d.date)} (${d.name})`).join(", ")}, com ${hfmtD(lostCalPrev)} a menos — o efeito líquido é a diferença.` : `${prev.label} não teve feriado no mesmo período.`}`
      : `Nenhum feriado ou evento nacional neste período${calPrev.length ? `; ${prev.label} teve ${calPrev.map((d) => d.name).join(", ")}, ${hfmtD(lostCalPrev)} a menos` : ""}.`,
    details: [...calCur, ...calPrev].map(
      (d) =>
        `${dmy(d.date)} (${WEEKDAY_SHORT[weekdayOf(d.date)]}) ${d.name}: ${hfmtD(d.hours)} usadas × ${hfmtD(d.typical)} num dia igual normal`,
    ),
  });

  const mixImpact = revPerHour ? (expectedPrevious - expectedCurrent) * revPerHour : null;
  const wkCur = weekend(cur);
  const wkPrev = weekend(prev);
  factors.push({
    title: "Dias da semana no período",
    impact: mixImpact,
    estimated: true,
    weight: weigh(mixImpact),
    text: `${cur.label} teve ${wkCur} dia(s) de fim de semana até o dia ${day}; ${prev.label} teve ${wkPrev}. Pelo movimento típico de cada dia da semana, isso dá ${hfmtD(expectedCurrent)} esperadas contra ${hfmtD(expectedPrevious)}.`,
    details: [],
  });

  const volumeReading = () => {
    if (!usagePrev || !previous) return "";
    const u = usageCur / usagePrev - 1;
    const r = current / previous - 1;
    if (u - r > 0.1)
      return "A receita caiu mais que o uso da quadra: olhe cobrança (débito em aberto) e pagamentos que ficaram para depois antes de culpar a falta de cliente.";
    if (u < -0.1 && r - u > 0.1)
      return "Menos quadra ocupada, mas a receita não caiu junto: cada hora rendeu mais (pagamento atrasado entrando ou preço maior). Se a ocupação continuar caindo, a receita vai atrás.";
    if (u < -0.1) return "Menos gente jogando: o problema é volume (clientes/horários), não preço.";
    return "Uso e receita andaram juntos.";
  };
  factors.push({
    title: "Volume de quadra × valor",
    impact: null,
    estimated: false,
    weight: "info",
    text: `Horas de quadra ocupadas: ${hfmtD(usageCur)} contra ${hfmtD(usagePrev)} (${usagePrev ? `${usageCur >= usagePrev ? "+" : ""}${pct(usageCur / usagePrev - 1)}` : "—"}), das quais fixo ${hfmtD(fixoCur)} contra ${hfmtD(fixoPrev)}. Receita: ${previous ? `${current >= previous ? "+" : ""}${pct(current / previous - 1)}` : "—"}. ${volumeReading()}`,
    details: [],
  });

  // ---- manchete
  const headline: string[] = [];
  const periodTxt = closed ? `${cur.label} inteiro` : `${cur.label} até o dia ${day}`;
  headline.push(
    `${periodTxt}: ${brl(current)} de faturamento (caixa). No mesmo período de ${prev.label}: ${brl(previous)} — ${previous ? `${current >= previous ? "+" : ""}${pct(current / previous - 1)}` : "sem base"}.`,
  );
  if (!closed && fullMonthAvg && avgSameDays != null) {
    headline.push(
      `Cuidado com a comparação: os meses anteriores fecharam em média ${brl(fullMonthAvg)}, mas até o dia ${day} eles tinham ${brl(avgSameDays)}. Contra essa base justa, ${cur.label} está ${current >= avgSameDays ? "+" : ""}${pct(current / Math.max(1, avgSameDays) - 1)}.`,
    );
  }
  const main = factors
    .filter((f) => f.weight === "principal" || f.weight === "contribui")
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0));
  if (!relevantDrop) {
    headline.push(
      `Na prática, ${cur.label} ${drop < 0 ? "ficou acima de" : "empatou com"} ${prev.label} no mesmo período: a diferença de ${brl(Math.abs(drop))} é pequena demais para ter "um culpado".`,
    );
  }
  // Contra a média dos meses anteriores: quais tipos de receita estão abaixo.
  const belowAvg = groups
    .filter((g) => g.average != null && g.current < g.average)
    .map((g) => ({ ...g, gap: (g.average ?? 0) - g.current }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3);
  if (avgSameDays != null && current < avgSameDays * 0.97 && belowAvg.length) {
    headline.push(
      `Contra a média dos meses anteriores (mesmos dias), quem está abaixo: ${belowAvg
        .map((g) => `${g.group} (${brl(g.current)} contra média de ${brl(g.average ?? 0)})`)
        .join(", ")}.`,
    );
  }
  // Torneio é receita de evento: distorce qualquer comparação de rotina.
  const event = groups.find((g) => /torneio/i.test(g.group));
  if (event && Math.abs(event.delta) > previous * 0.05) {
    const c = current - event.current;
    const pv = previous - event.previous;
    headline.push(
      `${event.group} é receita de evento, não de rotina (${brl(event.previous)} em ${prev.label}, ${brl(event.current)} agora). Tirando essa linha, ${cur.label} fica ${pv ? `${c >= pv ? "+" : ""}${pct(c / pv - 1)}` : "—"} contra ${prev.label}.`,
    );
  }
  if (relevantDrop) {
    headline.push(
      main.length
        ? `O que mais explica a diferença de ${brl(drop)}: ${main.map((f) => `${f.title[0].toLowerCase()}${f.title.slice(1)} (${f.estimated ? "≈" : ""}${brl(f.impact ?? 0)})`).join("; ")}. Os fatores se sobrepõem — não some os valores.`
        : `Nenhum dos fatores medidos explica sozinho a diferença de ${brl(drop)}: veja o detalhamento por tipo de receita e a cobrança.`,
    );
  }
  if (projection != null) {
    headline.push(
      `Se o resto do mês repetir o que ${prev.label} fez do dia ${day + 1} em diante, ${cur.label} fecha perto de ${brl(projection)} (${prev.label} fechou em ${brl(previousFullMonth)}).`,
    );
  }

  return {
    cur,
    prev,
    day,
    closed,
    revenue: {
      current,
      previous,
      avgSameDays,
      avgMonths: pastMonths.length,
      fullMonthAvg,
      previousFullMonth,
      projection,
    },
    clients: { current: clientsIn(cur), previous: clientsIn(prev) },
    groups,
    usage: {
      current: usageCur,
      previous: usagePrev,
      currentFixo: fixoCur,
      previousFixo: fixoPrev,
      revPerHour,
    },
    fixed: { weeklyHoursBefore, weeklyHoursNow, lost, added },
    absences: { current: absCur, previous: absPrev, clients: absenceClients },
    calendar: {
      current: calCur,
      previous: calPrev,
      expectedCurrent,
      expectedPrevious,
      weekendCurrent: wkCur,
      weekendPrevious: wkPrev,
    },
    factors,
    headline,
  };
}

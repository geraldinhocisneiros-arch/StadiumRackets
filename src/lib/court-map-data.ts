// Carregamento dos dados do mapa de quadras (staff) compartilhado entre o
// mapa (/mapa) e o Modo TV (/mapa/tv). Os dois tinham cada um a sua consulta
// e divergiam — a TV não mostrava selo de presença (V/F/C), "$" de pago nem
// presença nas locações "movidas do fixo". Mora aqui pra TV mostrar
// exatamente o mesmo que o mapa: qualquer ajuste na consulta vale pros dois.
import { supabase } from "@/integrations/supabase/client";
import {
  isMovedFromFixedBooking,
  weekdayOfISO,
  type Booking,
  type FixedSchedule,
} from "./court-map";
import type { PriceBand } from "./pricing";
import type { AttendanceRow } from "@/components/ScheduleAttendanceDialog";
import type { AvailabilityOverride } from "@/components/AvailabilityOverrideDialog";

// Parseia court/horário ORIGINAIS de dentro de notes = "Movido do fixo
// (Q2 (PB1) 07:00–08:00)" — courtNoteLabel() sempre intercala um
// sufixo tipo "(Tênis)"/"(PB1)" entre o número da quadra e o horário, então o
// grupo "(?:\s*\([^)]*\))?" cobre esse sufixo opcional. Sem ele (versão
// anterior era "Q(\d+)[^\s]*\s..."), a regex nunca casava com esse sufixo
// no meio e retornava null sempre — cada lugar que dependia do match caía
// no fallback ou simplesmente pulava o registro, quebrando silenciosamente
// a divisão de cobrança de uma quadra dividida movida (reportado: "os 2
// vieram" não aparecia pra dividir com quem também tinha sido movido).
export const MOVED_FROM_FIXED_NOTES_RE =
  /Movido do fixo \(Q(\d+)(?:\s*\([^)]*\))?\s+(\d{2}:\d{2})[–-](\d{2}:\d{2})\)/;

// Tabelas cuja mudança altera o que o mapa mostra — o mapa e a TV
// recarregam (realtime) quando qualquer uma delas muda.
export const COURT_MAP_LIVE_TABLES = [
  "court_bookings",
  "court_booking_participants",
  "client_schedules",
  "client_schedule_exceptions",
  "client_schedule_day_notes",
  "client_schedule_attendance",
  "court_availability_overrides",
  "payments",
] as const;

export interface CourtMapExceptionRow {
  id: string;
  client_schedule_id: string;
  reason: string | null;
  start_time: string | null;
  end_time: string | null;
  exception_date: string;
  range_end: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface CourtMapData {
  bookings: Booking[];
  fixed: FixedSchedule[];
  priceBands: PriceBand[];
  availOverrides: AvailabilityOverride[];
  attendanceRows: AttendanceRow[];
  paidBookingIds: Set<string>;
  // Locações pagas online (Mercado Pago) — pintadas de amarelo no mapa.
  onlinePaidBookingIds: Set<string>;
  exceptions: CourtMapExceptionRow[];
  // true se alguma consulta falhou — os dados vêm incompletos (a TV prefere
  // manter o que já está em tela a mostrar quadras "vazias" do nada).
  failed: boolean;
}

// Colunas da locação como o mapa mostra (cliente, professor e cor
// da categoria). Usado também no insert da nova locação, pra ela já voltar
// pronta pra entrar no mapa sem esperar a recarga completa.
export const COURT_MAP_BOOKING_SELECT =
  "*, clients!client_id(id, full_name), teachers(id, name, map_color_as_avulsa), client_categories:category_id(name, color)";

export type CourtMapBookingRow = Booking & {
  client_categories?: { name: string; color: string | null } | null;
};

/** Linha de court_bookings (com COURT_MAP_BOOKING_SELECT) → Booking do mapa. */
export function toCourtMapBooking(
  b: CourtMapBookingRow,
  participants: { client_id: string; full_name: string }[] = [],
): Booking {
  return {
    ...b,
    category_name: b.client_categories?.name ?? null,
    category_color: b.client_categories?.color ?? null,
    participants,
  };
}

export async function fetchCourtMapData(date: string): Promise<CourtMapData> {
  const weekday = weekdayOfISO(date);
  const [bRes, sRes, pRes, oRes] = await Promise.all([
    supabase.from("court_bookings").select(COURT_MAP_BOOKING_SELECT).eq("booking_date", date),
    supabase
      .from("client_schedules")
      .select(
        "*, clients!client_id(id, full_name), teachers(id, name)",
      )
      .eq("weekday", weekday)
      .or(`valid_from.is.null,valid_from.lte.${date}`)
      .or(`valid_until.is.null,valid_until.gte.${date}`),
    supabase
      .from("price_table")
      .select(
        "id, categories, courts, weekday, start_time, end_time, price_per_hour, starts_on, ends_on, discount_percent",
      )
      .eq("weekday", weekday),
    supabase
      .from("court_availability_overrides")
      .select("id, court, availability_date, start_time, end_time, hourly_price, notes")
      .eq("availability_date", date)
      .eq("active", true)
      .is("cancelled_at", null),
  ]);

  const bookingRows = (bRes.data ?? []) as unknown as CourtMapBookingRow[];
  const bookingIds = bookingRows.map((b) => b.id);
  const scheds = (sRes.data ?? []) as FixedSchedule[];
  const scheduleIds = scheds.map((s) => s.id);

  type Res = { data: unknown; error?: unknown };
  const empty: Res = { data: [], error: null };

  const [partRes, excRes, attRes, payRes, dayNotesRes] = (await Promise.all([
    bookingIds.length
      ? supabase
          .from("court_booking_participants")
          .select("booking_id, client_id, clients(full_name)")
          .in("booking_id", bookingIds)
      : Promise.resolve(empty),
    scheduleIds.length
      ? supabase
          .from("client_schedule_exceptions")
          .select(
            "id, client_schedule_id, reason, start_time, end_time, exception_date, range_end, created_by, created_at",
          )
          .lte("exception_date", date)
          .or(`range_end.gte.${date},and(range_end.is.null,exception_date.eq.${date})`)
          .in("client_schedule_id", scheduleIds)
      : Promise.resolve(empty),
    scheduleIds.length
      ? supabase
          .from("client_schedule_attendance")
          .select("id, client_schedule_id, attendance_date, status, payment_id, amount")
          .eq("attendance_date", date)
          .in("client_schedule_id", scheduleIds)
      : Promise.resolve(empty),
    bookingIds.length
      ? supabase.from("payments").select("booking_id, method").in("booking_id", bookingIds)
      : Promise.resolve(empty),
    scheduleIds.length
      ? supabase
          .from("client_schedule_day_notes")
          .select("client_schedule_id, notes")
          .eq("note_date", date)
          .in("client_schedule_id", scheduleIds)
      : Promise.resolve(empty),
  ])) as Res[];

  const failed = [bRes, sRes, pRes, oRes, partRes, excRes, attRes, payRes].some(
    (r) => !!r.error,
  );

  const participantsByBooking = new Map<string, { client_id: string; full_name: string }[]>();
  for (const p of (partRes.data ?? []) as Array<{
    booking_id: string;
    client_id: string;
    clients: { full_name: string } | { full_name: string }[] | null;
  }>) {
    const arr = participantsByBooking.get(p.booking_id) ?? [];
    const cli = Array.isArray(p.clients) ? p.clients[0] : p.clients;
    arr.push({ client_id: p.client_id, full_name: cli?.full_name ?? "—" });
    participantsByBooking.set(p.booking_id, arr);
  }
  const bookings: Booking[] = bookingRows.map((b) =>
    toCourtMapBooking(b, participantsByBooking.get(b.id) ?? []),
  );

  const exceptions = (excRes.data ?? []) as CourtMapExceptionRow[];
  const excByScheduleId = new Map<string, CourtMapExceptionRow[]>();
  for (const e of exceptions) {
    const arr = excByScheduleId.get(e.client_schedule_id) ?? [];
    arr.push(e);
    excByScheduleId.set(e.client_schedule_id, arr);
  }
  // Observação do dia é complementar: se a consulta falhar, o mapa segue
  // sem ela (não entra em `failed`).
  const dayNoteBySched = new Map<string, string>();
  for (const n of (dayNotesRes.data ?? []) as Array<{ client_schedule_id: string; notes: string }>) {
    dayNoteBySched.set(n.client_schedule_id, n.notes);
  }
  const fixed = scheds.map((s) => {
    return {
      ...s,
      day_note: dayNoteBySched.get(s.id) ?? null,
      exceptions: (excByScheduleId.get(s.id) ?? []).map((e) => ({
        id: e.id,
        start_time: e.start_time,
        end_time: e.end_time,
        reason: e.reason,
        created_by: e.created_by,
        created_at: e.created_at,
      })),
    };
  });

  const payRows = (payRes.data ?? []) as Array<{ booking_id: string | null; method: string | null }>;
  return {
    bookings,
    fixed,
    priceBands: (pRes.data ?? []) as unknown as PriceBand[],
    availOverrides: (oRes.data ?? []) as AvailabilityOverride[],
    attendanceRows: (attRes.data ?? []) as AttendanceRow[],
    paidBookingIds: new Set(
      payRows.map((p) => p.booking_id).filter((id): id is string => !!id),
    ),
    onlinePaidBookingIds: new Set(
      payRows
        .filter((p) => p.method === "mercadopago_pix" || p.method === "mercadopago_cartao")
        .map((p) => p.booking_id)
        .filter((id): id is string => !!id),
    ),
    exceptions,
    failed,
  };
}

// Locação "movida do fixo" → client_schedule original (mesmo cliente/weekday).
// Se houver múltiplos fixos do cliente no dia, prioriza o que casa com
// quadra/horário originais parseados de `notes`.
export function computeMovedFixedScheduleByBookingId(
  bookings: Booking[],
  fixed: FixedSchedule[],
  date: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  const wd = weekdayOfISO(date);
  const candidatesByClient = new Map<string, FixedSchedule[]>();
  for (const s of fixed) {
    if (s.weekday !== wd || !s.client_id) continue;
    const list = candidatesByClient.get(s.client_id) ?? [];
    list.push(s);
    candidatesByClient.set(s.client_id, list);
  }
  for (const b of bookings) {
    if (b.cancelled_at) continue;
    if (!isMovedFromFixedBooking(b) || !b.client_id) continue;
    const list = candidatesByClient.get(b.client_id);
    if (!list || list.length === 0) continue;
    let match: FixedSchedule | null = null;
    const m = typeof b.notes === "string" ? b.notes.match(MOVED_FROM_FIXED_NOTES_RE) : null;
    if (m) {
      const [, courtStr, startStr, endStr] = m;
      match =
        list.find(
          (s) =>
            s.court === Number(courtStr) &&
            s.start_time.slice(0, 5) === startStr &&
            s.end_time.slice(0, 5) === endStr,
        ) ?? null;
    }
    map[b.id] = (match ?? list[0]).id;
  }
  return map;
}

export function computeAttendanceByScheduleId(
  rows: AttendanceRow[],
): Record<string, { status: string }> {
  const map: Record<string, { status: string }> = {};
  for (const a of rows) map[a.client_schedule_id] = { status: a.status };
  return map;
}

export function computeAttendanceByBookingId(
  rows: AttendanceRow[],
  movedFixedScheduleByBookingId: Record<string, string>,
): Record<string, { status: string }> {
  const bySchedule = new Map<string, { status: string }>();
  for (const a of rows) bySchedule.set(a.client_schedule_id, { status: a.status });
  const map: Record<string, { status: string }> = {};
  for (const [bookingId, scheduleId] of Object.entries(movedFixedScheduleByBookingId)) {
    const st = bySchedule.get(scheduleId);
    if (st) map[bookingId] = st;
  }
  return map;
}

export interface WaitlistEntry {
  court: number;
  start: string;
  end: string;
  cnt: number;
}

// Contadores da lista de espera do dia (staff). null = falhou.
export async function fetchWaitlistEntries(date: string): Promise<WaitlistEntry[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("staff_get_waitlist_counts_for_date", {
    _date: date,
  });
  if (error) return null;
  return (
    (data ?? []) as Array<{
      court: number | null;
      start_time: string;
      end_time: string;
      cnt: number;
    }>
  ).map((r) => ({
    court: r.court ?? 0,
    start: r.start_time.slice(0, 5),
    end: r.end_time.slice(0, 5),
    cnt: Number(r.cnt),
  }));
}

// Fila é por HORÁRIO — ignora a quadra. Numa célula de várias horas, um
// pedido de só uma parte também conta; `windows` guarda a janela real de
// cada match pra o selo não dar a entender que o pedido é pro horário todo.
export function waitlistLookupFor(entries: WaitlistEntry[]) {
  return (_court: number, start: string, end: string) => {
    let count = 0;
    const windows: { start: string; end: string; cnt: number }[] = [];
    for (const e of entries) {
      if (e.start < end && e.end > start) {
        count += e.cnt;
        windows.push({ start: e.start, end: e.end, cnt: e.cnt });
      }
    }
    return { count, mine: false, windows };
  };
}

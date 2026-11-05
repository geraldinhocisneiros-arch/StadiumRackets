import { fetchAll } from "@/lib/fetchAll";
import { todayISO } from "@/lib/format";
import { isManutencaoClientName } from "@/lib/court-map";
import type { PriceBand } from "@/lib/pricing";
import type { IntelData } from "@/lib/intelligence";

// Carrega tudo que os cálculos de Inteligência precisam (aba Inteligência e
// sugestões da aba Reuniões).
export async function loadIntelData(): Promise<IntelData> {
  const [
    categories,
    clients,
    payments,
    bookings,
    participants,
    schedules,
    exceptions,
    attendance,
    priceBands,
    waitlist,
    fixedWaitlist,
    failures,
    teachers,
  ] = await Promise.all([
    fetchAll<IntelData["categories"][number]>("client_categories", "id, name"),
    fetchAll<IntelData["clients"][number]>(
      "clients",
      "id, full_name, phone, category_id, active, created_at, teacher_id",
    ),
    fetchAll<IntelData["payments"][number]>(
      "payments",
      "id, client_id, category_id, amount, passthrough_amount, paid_at, received",
    ),
    fetchAll<IntelData["bookings"][number]>(
      "court_bookings",
      "id, booking_date, start_time, end_time, court, client_id, category_id, source, teacher_id, cancelled_at",
      { build: (q) => q.is("cancelled_at", null) },
    ),
    fetchAll<IntelData["participants"][number]>(
      "court_booking_participants",
      "booking_id, client_id",
    ),
    fetchAll<IntelData["schedules"][number]>(
      "client_schedules",
      "id, client_id, weekday, start_time, end_time, court, valid_from, valid_until, teacher_id, created_at",
    ),
    fetchAll<IntelData["exceptions"][number]>(
      "client_schedule_exceptions",
      "client_schedule_id, exception_date, range_end, start_time, end_time, reason",
    ),
    fetchAll<IntelData["attendance"][number]>(
      "client_schedule_attendance",
      "client_schedule_id, attendance_date, status",
    ),
    fetchAll<PriceBand>(
      "price_table",
      "id, categories, courts, weekday, start_time, end_time, price_per_hour, starts_on, ends_on, discount_percent",
    ),
    fetchAll<IntelData["waitlist"][number]>(
      "court_waitlist",
      "desired_date, start_time, status, created_at",
    ),
    fetchAll<IntelData["fixedWaitlist"][number]>(
      "fixed_court_waitlist",
      "desired_weekday, start_time, status, created_at",
    ),
    fetchAll<IntelData["failures"][number]>(
      "portal_booking_failures",
      "created_at, booking_date, start_hour, stage",
    ).catch(() => []),
    fetchAll<IntelData["teachers"][number]>("teachers", "id, name"),
  ]);
  return {
    categories,
    clients,
    payments,
    bookings,
    participants,
    schedules,
    exceptions,
    attendance,
    priceBands,
    waitlist,
    fixedWaitlist,
    failures,
    teachers,
    maintenanceClientIds: new Set(
      clients.filter((c) => isManutencaoClientName(c.full_name)).map((c) => c.id),
    ),
    today: todayISO(),
  };
}

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { courtShort } from "@/lib/court-map";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toRecifeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00-03:00`).getDay(),
  };
}

export const Route = createFileRoute("/api/public/hooks/booking-confirmation-reminders")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const now = new Date();
          const targetMs = now.getTime() + 4 * 60 * 60 * 1000;
          const startMs = targetMs - 15 * 60 * 1000;
          const endMs = targetMs + 15 * 60 * 1000;
          const startTarget = new Date(startMs);
          const endTarget = new Date(endMs);

          const startParts = toRecifeParts(startTarget);
          const endParts = toRecifeParts(endTarget);
          const targetDate = startParts.date; // assume mesma data para intervalo de 30min
          const targetWeekday = startParts.weekday;

          const notifications: Array<Record<string, unknown>> = [];
          const confirmationRows: Array<{
            booking_id?: string;
            schedule_id?: string;
            booking_date: string;
          }> = [];

          // 1. Reservas avulsas
          const { data: bookings } = await supabaseAdmin
            .from("court_bookings")
            .select("id, client_id, court, booking_date, start_time, end_time")
            .eq("booking_date", targetDate)
            .is("cancelled_at", null)
            .not("client_id", "is", null)
            .gte("start_time", startParts.time)
            .lte("start_time", endParts.time);

          for (const b of bookings ?? []) {
            const { data: existing } = await supabaseAdmin
              .from("booking_confirmations")
              .select("id")
              .eq("booking_id", b.id)
              .maybeSingle();
            if (existing) continue;

            // Verifica se cliente tem portal
            const { data: portal } = await supabaseAdmin
              .from("client_portal_users")
              .select("id")
              .eq("client_id", b.client_id!)
              .limit(1)
              .maybeSingle();
            if (!portal) continue;

            const body =
              `${WEEKDAYS[targetWeekday]}, ${b.booking_date.slice(8, 10)}/${b.booking_date.slice(5, 7)}` +
              ` às ${String(b.start_time).slice(0, 5)} — ${courtShort(b.court)}. Você vem?`;

            notifications.push({
              kind: "booking_confirm_4h",
              client_id: b.client_id!,
              title: "Confirmar presença",
              body,
              requires_ack: true,
              metadata: {
                source: "avulsa",
                booking_id: b.id,
                booking_date: b.booking_date,
                court: b.court,
                start_time: b.start_time,
                end_time: b.end_time,
              },
            });
            confirmationRows.push({ booking_id: b.id, booking_date: b.booking_date });
          }

          // 2. Horários fixos do dia
          const { data: schedules } = await supabaseAdmin
            .from("client_schedules")
            .select("id, client_id, court, start_time, end_time, weekday")
            .eq("weekday", targetWeekday)
            .gte("start_time", startParts.time)
            .lte("start_time", endParts.time)
            .not("client_id", "is", null)
            .or(`valid_from.is.null,valid_from.lte.${targetDate}`)
            .or(`valid_until.is.null,valid_until.gte.${targetDate}`);

          for (const s of schedules ?? []) {
            // Verifica exceção para a data
            const { data: ex } = await supabaseAdmin
              .from("client_schedule_exceptions")
              .select("id, start_time, end_time")
              .eq("client_schedule_id", s.id)
              .eq("exception_date", targetDate);
            const fullDayEx = (ex ?? []).some((e) => !e.start_time && !e.end_time);
            if (fullDayEx) continue;

            const { data: existing } = await supabaseAdmin
              .from("booking_confirmations")
              .select("id")
              .eq("schedule_id", s.id)
              .eq("booking_date", targetDate)
              .maybeSingle();
            if (existing) continue;

            const { data: portal } = await supabaseAdmin
              .from("client_portal_users")
              .select("id")
              .eq("client_id", s.client_id!)
              .limit(1)
              .maybeSingle();
            if (!portal) continue;

            const body =
              `Hoje ${targetDate.slice(8, 10)}/${targetDate.slice(5, 7)}` +
              ` às ${String(s.start_time).slice(0, 5)} — ${s.court ? courtShort(Number(s.court)) : "quadra"}. Você vem?`;

            notifications.push({
              kind: "booking_confirm_4h",
              client_id: s.client_id!,
              title: "Confirmar presença",
              body,
              requires_ack: true,
              metadata: {
                source: "fixo",
                schedule_id: s.id,
                booking_date: targetDate,
                court: s.court,
                start_time: s.start_time,
                end_time: s.end_time,
              },
            });
            confirmationRows.push({ schedule_id: s.id, booking_date: targetDate });
          }

          if (notifications.length > 0) {
            const admin = supabaseAdmin as unknown as {
              from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: unknown }> };
            };
            await admin.from("app_notifications").insert(notifications);
            await admin.from("booking_confirmations").insert(confirmationRows);
          }

          return Response.json({
            success: true,
            date: targetDate,
            time_range: `${startParts.time}-${endParts.time}`,
            sent: notifications.length,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ success: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

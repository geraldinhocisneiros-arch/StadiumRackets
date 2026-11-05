import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { courtShort } from "@/lib/court-map";

interface RespondInput {
  notificationId: string;
  action: "confirm" | "cancel";
}

export const respondBookingConfirmation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RespondInput) => {
    if (!data.notificationId || (data.action !== "confirm" && data.action !== "cancel")) {
      throw new Error("Parâmetros inválidos");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: notif, error: nErr } = await supabase
      .from("app_notifications")
      .select("id, kind, client_id, metadata, read_at")
      .eq("id", data.notificationId)
      .maybeSingle();
    if (nErr) throw new Error(nErr.message);
    if (!notif) throw new Error("Notificação não encontrada");
    if (notif.kind !== "booking_confirm_4h") {
      throw new Error("Notificação não é de confirmação");
    }

    const meta = (notif.metadata ?? {}) as {
      booking_id?: string;
      schedule_id?: string;
      booking_date?: string;
      source?: string;
      court?: number;
      start_time?: string;
      end_time?: string;
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const clientName = notif.client_id
      ? (
          await supabaseAdmin
            .from("clients")
            .select("full_name")
            .eq("id", notif.client_id)
            .maybeSingle()
        ).data?.full_name ?? "Cliente"
      : "Cliente";

    const nowIso = new Date().toISOString();
    const slotDesc = `${meta.court ? courtShort(Number(meta.court)) : "Quadra"} ${String(meta.start_time ?? "").slice(0, 5)} (${
      meta.booking_date ?? ""
    })`;

    if (data.action === "confirm") {
      if (meta.booking_id) {
        await supabaseAdmin
          .from("booking_confirmations")
          .update({ status: "confirmed", responded_at: nowIso })
          .eq("booking_id", meta.booking_id);
      } else if (meta.schedule_id && meta.booking_date) {
        await supabaseAdmin
          .from("booking_confirmations")
          .update({ status: "confirmed", responded_at: nowIso })
          .eq("schedule_id", meta.schedule_id)
          .eq("booking_date", meta.booking_date);
      }
      await supabaseAdmin
        .from("app_notifications")
        .update({ read_at: nowIso })
        .eq("id", data.notificationId);

      return { ok: true, action: "confirm" as const };
    }

    // cancel
    if (meta.source === "avulsa" && meta.booking_id) {
      const { error: uErr } = await supabaseAdmin
        .from("court_bookings")
        .update({
          cancelled_at: nowIso,
          cancelled_by: userId,
          cancel_reason: "Cliente cancelou (confirmação 4h)",
        })
        .eq("id", meta.booking_id);
      if (uErr) throw new Error(uErr.message);
    } else if (meta.schedule_id && meta.booking_date) {
      // Cria exceção só para aquela data (aula continua nas outras semanas)
      const { error: exErr } = await supabaseAdmin
        .from("client_schedule_exceptions")
        .insert({
          client_schedule_id: meta.schedule_id,
          exception_date: meta.booking_date,
          reason: "Cliente cancelou (confirmação 4h)",
        });
      if (exErr && !exErr.message.includes("duplicate")) {
        throw new Error(exErr.message);
      }
    }

    if (meta.booking_id) {
      await supabaseAdmin
        .from("booking_confirmations")
        .update({ status: "cancelled", responded_at: nowIso })
        .eq("booking_id", meta.booking_id);
    } else if (meta.schedule_id && meta.booking_date) {
      await supabaseAdmin
        .from("booking_confirmations")
        .update({ status: "cancelled", responded_at: nowIso })
        .eq("schedule_id", meta.schedule_id)
        .eq("booking_date", meta.booking_date);
    }

    await supabaseAdmin
      .from("app_notifications")
      .update({ read_at: nowIso })
      .eq("id", data.notificationId);

    // Avisa recepção
    await supabaseAdmin.from("app_notifications").insert({
      kind: "client_cancelled_4h",
      client_id: notif.client_id,
      title: "Cliente cancelou presença",
      body: `${clientName} cancelou ${slotDesc}. Quadra liberada.`,
      requires_ack: true,
    });

    return { ok: true, action: "cancel" as const };
  });

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcOnlinePrice, type PriceBand } from "@/lib/pricing";
import { getServerSecret } from "@/lib/server-env";
import { normalizeCategoryName } from "@/lib/category";

interface CreatePreferenceInput {
  bookingId: string;
  clientId: string;
}

/**
 * Cria a pré-reserva paga (portal_create_paid_booking_hold) já com
 * client_id preenchido, e cria a "preference" no Mercado Pago (Checkout
 * Pro — cobre Pix e cartão numa única integração hospedada, sem
 * precisarmos tokenizar cartão na nossa própria tela). O valor é
 * calculado aqui, no servidor, a partir da tabela de preços — nunca
 * confiamos num valor vindo do cliente.
 */
export const createCourtBookingPaymentPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreatePreferenceInput) => {
    if (!data.bookingId) throw new Error("bookingId é obrigatório");
    if (!data.clientId) throw new Error("clientId é obrigatório");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accessToken = await getServerSecret("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      throw new Error("Pagamento online ainda não configurado (MERCADOPAGO_ACCESS_TOKEN ausente).");
    }

    // Um mesmo login pode ter acesso a mais de um cliente (conta de
    // família) — por isso o client_id vem explícito do front (a conta
    // ativa selecionada na tela) em vez de resolvido só pelo user_id, e é
    // validado aqui contra o vínculo real antes de prosseguir.
    const { data: portalUser } = await supabase
      .from("client_portal_users")
      .select("client_id")
      .eq("user_id", userId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!portalUser?.client_id) throw new Error("Usuário sem vínculo de cliente.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: booking } = await supabaseAdmin
      .from("court_bookings")
      .select("id, court, booking_date, start_time, end_time, client_id, cancelled_at, hold_expires_at")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (!booking) throw new Error("Pré-reserva não encontrada.");
    if (booking.client_id !== portalUser.client_id) {
      throw new Error("Esta pré-reserva não pertence a este cliente.");
    }
    if (booking.cancelled_at) throw new Error("Esta pré-reserva expirou. Escolha o horário novamente.");
    if (!booking.hold_expires_at || new Date(booking.hold_expires_at).getTime() <= Date.now()) {
      throw new Error("Esta pré-reserva expirou. Escolha o horário novamente.");
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("full_name, email, category_id")
      .eq("id", portalUser.client_id)
      .maybeSingle();
    if (!client) throw new Error("Cliente não encontrado.");

    const weekday = new Date(`${booking.booking_date}T12:00:00-03:00`).getDay();
    // "*" em vez de lista de colunas: inclui discount_percent (promoção
    // por percentual) sem quebrar a cobrança caso a coluna ainda não exista.
    const { data: priceRows } = await supabaseAdmin
      .from("price_table")
      .select("*")
      .eq("weekday", weekday);

    // Cliente sem categoria paga a promoção do avulso (ver calcOnlinePrice).
    let avulsoCategoryId: string | null = null;
    if (!client.category_id) {
      const { data: cats } = await supabaseAdmin.from("client_categories").select("id, name");
      avulsoCategoryId =
        ((cats ?? []) as Array<{ id: string; name: string }>).find(
          (c) => normalizeCategoryName(c.name) === "avulso",
        )?.id ?? null;
    }

    const calc = calcOnlinePrice({
      bands: (priceRows ?? []) as PriceBand[],
      weekday,
      startTime: booking.start_time,
      endTime: booking.end_time,
      categoryId: client.category_id,
      court: booking.court,
      date: booking.booking_date,
      // Único fluxo de cobrança que aplica preço promocional: compra
      // online paga pelo cliente no Checkout do Mercado Pago.
      avulsoCategoryId,
    });
    const amount = calc?.total ?? 0;
    if (!calc?.matched || amount <= 0) {
      throw new Error("Não foi possível calcular o valor deste horário. Fale com a recepção.");
    }

    const { data: onlinePayment, error: opErr } = await supabaseAdmin
      .from("online_payments")
      .insert({
        booking_id: booking.id,
        client_id: portalUser.client_id,
        amount,
        status: "pending",
      })
      .select("id")
      .single();
    if (opErr || !onlinePayment) throw new Error(opErr?.message ?? "Falha ao registrar pagamento.");

    const request = getRequest();
    const origin = request?.headers.get("origin") ?? new URL(request?.url ?? "http://localhost").origin;
    const startLabel = String(booking.start_time).slice(0, 5);
    const endLabel = String(booking.end_time).slice(0, 5);

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        // Evita registrar duas preferences pra mesma pré-reserva em cliques duplicados.
        "X-Idempotency-Key": onlinePayment.id,
      },
      body: JSON.stringify({
        items: [
          {
            title: `Quadra ${booking.court} — ${booking.booking_date} ${startLabel}-${endLabel}`,
            quantity: 1,
            unit_price: amount,
            currency_id: "BRL",
          },
        ],
        payer: {
          name: client.full_name,
          email: client.email || undefined,
        },
        external_reference: onlinePayment.id,
        notification_url: `${origin}/api/public/webhooks/mercadopago`,
        back_urls: {
          success: `${origin}/portal/reservar?payment=success`,
          failure: `${origin}/portal/reservar?payment=failure`,
          pending: `${origin}/portal/reservar?payment=pending`,
        },
        auto_return: "approved",
      }),
    });

    if (!mpRes.ok) {
      const errBody = await mpRes.text().catch(() => "");
      throw new Error(`Mercado Pago recusou a criação do pagamento (${mpRes.status}): ${errBody.slice(0, 300)}`);
    }
    const pref = (await mpRes.json()) as { id: string; init_point: string };

    await supabaseAdmin
      .from("online_payments")
      .update({ mp_preference_id: pref.id })
      .eq("id", onlinePayment.id);

    return { onlinePaymentId: onlinePayment.id, initPoint: pref.init_point, amount };
  });

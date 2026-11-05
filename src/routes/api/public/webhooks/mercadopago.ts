import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getServerSecret } from "@/lib/server-env";
import { courtShort } from "@/lib/court-map";

/**
 * Verifica a assinatura do webhook do Mercado Pago (header x-signature,
 * formato "ts=<timestamp>,v1=<hash>"). Sem isso, qualquer um que
 * descobrisse esta URL poderia forjar uma notificação de "pagamento
 * aprovado" e confirmar reservas de graça. Fórmula oficial do MP:
 * HMAC-SHA256("id:<dataId>;request-id:<x-request-id>;ts:<ts>;", secret).
 */
function verifyMercadoPagoSignature(
  signatureHeader: string | null,
  requestId: string | null,
  dataId: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !dataId) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.split("=").map((s) => s.trim());
      return [k, v];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface MpPayment {
  id: number;
  status: string;
  status_detail: string;
  transaction_amount: number;
  payment_method_id: string;
  external_reference: string | null;
}

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const accessToken = await getServerSecret("MERCADOPAGO_ACCESS_TOKEN");
          const webhookSecret = await getServerSecret("MERCADOPAGO_WEBHOOK_SECRET");
          if (!accessToken || !webhookSecret) {
            console.error("[mercadopago webhook] MERCADOPAGO_ACCESS_TOKEN/MERCADOPAGO_WEBHOOK_SECRET ausente");
            return Response.json({ ok: false, error: "not configured" }, { status: 500 });
          }

          const url = new URL(request.url);
          const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
          const topic = url.searchParams.get("type") ?? url.searchParams.get("topic");

          const signatureOk = verifyMercadoPagoSignature(
            request.headers.get("x-signature"),
            request.headers.get("x-request-id"),
            dataId,
            webhookSecret,
          );
          if (!signatureOk) {
            console.warn("[mercadopago webhook] assinatura inválida", { dataId, topic });
            return Response.json({ ok: false, error: "invalid signature" }, { status: 401 });
          }

          if (topic !== "payment" || !dataId) {
            // Outros tipos de evento (merchant_order, etc.) — nada a fazer.
            return Response.json({ ok: true, skipped: true });
          }

          // Nunca confia no corpo da notificação pro status — sempre busca o
          // pagamento de verdade na API do Mercado Pago com nosso token.
          const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!mpRes.ok) {
            console.error("[mercadopago webhook] falha ao buscar pagamento", dataId, mpRes.status);
            return Response.json({ ok: false, error: "payment lookup failed" }, { status: 502 });
          }
          const payment = (await mpRes.json()) as MpPayment;

          const onlinePaymentId = payment.external_reference;
          if (!onlinePaymentId) {
            return Response.json({ ok: true, skipped: "no external_reference" });
          }

          const { data: onlinePayment } = await supabaseAdmin
            .from("online_payments")
            .select("id, booking_id, client_id, amount, status")
            .eq("id", onlinePaymentId)
            .maybeSingle();
          if (!onlinePayment) {
            return Response.json({ ok: true, skipped: "online_payment not found" });
          }

          // Idempotência: notificação repetida pro mesmo pagamento já processado.
          if (onlinePayment.status === "approved" || onlinePayment.status === "approved_conflict") {
            return Response.json({ ok: true, already: onlinePayment.status });
          }

          if (payment.status === "approved") {
            const { data: booking } = await supabaseAdmin
              .from("court_bookings")
              .select("id, court, booking_date, start_time, end_time, client_id, notes")
              .eq("id", onlinePayment.booking_id)
              .maybeSingle();
            if (!booking) {
              return Response.json({ ok: true, skipped: "booking not found" });
            }

            // Confere se outra reserva (de outra pessoa) já ocupou esse mesmo
            // horário enquanto o pagamento estava em andamento — não deve
            // acontecer dentro da janela de 15 min, mas se acontecer, não
            // confirma por cima: sinaliza pra equipe resolver manualmente
            // (reembolso/realocação) em vez de duplicar a quadra.
            const { data: conflict } = await supabaseAdmin
              .from("court_bookings")
              .select("id")
              .eq("court", booking.court)
              .eq("booking_date", booking.booking_date)
              .eq("start_time", booking.start_time)
              .is("cancelled_at", null)
              .neq("id", booking.id)
              .maybeSingle();

            if (conflict) {
              await supabaseAdmin
                .from("online_payments")
                .update({
                  status: "approved_conflict",
                  mp_payment_id: String(payment.id),
                  mp_status_detail: payment.status_detail,
                })
                .eq("id", onlinePayment.id);

              await supabaseAdmin.from("app_notifications").insert({
                kind: "online_payment_conflict",
                client_id: booking.client_id,
                title: "Pagamento online recebido, mas horário já ocupado",
                body:
                  `Cliente pagou ${courtShort(booking.court)} ${String(booking.start_time).slice(0, 5)} ` +
                  `(${booking.booking_date}) mas o horário foi ocupado por outra reserva antes da ` +
                  `confirmação. Resolva manualmente (reembolso ou realocar o cliente).`,
                requires_ack: true,
              });

              return Response.json({ ok: true, conflict: true });
            }

            const { data: client } = await supabaseAdmin
              .from("clients")
              .select("category_id")
              .eq("id", booking.client_id!)
              .maybeSingle();

            const method: "mercadopago_pix" | "mercadopago_cartao" =
              payment.payment_method_id === "pix" ? "mercadopago_pix" : "mercadopago_cartao";

            const { data: paymentRow, error: payErr } = await supabaseAdmin
              .from("payments")
              .insert({
                // Vincula à locação: é isso que faz o mapa mostrar o selo "$"
                // e pintar a célula de amarelo (pago online).
                booking_id: booking.id,
                client_id: booking.client_id,
                category_id: client?.category_id ?? null,
                court: booking.court,
                start_time: booking.start_time,
                end_time: booking.end_time,
                amount: payment.transaction_amount ?? onlinePayment.amount,
                method,
                received: true,
                to_account: true,
                account_direction: "credito",
                notes: `Pagamento online via Mercado Pago (ID ${payment.id}) — reserva quadra ${booking.court}.`,
              })
              .select("id")
              .single();
            if (payErr) {
              console.error("[mercadopago webhook] falha ao registrar payments", payErr);
              return Response.json({ ok: false, error: payErr.message }, { status: 500 });
            }

            const paidDay = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
            const paidNote = `Pago via Mercado Pago dia ${paidDay}`;
            await supabaseAdmin
              .from("court_bookings")
              .update({
                cancelled_at: null,
                hold_expires_at: null,
                notes: booking.notes ? `${booking.notes}\n${paidNote}` : paidNote,
              })
              .eq("id", booking.id);

            // A pré-reserva (client_id já preenchido) não dispara o aviso
            // de "Reserva confirmada" enquanto está em hold — só agora,
            // com o pagamento de verdade aprovado, é que a reserva vale.
            const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
            const wd = new Date(`${booking.booking_date}T12:00:00-03:00`).getDay();
            await supabaseAdmin.from("app_notifications").insert({
              kind: "booking_created",
              client_id: booking.client_id,
              title: "Reserva confirmada",
              body:
                `${weekdays[wd]}, ${booking.booking_date.slice(8, 10)}/${booking.booking_date.slice(5, 7)} ` +
                `às ${String(booking.start_time).slice(0, 5)} — ${courtShort(booking.court)}`,
              requires_ack: true,
              metadata: { booking_id: booking.id, source: "avulsa" },
            });

            await supabaseAdmin
              .from("online_payments")
              .update({
                status: "approved",
                mp_payment_id: String(payment.id),
                mp_status_detail: payment.status_detail,
                payment_id: paymentRow?.id ?? null,
                confirmed_at: new Date().toISOString(),
              })
              .eq("id", onlinePayment.id);

            return Response.json({ ok: true, confirmed: true });
          }

          if (payment.status === "rejected" || payment.status === "cancelled") {
            await supabaseAdmin
              .from("online_payments")
              .update({
                status: payment.status === "rejected" ? "rejected" : "cancelled",
                mp_payment_id: String(payment.id),
                mp_status_detail: payment.status_detail,
              })
              .eq("id", onlinePayment.id);

            // Libera o horário na hora em vez de esperar o hold expirar sozinho.
            await supabaseAdmin
              .from("court_bookings")
              .update({ cancelled_at: new Date().toISOString() })
              .eq("id", onlinePayment.booking_id)
              .not("hold_expires_at", "is", null);

            return Response.json({ ok: true, status: payment.status });
          }

          // pending / in_process / authorized / etc — só atualiza o status,
          // sem mexer na reserva.
          await supabaseAdmin
            .from("online_payments")
            .update({
              mp_payment_id: String(payment.id),
              mp_status_detail: payment.status_detail,
            })
            .eq("id", onlinePayment.id);

          return Response.json({ ok: true, status: payment.status });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[mercadopago webhook] erro", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});

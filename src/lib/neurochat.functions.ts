import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildMessage,
  callNeurochat,
  normalizePhoneBR,
  type NeurochatMessageType,
  type NeurochatMetadata,
} from "./neurochat.server";

interface Input {
  clientId: string;
  messageType: NeurochatMessageType;
  message?: string | null;
  metadata?: NeurochatMetadata | null;
}

const VALID_TYPES: NeurochatMessageType[] = [
  "reservation_request",
  "booking_cancelled",
  "payment_contact",
  "general_contact",
];

export const sendNeurochatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: Input) => {
    if (!raw || typeof raw !== "object") throw new Error("Payload inválido");
    if (!raw.clientId || typeof raw.clientId !== "string") {
      throw new Error("clientId obrigatório");
    }
    if (!VALID_TYPES.includes(raw.messageType)) {
      throw new Error("messageType inválido");
    }
    return {
      clientId: raw.clientId,
      messageType: raw.messageType,
      message: raw.message ?? null,
      metadata: raw.metadata ?? {},
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, full_name, phone")
      .eq("id", data.clientId)
      .maybeSingle();

    if (clientErr) {
      return {
        ok: false as const,
        status: "FAILED",
        failureReason: `Cliente não encontrado: ${clientErr.message}`,
      };
    }
    if (!client) {
      return {
        ok: false as const,
        status: "FAILED",
        failureReason: "Cliente não encontrado.",
      };
    }

    const phone = normalizePhoneBR(client.phone);
    const firstName = (client.full_name ?? "").split(/\s+/)[0] ?? "";
    const meta: NeurochatMetadata = (data.metadata ?? {}) as NeurochatMetadata;
    const text = buildMessage(data.messageType, firstName, meta, data.message);

    const requestPayload = {
      to: phone,
      text,
      messageType: data.messageType,
      metadata: meta as Record<string, unknown>,
    } as unknown as Record<string, unknown>;

    // Sem telefone: registra falha e retorna, sem chamar API.
    if (!phone) {
      await supabaseAdmin.from("neurochat_message_logs").insert([{
        client_id: data.clientId,
        booking_id: meta.bookingId ?? null,
        message_type: data.messageType,
        phone: client.phone ?? null,
        request_payload: requestPayload as never,
        response_payload: null,
        status: "FAILED",
        failure_reason: "Cliente sem telefone válido cadastrado.",
        created_by: userId,
      }]);
      return {
        ok: false as const,
        status: "FAILED",
        failureReason: "Cliente sem telefone válido cadastrado.",
      };
    }

    const result = await callNeurochat({ to: phone, text });

    await supabaseAdmin.from("neurochat_message_logs").insert([{
      client_id: data.clientId,
      booking_id: meta.bookingId ?? null,
      message_type: data.messageType,
      phone,
      request_payload: requestPayload as never,
      response_payload: (result.responsePayload ?? null) as never,
      external_message_id: result.externalMessageId,
      session_id: result.sessionId,
      status: result.status,
      failure_reason: result.failureReason,
      created_by: userId,
    }]);

    if (!result.ok) {
      return {
        ok: false as const,
        status: result.status,
        failureReason: result.failureReason ?? "Falha ao enviar mensagem.",
      };
    }
    return {
      ok: true as const,
      status: result.status,
      externalMessageId: result.externalMessageId,
    };
  });

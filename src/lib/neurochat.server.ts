// Server-only helpers for the Neurochat / WTS Chat WhatsApp integration.
// This module is imported ONLY from src/lib/neurochat.functions.ts (server fn).
// The Bearer token lives here — never expose to the client.
import { getServerEnv } from "@/lib/server-env";

const NEUROCHAT_ENDPOINT = "https://api.wts.chat/chat/v1/send/text";

export type NeurochatMessageType =
  | "reservation_request"
  | "booking_cancelled"
  | "payment_contact"
  | "general_contact";

export interface NeurochatMetadata {
  bookingId?: string | null;
  court?: number | null;
  date?: string | null; // yyyy-mm-dd
  startTime?: string | null; // HH:MM
  endTime?: string | null; // HH:MM
}

/** Normaliza telefone BR para o formato 55DDDNUMERO (12 ou 13 dígitos). */
export function normalizePhoneBR(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D+/g, "");
  if (!digits) return null;
  let local = digits;
  if (digits.length >= 12 && digits.startsWith("55")) local = digits.slice(2);
  if (local.length !== 10 && local.length !== 11) return null;
  const ddd = local.slice(0, 2);
  if (!/^[1-9][1-9]$/.test(ddd)) return null;
  return `55${local}`;
}

function fmtDateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  return t.slice(0, 5);
}

function slotLines(meta: NeurochatMetadata): string {
  const lines: string[] = [];
  if (meta.court != null) lines.push(`Quadra: ${meta.court}`);
  if (meta.date) lines.push(`Data: ${fmtDateBR(meta.date)}`);
  if (meta.startTime || meta.endTime) {
    lines.push(`Horário: ${fmtTime(meta.startTime)} às ${fmtTime(meta.endTime)}`);
  }
  return lines.join("\n");
}

/** Monta a mensagem padrão pelo tipo. Se `override` for informado, ele prevalece. */
export function buildMessage(
  type: NeurochatMessageType,
  clientFirstName: string,
  meta: NeurochatMetadata,
  override?: string | null,
): string {
  if (override && override.trim()) return override.trim();
  const name = clientFirstName || "";
  const hello = name ? `Olá, ${name}!` : "Olá!";
  const slot = slotLines(meta);
  switch (type) {
    case "reservation_request":
      return `${hello}\n\nRecebemos sua solicitação de reserva:\n\n${slot}\n\nNossa equipe irá verificar e confirmar pelo WhatsApp.`;
    case "booking_cancelled":
      return `${hello}\n\nSua locação foi cancelada:\n\n${slot}\n\nA quadra já foi liberada no sistema.`;
    case "payment_contact":
      return `${hello}\n\nEstamos entrando em contato sobre um pagamento pendente. Se precisar de ajuda, é só responder esta mensagem.`;
    case "general_contact":
      return `${hello}\n\nEstamos entrando em contato pelo Stadium Rackets.`;
  }
}

export interface NeurochatSendResult {
  ok: boolean;
  status: string;
  httpStatus: number;
  externalMessageId: string | null;
  sessionId: string | null;
  failureReason: string | null;
  responsePayload: unknown;
}

/** Faz a chamada HTTP para o Neurochat/WTS. */
export async function callNeurochat(params: {
  to: string;
  text: string;
}): Promise<NeurochatSendResult> {
  const token = getServerEnv("NEUROCHAT_API_TOKEN");
  const from = getServerEnv("NEUROCHAT_FROM_NUMBER");

  if (!token || !from) {
    return {
      ok: false,
      status: "FAILED",
      httpStatus: 0,
      externalMessageId: null,
      sessionId: null,
      failureReason: "NEUROCHAT_API_TOKEN ou NEUROCHAT_FROM_NUMBER não configurado.",
      responsePayload: null,
    };
  }

  const body = { from, to: params.to, text: params.text };
  let httpStatus = 0;
  let raw: string | null = null;
  let parsed: unknown = null;
  try {
    const res = await fetch(NEUROCHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    raw = await res.text();
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      const msg =
        (parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as Record<string, unknown>).message)
          : null) ?? `HTTP ${httpStatus}`;
      return {
        ok: false,
        status: "FAILED",
        httpStatus,
        externalMessageId: null,
        sessionId: null,
        failureReason: msg,
        responsePayload: parsed,
      };
    }
    const obj = (parsed ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      status: (typeof obj.status === "string" ? obj.status : "SENT"),
      httpStatus,
      externalMessageId: typeof obj.id === "string" ? obj.id : null,
      sessionId: typeof obj.sessionId === "string" ? obj.sessionId : null,
      failureReason:
        typeof obj.failedReason === "string" ? obj.failedReason : null,
      responsePayload: parsed,
    };
  } catch (e) {
    return {
      ok: false,
      status: "FAILED",
      httpStatus,
      externalMessageId: null,
      sessionId: null,
      failureReason: e instanceof Error ? e.message : String(e),
      responsePayload: parsed ?? raw,
    };
  }
}

// Registra no banco uma tentativa de reserva recusada no portal, para a
// secretaria consultar na tabela portal_booking_failures quando o cliente reclamar.
// Ver supabase/migrations/20260925100000_portal_booking_failures.sql.
//
// Nunca lança erro nem é aguardado por quem chama: se o próprio registro
// falhar (ex.: rede caiu), o fluxo do cliente segue igual.

import { supabase } from "@/integrations/supabase/client";

export type BookingFailureStage = "regra_horario" | "categoria" | "servidor" | "carregamento";

interface Args {
  clientId: string | null;
  bookingDate?: string | null;
  court?: number | null;
  startHour?: number | null;
  stage: BookingFailureStage;
  message: string;
  errorCode?: string | null;
  extra?: Record<string, unknown>;
}

export function logPortalBookingFailure({
  clientId,
  bookingDate = null,
  court = null,
  startHour = null,
  stage,
  message,
  errorCode = null,
  extra = {},
}: Args): void {
  const details = {
    ...extra,
    // Relógio do aparelho: a regra de antecedência na tela usa a hora do
    // celular — comparar com created_at (hora do servidor) revela relógio
    // errado no aparelho do cliente.
    device_time: new Date().toISOString(),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any)
      .rpc("portal_log_booking_failure", {
        _client_id: clientId,
        _booking_date: bookingDate,
        _court: court,
        _start_hour: startHour,
        _stage: stage,
        _message: message,
        _error_code: errorCode,
        _details: details,
      })
      .then(
        ({ error }: { error: { message: string } | null }) => {
          if (error) console.error("portal_log_booking_failure error", error);
        },
        (e: unknown) => console.error("portal_log_booking_failure failed", e),
      );
  } catch (e) {
    console.error("portal_log_booking_failure failed", e);
  }
}

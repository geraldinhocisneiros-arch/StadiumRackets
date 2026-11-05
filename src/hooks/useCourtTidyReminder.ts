import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_TZ, todayISO } from "@/lib/format";
import { weekdayOfISO, type Booking, type FixedSchedule } from "@/lib/court-map";
import { computeCourtsNeedingTidy, TIDY_REMINDER_SKIP_HOURS } from "@/lib/court-tidy";

export interface CourtTidyCheckpoint {
  hour: number;
  priorityCourts: number[];
  laterCourts: number[];
  maintenanceCourts: number[];
}

const CHECK_INTERVAL_MS = 20_000;
// Dispara quando faltam 10 minutos pra próxima hora cheia (minuto >= 50).
const TRIGGER_MINUTE = 50;
const ACK_STORAGE_PREFIX = "sr_court_tidy_ack_";

function recifeNow(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute") };
}

function isAcked(key: string): boolean {
  try {
    return window.localStorage.getItem(ACK_STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function setAcked(key: string) {
  try {
    window.localStorage.setItem(ACK_STORAGE_PREFIX + key, "1");
  } catch {
    // localStorage indisponível (modo privado etc.) — sem persistência, tudo bem.
  }
}

/**
 * A cada hora cheia (exceto 06h), 10 minutos antes, verifica se alguma
 * quadra precisa ser arrumada (ou vai entrar em manutenção) e mostra um
 * lembrete pra recepção — separado em prioritárias (virada de locação na
 * mesma hora, arrumar já), "depois" (fica livre agora, mas só tem locação
 * marcada pra hora seguinte) e "entrando em manutenção" (não precisa
 * arrumar, só avisar a equipe — ver computeCourtsNeedingTidy). Só roda
 * quando `enabled` (papéis de recepção/direção) — ver
 * CourtTidyReminderDialog.
 *
 * Recalcula a cada CHECK_INTERVAL_MS durante toda a janela de 10 minutos
 * (não só na primeira verificação) — uma reserva feita em cima da hora
 * (ex.: recepção lançando na hora) só entra na lista "depois" se o
 * cálculo for repetido depois que ela existir no banco. Só para de
 * recalcular quando o checkpoint é confirmado (isAcked).
 */
export function useCourtTidyReminder(enabled: boolean) {
  const [pending, setPending] = useState<CourtTidyCheckpoint | null>(null);
  const checkedKeyRef = useRef<string | null>(null);

  const checkNow = useCallback(async () => {
    const { hour, minute } = recifeNow();
    if (minute < TRIGGER_MINUTE) return;
    const checkpointHour = (hour + 1) % 24;
    if (TIDY_REMINDER_SKIP_HOURS.has(checkpointHour)) return;

    const date = todayISO();
    const key = `${date}-${checkpointHour}`;
    if (isAcked(key)) return;
    checkedKeyRef.current = key;

    const weekday = weekdayOfISO(date);
    const [bRes, sRes] = await Promise.all([
      supabase
        .from("court_bookings")
        .select(
          "id, court, booking_date, start_time, end_time, client_id, guest_name, cancelled_at, clients!client_id(id, full_name)",
        )
        .eq("booking_date", date)
        .is("cancelled_at", null),
      supabase
        .from("client_schedules")
        .select(
          "id, client_id, weekday, start_time, end_time, court, clients!client_id(id, full_name)",
        )
        .eq("weekday", weekday)
        .or(`valid_from.is.null,valid_from.lte.${date}`)
        .or(`valid_until.is.null,valid_until.gte.${date}`),
    ]);
    if (bRes.error || sRes.error) return;

    const bookings = (bRes.data ?? []) as unknown as Booking[];
    const scheds = (sRes.data ?? []) as unknown as FixedSchedule[];
    const scheduleIds = scheds.map((s) => s.id);

    const exceptionsBySchedule: Record<string, FixedSchedule["exceptions"]> = {};
    if (scheduleIds.length > 0) {
      const { data: exData } = await supabase
        .from("client_schedule_exceptions")
        .select("id, client_schedule_id, start_time, end_time, reason, created_by, created_at")
        .eq("exception_date", date)
        .in("client_schedule_id", scheduleIds);
      for (const ex of exData ?? []) {
        const list = exceptionsBySchedule[ex.client_schedule_id] ?? [];
        list.push(ex);
        exceptionsBySchedule[ex.client_schedule_id] = list;
      }
    }
    const fixedSchedules: FixedSchedule[] = scheds.map((s) => ({
      ...s,
      exceptions: exceptionsBySchedule[s.id] ?? [],
    }));

    const { priority, later, enteringMaintenance } = computeCourtsNeedingTidy({
      date,
      checkpointHour,
      bookings,
      fixedSchedules,
    });
    if (priority.length > 0 || later.length > 0 || enteringMaintenance.length > 0) {
      setPending({
        hour: checkpointHour,
        priorityCourts: priority,
        laterCourts: later,
        maintenanceCourts: enteringMaintenance,
      });
    } else {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void checkNow();
    const id = window.setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, checkNow]);

  const dismiss = useCallback(() => {
    if (checkedKeyRef.current) setAcked(checkedKeyRef.current);
    setPending(null);
  }, []);

  return { pending, dismiss };
}

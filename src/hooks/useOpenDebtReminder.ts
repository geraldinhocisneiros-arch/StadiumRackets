import { useCallback, useEffect, useRef, useState } from "react";
import { APP_TZ, todayISO } from "@/lib/format";
import {
  OPEN_DEBT_REMINDER_HOUR,
  fetchOpenDebtReminderRows,
  type OpenDebtReminderRow,
} from "@/lib/open-debt-reminder";

const CHECK_INTERVAL_MS = 60_000;
// Recalcula a lista (consulta pesada: mapa de amanhã inteiro) no máximo
// a cada 5 min — entre uma consulta e outra, as ações do pop-up só tiram
// linhas da lista local.
const REFRESH_EVERY_MS = 5 * 60_000;
const SNOOZE_MS = 15 * 60_000;
const SNOOZE_STORAGE_KEY = "sr_open_debt_reminder_snooze_until";

function recifeHour(): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  return Number(h) % 24;
}

function snoozedUntil(): number {
  try {
    return Number(window.localStorage.getItem(SNOOZE_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Pop-up de véspera do débito em aberto: a partir das 11h (Recife), monta
 * a lista de clientes negativos com locação amanhã que ainda não foram
 * cobrados na semana nem resolvidos hoje. Fica aberto até a lista
 * esvaziar — "Lembrar em 15 min" só adia. Se ninguém estiver logado às
 * 11h, aparece no próximo login do dia. Só roda quando `enabled`
 * (papéis de recepção/direção) — ver OpenDebtReminderDialog.
 */
export function useOpenDebtReminder(enabled: boolean) {
  const [rows, setRows] = useState<OpenDebtReminderRow[]>([]);
  const [snoozeTick, setSnoozeTick] = useState(0);
  const lastFetchRef = useRef<{ date: string; at: number } | null>(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    if (recifeHour() < OPEN_DEBT_REMINDER_HOUR) {
      setRows([]);
      return;
    }
    if (Date.now() < snoozedUntil()) return;
    const today = todayISO();
    const last = lastFetchRef.current;
    if (!force && last && last.date === today && Date.now() - last.at < REFRESH_EVERY_MS) return;
    loadingRef.current = true;
    try {
      const next = await fetchOpenDebtReminderRows(today);
      if (next) {
        setRows(next);
        lastFetchRef.current = { date: today, at: Date.now() };
      }
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh, snoozeTick]);

  const removeRow = useCallback((clientId: string) => {
    setRows((prev) => prev.filter((r) => r.clientId !== clientId));
  }, []);

  const snooze = useCallback(() => {
    try {
      window.localStorage.setItem(SNOOZE_STORAGE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // sem localStorage o adiamento vale só até o próximo minuto — tudo bem.
    }
    setRows([]);
    lastFetchRef.current = null;
    setSnoozeTick((t) => t + 1);
  }, []);

  const visible = enabled && Date.now() >= snoozedUntil() ? rows : [];
  return { rows: visible, removeRow, snooze, today: todayISO() };
}

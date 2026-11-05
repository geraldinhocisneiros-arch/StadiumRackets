import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WaitlistIntervalEntry {
  court: number;
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
  total: number;
  /** true se o próprio usuário atual está aguardando esse intervalo. */
  mine: boolean;
}

/**
 * Hook compartilhado (Portal do Cliente e Portal do Professor) que lista
 * todas as filas de espera pendentes em uma data, agrupadas pelo intervalo
 * desejado, e expõe helpers para consulta por célula (sobreposição real).
 */
export function useWaitlistCounts(date: string) {
  const [entries, setEntries] = useState<WaitlistIntervalEntry[]>([]);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "get_court_waitlist_counts_for_date",
      { _date: date },
    );
    if (error) {
      setEntries([]);
      return;
    }
    const list: WaitlistIntervalEntry[] = ((data ?? []) as Array<{
      court: number | null;
      start_time: string;
      end_time: string;
      total: number;
      mine: boolean;
    }>).map((r) => ({
      court: r.court ?? 0,
      start: r.start_time.slice(0, 5),
      end: r.end_time.slice(0, 5),
      total: r.total,
      mine: !!r.mine,
    }));
    setEntries(list);
  }, [date]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`waitlist_counts_${date}_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "court_waitlist" },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  /**
   * Para uma célula/intervalo (court, start HH:MM, end HH:MM), retorna a
   * soma de filas que se sobrepõem a esse intervalo e se o usuário atual
   * está em alguma delas.
   */
  const helpers = useMemo(() => {
    const forInterval = (_court: number, start: string, end: string) => {
      // Fila é por HORÁRIO — ignoramos a quadra específica.
      let count = 0;
      let mine = false;
      for (const e of entries) {
        // overlap: e.start < end AND e.end > start
        if (e.start < end && e.end > start) {
          count += e.total;
          if (e.mine) mine = true;
        }
      }
      return { count, mine };
    };
    return { forInterval };
  }, [entries]);

  return { entries, reload: load, ...helpers };
}

/**
 * Compat legado: mapa `court|start|end -> total` usado por componentes
 * que ainda esperam o formato antigo.
 */
export function toLegacyCountsMap(
  entries: WaitlistIntervalEntry[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of entries) {
    map[`${e.court}|${e.start}|${e.end}`] = e.total;
  }
  return map;
}

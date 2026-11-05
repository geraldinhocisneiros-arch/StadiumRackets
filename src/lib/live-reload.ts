import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Recarregamento "ao vivo" de uma tela a partir do realtime do Supabase.
 *
 * Antes, cada tela fazia `channel.on(tabela, () => load())` direto, e isso
 * deixava o mapa lento/desatualizado (locação de ranking marcada que só
 * aparecia depois de F5):
 *
 *  1. Rajada de recargas: salvar UMA locação mexe em várias tabelas ao mesmo
 *     tempo (court_bookings, participantes, pagamentos, janela de ranking...).
 *     Cada evento disparava um `load()` completo (~12 consultas). Como cada
 *     aba só manda 2 requisições por vez ao banco (ver createLimitedFetch em
 *     integrations/supabase/client.ts), 4-5 recargas empilhadas viravam uma
 *     fila de 50+ consultas — a informação nova chegava dezenas de segundos
 *     depois. E recargas sobrepostas podiam terminar fora de ordem, com uma
 *     resposta velha sobrescrevendo a nova.
 *     → Agora os eventos são agrupados (debounce) e só UMA recarga roda por
 *       vez; se chegar evento no meio, roda mais uma única vez no final.
 *
 *  2. Conexão do realtime caindo: notebook que dorme, Wi-Fi que oscila, aba
 *     em segundo plano. O canal reconecta sozinho, mas os eventos que
 *     aconteceram enquanto estava fora se perdem — e nada recarregava.
 *     → Recarrega quando o canal (re)conecta, quando a aba volta a ficar
 *       visível/focada, quando a internet volta e, por garantia, a cada
 *       `pollMs` se nada tiver recarregado nesse intervalo.
 */
export interface LiveReloadSubscription {
  table: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
}

export interface LiveReloadOptions {
  /** Prefixo do nome do canal (um sufixo aleatório é adicionado). */
  channel: string;
  tables: Array<string | LiveReloadSubscription>;
  /** Recarga de segurança enquanto a aba está visível. 0 desativa. */
  pollMs?: number;
  /** Janela para agrupar eventos em uma única recarga. */
  debounceMs?: number;
  enabled?: boolean;
}

export function useLiveReload(
  load: () => unknown,
  {
    channel: channelPrefix,
    tables,
    pollMs = 60_000,
    debounceMs = 300,
    enabled = true,
  }: LiveReloadOptions,
): () => void {
  const loadRef = useRef(load);
  loadRef.current = load;

  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunAtRef = useRef(Date.now());

  const run = useCallback(async () => {
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }
    runningRef.current = true;
    lastRunAtRef.current = Date.now();
    try {
      await loadRef.current();
    } catch {
      // a própria tela trata/mostra o erro; aqui só não pode travar a fila
    } finally {
      runningRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void run();
      }
    }
  }, []);

  const trigger = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void run();
    }, debounceMs);
  }, [run, debounceMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Chave estável para não recriar o canal a cada render.
  const tablesKey = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return;
    const subs: LiveReloadSubscription[] = (
      JSON.parse(tablesKey) as Array<string | LiveReloadSubscription>
    ).map((t) => (typeof t === "string" ? { table: t } : t));
    const channel = supabase.channel(`${channelPrefix}_${Math.random().toString(36).slice(2)}`);
    for (const s of subs) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: s.event ?? "*", schema: "public", table: s.table },
        () => trigger(),
      );
    }
    let subscribedOnce = false;
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Primeira conexão: a tela já fez a carga inicial. Reconexão: pode
      // ter perdido eventos enquanto estava fora — recarrega.
      if (subscribedOnce) trigger();
      subscribedOnce = true;
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, channelPrefix, tablesKey, trigger]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") trigger();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", trigger);
    let interval: ReturnType<typeof setInterval> | null = null;
    if (pollMs > 0) {
      interval = setInterval(
        () => {
          if (document.visibilityState !== "visible") return;
          if (Date.now() - lastRunAtRef.current < pollMs) return;
          trigger();
        },
        Math.min(pollMs, 15_000),
      );
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", trigger);
      if (interval) clearInterval(interval);
    };
  }, [enabled, pollMs, trigger]);

  return trigger;
}

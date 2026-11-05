import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CourtMap } from "@/components/CourtMap";
import type { ManualAvailability } from "@/components/CourtMap";
import { dateISO } from "@/lib/court-map";
import {
  COURT_MAP_LIVE_TABLES,
  computeAttendanceByBookingId,
  computeAttendanceByScheduleId,
  computeMovedFixedScheduleByBookingId,
  fetchCourtMapData,
  fetchWaitlistEntries,
  waitlistLookupFor,
  type CourtMapData as CourtMapCoreData,
  type WaitlistEntry,
} from "@/lib/court-map-data";

type CourtMapData = CourtMapCoreData & { date: string };

const REFRESH_MS = 60_000;

export function MapaTVStandalone() {
  const { user, loading, roles, isAdmin, isDiretoria } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isDiretoria && !roles.includes("recepcionista")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Acesso restrito.
      </div>
    );
  }

  return <MapaTVPage />;
}

// Hash do bundle publicado (os /assets/*.js que o HTML referencia). A TV
// fica dias aberta sem ninguém recarregar: sem isso, depois de um deploy ela
// continuava rodando o código antigo do mapa (cores/regras desatualizadas)
// enquanto o mapa da recepção já mostrava o novo.
async function fetchBuildSignature(): Promise<string | null> {
  try {
    const res = await fetch(`/?__tv=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const assets = Array.from(new Set(html.match(/\/assets\/[^"'\s)]+\.js/g) ?? [])).sort();
    return assets.length ? assets.join("|") : null;
  } catch {
    return null;
  }
}

function MapaTVPage() {
  const [data, setData] = useState<CourtMapData | null>(null);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [countdown, setCountdown] = useState(REFRESH_MS);
  const buildSignatureRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const pendingRef = useRef(false);

  // Mesma consulta do mapa de quadras (court-map-data.ts) — a TV mostra
  // exatamente o mesmo que a recepção vê no mapa de hoje.
  const load = useCallback(async () => {
    // Uma troca de quadra dispara vários eventos de realtime em sequência;
    // não roda duas cargas ao mesmo tempo (a mais antiga podia terminar por
    // último e voltar a tela pro estado de antes) — agenda mais uma no fim.
    if (loadingRef.current) {
      pendingRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const today = dateISO(new Date());
      const [core, wl] = await Promise.all([fetchCourtMapData(today), fetchWaitlistEntries(today)]);
      // Uma falha transitória (rede, token expirando etc.) não pode fazer o
      // mapa "esvaziar" e mostrar todas as quadras como disponíveis do nada
      // — mantém os últimos dados válidos e tenta de novo no próximo ciclo.
      if (core.failed) {
        console.error("Falha ao atualizar o mapa da TV, mantendo dados anteriores.");
      } else {
        setData({ ...core, date: today });
      }
      if (wl) setWaitlistEntries(wl);
      setCountdown(REFRESH_MS);
    } finally {
      loadingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void load();
      }
    }
  }, []);

  // A cada minuto: recarrega os dados e, se saiu versão nova do sistema,
  // recarrega a página inteira pra pegar o código novo.
  useEffect(() => {
    void load();
    void fetchBuildSignature().then((sig) => {
      buildSignatureRef.current = sig;
    });
    const refreshId = window.setInterval(() => {
      void load();
      void fetchBuildSignature().then((sig) => {
        if (!sig) return;
        if (buildSignatureRef.current && sig !== buildSignatureRef.current) {
          window.location.reload();
          return;
        }
        buildSignatureRef.current = sig;
      });
    }, REFRESH_MS);
    return () => window.clearInterval(refreshId);
  }, [load]);

  // Realtime: qualquer mudança no mapa (troca de quadra, presença, cancelamento,
  // pagamento…) aparece na TV na hora, sem esperar o minuto.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 800);
    };
    const channel = supabase.channel(`mapa_tv_${Math.random().toString(36).slice(2)}`);
    for (const table of [...COURT_MAP_LIVE_TABLES, "court_waitlist", "waitlist_acknowledgements"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    const tickId = window.setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => window.clearInterval(tickId);
  }, []);

  const manualAvailabilities: ManualAvailability[] = useMemo(
    () =>
      (data?.availOverrides ?? []).map((o) => ({
        id: o.id,
        court: o.court,
        start_time: o.start_time,
        end_time: o.end_time,
        hourly_price: Number(o.hourly_price),
      })),
    [data],
  );

  const attendanceByScheduleId = useMemo(
    () => computeAttendanceByScheduleId(data?.attendanceRows ?? []),
    [data],
  );
  const attendanceByBookingId = useMemo(
    () =>
      data
        ? computeAttendanceByBookingId(
            data.attendanceRows,
            computeMovedFixedScheduleByBookingId(data.bookings, data.fixed, data.date),
          )
        : {},
    [data],
  );

  const waitlistLookup = useMemo(() => waitlistLookupFor(waitlistEntries), [waitlistEntries]);

  return (
    <div className="relative min-h-screen w-screen overflow-x-hidden overflow-y-auto bg-background p-2">
      {!data ? (
        <div className="min-h-[80vh] flex items-center justify-center text-muted-foreground text-lg">
          Carregando mapa…
        </div>
      ) : (
        <CourtMap
          bookings={data.bookings}
          fixedSchedules={data.fixed}
          highlightAvailability
          priceBands={data.priceBands}
          date={data.date}
          attendanceByScheduleId={attendanceByScheduleId}
          attendanceByBookingId={attendanceByBookingId}
          paidBookingIds={data.paidBookingIds}
          onlinePaidBookingIds={data.onlinePaidBookingIds}
          manualAvailabilities={manualAvailabilities}
          showManualBadge
          waitlistLookup={waitlistLookup}
          readOnly
        />
      )}

      <div className="fixed bottom-3 right-3 z-50 rounded-full border bg-background/85 px-3 py-1.5 text-xs text-foreground shadow-sm backdrop-blur-sm">
        Próxima atualização em {Math.ceil(countdown / 1000)}s
      </div>
    </div>
  );
}

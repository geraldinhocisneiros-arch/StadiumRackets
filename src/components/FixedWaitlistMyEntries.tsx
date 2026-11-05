import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { WEEKDAY_LABELS } from "@/lib/pricing";
import { fixedWaitlistCourtLabel } from "@/lib/court-map";

interface Entry {
  id: string;
  court: number | null;
  desired_weekday: number;
  start_time: string;
  end_time: string;
  status: string;
}

interface PositionResult {
  ok: boolean;
  position?: number;
  total?: number;
  tied?: boolean;
}

/**
 * Lista as próprias inscrições ativas na fila de horário fixo (professor
 * vê as que solicitou; cliente vê as próprias) com posição atual e botão
 * pra sair da fila. RLS já restringe às linhas do próprio usuário.
 */
export function FixedWaitlistMyEntries({ refreshKey }: { refreshKey?: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [positions, setPositions] = useState<Record<string, PositionResult>>({});
  const [loading, setLoading] = useState(true);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("fixed_court_waitlist")
      .select("id, court, desired_weekday, start_time, end_time, status")
      .in("status", ["waiting", "notified", "contacted"])
      .order("created_at", { ascending: true });
    const rows = (data as Entry[]) ?? [];
    setEntries(rows);
    const pos: Record<string, PositionResult> = {};
    await Promise.all(
      rows.map(async (r) => {
        const { data: p } = await supabase.rpc("fixed_waitlist_position", { _id: r.id } as never);
        pos[r.id] = p as unknown as PositionResult;
      }),
    );
    setPositions(pos);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleLeave = async (id: string) => {
    setLeavingId(id);
    const { data, error } = await supabase.rpc("fixed_waitlist_leave", { _id: id } as never);
    setLeavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error("Não foi possível sair da fila.");
      return;
    }
    toast.success("Você saiu da fila.");
    void load();
  };

  if (loading) {
    return (
      <div className="py-4 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Minhas solicitações na fila</div>
      {entries.map((e) => {
        const pos = positions[e.id];
        return (
          <div
            key={e.id}
            className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <div>
              <span className="font-medium">
                {e.court === null || e.court === 0
                  ? fixedWaitlistCourtLabel(e.court)
                  : `Quadra ${e.court}`}{" "}
                · {WEEKDAY_LABELS[e.desired_weekday]} {e.start_time.slice(0, 5)}–
                {e.end_time.slice(0, 5)}
              </span>
              {pos?.ok && (
                <div className="text-xs text-muted-foreground">
                  Posição {pos.position} de {pos.total}
                  {pos.tied ? " · empatado" : ""}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleLeave(e.id)}
              disabled={leavingId === e.id}
            >
              {leavingId === e.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { avulsaCourtLabel } from "@/lib/court-map";

interface Entry {
  id: string;
  court: number | null;
  desired_date: string;
  start_time: string;
  end_time: string;
  status: string;
  source_booking_id: string | null;
}

interface PositionResult {
  ok: boolean;
  position?: number;
  total?: number;
}

/**
 * Lista as próprias inscrições ativas na fila avulsa (por data específica)
 * — RLS já restringe às linhas do próprio usuário (user_id = auth.uid()),
 * cobrindo tanto inscrições em nome próprio quanto em nome de um aluno
 * vinculado (professor).
 */
export function AvulsaWaitlistMyEntries({ refreshKey }: { refreshKey?: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [positions, setPositions] = useState<Record<string, PositionResult>>({});
  const [loading, setLoading] = useState(true);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("court_waitlist")
      .select("id, court, desired_date, start_time, end_time, status, source_booking_id")
      .in("status", ["waiting", "notified", "contacted"])
      .order("created_at", { ascending: true });
    const rows = (data as Entry[]) ?? [];
    setEntries(rows);
    const pos: Record<string, PositionResult> = {};
    await Promise.all(
      rows.map(async (r) => {
        const { data: p } = await supabase.rpc("portal_waitlist_position_by_id", {
          _id: r.id,
        } as never);
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
    const { data, error } = await supabase.rpc("portal_leave_court_waitlist", {
      _waitlist_id: id,
    } as never);
    setLeavingId(null);
    const res = data as unknown as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      toast.error(res?.error ?? error?.message ?? "Não foi possível sair da fila.");
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
      <div className="text-sm font-medium">Minhas solicitações avulsas</div>
      {entries.map((e) => {
        const pos = positions[e.id];
        return (
          <div
            key={e.id}
            className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <div>
              <span className="font-medium">
                {avulsaCourtLabel(e.court)} · {e.desired_date.split("-").reverse().join("/")}{" "}
                {e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}
              </span>
              {e.source_booking_id && (
                <div className="text-xs text-muted-foreground">
                  Troca de horário — sua reserva atual é mantida até a confirmação
                </div>
              )}
              {pos?.ok && (
                <div className="text-xs text-muted-foreground">
                  Posição {pos.position} de {pos.total}
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

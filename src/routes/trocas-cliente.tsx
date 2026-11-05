import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { fmtDateBR, courtShort } from "@/lib/court-map";

export const Route = createFileRoute("/trocas-cliente")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Trocas de cliente • Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <TrocasClientePage />
    </RequireAuth>
  ),
});

interface Row {
  id: string;
  teacher_id: string;
  booking_id: string | null;
  schedule_id: string | null;
  occurrence_date: string;
  court: number;
  start_time: string;
  end_time: string;
  current_client_id: string | null;
  current_client_name: string | null;
  new_client_id: string | null;
  new_client_name: string;
  status: string;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  teachers?: { name: string } | null;
}

function TrocasClientePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pendente");
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from("teacher_client_change_requests")
      .select("*, teachers(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    const { data, error } =
      statusFilter === "todos"
        ? await q
        : await q.eq("status", statusFilter);
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (r: Row) => {
    setBusy(r.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "approve_client_change_request",
      { _request_id: r.id },
    );
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string; already_done?: boolean };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao aprovar.");
    toast.success(
      res.already_done
        ? "A troca já estava feita no mapa. Solicitação marcada como aprovada."
        : "Troca aprovada. Cliente substituído.",
    );
    load();
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "reject_client_change_request",
      { _request_id: rejecting.id, _reason: rejectReason || null },
    );
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao recusar.");
    toast.success("Solicitação recusada.");
    setRejecting(null);
    setRejectReason("");
    load();
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pendente: "bg-amber-500/15 text-amber-700 border-amber-500/40",
      aprovada: "bg-emerald-500/15 text-emerald-700 border-emerald-600/40",
      recusada: "bg-red-500/15 text-red-700 border-red-500/40",
      cancelada: "bg-muted text-muted-foreground",
    };
    return (
      <Badge variant="outline" className={map[s] ?? ""}>
        {s}
      </Badge>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Trocas de cliente</h1>
          <p className="text-sm text-muted-foreground">
            Solicitações enviadas pelos professores para substituir o cliente
            em uma aula específica. Quadra, data e horário permanecem
            inalterados.
          </p>
        </div>
        <div className="flex gap-1">
          {["pendente", "aprovada", "recusada", "todos"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma solicitação {statusFilter !== "todos" ? statusFilter : ""}.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-md border p-3 text-sm space-y-2"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-medium">
                        {r.current_client_name ?? "—"}{" "}
                        <span className="text-muted-foreground">→</span>{" "}
                        <span className="text-primary">{r.new_client_name}</span>
                        {!r.new_client_id && (
                          <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                            nome livre
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Prof. {r.teachers?.name ?? "—"} • {courtShort(r.court)} •{" "}
                        {fmtDateBR(r.occurrence_date)} •{" "}
                        {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} •{" "}
                        {r.schedule_id ? "aula fixa" : "reserva"}
                      </div>
                      {r.review_notes && (
                        <div className="text-xs text-muted-foreground italic">
                          {r.status === "recusada" ? "Motivo" : "Obs."}:{" "}
                          {r.review_notes}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusBadge(r.status)}
                      {r.status === "pendente" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => approve(r)}
                            disabled={busy === r.id}
                          >
                            {busy === r.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4 mr-1" />
                            )}
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRejecting(r)}
                            disabled={busy === r.id}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Recusar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar solicitação</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Motivo (opcional)"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Voltar
            </Button>
            <Button
              onClick={confirmReject}
              disabled={busy === rejecting?.id}
            >
              Confirmar recusa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

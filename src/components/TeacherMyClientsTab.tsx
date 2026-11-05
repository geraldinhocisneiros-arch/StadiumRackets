import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, UserMinus } from "lucide-react";
import {
  TeacherClientLinkRequestDialog,
  type TeacherClientLinkRequestTarget,
} from "@/components/TeacherClientLinkRequestDialog";

interface LinkedClient {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
}

interface PendingRequest {
  client_id: string;
  action: "vincular" | "desvincular";
}

export function TeacherMyClientsTab({
  teacherId,
  teacherName,
}: {
  teacherId: string;
  teacherName: string;
}) {
  const [clients, setClients] = useState<LinkedClient[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<TeacherClientLinkRequestTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: primary }, { data: links }, { data: reqs }] = await Promise.all([
      supabase
        .from("clients")
        .select("id, full_name, phone, active")
        .eq("teacher_id", teacherId),
      supabase
        .from("client_teachers")
        .select("clients!client_id(id, full_name, phone, active)")
        .eq("teacher_id", teacherId),
      supabase
        .from("client_teacher_link_requests")
        .select("client_id, action")
        .eq("teacher_id", teacherId)
        .eq("status", "pendente"),
    ]);
    const byId = new Map<string, LinkedClient>();
    ((primary ?? []) as LinkedClient[]).forEach((c) => byId.set(c.id, c));
    ((links ?? []) as Array<{ clients: LinkedClient | null }>).forEach((r) => {
      if (r.clients) byId.set(r.clients.id, r.clients);
    });
    setClients(
      Array.from(byId.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
    );
    setPending((reqs ?? []) as PendingRequest[]);
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingFor = (clientId: string) => pending.find((p) => p.client_id === clientId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Meus clientes</h2>
          <p className="text-sm text-muted-foreground">
            Clientes vinculados a você. Envie uma solicitação para adicionar ou remover um vínculo — a
            recepção precisa aprovar.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            setTarget({ action: "vincular", teacherId, teacherName })
          }
        >
          <UserPlus className="h-4 w-4 mr-2" /> Solicitar vínculo
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : clients.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum cliente vinculado a você ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => {
                const p = pendingFor(c.id);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {c.full_name}
                        {!c.active && (
                          <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                        )}
                      </div>
                      {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {p ? (
                        <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-500/40">
                          {p.action === "desvincular" ? "Desvínculo pendente" : "Vínculo pendente"}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setTarget({
                              action: "desvincular",
                              teacherId,
                              teacherName,
                              clientId: c.id,
                              clientName: c.full_name,
                            })
                          }
                        >
                          <UserMinus className="h-4 w-4 mr-1" /> Solicitar desvínculo
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <TeacherClientLinkRequestDialog
        target={target}
        onClose={() => setTarget(null)}
        onSubmitted={load}
      />
    </div>
  );
}

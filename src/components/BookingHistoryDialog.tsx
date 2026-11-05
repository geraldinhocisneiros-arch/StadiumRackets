import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type EntityType = "court_booking" | "client_schedule";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entityType: EntityType;
  entityId: string;
}

interface Row {
  id: string;
  entity: string;
  entity_id: string;
  action: string;
  actor_name: string | null;
  actor_email: string | null;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any;
}

const FIELD_LABEL: Record<string, string> = {
  court: "Quadra",
  booking_date: "Data",
  start_time: "Início",
  end_time: "Fim",
  client_id: "Cliente",
  teacher_id: "Professor",
  guest_type: "Tipo do avulso",
  guest_name: "Nome do avulso",
  notes: "Observação",
  cancelled_at: "Cancelamento",
  cancel_reason: "Motivo do cancelamento",
  category_id: "Categoria",
  source: "Origem",
  weekday: "Dia da semana",
  reason: "Motivo",
  exception_date: "Data",
  client_schedule_id: "Horário fixo",
  valid_from: "Vale a partir de",
  valid_until: "Vale até",
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtVal(field: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (field === "weekday" && typeof v === "number") return WEEKDAYS[v] ?? String(v);
  if (
    field === "booking_date" ||
    field === "exception_date" ||
    field === "valid_from" ||
    field === "valid_until"
  ) {
    try {
      return format(new Date(String(v) + "T00:00:00"), "dd/MM/yyyy");
    } catch {
      return String(v);
    }
  }
  if (field === "start_time" || field === "end_time") return String(v).slice(0, 5);
  if (field === "cancelled_at") {
    try {
      return format(new Date(String(v)), "dd/MM/yyyy HH:mm");
    } catch {
      return String(v);
    }
  }
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  return String(v);
}

async function resolveNames(ids: Set<string>, table: "clients" | "teachers" | "client_categories"): Promise<Record<string, string>> {
  if (ids.size === 0) return {};
  const col = table === "teachers" ? "name" : table === "client_categories" ? "name" : "full_name";
  const { data } = await supabase.from(table).select(`id, ${col}`).in("id", Array.from(ids));
  const out: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (data ?? []).forEach((r: any) => {
    out[r.id] = r[col];
  });
  return out;
}

export function BookingHistoryDialog({ open, onOpenChange, entityType, entityId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [catNames, setCatNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let query = supabase
        .from("audit_logs")
        .select("id, entity, entity_id, action, actor_name, actor_email, created_at, details")
        .order("created_at", { ascending: false })
        .limit(200);
      if (entityType === "court_booking") {
        query = query.eq("entity", "court_booking").eq("entity_id", entityId);
      } else {
        // client_schedule + its exceptions
        query = query.or(
          `and(entity.eq.client_schedule,entity_id.eq.${entityId}),and(entity.eq.client_schedule_exception,details->>client_schedule_id.eq.${entityId})`
        );
      }
      const { data } = await query;
      if (cancelled) return;
      const list = (data ?? []) as Row[];
      setRows(list);

      // resolve id → name lookups
      const clientIds = new Set<string>();
      const teacherIds = new Set<string>();
      const catIds = new Set<string>();
      for (const r of list) {
        const bag = r.details?.changes ?? r.details?.values ?? {};
        for (const [k, v] of Object.entries(bag)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vals = (v && typeof v === "object" && "from" in (v as any) ? [(v as any).from, (v as any).to] : [v]).filter((x) => typeof x === "string");
          for (const val of vals as string[]) {
            if (k === "client_id") clientIds.add(val);
            else if (k === "teacher_id") teacherIds.add(val);
            else if (k === "category_id") catIds.add(val);
          }
        }
      }
      const [cn, tn, ctn] = await Promise.all([
        resolveNames(clientIds, "clients"),
        resolveNames(teacherIds, "teachers"),
        resolveNames(catIds, "client_categories"),
      ]);
      if (cancelled) return;
      setClientNames(cn);
      setTeacherNames(tn);
      setCatNames(ctn);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, entityType, entityId]);

  function displayId(field: string, v: unknown): string {
    if (v === null || v === undefined) return "—";
    const s = String(v);
    if (field === "client_id") return clientNames[s] ?? s.slice(0, 8);
    if (field === "teacher_id") return teacherNames[s] ?? s.slice(0, 8);
    if (field === "category_id") return catNames[s] ?? s.slice(0, 8);
    return fmtVal(field, v);
  }

  function actionLabel(r: Row): string {
    const entLabel =
      r.entity === "court_booking" ? "Locação"
      : r.entity === "client_schedule" ? "Horário fixo"
      : "Exceção do fixo";
    if (r.action === "create") return `${entLabel} criada`;
    if (r.action === "delete") return `${entLabel} removida`;
    // update: detect cancel/reactivate specifically for court_booking
    if (r.entity === "court_booking" && r.details?.changes?.cancelled_at) {
      const c = r.details.changes.cancelled_at;
      if (c.from === null && c.to !== null) return "Locação cancelada";
      if (c.from !== null && c.to === null) return "Locação reativada";
    }
    return `${entLabel} editada`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Histórico de ações
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma ação registrada ainda para esta locação.
          </p>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => {
              const changes = r.details?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
              const values = r.details?.values as Record<string, unknown> | undefined;
              return (
                <li key={r.id} className="rounded-md border p-3 text-sm space-y-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{actionLabel(r)}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    por {r.actor_name || r.actor_email || "—"}
                  </div>
                  {changes && (
                    <ul className="mt-1 space-y-0.5">
                      {Object.entries(changes).map(([field, val]) => (
                        <li key={field} className="text-xs">
                          <span className="font-medium">{FIELD_LABEL[field] ?? field}:</span>{" "}
                          <span className="text-muted-foreground">{displayId(field, val.from)}</span>
                          {" → "}
                          <span>{displayId(field, val.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {values && r.action !== "update" && (
                    <ul className="mt-1 space-y-0.5">
                      {Object.entries(values)
                        .filter(([k]) => k !== "client_schedule_id" && k !== "booking_date")
                        .map(([field, val]) => (
                          <li key={field} className="text-xs">
                            <span className="font-medium">{FIELD_LABEL[field] ?? field}:</span>{" "}
                            <span>{displayId(field, val)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

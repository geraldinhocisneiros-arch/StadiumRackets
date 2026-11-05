import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { dayEndExclusiveISO, dayStartISO, fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { addDaysISO, courtShort } from "@/lib/court-map";

export const Route = createFileRoute("/reservas-recusadas")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Reservas recusadas | Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <ReservasRecusadasPage />
    </RequireAuth>
  ),
});

type Stage = "regra_horario" | "categoria" | "servidor" | "carregamento";

interface FailureRow {
  id: string;
  created_at: string;
  client_id: string | null;
  booking_date: string | null;
  court: number | null;
  start_hour: number | null;
  stage: Stage;
  message: string;
  error_code: string | null;
  details: { device_time?: string; user_agent?: string | null } | null;
  clients: { full_name: string } | null;
}

const STAGE_INFO: Record<Stage, { label: string; hint: string; className: string }> = {
  regra_horario: {
    label: "Regra de horário",
    hint: "Barrado na tela pela regra de antecedência.",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  },
  servidor: {
    label: "Recusado pelo sistema",
    hint: "O banco de dados recusou a gravação da reserva.",
    className: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  },
  categoria: {
    label: "Categoria não carregou",
    hint: "A tela não conseguiu confirmar a categoria do cliente (rede/lentidão).",
    className: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  },
  carregamento: {
    label: "Mapa não carregou",
    hint: "O mapa de quadras não carregou (rede/lentidão).",
    className: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
  },
};

// Diferença (em minutos) entre o relógio do aparelho e a hora do servidor
// no momento do registro. A regra de antecedência na tela usa o relógio
// do celular — diferença grande indica relógio errado no aparelho.
function clockDriftMinutes(row: FailureRow): number | null {
  const dt = row.details?.device_time;
  if (!dt) return null;
  const diff = (new Date(dt).getTime() - new Date(row.created_at).getTime()) / 60000;
  return Number.isFinite(diff) ? Math.round(diff) : null;
}

function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android" : "Computador";
  // O app nativo (Capacitor) abre o site dentro de uma WebView — o
  // user agent do Android traz "; wv)"; no iOS, a WebView não tem "Safari/".
  const isApp = /; wv\)/.test(ua) || (/iPhone|iPad/i.test(ua) && !/Safari\//.test(ua));
  return `${os} · ${isApp ? "app" : "navegador"}`;
}

function ReservasRecusadasPage() {
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -6));
  const [to, setTo] = useState(() => todayISO());
  const [stage, setStage] = useState<"all" | Stage>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("portal_booking_failures")
      .select(
        "id, created_at, client_id, booking_date, court, start_hour, stage, message, error_code, details, clients(full_name)",
      )
      .gte("created_at", dayStartISO(from))
      .lt("created_at", dayEndExclusiveISO(to))
      .order("created_at", { ascending: false })
      .limit(500);
    if (stage !== "all") q = q.eq("stage", stage);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as FailureRow[]);
    setLoading(false);
  }, [from, to, stage]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const n = search.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (!n) return rows;
    return rows.filter((r) =>
      (r.clients?.full_name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n),
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reservas recusadas</CardTitle>
          <CardDescription>
            Toda vez que um cliente tenta reservar pelo portal e não consegue, o motivo fica
            registrado aqui. Use quando alguém reclamar que "não conseguiu reservar". Histórico dos
            últimos 90 dias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>De</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-auto"
              />
            </div>
            <div className="space-y-1">
              <Label>Até</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-auto"
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as "all" | Stage)}>
                <SelectTrigger className="w-[210px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {(Object.keys(STAGE_INFO) as Stage[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_INFO[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label>Cliente</Label>
              <Input
                placeholder="Buscar pelo nome"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => load()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
            </Button>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {(Object.keys(STAGE_INFO) as Stage[]).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-medium ${STAGE_INFO[s].className}`}>
                  {STAGE_INFO[s].label}
                </span>
                <span>{STAGE_INFO[s].hint}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma tentativa recusada no período.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Horário tentado</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Aparelho</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const drift = clockDriftMinutes(r);
                    const info = STAGE_INFO[r.stage];
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">
                          {fmtDateTime(r.created_at)}
                        </TableCell>
                        <TableCell>
                          {r.client_id && r.clients ? (
                            <Link
                              to="/clientes/$clientId"
                              params={{ clientId: r.client_id }}
                              className="hover:underline font-medium"
                            >
                              {r.clients.full_name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.booking_date ? fmtDate(`${r.booking_date}T12:00:00`) : "—"}
                          {r.start_hour !== null &&
                            ` · ${String(r.start_hour).padStart(2, "0")}:00`}
                          {r.court !== null && ` · ${courtShort(r.court)}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`border-0 ${info.className}`}>
                            {info.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[360px]">
                          <div>{r.message}</div>
                          {r.error_code && (
                            <div className="text-xs text-muted-foreground">
                              Código: {r.error_code}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          <div>{deviceLabel(r.details?.user_agent)}</div>
                          {drift !== null && Math.abs(drift) >= 3 && (
                            <div className="text-red-600 dark:text-red-400 font-medium">
                              Relógio do aparelho {drift > 0 ? "adiantado" : "atrasado"}{" "}
                              {Math.abs(drift)} min
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

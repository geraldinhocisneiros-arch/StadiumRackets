import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { fmtBRL } from "@/lib/format";
import { WEEKDAY_LABELS } from "@/lib/pricing";
import { fetchAll } from "@/lib/fetchAll";
import { Users, Clock, TrendingUp, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { courtShort } from "@/lib/court-map";

export const Route = createFileRoute("/professores/relatorio")({
  component: () => (
    <RequireAuth rolesAllowed={["diretoria", "recepcionista"]}>
      <ProfessoresRelatorioPage />
    </RequireAuth>
  ),
});

interface Teacher { id: string; name: string; active: boolean; }
interface Schedule {
  id: string;
  client_id: string;
  teacher_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
  clients?: { id: string; full_name: string; active: boolean; phone: string | null } | null;
}
interface Entry {
  client_id: string;
  entry_type: string;
  amount: number;
  entry_date: string;
}

const timeShort = (t: string) => t.slice(0, 5);

const timeToMin = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

function currentMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, m, 1));
  const yy = endDate.getUTCFullYear();
  const mm = String(endDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(endDate.getUTCDate()).padStart(2, "0");
  const endExclusive = `${yy}-${mm}-${dd}`;
  return [start, endExclusive];
}

function ProfessoresRelatorioPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState<string>("");
  const [month, setMonth] = useState<string>(currentMonthISO());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("teachers").select("*").order("name");
      const list = (data ?? []) as Teacher[];
      setTeachers(list);
      if (list.length && !teacherId) setTeacherId(list[0].id);
    })();
  }, []);

  const [linkedClients, setLinkedClients] = useState<
    Array<{ id: string; full_name: string; active: boolean; phone: string | null }>
  >([]);
  const [primaryClientIds, setPrimaryClientIds] = useState<Set<string>>(new Set());
  const [additionalClientIds, setAdditionalClientIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!teacherId) return;
    (async () => {
      setLoading(true);
      const [start, endExcl] = monthRange(month);
      const [sched, ents, cli, cliaLinks] = await Promise.all([
        supabase
          .from("client_schedules")
          .select("*, clients!client_id(id, full_name, active, phone)")
          .eq("teacher_id", teacherId)
          // Só fixos em vigência em algum dia do mês escolhido.
          .or(`valid_from.is.null,valid_from.lt.${endExcl}`)
          .or(`valid_until.is.null,valid_until.gte.${start}`)
          .order("weekday")
          .order("start_time"),
        fetchAll<Entry>(
          "account_entries",
          "client_id, entry_type, amount, entry_date",
          { pageSize: 1000 },
        ),
        supabase
          .from("clients")
          .select("id, full_name, active, phone")
          .eq("teacher_id", teacherId)
          .order("full_name"),
        supabase
          .from("client_teachers")
          .select("clients!client_id(id, full_name, active, phone)")
          .eq("teacher_id", teacherId),
      ]);
      const filteredEntries = (ents as Entry[]).filter(
        (e) => e.entry_type === "credito" && e.entry_date >= start && e.entry_date < endExcl,
      );
      setSchedules((sched.data ?? []) as Schedule[]);
      setEntries(filteredEntries);
      const primaryClients = (cli.data ?? []) as Array<{ id: string; full_name: string; active: boolean; phone: string | null }>;
      const additionalClients = (
        (cliaLinks.data ?? []) as Array<{ clients: { id: string; full_name: string; active: boolean; phone: string | null } | null }>
      )
        .map((r) => r.clients)
        .filter((c): c is { id: string; full_name: string; active: boolean; phone: string | null } => !!c);
      const byId = new Map<string, { id: string; full_name: string; active: boolean; phone: string | null }>();
      [...primaryClients, ...additionalClients].forEach((c) => byId.set(c.id, c));
      setLinkedClients(Array.from(byId.values()));
      setPrimaryClientIds(new Set(primaryClients.map((c) => c.id)));
      setAdditionalClientIds(new Set(additionalClients.map((c) => c.id)));
      setLoading(false);
    })();
  }, [teacherId, month]);

  const clientsMap = useMemo(() => {
    const m = new Map<
      string,
      {
        id: string;
        name: string;
        active: boolean;
        phone: string | null;
        schedules: Schedule[];
        isPrincipal: boolean;
        isVinculoAdicional: boolean;
      }
    >();
    // 1) Clientes vinculados diretamente ao professor pelo cadastro
    linkedClients.forEach((c) => {
      m.set(c.id, {
        id: c.id,
        name: c.full_name,
        active: c.active,
        phone: c.phone,
        schedules: [],
        isPrincipal: primaryClientIds.has(c.id),
        isVinculoAdicional: additionalClientIds.has(c.id),
      });
    });
    // 2) Clientes vinculados via horário fixo com este professor
    schedules.forEach((s) => {
      if (!s.clients) return;
      const cur =
        m.get(s.client_id) ??
        {
          id: s.client_id,
          name: s.clients.full_name,
          active: s.clients.active,
          phone: s.clients.phone,
          schedules: [],
          isPrincipal: primaryClientIds.has(s.client_id),
          isVinculoAdicional: additionalClientIds.has(s.client_id),
        };
      cur.schedules.push(s);
      m.set(s.client_id, cur);
    });
    return m;
  }, [schedules, linkedClients, primaryClientIds, additionalClientIds]);

  const creditsByClient = useMemo(() => {
    const m = new Map<string, number>();
    entries.forEach((e) => {
      m.set(e.client_id, (m.get(e.client_id) ?? 0) + Number(e.amount));
    });
    return m;
  }, [entries]);

  const clients = useMemo(() => {
    const arr = Array.from(clientsMap.values()).map((c) => ({
      ...c,
      credit: creditsByClient.get(c.id) ?? 0,
    }));
    arr.sort((a, b) => b.credit - a.credit || a.name.localeCompare(b.name));
    return arr;
  }, [clientsMap, creditsByClient]);

  const totalCredit = clients.reduce((s, c) => s + c.credit, 0);
  const totalWeeklyMin = schedules.reduce(
    (s, sc) => s + (timeToMin(sc.end_time) - timeToMin(sc.start_time)),
    0,
  );
  const totalWeeklyHours = totalWeeklyMin / 60;

  const vinculoLabel = (c: { isPrincipal: boolean; isVinculoAdicional: boolean; schedules: Schedule[] }) => {
    if (c.isPrincipal) return "Professor principal";
    if (c.isVinculoAdicional) return "Vínculo adicional";
    if (c.schedules.length > 0) return "Só via horário fixo";
    return "";
  };

  const handleExport = () => {
    const teacherName = teachers.find((t) => t.id === teacherId)?.name ?? "professor";

    const alunosRows = clients.map((c) => ({
      Aluno: c.name,
      Telefone: c.phone ?? "",
      Status: c.active ? "Ativo" : "Inativo",
      Vínculo: vinculoLabel(c),
      Horários: c.schedules
        .map(
          (s) =>
            `${WEEKDAY_LABELS[s.weekday]} ${timeShort(s.start_time)}–${timeShort(s.end_time)}${s.court ? ` · ${courtShort(s.court)}` : ""}`,
        )
        .join(" · "),
      "Crédito no mês (R$)": c.credit,
    }));

    const gradeRows = schedules.map((s) => ({
      Dia: WEEKDAY_LABELS[s.weekday],
      Horário: `${timeShort(s.start_time)}–${timeShort(s.end_time)}`,
      Quadra: s.court ?? "",
      Aluno: s.clients?.full_name ?? "—",
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(alunosRows), "Alunos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gradeRows), "Grade semanal");

    const diacritics = new RegExp("[̀-ͯ]", "g");
    const slug =
      teacherName
        .toLowerCase()
        .normalize("NFD")
        .replace(diacritics, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "professor";
    XLSX.writeFile(wb, `relatorio-${slug}-${month}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relatório por professor</h1>
          <p className="text-muted-foreground">
            Alunos, horários e crédito injetado por período. Cadastre professores em{" "}
            <Link to="/professores" className="underline">Professores</Link>.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!teacherId || loading}>
          <Download className="h-4 w-4 mr-2" /> Baixar Excel
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Professor</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{!t.active ? " (inativo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Alunos vinculados" value={String(clients.length)} icon={Users} />
        <StatCard title="Horas por semana" value={`${totalWeeklyHours.toFixed(1).replace(".", ",")}h`} icon={Clock} />
        <StatCard title="Crédito injetado no mês" value={fmtBRL(totalCredit)} icon={TrendingUp} accent />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alunos deste professor</CardTitle>
          <CardDescription>
            Um aluno pode aparecer aqui por mais de um motivo: é o professor principal do cadastro
            do cliente, tem um vínculo adicional (Clientes → Professores adicionais), ou só dá aula
            fixa pra ele num horário — sem necessariamente ser o professor "oficial" do cliente. Os
            selos abaixo do nome mostram qual é o caso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : clients.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              Nenhum aluno vinculado a este professor.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Horários</TableHead>
                  <TableHead className="text-right">Crédito no mês</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link to="/clientes/$clientId" params={{ clientId: c.id }} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {!c.active && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.isPrincipal && (
                          <Badge variant="outline" className="text-[10px]">Professor principal</Badge>
                        )}
                        {c.isVinculoAdicional && (
                          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-500/40">
                            Vínculo adicional
                          </Badge>
                        )}
                        {!c.isPrincipal && !c.isVinculoAdicional && c.schedules.length > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/40">
                            Só via horário fixo
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.schedules
                        .map((s) => `${WEEKDAY_LABELS[s.weekday].slice(0, 3)} ${timeShort(s.start_time)}–${timeShort(s.end_time)}${s.court ? ` · ${courtShort(s.court)}` : ""}`)
                        .join(" · ")}
                    </TableCell>
                    <TableCell className="text-right font-medium text-success">{fmtBRL(c.credit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Grade semanal</CardTitle></CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Sem horários cadastrados.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-7">
              {WEEKDAY_LABELS.map((label, wd) => {
                const daySchedules = schedules
                  .filter((s) => s.weekday === wd)
                  .sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
                return (
                  <div key={wd} className="rounded-md border p-3 space-y-2">
                    <div className="text-sm font-semibold">{label}</div>
                    {daySchedules.length === 0 ? (
                      <div className="text-xs text-muted-foreground">—</div>
                    ) : (
                      daySchedules.map((s) => (
                        <div key={s.id} className="text-xs rounded bg-muted/50 px-2 py-1">
                          <div className="font-medium">
                            {timeShort(s.start_time)}–{timeShort(s.end_time)}
                            {s.court ? ` · ${courtShort(s.court)}` : ""}
                          </div>
                          <div className="text-muted-foreground truncate">{s.clients?.full_name ?? "—"}</div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title, value, icon: Icon, accent,
}: {
  title: string; value: string; icon: typeof Users; accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${accent ? "text-success" : ""}`}>{value}</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

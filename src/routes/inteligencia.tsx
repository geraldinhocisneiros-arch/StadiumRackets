import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtBRL, todayISO } from "@/lib/format";
import { loadIntelData as loadData } from "@/lib/intelligence-data";
import { useUrlState } from "@/hooks/useUrlState";
import { toast } from "sonner";
import { Lightbulb, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  IntelContext,
  WEEKDAY_SHORT,
  addMonthsYm,
  buildSessions,
  computeConcentration,
  computeDemand,
  computeDiagnosis,
  computeEvolution,
  computeOccupancy,
  computeRetention,
  lastDayOfMonth,
  pct,
  slotKey,
  systemStart,
  ymOf,
  type DiagnosisResult,
  type IntelData,
} from "@/lib/intelligence";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ComposedChart,
  ScatterChart,
  Scatter,
  ZAxis,
  AreaChart,
  Area,
  ReferenceLine,
} from "recharts";

// Inteligência: análises de decisão (somente diretoria). Os cálculos moram
// em lib/intelligence.ts; aqui só carregamos os dados e desenhamos.

export const Route = createFileRoute("/inteligencia")({
  component: () => (
    <RequireAuth rolesAllowed={["diretoria"]}>
      <InteligenciaPage />
    </RequireAuth>
  ),
});

const SERIES = [
  "var(--color-primary)",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#0ea5e9",
  "#64748b",
];

const brl0 = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const kfmt = (v: number) =>
  Math.abs(v) >= 1000
    ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`
    : String(Math.round(v));
const hfmt = (v: number) => `${Math.round(v).toLocaleString("pt-BR")}h`;

function InteligenciaPage() {
  const curYm = ymOf(todayISO());
  const [activeTab, setActiveTab] = useUrlState<string>("tab", "diagnostico");
  const [diagYm, setDiagYm] = useUrlState<string>("mes", curYm);
  const [fromYm, setFromYm] = useUrlState<string>("from", addMonthsYm(curYm, -3));
  const [toYm, setToYm] = useUrlState<string>("to", addMonthsYm(curYm, -1));
  const [data, setData] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(true);
  // Impressão: desenha todas as abas uma embaixo da outra (o Tabs só monta a
  // aba ativa) e chama o print depois que os gráficos terminam de animar.
  const [printAll, setPrintAll] = useState(false);

  useEffect(() => {
    if (!printAll) return;
    const done = () => setPrintAll(false);
    window.addEventListener("afterprint", done);
    const t = window.setTimeout(() => {
      // Aviso na tela sairia impresso em todas as páginas.
      toast.dismiss();
      window.print();
    }, 1500);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printAll]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadData()
      .then((d) => alive && setData(d))
      .catch((e) => toast.error(`Erro ao carregar dados: ${e?.message ?? e}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const ctx = useMemo(() => (data ? new IntelContext(data) : null), [data]);
  const startDay = useMemo(() => (data ? systemStart(data) : null), [data]);

  // Período escolhido (meses inteiros), nunca antes do início do sistema.
  const period = useMemo(() => {
    const f = fromYm <= toYm ? fromYm : toYm;
    const t = fromYm <= toYm ? toYm : fromYm;
    let from = `${f}-01`;
    if (startDay && from < startDay) from = startDay;
    return { fromYm: f, toYm: t, from, to: lastDayOfMonth(t) };
  }, [fromYm, toYm, startDay]);

  const allSessions = useMemo(
    () => (ctx && startDay ? buildSessions(ctx, startDay, ctx.data.today) : []),
    [ctx, startDay],
  );
  const periodSessions = useMemo(
    () => allSessions.filter((s) => s.date >= period.from && s.date <= period.to),
    [allSessions, period],
  );

  const evolution = useMemo(() => (ctx ? computeEvolution(ctx) : null), [ctx]);
  const occupancy = useMemo(
    () => (ctx ? computeOccupancy(ctx, periodSessions, period.from, period.to) : null),
    [ctx, periodSessions, period],
  );
  const retention = useMemo(
    () => (ctx ? computeRetention(ctx, allSessions) : null),
    [ctx, allSessions],
  );
  const demand = useMemo(
    () => (ctx && occupancy ? computeDemand(ctx, occupancy, period.from, period.to) : null),
    [ctx, occupancy, period],
  );
  const concentration = useMemo(
    () => (ctx ? computeConcentration(ctx, period.fromYm, period.toYm) : null),
    [ctx, period],
  );

  const diagnosis = useMemo(
    () => (ctx ? computeDiagnosis(ctx, allSessions, diagYm) : null),
    [ctx, allSessions, diagYm],
  );

  const usesPeriod = !["diagnostico", "evolucao", "retencao"].includes(activeTab);
  const fmtYm = (ym: string) => ym.split("-").reverse().join("/");

  const sections = [
    {
      value: "diagnostico",
      label: "Diagnóstico do mês",
      node: diagnosis && <DiagnosisTab diag={diagnosis} />,
    },
    { value: "evolucao", label: "Evolução", node: evolution && <EvolutionTab ev={evolution} /> },
    { value: "ocupacao", label: "Ocupação", node: occupancy && <OccupancyTab occ={occupancy} /> },
    {
      value: "retencao",
      label: "Retenção",
      node: retention && <RetentionTab ret={retention} showAll={printAll} />,
    },
    { value: "demanda", label: "Demanda reprimida", node: demand && <DemandTab dem={demand} /> },
    {
      value: "abc",
      label: "Clientes (ABC)",
      node: concentration && <ConcentrationTab con={concentration} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inteligência</h1>
          <p className="text-sm text-muted-foreground">
            Análises para decisão: evolução, ocupação, retenção, demanda e concentração.
            {startDay && ` Dados desde ${startDay.split("-").reverse().join("/")}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          {activeTab === "diagnostico" && (
            <div>
              <Label htmlFor="intel-diag">Mês analisado</Label>
              <Input
                id="intel-diag"
                type="month"
                value={diagYm}
                min={startDay ? ymOf(addMonthsYm(ymOf(startDay), 1)) : undefined}
                max={curYm}
                onChange={(e) => e.target.value && setDiagYm(e.target.value)}
              />
            </div>
          )}
          {usesPeriod && (
            <>
              <div>
                <Label htmlFor="intel-from">De</Label>
                <Input
                  id="intel-from"
                  type="month"
                  value={fromYm}
                  min={startDay ? ymOf(startDay) : undefined}
                  onChange={(e) => e.target.value && setFromYm(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="intel-to">Até</Label>
                <Input
                  id="intel-to"
                  type="month"
                  value={toYm}
                  max={curYm}
                  onChange={(e) => e.target.value && setToYm(e.target.value)}
                />
              </div>
            </>
          )}
          <Button
            variant="outline"
            disabled={loading || !ctx || printAll}
            onClick={() => {
              setPrintAll(true);
            }}
          >
            {printAll ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            Imprimir tudo
          </Button>
        </div>
      </div>

      {loading || !ctx ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando e cruzando os dados…
        </div>
      ) : printAll ? (
        <div
          className="space-y-6"
          style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
        >
          <p className="text-sm text-muted-foreground">
            Impresso em {todayISO().split("-").reverse().join("/")}. Diagnóstico: {fmtYm(diagYm)}.
            Ocupação, Demanda e Clientes (ABC): {fmtYm(period.fromYm)} a {fmtYm(period.toYm)}
            . Evolução e Retenção: todo o histórico.
          </p>
          {sections.map((sec, i) => (
            <section key={sec.value} className={`space-y-4 ${i ? "break-before-page" : ""}`}>
              <h2 className="text-xl font-bold">{sec.label}</h2>
              {sec.node}
            </section>
          ))}
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex h-auto flex-wrap">
            {sections.map((sec) => (
              <TabsTrigger key={sec.value} value={sec.value}>
                {sec.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map((sec) => (
            <TabsContent key={sec.value} value={sec.value} className="mt-4 space-y-4">
              {sec.node}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

// ------------------------------------------------------------ comuns ---

function Insights({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-primary" /> Leitura
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  hint,
  children,
  height = "h-80",
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  height?: string;
}) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>
        <div className={height}>{children}</div>
      </CardContent>
    </Card>
  );
}

/** Mapa de calor dia da semana × hora. */
function Heatmap({
  hours,
  value,
  format,
  title,
}: {
  hours: number[];
  value: (wd: number, h: number) => { v: number | null; intensity: number; title?: string };
  format: (v: number) => string;
  title?: string;
}) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs" aria-label={title}>
        <thead>
          <tr>
            <th className="w-10" />
            {hours.map((h) => (
              <th key={h} className="px-1 font-normal text-muted-foreground">
                {h}h
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((wd) => (
            <tr key={wd}>
              <td className="pr-2 font-medium text-muted-foreground">{WEEKDAY_SHORT[wd]}</td>
              {hours.map((h) => {
                const c = value(wd, h);
                if (c.v == null) return <td key={h} className="h-8 min-w-9 rounded bg-muted/30" />;
                const a = Math.max(0.06, Math.min(1, c.intensity));
                return (
                  <td
                    key={h}
                    title={c.title}
                    className="h-8 min-w-9 rounded text-center tabular-nums"
                    style={{
                      background: `color-mix(in oklab, var(--color-primary) ${Math.round(a * 100)}%, transparent)`,
                      color: a > 0.55 ? "white" : undefined,
                    }}
                  >
                    {format(c.v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------- diagnóstico ---

const WEIGHT_STYLE: Record<
  DiagnosisResult["factors"][number]["weight"],
  { label: string; cls: string }
> = {
  principal: { label: "Explica boa parte", cls: "bg-red-600 text-white" },
  contribui: { label: "Contribui", cls: "bg-amber-500 text-white" },
  pouco: { label: "Pesa pouco", cls: "bg-muted text-foreground" },
  "a favor": { label: "Ajudou", cls: "bg-emerald-600 text-white" },
  info: { label: "Contexto", cls: "bg-sky-600 text-white" },
};

function DiagnosisTab({ diag }: { diag: DiagnosisResult | { error: string } }) {
  if ("error" in diag) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">{diag.error}</CardContent>
      </Card>
    );
  }
  const { cur, prev, revenue, day } = diag;
  const dmy = (d: string) => d.split("-").reverse().join("/");
  const delta = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${pct(a / b - 1)}` : "—");
  const groupChart = [...diag.groups]
    .sort((a, b) => b.previous + b.current - (a.previous + a.current))
    .map((g) => ({ group: g.group, [prev.label]: g.previous, [cur.label]: g.current }));
  return (
    <>
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4 text-primary" /> Resumo para a diretoria
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {cur.label}: {dmy(cur.from)} a {dmy(cur.to)}
            {diag.closed ? "" : " (até ontem, último dia completo)"} × {prev.label}:{" "}
            {dmy(prev.from)} a {dmy(prev.to)}. Mesmo número de dias, para a comparação ser justa.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {diag.headline.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label={diag.closed ? `${cur.label} (mês inteiro)` : `${cur.label} até dia ${day}`}
          value={fmtBRL(revenue.current)}
          sub={`${delta(revenue.current, revenue.previous)} × ${prev.label}`}
        />
        <Kpi
          label={`${prev.label} mesmo período`}
          value={fmtBRL(revenue.previous)}
          sub={`mês inteiro: ${fmtBRL(revenue.previousFullMonth)}`}
        />
        <Kpi
          label="Média dos meses anteriores"
          value={revenue.avgSameDays != null ? fmtBRL(revenue.avgSameDays) : "—"}
          sub={`até o dia ${day}, ${revenue.avgMonths} mês(es)`}
        />
        {revenue.projection != null ? (
          <Kpi
            label="Projeção de fechamento"
            value={fmtBRL(revenue.projection)}
            sub={`se o resto repetir ${prev.label}`}
          />
        ) : (
          <Kpi
            label="Clientes pagantes"
            value={String(diag.clients.current)}
            sub={`${prev.label}: ${diag.clients.previous}`}
          />
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Suspeitos, um por um</h3>
        <p className="text-sm text-muted-foreground">
          Valores com ≈ são estimados: horas de quadra × {fmtBRL(diag.usage.revPerHour)} (receita
          média por hora de uso por cliente em {prev.label}). Os fatores se sobrepõem — um fixo que
          saiu também aparece na queda de Mensalista —, então não some os valores.
        </p>
        {diag.factors.map((f) => (
          <Card key={f.title} className="break-inside-avoid">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{f.title}</CardTitle>
                <div className="flex items-center gap-2">
                  {f.impact != null && f.weight !== "info" && (
                    <span className="text-sm font-semibold tabular-nums">
                      {f.impact > 0 ? "−" : f.impact < 0 ? "+" : ""}
                      {f.estimated ? "≈" : ""}
                      {fmtBRL(Math.abs(f.impact))}
                    </span>
                  )}
                  <Badge className={WEIGHT_STYLE[f.weight].cls}>
                    {WEIGHT_STYLE[f.weight].label}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{f.text}</p>
              {f.details.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {f.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ChartCard
        title="Receita por tipo, mesmo período"
        hint={`Caixa de ${prev.label} × ${cur.label} até o dia ${day}.`}
      >
        <ResponsiveContainer>
          <BarChart data={groupChart}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="group" />
            <YAxis tickFormatter={kfmt} />
            <Tooltip formatter={(v: number) => fmtBRL(v)} />
            <Legend />
            <Bar dataKey={prev.label} fill="#64748b" radius={[4, 4, 0, 0]} />
            <Bar dataKey={cur.label} fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle className="text-base">Detalhe por tipo de receita</CardTitle>
          <p className="text-sm text-muted-foreground">
            Todas as colunas no mesmo número de dias do mês.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Média dos meses anteriores</TableHead>
                <TableHead className="text-right">{prev.label}</TableHead>
                <TableHead className="text-right">{cur.label}</TableHead>
                <TableHead className="text-right">Diferença × {prev.label}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diag.groups.map((g) => (
                <TableRow key={g.group}>
                  <TableCell>{g.group}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {g.average != null ? fmtBRL(g.average) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRL(g.previous)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRL(g.current)}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${g.delta < 0 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {g.delta >= 0 ? "+" : ""}
                    {fmtBRL(g.delta)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ----------------------------------------------------------- evolução ---

function EvolutionTab({ ev }: { ev: ReturnType<typeof computeEvolution> }) {
  const [view, setView] = useState<"competencia" | "caixa">("competencia");
  const complete = ev.months.filter((m) => !m.partial);
  const last = complete[complete.length - 1];
  const avg = complete.length
    ? complete.reduce((s, m) => s + m.competencia, 0) / complete.length
    : 0;
  const stacked = ev.months.map((m) => ({ label: m.label, ...m.byGroup }));
  return (
    <>
      <Insights items={ev.insights} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Último mês fechado"
          value={last ? fmtBRL(last.competencia) : "—"}
          sub={last ? `${last.label} · competência` : undefined}
        />
        <Kpi label="Média mensal" value={fmtBRL(avg)} sub={`${complete.length} meses fechados`} />
        <Kpi
          label="Clientes pagantes"
          value={last ? String(last.clientes) : "—"}
          sub={last ? `ticket ${fmtBRL(last.ticket)}` : undefined}
        />
        <Kpi
          label="Mês atual até hoje"
          value={ev.mtd ? fmtBRL(ev.mtd.current) : "—"}
          sub={
            ev.mtd ? `mês anterior até dia ${ev.mtd.day}: ${fmtBRL(ev.mtd.previous)}` : undefined
          }
        />
      </div>

      <ChartCard
        title="Curva de faturamento mês a mês"
        hint="Caixa = quando o dinheiro entrou. Competência = mês a que o lançamento se refere. O mês atual está incompleto."
      >
        <ResponsiveContainer>
          <ComposedChart data={ev.months}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={kfmt} />
            <Tooltip formatter={(v: number) => fmtBRL(v)} />
            <Legend />
            <Bar
              dataKey="caixa"
              name="Caixa"
              fill="var(--color-primary)"
              opacity={0.35}
              radius={[4, 4, 0, 0]}
            />
            <Line
              dataKey="competencia"
              name="Competência"
              stroke="var(--color-primary)"
              strokeWidth={3}
              dot
            />
            {avg > 0 && (
              <ReferenceLine
                y={avg}
                stroke="#64748b"
                strokeDasharray="4 4"
                label={{ value: "média", fontSize: 11, fill: "#64748b" }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="De onde vem o faturamento"
        hint="Receita (caixa) por família de categoria em cada mês."
      >
        <ResponsiveContainer>
          <AreaChart data={stacked}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={kfmt} />
            <Tooltip formatter={(v: number) => fmtBRL(v)} />
            <Legend />
            {ev.groups.map((g, i) => (
              <Area
                key={g}
                dataKey={g}
                stackId="1"
                stroke={SERIES[i % SERIES.length]}
                fill={SERIES[i % SERIES.length]}
                fillOpacity={0.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Comparação ano a ano"
          hint="Uma linha por ano (competência, só meses fechados). Ganha valor a partir do segundo ano de dados."
        >
          <ResponsiveContainer>
            <LineChart data={ev.byYear}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={kfmt} />
              <Tooltip formatter={(v: number) => fmtBRL(v)} />
              <Legend />
              {ev.years.map((y, i) => (
                <Line
                  key={y}
                  dataKey={y}
                  stroke={SERIES[i % SERIES.length]}
                  strokeWidth={2}
                  connectNulls={false}
                  dot
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          title="Índice de sazonalidade"
          hint="Cada mês em relação à média dos últimos 12 meses (100% = mês médio)."
        >
          {ev.seasonality ? (
            <ResponsiveContainer>
              <BarChart
                data={ev.seasonality.map((s) => ({ ...s, index: Math.round(s.index * 100) }))}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" />
                <YAxis unit="%" />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <ReferenceLine y={100} stroke="#64748b" />
                <Bar
                  dataKey="index"
                  name="Índice"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <p>{ev.completeMonths} de 12 meses fechados.</p>
              <div className="h-2 w-48 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${(ev.completeMonths / 12) * 100}%` }}
                />
              </div>
              <p>O índice aparece sozinho quando o sistema completar 12 meses de dados.</p>
            </div>
          )}
        </ChartCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhamento mensal</CardTitle>
          <div className="flex gap-2 text-sm">
            {(["competencia", "caixa"] as const).map((v) => (
              <button
                key={v}
                className={`rounded px-2 py-1 ${view === v ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                onClick={() => setView(v)}
              >
                {v === "competencia" ? "Competência" : "Caixa"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Variação</TableHead>
                <TableHead className="text-right">Clientes pagantes</TableHead>
                <TableHead className="text-right">Ticket por cliente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ev.months.map((m, i) => {
                const val = m[view];
                const prev = i > 0 ? ev.months[i - 1][view] : 0;
                const d = prev > 0 ? val / prev - 1 : null;
                return (
                  <TableRow key={m.ym}>
                    <TableCell className="font-medium">
                      {m.label} {m.partial && <Badge variant="outline">em andamento</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{fmtBRL(val)}</TableCell>
                    <TableCell
                      className={`text-right ${d == null ? "text-muted-foreground" : d >= 0 ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {d == null || m.partial ? "—" : `${d >= 0 ? "+" : ""}${pct(d, 1)}`}
                    </TableCell>
                    <TableCell className="text-right">{m.clientes}</TableCell>
                    <TableCell className="text-right">{fmtBRL(m.ticket)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ----------------------------------------------------------- ocupação ---

function OccupancyTab({ occ }: { occ: ReturnType<typeof computeOccupancy> }) {
  const byKey = new Map(occ.cells.map((c) => [slotKey(c.weekday, c.hour), c]));
  const maxIdle = Math.max(1, ...occ.cells.map((c) => c.idleValue));
  return (
    <>
      <Insights items={occ.insights} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Ocupação geral"
          value={pct(occ.totalRate)}
          sub="horas-quadra de funcionamento"
        />
        <Kpi
          label="Faixas de horário nobre"
          value={String(occ.primeKeys.size)}
          sub={`ocupação ≥ ${pct(occ.primeThreshold)}`}
        />
        <Kpi
          label="Teto das horas ociosas"
          value={brl0(occ.idleValue)}
          sub="a preço de tabela do Avulso"
        />
        <Kpi label="Quadras" value="4" sub="1 tênis (saibro) + 3 pickleball" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ocupação por dia e hora</CardTitle>
          <p className="text-sm text-muted-foreground">
            Percentual das 4 quadras ocupado em cada faixa, na média do período. Inclui locações
            fixas, avulsas e aulas.
          </p>
        </CardHeader>
        <CardContent>
          <Heatmap
            title="Ocupação"
            hours={occ.hours}
            value={(wd, h) => {
              const c = byKey.get(slotKey(wd, h));
              if (!c) return { v: null, intensity: 0 };
              return {
                v: c.rate,
                intensity: c.rate,
                title: `${WEEKDAY_SHORT[wd]} ${h}h · ${pct(c.rate)} ocupado · ${Math.round(c.occupied)} de ${c.capacity} horas-quadra`,
              };
            }}
            format={(v) => String(Math.round(v * 100))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onde o dinheiro fica parado</CardTitle>
          <p className="text-sm text-muted-foreground">
            Horas vazias × preço de tabela do Avulso em cada faixa (em R$ mil, no período).
          </p>
        </CardHeader>
        <CardContent>
          <Heatmap
            title="Valor ocioso"
            hours={occ.hours}
            value={(wd, h) => {
              const c = byKey.get(slotKey(wd, h));
              if (!c) return { v: null, intensity: 0 };
              return {
                v: c.idleValue,
                intensity: c.idleValue / maxIdle,
                title: `${WEEKDAY_SHORT[wd]} ${h}h · ${fmtBRL(c.idleValue)} em horas vazias`,
              };
            }}
            format={(v) =>
              v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",") : v > 0 ? "<1" : "0"
            }
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Ocupação por quadra">
          <ResponsiveContainer>
            <BarChart data={occ.byCourt.map((c) => ({ ...c, rate: Math.round(c.rate * 100) }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="court" />
              <YAxis unit="%" />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar
                dataKey="rate"
                name="Ocupação"
                fill="var(--color-primary)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          title="Quem usa as quadras"
          hint="Horas de uso por família de categoria no período."
        >
          <ResponsiveContainer>
            <BarChart data={occ.byGroup} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" tickFormatter={kfmt} />
              <YAxis type="category" dataKey="group" width={110} />
              <Tooltip formatter={(v: number) => hfmt(v)} />
              <Bar dataKey="hours" name="Horas" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  );
}

// ----------------------------------------------------------- retenção ---

function RetentionTab({
  ret,
  showAll = false,
}: {
  ret: ReturnType<typeof computeRetention>;
  showAll?: boolean;
}) {
  const [limit, setShow] = useState(30);
  const show = showAll ? Infinity : limit;
  return (
    <>
      <Insights items={ret.insights} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Em risco alto"
          value={String(ret.risks.filter((r) => r.level === "alto").length)}
        />
        <Kpi
          label="Em risco médio"
          value={String(ret.risks.filter((r) => r.level === "medio").length)}
        />
        <Kpi
          label="Receita mensal em risco"
          value={fmtBRL(ret.revenueAtRisk)}
          sub="média dos últimos 3 meses"
        />
        <Kpi
          label="Ativos no mês"
          value={String(ret.flow[ret.flow.length - 1]?.ativos ?? 0)}
          sub="jogaram ou pagaram"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quem ligar esta semana</CardTitle>
          <p className="text-sm text-muted-foreground">
            Compara as últimas 4 semanas com as 8 anteriores. Também entra quem saiu do horário fixo nos últimos 60 dias. Quem tem
            férias/afastamento lançado no horário fixo fica de fora. Ordenado por risco e por valor.
          </p>
        </CardHeader>
        <CardContent>
          {ret.risks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum cliente com sinal de saída agora.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Risco</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Sinal</TableHead>
                    <TableHead className="text-right">Freq. antes → agora</TableHead>
                    <TableHead className="text-right">Última vez</TableHead>
                    <TableHead className="text-right">R$/mês</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ret.risks.slice(0, show).map((r) => (
                    <TableRow key={r.clientId}>
                      <TableCell>
                        <Badge variant={r.level === "alto" ? "destructive" : "secondary"}>
                          {r.level === "alto" ? "Alto" : "Médio"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.category}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.phone ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.reasons.join(" · ")}</TableCell>
                      <TableCell className="text-right text-xs">
                        {r.baselinePerWeek.toFixed(1).replace(".", ",")} →{" "}
                        {r.recentPerWeek.toFixed(1).replace(".", ",")} /sem
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.daysSince == null ? "—" : `há ${r.daysSince} dias`}
                      </TableCell>
                      <TableCell className="text-right">{fmtBRL(r.monthlyRevenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {ret.risks.length > show && (
                <button
                  className="mt-3 text-sm text-primary underline"
                  onClick={() => setShow((s) => s + 30)}
                >
                  Mostrar mais ({ret.risks.length - show})
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ChartCard
        title="Entradas e saídas de clientes por mês"
        hint="Perdido = ativo no mês e sem nenhuma atividade nos 2 meses seguintes (só aparece quando esses 2 meses já passaram). O primeiro mês é a base que já existia."
      >
        <ResponsiveContainer>
          <ComposedChart data={ret.flow}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" />
            <YAxis yAxisId="l" />
            <YAxis yAxisId="r" orientation="right" />
            <Tooltip />
            <Legend />
            <Bar yAxisId="l" dataKey="novos" name="Novos" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar
              yAxisId="l"
              dataKey="perdidos"
              name="Perdidos"
              fill="#ef4444"
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="r"
              dataKey="ativos"
              name="Ativos"
              stroke="var(--color-primary)"
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coortes — quantos continuam depois de entrar</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada linha é o grupo que começou naquele mês; cada coluna, quantos meses depois.
            Percentual ainda ativo.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="text-left font-normal text-muted-foreground">Entrada</th>
                <th className="font-normal text-muted-foreground">Clientes</th>
                {Array.from({ length: ret.maxCohortCols }, (_, i) => (
                  <th key={i} className="font-normal text-muted-foreground">
                    M{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ret.cohorts.map((c) => (
                <tr key={c.ym}>
                  <td className="pr-2 font-medium">
                    {c.label}
                    {c.base && <span className="ml-1 text-muted-foreground">(base)</span>}
                  </td>
                  <td className="text-center">{c.size}</td>
                  {Array.from({ length: ret.maxCohortCols }, (_, i) => {
                    const v = c.cells[i];
                    if (v == null) return <td key={i} />;
                    return (
                      <td
                        key={i}
                        className="h-7 rounded text-center tabular-nums"
                        style={{
                          background: `color-mix(in oklab, var(--color-primary) ${Math.round(v * 90)}%, transparent)`,
                          color: v > 0.6 ? "white" : undefined,
                        }}
                      >
                        {Math.round(v * 100)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Migração entre categorias</CardTitle>
          <p className="text-sm text-muted-foreground">
            Mudanças da categoria principal de pagamento de um mês para outro.
          </p>
        </CardHeader>
        <CardContent>
          {ret.migrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma mudança de categoria registrada.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>De</TableHead>
                  <TableHead>Para</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ret.migrations.slice(0, 15).map((m) => (
                  <TableRow key={`${m.from}-${m.to}`}>
                    <TableCell>{m.from}</TableCell>
                    <TableCell>{m.to}</TableCell>
                    <TableCell className="text-right">{m.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// -------------------------------------------------- demanda reprimida ---

function DemandTab({ dem }: { dem: ReturnType<typeof computeDemand> }) {
  const byKey = new Map(dem.cells.map((c) => [slotKey(c.weekday, c.hour), c]));
  const max = Math.max(1, ...dem.cells.map((c) => c.count));
  return (
    <>
      <Insights items={dem.insights} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Lista de espera avulsa"
          value={String(dem.totals.avulsa)}
          sub={`${dem.totals.avulsaAtendida} atendidos`}
        />
        <Kpi
          label="Fila de fixo"
          value={String(dem.totals.fixa)}
          sub={`${dem.totals.fixaAguardando} aguardando agora`}
        />
        <Kpi label="Recusas no portal" value={String(dem.totals.falhas)} />
        <Kpi
          label="Total não atendido"
          value={String(dem.totals.avulsa + dem.totals.fixa + dem.totals.falhas)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onde a procura excede a oferta</CardTitle>
          <p className="text-sm text-muted-foreground">
            Número de pedidos não atendidos de imediato por faixa. Passe o mouse para ver a ocupação
            da faixa.
          </p>
        </CardHeader>
        <CardContent>
          <Heatmap
            title="Demanda reprimida"
            hours={dem.hours}
            value={(wd, h) => {
              const c = byKey.get(slotKey(wd, h));
              if (!c) return { v: 0, intensity: 0 };
              return {
                v: c.count,
                intensity: c.count / max,
                title: `${WEEKDAY_SHORT[wd]} ${h}h · ${c.count} pedidos${c.rate != null ? ` · ${pct(c.rate)} ocupado` : ""}`,
              };
            }}
            format={(v) => (v ? String(v) : "")}
          />
        </CardContent>
      </Card>
      {dem.topFixed.length > 0 && (
        <ChartCard
          title="Fila de horário fixo — faixas mais pedidas"
          hint="Pessoas aguardando vaga fixa agora."
        >
          <ResponsiveContainer>
            <BarChart data={dem.topFixed}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Aguardando" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </>
  );
}

// -------------------------------------------------------- concentração ---

function ConcentrationTab({ con }: { con: ReturnType<typeof computeConcentration> }) {
  return (
    <>
      <Insights items={con.insights} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Faturamento do período" value={fmtBRL(con.total)} />
        <Kpi label="Clientes pagantes" value={String(con.clients.length)} />
        <Kpi label="Clientes A" value={String(con.aCount)} sub="fazem 80% da receita" />
        <Kpi
          label="Maior cliente"
          value={con.clients[0] ? pct(con.clients[0].share, 1) : "—"}
          sub={con.clients[0]?.name}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Curva de concentração"
          hint="% dos clientes (do maior para o menor) × % da receita acumulada."
        >
          <ResponsiveContainer>
            <AreaChart data={con.curve}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="x" type="number" unit="%" domain={[0, 100]} />
              <YAxis unit="%" domain={[0, 100]} />
              <Tooltip
                formatter={(v: number) => `${v}%`}
                labelFormatter={(l) => `${l}% dos clientes`}
              />
              <ReferenceLine y={80} stroke="#64748b" strokeDasharray="4 4" />
              <Area
                dataKey="y"
                name="Receita acumulada"
                stroke="var(--color-primary)"
                fill="var(--color-primary)"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Receita por família de categoria">
          <ResponsiveContainer>
            <BarChart data={con.byGroup} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" tickFormatter={kfmt} />
              <YAxis type="category" dataKey="group" width={110} />
              <Tooltip formatter={(v: number) => fmtBRL(v)} />
              <Bar
                dataKey="revenue"
                name="Receita"
                fill="var(--color-primary)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      {con.byTeacher.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dependência de professores</CardTitle>
            <p className="text-sm text-muted-foreground">
              Receita dos clientes vinculados a cada professor (cadastro do cliente).
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Professor</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">% do total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {con.byTeacher.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right">{t.clients}</TableCell>
                    <TableCell className="text-right">{fmtBRL(t.revenue)}</TableCell>
                    <TableCell className="text-right">{pct(t.share, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking de clientes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">% </TableHead>
                <TableHead className="text-right">Acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {con.clients.slice(0, 50).map((c, i) => (
                <TableRow key={c.clientId}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.category}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.abc === "A" ? "default" : "outline"}>{c.abc}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{fmtBRL(c.revenue)}</TableCell>
                  <TableCell className="text-right">{pct(c.share, 1)}</TableCell>
                  <TableCell className="text-right">{pct(c.cum)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL, fmtDate, monthStartISO, monthEndISO, dayStartISO, dayEndExclusiveISO } from "@/lib/format";
import { Printer } from "lucide-react";
import { useUrlState } from "@/hooks/useUrlState";
import { toast } from "sonner";
import { isSaldoAnterior, isNonRevenueCategory } from "@/lib/category";
import { fetchAll, runWithConcurrency } from "@/lib/fetchAll";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { PAYMENT_METHOD_LABELS as METHOD_LABEL } from "@/lib/payment-methods";

export const Route = createFileRoute("/relatorios")({
  component: () => (
    <RequireAuth rolesAllowed={["diretoria"]}>
      <RelatoriosPage />
    </RequireAuth>
  ),
});


const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function RelatoriosPage() {
  const { canSeeDebt } = useAuth();
  const [from, setFrom] = useUrlState<string>("from", monthStartISO());
  const [to, setTo] = useUrlState<string>("to", monthEndISO());
  const [activeTab, setActiveTab] = useUrlState<string>("tab", "faturamento");
  const [payments, setPayments] = useState<any[]>([]);
  const [allPaymentsRaw, setAllPaymentsRaw] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [forecast, setForecast] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [newClients, setNewClients] = useState(0);
  const [activeClients, setActiveClients] = useState(0);
  const [profilesMap, setProfilesMap] = useState<Map<string, string>>(new Map());
  const [categoryNameMap, setCategoryNameMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [monthlyRevenue, setMonthlyRevenue] = useState<Array<{ month: string; label: string; total: number; count: number }>>([]);

  // Início/fim do dia em Recife (UTC-3 fixo). Helpers centralizados em lib/format.
  const localDayStartISO = dayStartISO;
  const localDayEndExclusiveISO = dayEndExclusiveISO;

  const load = async () => {
    setLoading(true);
    const startISO = localDayStartISO(from);
    const endISO = localDayEndExclusiveISO(to);
    const fetchAllPayments = async () => {
      const cols = "amount, passthrough_amount, method, paid_at, start_time, court, recorded_by, received, to_account, account_direction, category_id, clients(full_name, category_id, client_categories(name))";
      const pageSize = 1000;
      const first = await supabase
        .from("payments")
        .select(cols, { count: "exact" })
        .gte("paid_at", startISO)
        .lt("paid_at", endISO)
        .order("paid_at", { ascending: false })
        .range(0, pageSize - 1);
      if (first.error) throw first.error;
      const firstChunk = first.data ?? [];
      const total = first.count ?? firstChunk.length;
      if (firstChunk.length < pageSize || total <= pageSize) return { data: firstChunk };
      const totalPages = Math.ceil(total / pageSize);
      const restPages = await runWithConcurrency(
        Array.from({ length: totalPages - 1 }, (_, i) => () => {
          const from = (i + 1) * pageSize;
          const to = from + pageSize - 1;
          return supabase
            .from("payments")
            .select(cols)
            .gte("paid_at", startISO)
            .lt("paid_at", endISO)
            .order("paid_at", { ascending: false })
            .range(from, to)
            .then(({ data, error }) => {
              if (error) throw error;
              return data ?? [];
            });
        }),
        2,
      );
      return { data: [firstChunk, ...restPages].flat() };
    };
    const [pays, entries, allOpen, profs, clientsCount, newClientsRes, catsRes] = await Promise.all([
      fetchAllPayments(),
      fetchAll<any>(
        "account_entries",
        "client_id, entry_type, amount, entry_date, clients(full_name, phone, client_categories(name))",
      ),
      supabase
        .from("monthly_charges")
        .select("amount", { count: "exact" })
        .gte("reference_month", monthStartISO())
        .lte("reference_month", monthEndISO()),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("active", true),
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startISO)
        .lt("created_at", endISO),
      supabase.from("client_categories").select("id, name"),
    ]);

    const catMap = new Map<string, string>();
    (catsRes.data ?? []).forEach((c: any) => catMap.set(c.id, c.name));
    setCategoryNameMap(catMap);

    const pmap = new Map<string, string>();
    (profs.data ?? []).forEach((p: any) => pmap.set(p.id, p.full_name));
    setProfilesMap(pmap);

    // Excluir lançamentos que foram débito na conta do cliente (não recebidos no caixa).
    // Só conta como pagamento real quando "recebido" estiver marcado, ou quando for crédito na conta.
    // Categoria "Saldo Anterior" NUNCA entra em somas (é apenas dado importado).
    const resolveCatName = (p: any): string => {
      if (p.category_id && catMap.get(p.category_id)) return catMap.get(p.category_id)!;
      if (p.clients?.client_categories?.name) return p.clients.client_categories.name;
      if (p.clients?.category_id && catMap.get(p.clients.category_id)) return catMap.get(p.clients.category_id)!;
      return "";
    };
    const allPays = (pays.data ?? []).filter((p: any) => !isSaldoAnterior(resolveCatName(p)));
    // Faturamento = somente pagamentos efetivamente recebidos (mesmo critério das Metas).
    // Lançamentos de crédito na conta do cliente que não foram recebidos em caixa não entram.
    const realPayments = allPays.filter((p: any) => p.received === true);
    setPayments(realPayments);
    setAllPaymentsRaw(allPays);
    setActiveClients(clientsCount.count ?? 0);
    setNewClients(newClientsRes.count ?? 0);

    const map = new Map<string, { id: string; client: any; balance: number; lastDate: string | null }>();
    (entries ?? []).forEach((e: any) => {
      const cur = map.get(e.client_id) ?? { id: e.client_id, client: e.clients, balance: 0, lastDate: null };
      const sign = e.entry_type === "credito" ? 1 : -1;
      cur.balance += sign * Number(e.amount);
      if (e.entry_type === "debito") {
        if (!cur.lastDate || e.entry_date > cur.lastDate) cur.lastDate = e.entry_date;
      }
      cur.client = e.clients ?? cur.client;
      map.set(e.client_id, cur);
    });
    const negatives = Array.from(map.values())
      .filter((v) => v.balance < 0)
      .map((v) => ({
        id: v.id,
        full_name: v.client?.full_name ?? "—",
        phone: v.client?.phone ?? "—",
        category: v.client?.client_categories?.name ?? "—",
        last_date: v.lastDate,
        amount: Math.abs(v.balance),
      }))
      .sort((a, b) => b.amount - a.amount);
    setOverdue(negatives);

    const total = (allOpen.data ?? []).reduce((s: number, c: any) => s + Number(c.amount), 0);
    setForecast({ total, count: allOpen.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // Realtime: atualiza relatórios quando recepcionistas registram pagamentos/lançamentos
  useEffect(() => {
    const channel = supabase
      .channel("relatorios-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "account_entries" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_charges" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // Comparativo de faturamento por mês (últimos 12 meses) — independe do filtro de período
  const loadMonthlyRevenue = async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const startISO = new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0).toISOString();
    const cols = "amount, passthrough_amount, paid_at, received, to_account, account_direction, category_id, clients(category_id, client_categories(name))";
    const pageSize = 1000;
    const data: any[] = [];
    let offset = 0;
    while (true) {
      const { data: chunk, error } = await supabase
        .from("payments")
        .select(cols)
        .gte("paid_at", startISO)
        .range(offset, offset + pageSize - 1);
      if (error) break;
      const arr = chunk ?? [];
      data.push(...arr);
      if (arr.length < pageSize) break;
      offset += pageSize;
    }
    const { data: cats } = await supabase.from("client_categories").select("id, name");
    const catMap = new Map<string, string>();
    (cats ?? []).forEach((c: any) => catMap.set(c.id, c.name));
    const resolveCat = (p: any): string => {
      if (p.category_id && catMap.get(p.category_id)) return catMap.get(p.category_id)!;
      if (p.clients?.client_categories?.name) return p.clients.client_categories.name;
      if (p.clients?.category_id && catMap.get(p.clients.category_id)) return catMap.get(p.clients.category_id)!;
      return "";
    };
    const months: Array<{ month: string; label: string; total: number; count: number }> = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
      months.push({ month: ym, label, total: 0, count: 0 });
    }
    const idx = new Map(months.map((m, i) => [m.month, i] as const));
    (data ?? []).forEach((p: any) => {
      if (!p.received) return;
      const cat = resolveCat(p);
      if (isNonRevenueCategory(cat)) return;
      const ym = (p.paid_at as string).slice(0, 7);
      const i = idx.get(ym);
      if (i == null) return;
      months[i].total += Number(p.amount) - Number(p.passthrough_amount ?? 0);
      months[i].count += 1;
    });
    setMonthlyRevenue(months);
  };

  useEffect(() => {
    loadMonthlyRevenue();
    const channel = supabase
      .channel("relatorios-monthly-rev")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => loadMonthlyRevenue())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const resolveCategory = (p: any): string => {
    if (p.category_id && categoryNameMap.get(p.category_id)) return categoryNameMap.get(p.category_id)!;
    if (p.clients?.client_categories?.name) return p.clients.client_categories.name;
    if (p.clients?.category_id && categoryNameMap.get(p.clients.category_id)) return categoryNameMap.get(p.clients.category_id)!;
    return "Avulso";
  };

  const stats = useMemo(() => {
    // Pagamentos que entram no faturamento da empresa (exclui terno de bola, grip, saldo anterior)
    const revenuePayments = payments.filter((p) => !isNonRevenueCategory(resolveCategory(p)));
    const total = revenuePayments.reduce((s, p) => s + Number(p.amount) - Number((p as any).passthrough_amount ?? 0), 0);
    const count = revenuePayments.length;
    const avgTicket = count ? total / count : 0;

    const byMethod = new Map<string, number>();
    const byCategory = new Map<string, { total: number; count: number }>();
    const byOperator = new Map<string, number>();
    const byDay = new Map<string, number>();
    const byWeekday = new Map<number, { total: number; count: number }>();
    const byHour = new Map<number, number>();
    const byCourt = new Map<string, { total: number; count: number }>();

    for (let i = 0; i < 7; i++) byWeekday.set(i, { total: 0, count: 0 });

    payments.forEach((p) => {
      const amt = Number(p.amount) - Number((p as any).passthrough_amount ?? 0);
      const cat = resolveCategory(p);
      const isRevenue = !isNonRevenueCategory(cat);

      // byCategory mantém todas as categorias (para visibilidade)
      const c = byCategory.get(cat) ?? { total: 0, count: 0 };
      c.total += amt;
      c.count += 1;
      byCategory.set(cat, c);

      // Demais agregações usam apenas receita da empresa
      if (isRevenue) {
        byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + amt);

        const opName = profilesMap.get(p.recorded_by) ?? "—";
        byOperator.set(opName, (byOperator.get(opName) ?? 0) + amt);

        const date = new Date(p.paid_at);
        const d = (p.paid_at as string).slice(0, 10);
        byDay.set(d, (byDay.get(d) ?? 0) + amt);

        const wd = date.getDay();
        const w = byWeekday.get(wd)!;
        w.total += amt;
        w.count += 1;

        // hour from start_time (HH:MM:SS) or from paid_at
        let hour: number | null = null;
        if (p.start_time) hour = parseInt((p.start_time as string).slice(0, 2), 10);
        else hour = date.getHours();
        if (!isNaN(hour)) byHour.set(hour, (byHour.get(hour) ?? 0) + 1);

        if (p.court != null) {
          const key = `Quadra ${p.court}`;
          const cc = byCourt.get(key) ?? { total: 0, count: 0 };
          cc.total += amt;
          cc.count += 1;
          byCourt.set(key, cc);
        }
      }
    });

    const weekdayArr = Array.from(byWeekday.entries())
      .map(([i, v]) => ({ name: WEEKDAYS[i], total: v.total, count: v.count, avg: v.count ? v.total / v.count : 0 }));

    const topWeekday = [...weekdayArr].sort((a, b) => b.count - a.count)[0];

    const hourArr = Array.from({ length: 24 }, (_, h) => ({
      name: `${String(h).padStart(2, "0")}h`,
      count: byHour.get(h) ?? 0,
    }));
    const peakHour = [...hourArr].sort((a, b) => b.count - a.count)[0];

    return {
      total,
      count,
      avgTicket,
      topWeekday,
      peakHour,
      byMethod: Array.from(byMethod.entries()).map(([name, total]) => ({ name: METHOD_LABEL[name] ?? name, total })),
      byCategory: Array.from(byCategory.entries()).map(([name, v]) => ({
        name,
        total: v.total,
        count: v.count,
        avg: v.count ? v.total / v.count : 0,
      })),
      byOperator: Array.from(byOperator.entries()).map(([name, total]) => ({ name, total })),
      byDay: Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, total]) => ({ name: name.slice(8, 10) + "/" + name.slice(5, 7), total })),
      byWeekday: weekdayArr,
      byHour: hourArr,
      byCourt: Array.from(byCourt.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, v]) => ({ name, total: v.total, count: v.count })),
    };
  }, [payments, profilesMap, categoryNameMap]);

  // Monthly breakdown by category (uses real payments — receita efetiva)
  // and by court (uses ALL payments, treating debits as positive — uso da quadra)
  const monthly = useMemo(() => {
    const monthsSet = new Set<string>();
    const catMap = new Map<string, Map<string, number>>(); // category -> month -> total
    const courtMap = new Map<string, Map<string, number>>(); // court -> month -> total

    payments.forEach((p: any) => {
      const month = (p.paid_at as string).slice(0, 7); // YYYY-MM
      monthsSet.add(month);
      const cat = resolveCategory(p);
      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const m = catMap.get(cat)!;
      m.set(month, (m.get(month) ?? 0) + Number(p.amount));
    });

    // Para quadras: contabilizar TODOS os valores envolvendo quadras (mesmo débitos),
    // sempre como positivo, pois representa uso/faturamento da quadra.
    allPaymentsRaw.forEach((p: any) => {
      if (p.court == null) return;
      const month = (p.paid_at as string).slice(0, 7);
      monthsSet.add(month);
      const key = `Quadra ${p.court}`;
      if (!courtMap.has(key)) courtMap.set(key, new Map());
      const m = courtMap.get(key)!;
      m.set(month, (m.get(month) ?? 0) + Math.abs(Number(p.amount)));
    });

    const months = Array.from(monthsSet).sort();
    const monthLabel = (ym: string) => {
      const [y, mo] = ym.split("-");
      return `${mo}/${y.slice(2)}`;
    };

    const categoryRows = Array.from(catMap.entries())
      .map(([name, m]) => {
        const total = months.reduce((s, mo) => s + (m.get(mo) ?? 0), 0);
        return { name, byMonth: months.map((mo) => m.get(mo) ?? 0), total };
      })
      .sort((a, b) => b.total - a.total);

    const courtRows = Array.from(courtMap.entries())
      .map(([name, m]) => {
        const total = months.reduce((s, mo) => s + (m.get(mo) ?? 0), 0);
        return { name, byMonth: months.map((mo) => m.get(mo) ?? 0), total };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { months, monthLabels: months.map(monthLabel), categoryRows, courtRows };
  }, [payments, allPaymentsRaw, categoryNameMap]);

  const overdueTotal = overdue.reduce((s, c) => s + Number(c.amount), 0);
  const colors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

  const handlePrint = () => {
    const period = `${fmtDate(from)} a ${fmtDate(to)}`;
    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const row = (cells: (string | number)[]) =>
      `<tr>${cells.map((c, i) => `<td${i > 0 && typeof c === "string" && c.startsWith("R$") ? ' style="text-align:right"' : ""}>${esc(String(c))}</td>`).join("")}</tr>`;

    const tbl = (title: string, headers: string[], rows: string[]) => `
      <h2>${title}</h2>
      <table>
        <thead><tr>${headers.map((h, i) => `<th${i > 0 ? ' style="text-align:right"' : ""}>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("") || `<tr><td colspan="${headers.length}" style="text-align:center;color:#888">Sem dados</td></tr>`}</tbody>
      </table>`;

    const kpiBlock = `
      <div class="kpis">
        <div><span>Total no período</span><strong>${fmtBRL(stats.total)}</strong></div>
        <div><span>Pagamentos</span><strong>${stats.count}</strong></div>
        <div><span>Ticket médio</span><strong>${fmtBRL(stats.avgTicket)}</strong></div>
        <div><span>Dia mais movimentado</span><strong>${stats.topWeekday?.name ?? "—"}</strong></div>
        <div><span>Horário de pico</span><strong>${stats.peakHour?.count ? stats.peakHour.name : "—"}</strong></div>
        <div><span>Clientes ativos</span><strong>${activeClients}</strong></div>
        <div><span>Novos clientes</span><strong>${newClients}</strong></div>
        ${
          canSeeDebt
            ? `<div><span>Inadimplentes</span><strong>${overdue.length} — ${fmtBRL(overdueTotal)}</strong></div>
        <div><span>Total de inadimplência</span><strong>${fmtBRL(overdueTotal)}</strong></div>`
            : ""
        }
      </div>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório ${period}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px;font-size:22px}
        h2{margin:24px 0 8px;font-size:15px;border-bottom:1px solid #ddd;padding-bottom:4px}
        p.sub{margin:0 0 16px;color:#555;font-size:13px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f3f4f6}
        .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 8px}
        .kpis>div{border:1px solid #e5e7eb;border-radius:6px;padding:8px}
        .kpis span{display:block;font-size:11px;color:#666}
        .kpis strong{display:block;font-size:14px;margin-top:2px}
      </style></head><body>
      <h1>Relatório gerencial</h1>
      <p class="sub">Período: ${period}</p>
      ${kpiBlock}
      ${tbl(
        "Faturamento por dia",
        ["Dia", "Valor"],
        stats.byDay.map((d) => row([d.name, fmtBRL(d.total)]))
      )}
      ${tbl(
        "Por dia da semana",
        ["Dia", "Pagamentos", "Total", "Ticket médio"],
        stats.byWeekday.map((d) => row([d.name, d.count, fmtBRL(d.total), fmtBRL(d.avg)]))
      )}
      ${tbl(
        "Por categoria",
        ["Categoria", "Pagamentos", "Total", "Ticket médio"],
        stats.byCategory.map((c) => row([c.name, c.count, fmtBRL(c.total), fmtBRL(c.avg)]))
      )}
      ${tbl(
        "Por forma de pagamento",
        ["Forma", "Total"],
        stats.byMethod.map((m) => row([m.name, fmtBRL(m.total)]))
      )}
      ${tbl(
        "Por recepcionista",
        ["Recepcionista", "Total"],
        stats.byOperator.map((o) => row([o.name, fmtBRL(o.total)]))
      )}
      ${tbl(
        "Por quadra",
        ["Quadra", "Pagamentos", "Total"],
        stats.byCourt.map((c) => row([c.name, c.count, fmtBRL(c.total)]))
      )}
      ${
        canSeeDebt
          ? tbl(
              "Inadimplência",
              ["Cliente", "Categoria", "Telefone", "Último débito", "Saldo devedor"],
              overdue.map((c) =>
                row([c.full_name, c.category ?? "—", c.phone ?? "—", c.last_date ? fmtDate(c.last_date) : "—", fmtBRL(c.amount)])
              )
            )
          : ""
      }
      <script>window.onload=()=>{window.print();}</script>
      </body></html>`;

    const w = window.open("", "_blank");
    if (!w) { toast.error("Permita pop-ups para imprimir."); return; }
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios gerenciais</h1>
          <p className="text-muted-foreground">Indicadores estratégicos para tomada de decisão</p>
        </div>
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" /> Imprimir relatório
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label>Início</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fim</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm text-muted-foreground">Total no período</p>
              <p className="text-2xl font-bold text-primary">{fmtBRL(stats.total)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pagamentos" value={String(stats.count)} sub="no período" />
        <KpiCard label="Ticket médio" value={fmtBRL(stats.avgTicket)} sub="por pagamento" />
        <KpiCard
          label="Dia mais movimentado"
          value={stats.topWeekday?.name ?? "—"}
          sub={stats.topWeekday ? `${stats.topWeekday.count} pagamentos` : ""}
        />
        <KpiCard
          label="Horário de pico"
          value={stats.peakHour?.count ? stats.peakHour.name : "—"}
          sub={stats.peakHour?.count ? `${stats.peakHour.count} pagamentos` : ""}
        />
        <KpiCard label="Clientes ativos" value={String(activeClients)} sub="no total" />
        <KpiCard label="Novos clientes" value={String(newClients)} sub="no período" />
        {canSeeDebt && (
          <>
            <KpiCard
              label="Clientes inadimplentes"
              value={String(overdue.length)}
              sub={`Total devido: ${fmtBRL(overdueTotal)}`}
            />
            <KpiCard label="Total de inadimplência" value={fmtBRL(overdueTotal)} sub={`${overdue.length} clientes devendo`} />
          </>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="faturamento">Faturamento</TabsTrigger>
          <TabsTrigger value="comportamento">Comportamento</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="formas-pagamento">Formas de pagamento</TabsTrigger>
          <TabsTrigger value="comparativo-mensal">Comparativo mensal</TabsTrigger>
        </TabsList>

        <TabsContent value="faturamento" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>Faturamento por dia</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={stats.byDay}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comportamento" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Pagamentos por dia da semana</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={stats.byWeekday}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v: number, n: string) => n === "total" ? fmtBRL(v) : v} />
                      <Legend />
                      <Bar dataKey="count" name="Qtd" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="total" name="Valor" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Horários de pico (qtd. pagamentos)</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <LineChart data={stats.byHour}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="var(--color-chart-3)" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="categorias" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Distribuição por categoria</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={stats.byCategory} dataKey="total" nameKey="name" outerRadius={90} label>
                        {stats.byCategory.map((_, i) => (
                          <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtBRL(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Ticket médio por categoria</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Ticket médio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.byCategory.sort((a, b) => b.total - a.total).map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-right">{c.count}</TableCell>
                        <TableCell className="text-right">{fmtBRL(c.total)}</TableCell>
                        <TableCell className="text-right font-medium text-primary">{fmtBRL(c.avg)}</TableCell>
                      </TableRow>
                    ))}
                    {stats.byCategory.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Sem dados</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="formas-pagamento" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Distribuição por forma de pagamento</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Percentual que cada forma representa do total recebido no período.
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats.byMethod}
                        dataKey="total"
                        nameKey="name"
                        outerRadius={90}
                        label={(e: any) =>
                          stats.total > 0 ? `${((e.total / stats.total) * 100).toFixed(1)}%` : ""
                        }
                      >
                        {stats.byMethod.map((_, i) => (
                          <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtBRL(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Detalhamento</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Forma</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">% do total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...stats.byMethod].sort((a, b) => b.total - a.total).map((m) => {
                      const pct = stats.total > 0 ? (m.total / stats.total) * 100 : 0;
                      return (
                        <TableRow key={m.name}>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell className="text-right">{fmtBRL(m.total)}</TableCell>
                          <TableCell className="text-right font-medium text-primary">
                            {pct.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {stats.byMethod.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                          Sem dados no período
                        </TableCell>
                      </TableRow>
                    )}
                    {stats.byMethod.length > 0 && (
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold">{fmtBRL(stats.total)}</TableCell>
                        <TableCell className="text-right font-semibold">100%</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="comparativo-mensal" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Comparativo de faturamento por mês</CardTitle>
              <p className="text-sm text-muted-foreground">
                Receita efetiva nos últimos 12 meses (independe do filtro de período acima).
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={monthlyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Bar dataKey="total" name="Faturamento" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Detalhamento mensal</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Pagamentos</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                    <TableHead className="text-right">Variação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyRevenue.map((m, i) => {
                    const prev = i > 0 ? monthlyRevenue[i - 1].total : 0;
                    const diff = prev > 0 ? ((m.total - prev) / prev) * 100 : null;
                    return (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{m.label}</TableCell>
                        <TableCell className="text-right">{m.count}</TableCell>
                        <TableCell className="text-right">{fmtBRL(m.total)}</TableCell>
                        <TableCell className={`text-right font-medium ${diff == null ? "text-muted-foreground" : diff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {diff == null ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

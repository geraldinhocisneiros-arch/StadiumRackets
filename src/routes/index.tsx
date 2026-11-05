import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtBRL, monthStartISO, monthEndISO, dayStartISO, dayEndExclusiveISO } from "@/lib/format";
import { TrendingUp, AlertCircle, UserX } from "lucide-react";
import { isNonRevenueCategory } from "@/lib/category";
import { fetchAll, runWithConcurrency } from "@/lib/fetchAll";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { PAYMENT_METHOD_LABELS as METHOD_LABELS } from "@/lib/payment-methods";

export const Route = createFileRoute("/")({
  component: () => (
    <RequireAuth rolesAllowed={["diretoria"]} fallbackRedirect>
      <DashboardPage />
    </RequireAuth>
  ),
});


interface Stats {
  monthTotal: number;
  inadimplenciaTotal: number;
  inadimplenciaCount: number;
  byDay: { day: string; total: number }[];
  byCategory: { name: string; total: number }[];
  byMethod: { name: string; total: number }[];
}

function DashboardPage() {
  const { canSeeDebt } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const monthStartUTC = dayStartISO(monthStartISO());
      const monthEndUTC = dayEndExclusiveISO(monthEndISO());

      const fetchAllPayments = async () => {
        const cols =
          "amount, passthrough_amount, paid_at, method, received, category_id, clients(category_id, client_categories(name))";
        const pageSize = 1000;
        const first = await supabase
          .from("payments")
          .select(cols, { count: "exact" })
          .gte("paid_at", monthStartUTC)
          .lt("paid_at", monthEndUTC)
          .range(0, pageSize - 1);
        if (first.error) throw first.error;
        const firstChunk = first.data ?? [];
        const total = first.count ?? firstChunk.length;
        if (firstChunk.length < pageSize || total <= pageSize) return firstChunk;
        const totalPages = Math.ceil(total / pageSize);
        const restPages = await runWithConcurrency(
          Array.from({ length: totalPages - 1 }, (_, i) => () => {
            const from = (i + 1) * pageSize;
            const to = from + pageSize - 1;
            return supabase
              .from("payments")
              .select(cols)
              .gte("paid_at", monthStartUTC)
              .lt("paid_at", monthEndUTC)
              .range(from, to)
              .then(({ data, error }) => {
                if (error) throw error;
                return data ?? [];
              });
          }),
          2,
        );
        return [firstChunk, ...restPages].flat();
      };

      const [paymentsAll, catsRes, clientsAll, entriesAll] = await Promise.all([
        fetchAllPayments(),
        supabase.from("client_categories").select("id, name"),
        fetchAll<{ id: string; active: boolean }>("clients", "id, active"),
        fetchAll<{ client_id: string; entry_type: string; amount: number }>(
          "account_entries",
          "client_id, entry_type, amount",
        ),
      ]);

      const catNameMap = new Map<string, string>();
      (catsRes.data ?? []).forEach((c: any) => catNameMap.set(c.id, c.name));

      const resolveCat = (p: any): string => {
        if (p.category_id && catNameMap.get(p.category_id)) return catNameMap.get(p.category_id)!;
        if (p.clients?.client_categories?.name) return p.clients.client_categories.name;
        if (p.clients?.category_id && catNameMap.get(p.clients.category_id))
          return catNameMap.get(p.clients.category_id)!;
        return "Avulso";
      };

      const localDay = (iso: string) => {
        const d = new Date(iso);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };

      const payments = paymentsAll;
      let monthTotal = 0;
      const byDayMap = new Map<string, number>();
      const byCatMap = new Map<string, number>();
      const byMethodMap = new Map<string, number>();

      for (const p of payments) {
        const amt = Number(p.amount) - Number((p as any).passthrough_amount ?? 0);
        const catName = resolveCat(p);
        if (isNonRevenueCategory(catName)) continue;
        const isReceived = (p as any).received === true;
        if (!isReceived) continue;
        const day = localDay(p.paid_at as string);

        monthTotal += amt;
        byDayMap.set(day, (byDayMap.get(day) ?? 0) + amt);
        byCatMap.set(catName, (byCatMap.get(catName) ?? 0) + amt);
        const m = (p as any).method as string | null;
        const label = METHOD_LABELS[m ?? ""] ?? "Outro";
        byMethodMap.set(label, (byMethodMap.get(label) ?? 0) + amt);
      }

      // Inadimplência: clientes ativos com saldo (account_entries) negativo
      const activeIds = new Set<string>(clientsAll.filter((c) => c.active).map((c) => c.id));
      const balanceMap = new Map<string, number>();
      (entriesAll as any[]).forEach((e) => {
        if (!activeIds.has(e.client_id)) return;
        const cur = balanceMap.get(e.client_id) ?? 0;
        const delta = e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
        balanceMap.set(e.client_id, cur + delta);
      });
      let inadimplenciaTotal = 0;
      let inadimplenciaCount = 0;
      balanceMap.forEach((bal) => {
        if (bal < 0) {
          inadimplenciaCount += 1;
          inadimplenciaTotal += -bal;
        }
      });

      const byDay = Array.from(byDayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, total]) => ({ day: day.slice(8, 10), total }));

      const byCategory = Array.from(byCatMap.entries()).map(([name, total]) => ({ name, total }));
      const byMethod = Array.from(byMethodMap.entries())
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total);

      setStats({
        monthTotal,
        inadimplenciaTotal,
        inadimplenciaCount,
        byDay,
        byCategory,
        byMethod,
      });
    } catch (error) {
      console.error("[Painel] falha ao carregar dados", error);
      toast.error(
        error instanceof Error
          ? `Não foi possível carregar o painel: ${error.message}`
          : "Não foi possível carregar o painel. Tente atualizar a página.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("painel-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "account_entries" }, () =>
        load(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const colors = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Painel</h1>
        <p className="text-muted-foreground">Visão geral financeira da academia</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Faturamento mensal"
          value={fmtBRL(stats?.monthTotal)}
          icon={TrendingUp}
          loading={loading}
        />
        {canSeeDebt && (
          <>
            <Link
              to="/inadimplentes"
              className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-lg"
            >
              <StatCard
                title="Inadimplência total"
                value={fmtBRL(stats?.inadimplenciaTotal)}
                icon={AlertCircle}
                loading={loading}
                accent="warning"
                clickable
              />
            </Link>
            <Link
              to="/inadimplentes"
              className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-lg"
            >
              <StatCard
                title="Clientes inadimplentes"
                value={String(stats?.inadimplenciaCount ?? "—")}
                icon={UserX}
                loading={loading}
                accent="warning"
                clickable
              />
            </Link>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recebimentos diários (mês atual)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={stats?.byDay ?? []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" />
                  <YAxis tickFormatter={(v) => `R$${v}`} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} />
                  <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por categoria de cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const catTotal = (stats?.byCategory ?? []).reduce((s, c) => s + Number(c.total), 0);
              return (
                <div className="h-[28rem]">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats?.byCategory ?? []}
                        dataKey="total"
                        nameKey="name"
                        outerRadius={140}
                        label={(e: any) => {
                          const pct = catTotal > 0 ? (Number(e.value) / catTotal) * 100 : 0;
                          return `${fmtBRL(e.value)} (${pct.toFixed(1)}%)`;
                        }}
                      >
                        {(stats?.byCategory ?? []).map((_, i) => (
                          <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) => {
                          const pct = catTotal > 0 ? (v / catTotal) * 100 : 0;
                          return [`${fmtBRL(v)} (${pct.toFixed(1)}%)`, name];
                        }}
                      />
                      <Legend
                        formatter={(value, entry: any) => {
                          const v = Number(entry?.payload?.total ?? 0);
                          const pct = catTotal > 0 ? (v / catTotal) * 100 : 0;
                          return `${value} — ${pct.toFixed(1)}%`;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Formas de pagamento (mês atual)</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const methodTotal = (stats?.byMethod ?? []).reduce((s, c) => s + Number(c.total), 0);
              return (
                <div className="h-[28rem]">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats?.byMethod ?? []}
                        dataKey="total"
                        nameKey="name"
                        outerRadius={140}
                        label={(e: any) => {
                          const pct = methodTotal > 0 ? (Number(e.value) / methodTotal) * 100 : 0;
                          return `${fmtBRL(e.value)} (${pct.toFixed(1)}%)`;
                        }}
                      >
                        {(stats?.byMethod ?? []).map((_, i) => (
                          <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) => {
                          const pct = methodTotal > 0 ? (v / methodTotal) * 100 : 0;
                          return [`${fmtBRL(v)} (${pct.toFixed(1)}%)`, name];
                        }}
                      />
                      <Legend
                        formatter={(value, entry: any) => {
                          const v = Number(entry?.payload?.total ?? 0);
                          const pct = methodTotal > 0 ? (v / methodTotal) * 100 : 0;
                          return `${value} — ${fmtBRL(v)} (${pct.toFixed(1)}%)`;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
  accent,
  clickable,
}: {
  title: string;
  value: string;
  icon: typeof TrendingUp;
  loading: boolean;
  accent?: "warning";
  clickable?: boolean;
}) {
  return (
    <Card
      className={
        clickable ? "transition hover:shadow-md hover:border-primary/40 cursor-pointer" : undefined
      }
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p
              className={`text-2xl font-bold mt-1 ${accent === "warning" ? "text-warning-foreground" : ""}`}
            >
              {loading ? "..." : value}
            </p>
          </div>
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              accent === "warning"
                ? "bg-warning/20 text-warning-foreground"
                : "bg-primary/10 text-primary"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

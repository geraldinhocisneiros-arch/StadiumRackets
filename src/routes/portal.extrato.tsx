import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtBRL } from "@/lib/format";
import {
  describeEntryText,
  monthSummaryOf,
  runningBalances,
  type EntryPaymentInfo,
} from "@/lib/extrato";
import { Loader2 } from "lucide-react";
import { usePortalClientId } from "@/hooks/usePortalClientId";

export const Route = createFileRoute("/portal/extrato")({
  component: PortalExtrato,
});

interface Entry {
  id: string;
  entry_type: string;
  amount: number;
  description: string | null;
  entry_date: string;
  created_at: string;
  payment_id: string | null;
}

const MONTH_NAMES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[Number(m) - 1]}/${y}`;
};

const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

function PortalExtrato() {
  const { clientId, loading: loadingId } = usePortalClientId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [paymentInfo, setPaymentInfo] = useState<Record<string, EntryPaymentInfo>>({});
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = async (cid: string) => {
    const [{ data: ent }] = await Promise.all([
      supabase
        .from("account_entries")
        .select("id, entry_type, amount, description, entry_date, created_at, payment_id")
        .eq("client_id", cid)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    const rows = (ent ?? []) as Entry[];
    const paymentIds = rows.map((e) => e.payment_id).filter(Boolean) as string[];
    const info: Record<string, EntryPaymentInfo> = {};
    if (paymentIds.length > 0) {
      const { data: pays } = await supabase
        .from("payments")
        .select("id, court, start_time, end_time, category_id")
        .in("id", paymentIds);
      const payRows = (pays ?? []) as Array<{
        id: string;
        court: number | null;
        start_time: string | null;
        end_time: string | null;
        category_id: string | null;
      }>;
      // O portal não lê client_categories direto — só via RPC.
      const categoryIds = [...new Set(payRows.map((p) => p.category_id).filter(Boolean))];
      const catNames: Record<string, string> = {};
      if (categoryIds.length > 0) {
        const { data: cats } = await supabase.rpc("portal_get_category_names", {
          _ids: categoryIds as string[],
        });
        for (const c of (cats ?? []) as Array<{ id: string; name: string }>) {
          catNames[c.id] = c.name;
        }
      }
      for (const p of payRows) {
        info[p.id] = {
          category: p.category_id ? (catNames[p.category_id] ?? null) : null,
          court: p.court,
          start_time: p.start_time,
          end_time: p.end_time,
        };
      }
    }
    setEntries(rows);
    setPaymentInfo(info);
    setLoading(false);
  };

  useEffect(() => {
    if (!clientId) return;
    load(clientId);
    const ch = supabase
      .channel(`portal-ext-${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "account_entries",
          filter: `client_id=eq.${clientId}`,
        },
        () => load(clientId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [clientId]);

  const { map: runningById } = useMemo(() => runningBalances(entries), [entries]);

  if (loadingId || loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const balance = entries.reduce(
    (s, e) => s + (e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount)),
    0,
  );
  const availableMonths = Array.from(new Set(entries.map((e) => e.entry_date.slice(0, 7)))).sort(
    (a, b) => b.localeCompare(a),
  );
  const filteredEntries =
    monthFilter === "all" ? entries : entries.filter((e) => e.entry_date.startsWith(monthFilter));
  const monthSummary = monthFilter === "all" ? null : monthSummaryOf(entries, monthFilter);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Resumo da minha conta</h1>
        <p className="text-sm text-muted-foreground">
          Atualiza em tempo real conforme a recepção lança movimentos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo atual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                balance < 0 ? "text-destructive" : balance > 0 ? "text-emerald-600" : ""
              }`}
            >
              {fmtBRL(Math.abs(balance))}
              <span className="text-xs ml-2 font-normal text-muted-foreground">
                {balance < 0 ? "(em aberto)" : balance > 0 ? "(crédito)" : "(zerada)"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>


      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Extrato</CardTitle>
          {availableMonths.length > 0 && (
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue placeholder="Filtrar por mês" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent>
          {monthSummary && (
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span>
                Veio do mês anterior:{" "}
                <span className="font-medium">{fmtBRL(monthSummary.opening)}</span>
              </span>
              <span>
                Cobranças:{" "}
                <span className="font-medium text-destructive">-{fmtBRL(monthSummary.debits)}</span>
              </span>
              <span>
                Pagamentos / créditos:{" "}
                <span className="font-medium text-emerald-600">
                  +{fmtBRL(monthSummary.credits)}
                </span>
              </span>
              <span>
                Fechou o mês em:{" "}
                <span
                  className={`font-semibold ${
                    monthSummary.closing < 0
                      ? "text-destructive"
                      : monthSummary.closing > 0
                        ? "text-emerald-600"
                        : ""
                  }`}
                >
                  {fmtBRL(monthSummary.closing)}
                </span>
              </span>
            </div>
          )}
          {filteredEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {entries.length === 0 ? "Sem lançamentos." : "Sem lançamentos neste mês."}
            </p>
          ) : (
            <ul className="divide-y">
              {filteredEntries.map((e) => {
                const credit = e.entry_type === "credito";
                const run = runningById[e.id] ?? 0;
                return (
                  <li key={e.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {describeEntryText(
                          e.description,
                          e.payment_id ? paymentInfo[e.payment_id] : undefined,
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(e.entry_date)} · {credit ? "Pagamento / crédito" : "Cobrança"}
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div
                        className={`font-semibold ${credit ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {credit ? "+" : "−"} {fmtBRL(Number(e.amount))}
                      </div>
                      <div
                        className={`text-xs ${run < 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        saldo {fmtBRL(run)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

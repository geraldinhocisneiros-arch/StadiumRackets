import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Printer, Loader2, Download } from "lucide-react";
import { fmtBRL as brl, todayISO } from "@/lib/format";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/comissoes")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <ComissoesPage />
    </RequireAuth>
  ),
});

interface SaleRow {
  id: string;
  amount: number;
  paid_at: string;
  recorded_by: string | null;
  commission_user_id: string | null;
  category_id: string | null;
  client_id: string | null;
  clients: { full_name: string } | null;
  client_categories: { name: string; commission_percent: number } | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
}

const firstDayOfMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

function ComissoesPage() {
  const { user, isAdmin, isDiretoria } = useAuth();
  const canSeeAll = isAdmin || isDiretoria;
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState<string>(firstDayOfMonth());
  const [to, setTo] = useState<string>(todayISO());
  const [filterUser, setFilterUser] = useState<string>("all");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999`).toISOString();

    let rows: SaleRow[];
    if (!canSeeAll) {
      // Recepcionista: no banco ela não enxerga os pagamentos antigos, então
      // a leitura direta de payments vinha vazia e a tela ficava zerada. A
      // RPC devolve só as vendas com comissão do próprio usuário.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: mine } = await (supabase as any).rpc("list_my_commission_sales", {
        _from: fromIso,
        _to: toIso,
      });
      rows = ((mine ?? []) as Array<{
        id: string;
        amount: number;
        paid_at: string;
        recorded_by: string | null;
        commission_user_id: string | null;
        category_id: string | null;
        client_id: string | null;
        client_name: string | null;
        category_name: string | null;
        commission_percent: number | null;
      }>).map((r) => ({
        id: r.id,
        amount: r.amount,
        paid_at: r.paid_at,
        recorded_by: r.recorded_by,
        commission_user_id: r.commission_user_id,
        category_id: r.category_id,
        client_id: r.client_id,
        clients: r.client_name != null ? { full_name: r.client_name } : null,
        client_categories:
          r.category_name != null
            ? { name: r.category_name, commission_percent: Number(r.commission_percent ?? 0) }
            : null,
      }));
    } else {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, amount, paid_at, recorded_by, commission_user_id, category_id, client_id, clients(full_name), client_categories!payments_category_id_fkey(name, commission_percent)"
        )
        .eq("is_new_plan_sale", true)
        .gte("paid_at", fromIso)
        .lte("paid_at", toIso)
        .order("paid_at", { ascending: false });

      if (error) {
        const alt = await supabase
          .from("payments")
          .select(
            "id, amount, paid_at, recorded_by, commission_user_id, category_id, client_id, clients(full_name), client_categories(name, commission_percent)"
          )
          .eq("is_new_plan_sale", true)
          .gte("paid_at", fromIso)
          .lte("paid_at", toIso)
          .order("paid_at", { ascending: false });
        rows = (alt.data as unknown as SaleRow[]) ?? [];
      } else {
        rows = (data as unknown as SaleRow[]) ?? [];
      }
    }
    setSales(rows);

    const ids = new Set<string>();
    rows.forEach((p) => {
      const uid = p.commission_user_id ?? p.recorded_by;
      if (uid) ids.add(uid);
    });
    if (ids.size > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(ids));
      const map: Record<string, string> = {};
      (profs as ProfileRow[] | null)?.forEach((p) => {
        map[p.id] = p.full_name;
      });
      setProfiles(map);
    } else {
      setProfiles({});
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, canSeeAll]);

  const commissionUserOf = (s: SaleRow): string | null => s.commission_user_id ?? s.recorded_by;

  const filteredSales = useMemo(() => {
    let base = sales;
    if (!canSeeAll) {
      base = sales.filter((s) => commissionUserOf(s) === user?.id);
    }
    if (filterUser === "all") return base;
    if (filterUser === "none") return base.filter((s) => !commissionUserOf(s));
    return base.filter((s) => commissionUserOf(s) === filterUser);
  }, [sales, filterUser, canSeeAll, user?.id]);

  // Agrega por recepcionista
  const summary = useMemo(() => {
    const map = new Map<
      string,
      { userId: string; userName: string; count: number; total: number; commission: number }
    >();
    for (const s of filteredSales) {
      const cu = commissionUserOf(s);
      const uid = cu ?? "__none__";
      const name = cu ? profiles[cu] ?? "—" : "Sem usuário";
      const pct = Number(s.client_categories?.commission_percent ?? 0);
      const commission = (Number(s.amount) * pct) / 100;
      const cur = map.get(uid) ?? {
        userId: uid,
        userName: name,
        count: 0,
        total: 0,
        commission: 0,
      };
      cur.count += 1;
      cur.total += Number(s.amount);
      cur.commission += commission;
      map.set(uid, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.commission - a.commission);
  }, [filteredSales, profiles]);

  const totals = useMemo(() => {
    const totalSales = filteredSales.reduce((acc, s) => acc + Number(s.amount), 0);
    const totalCommission = filteredSales.reduce((acc, s) => {
      const pct = Number(s.client_categories?.commission_percent ?? 0);
      return acc + (Number(s.amount) * pct) / 100;
    }, 0);
    return { totalSales, totalCommission, count: filteredSales.length };
  }, [filteredSales]);

  const userOptions = useMemo(() => {
    const set = new Map<string, string>();
    sales.forEach((s) => {
      const cu = commissionUserOf(s);
      if (cu) set.set(cu, profiles[cu] ?? "—");
    });
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [sales, profiles]);

  const fmtDateBR = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Relatório de Comissões", 14, 18);
    doc.setFontSize(11);
    doc.text(`Período: ${fmtDateBR(from)} a ${fmtDateBR(to)}`, 14, 28);
    doc.text(`Emitido em: ${fmtDateBR(todayISO())}`, 14, 34);

    let y = 44;
    doc.setFontSize(12);
    doc.text("Resumo por recepcionista", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Recepcionista", "Nº vendas", "Total vendido", "Comissão"]],
      body: summary.length
        ? summary.map((s) => [s.userName, String(s.count), brl(s.total), brl(s.commission)])
        : [["—", "—", "—", "—"]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [34, 84, 61] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    doc.setFontSize(11);
    doc.text(`Vendas no período: ${totals.count}`, 14, y);
    doc.text(`Total vendido: ${brl(totals.totalSales)}`, 14, y + 6);
    doc.text(`Total de comissões: ${brl(totals.totalCommission)}`, 14, y + 12);
    y += 20;

    doc.setFontSize(12);
    doc.text("Detalhamento das vendas", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Data", "Cliente", "Categoria", "Recepcionista", "Valor", "%", "Comissão"]],
      body: filteredSales.length
        ? filteredSales.map((s) => {
            const pct = Number(s.client_categories?.commission_percent ?? 0);
            const comm = (Number(s.amount) * pct) / 100;
            const cu = commissionUserOf(s);
            return [
              new Date(s.paid_at).toLocaleDateString("pt-BR"),
              s.clients?.full_name ?? "—",
              s.client_categories?.name ?? "—",
              cu ? profiles[cu] ?? "—" : "—",
              brl(Number(s.amount)),
              `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`,
              brl(comm),
            ];
          })
        : [["—", "—", "—", "—", "—", "—", "—"]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [34, 84, 61] },
    });

    doc.save(`comissoes-${from}-a-${to}.pdf`);
  };


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comissões</h1>
          <p className="text-muted-foreground">
            Vendas de novos planos por recepcionista
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => generatePDF()}>
            <Download className="h-4 w-4 mr-2" /> Baixar PDF
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {canSeeAll && (
              <div className="space-y-2 md:col-span-2">
                <Label>Recepcionista</Label>
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {userOptions.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                    <SelectItem value="none">Sem usuário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vendas no período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totals.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total vendido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{brl(totals.totalSales)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total de comissões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{brl(totals.totalCommission)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumo por recepcionista</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 mx-auto animate-spin" />
            </div>
          ) : summary.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Nenhuma venda de novo plano no período.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recepcionista</TableHead>
                  <TableHead className="text-right">Nº de vendas</TableHead>
                  <TableHead className="text-right">Total vendido</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((s) => (
                  <TableRow key={s.userId}>
                    <TableCell className="font-medium">{s.userName}</TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                    <TableCell className="text-right">{brl(s.total)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {brl(s.commission)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detalhamento das vendas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 mx-auto animate-spin" />
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Nenhuma venda no período.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Recepcionista</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.map((s) => {
                  const pct = Number(s.client_categories?.commission_percent ?? 0);
                  const comm = (Number(s.amount) * pct) / 100;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        {new Date(s.paid_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>{s.clients?.full_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {s.client_categories?.name ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const cu = commissionUserOf(s);
                          return cu ? profiles[cu] ?? "—" : "—";
                        })()}
                      </TableCell>
                      <TableCell className="text-right">{brl(Number(s.amount))}</TableCell>
                      <TableCell className="text-right">
                        {pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary">
                        {brl(comm)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

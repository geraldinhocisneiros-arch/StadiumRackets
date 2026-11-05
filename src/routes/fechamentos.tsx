import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL } from "@/lib/format";
import { toast } from "sonner";
import { Eye, Printer, Trash2, Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { logAction } from "@/lib/audit";
import {
  buildClosingDocumentHtml,
  sumCounted,
  sumDifferences,
  type ClosingRecord,
} from "@/lib/cash-closing-doc";

export const Route = createFileRoute("/fechamentos")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria"]}>
      <FechamentosPage />
    </RequireAuth>
  ),
});

interface Row {
  id: string;
  closing_date: string;
  closed_at: string;
  closed_by: string;
  cash_user_id: string | null;
  totals_system: Record<string, number>;
  totals_counted: Record<string, number>;
  differences: Record<string, number>;
  pending_resolved: ClosingRecord["pending_resolved"];
  stock_report: ClosingRecord["stock_report"];
  remotes_report: ClosingRecord["remotes_report"];
  notes: string | null;
  closed_by_name: string | null;
}

function FechamentosPage() {
  const { isAdmin, isDiretoria } = useAuth();
  const canDelete = isAdmin;
  const canView = isAdmin || isDiretoria;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cash_closings")
        .select(
          "id, closing_date, closed_at, closed_by, cash_user_id, totals_system, totals_counted, differences, pending_resolved, stock_report, remotes_report, notes",
        )
        .order("closed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = (data ?? []) as unknown as Omit<Row, "closed_by_name">[];
      const ids = Array.from(new Set(list.map((r) => r.closed_by).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        nameMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name ?? ""]));
      }
      setRows(list.map((r) => ({ ...r, closed_by_name: nameMap[r.closed_by] ?? null })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar fechamentos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) void loadAll();
    else setLoading(false);
  }, [canView]);

  const fetchReceivedItems = async (closingDate: string, cashUserId: string | null) => {
    const [y, m, d] = closingDate.split("-").map(Number);
    const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString();
    const end = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0).toISOString();
    let paysQuery = supabase
      .from("payments")
      .select("amount, method, notes, client_id, category_id, received, recorded_by, clients(full_name)")
      .eq("received", true)
      .gt("amount", 0)
      .gte("paid_at", start)
      .lt("paid_at", end);
    if (cashUserId) paysQuery = paysQuery.eq("recorded_by", cashUserId);
    const [paysRes, catsRes] = await Promise.all([
      paysQuery,
      supabase.from("client_categories").select("id, name"),
    ]);
    if (paysRes.error) throw paysRes.error;
    const catMap = new Map<string, string>();
    (catsRes.data ?? []).forEach((c) => catMap.set(c.id, c.name));
    return (paysRes.data ?? []).map((p) => ({
      client: (p.clients as { full_name?: string } | null)?.full_name ?? null,
      category: p.category_id ? catMap.get(p.category_id) ?? null : null,
      notes: p.notes,
      amount: Number(p.amount),
      method: p.method,
    }));
  };

  const buildHtmlFor = async (row: Row, opts?: { autoPrint?: boolean }) => {
    let items: Awaited<ReturnType<typeof fetchReceivedItems>> = [];
    try {
      // Fallback: se o fechamento antigo não tem cash_user_id salvo, filtra pelo usuário que fechou.
      const effectiveUserId = row.cash_user_id ?? row.closed_by ?? null;
      items = await fetchReceivedItems(row.closing_date, effectiveUserId);
    } catch (e) {
      console.warn("Falha ao buscar lançamentos do dia:", e);
    }
    return buildClosingDocumentHtml({ ...toRecord(row), received_items: items }, opts);
  };

  const handlePrint = async (row: Row) => {
    const html = await buildHtmlFor(row, { autoPrint: true });
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      toast.error("Permita pop-ups para imprimir.");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const { error } = await supabase.from("cash_closings").delete().eq("id", deleting.id);
      if (error) throw error;
      await logAction({
        entity: "cash_closing",
        entity_id: deleting.id,
        action: "delete",
        details: { closing_date: deleting.closing_date },
      });
      toast.success("Fechamento excluído.");
      setDeleting(null);
      if (viewing?.id === deleting.id) setViewing(null);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setDeletingBusy(false);
    }
  };

  const [docHtml, setDocHtml] = useState("");
  useEffect(() => {
    if (!viewing) {
      setDocHtml("");
      return;
    }
    let cancelled = false;
    void buildHtmlFor(viewing).then((h) => {
      if (!cancelled) setDocHtml(h);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing]);

  if (!canView) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Você não tem permissão para ver o histórico de fechamentos.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Fechamentos de caixa</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de todos os fechamentos registrados. Clique em "Ver" para abrir o documento.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/financas" search={{ received: undefined, dateField: undefined }}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar para Finanças
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{rows.length} fechamento(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Nenhum fechamento registrado ainda.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead>Fechado por</TableHead>
                    <TableHead className="text-right">Total conferido</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const total = sumCounted(r.totals_counted);
                    const diff = sumDifferences(r.differences);
                    const [y, m, d] = r.closing_date.split("-").map(Number);
                    const dateLabel = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR");
                    const timeLabel = new Date(r.closed_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{dateLabel}</TableCell>
                        <TableCell>{timeLabel}</TableCell>
                        <TableCell>{r.closed_by_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{fmtBRL(total)}</TableCell>
                        <TableCell
                          className={`text-right ${Math.abs(diff) < 0.005 ? "text-green-600" : "text-red-600"}`}
                        >
                          {fmtBRL(diff)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                              <Eye className="h-4 w-4 mr-1" /> Ver
                            </Button>
                            {canDelete && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => setDeleting(r)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
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

      {/* Visualizar documento */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Documento de fechamento</DialogTitle>
            <DialogDescription>
              Visualização do fechamento salvo. Use "Imprimir" para gerar uma cópia.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-md border bg-white">
            {viewing && (
              <iframe
                title="Fechamento"
                srcDoc={docHtml}
                className="w-full h-[65vh] border-0"
              />
            )}
          </div>
          <DialogFooter className="gap-2">
            {viewing && canDelete && (
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700 mr-auto"
                onClick={() => setDeleting(viewing)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Excluir
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewing(null)}>
              Fechar
            </Button>
            {viewing && (
              <Button onClick={() => handlePrint(viewing)}>
                <Printer className="h-4 w-4 mr-2" /> Imprimir
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir fechamento?</DialogTitle>
            <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
            <div>
              A exclusão remove apenas o <strong>registro do fechamento</strong>. Pagamentos marcados como
              pagos e ajustes de estoque já lançados no dia <strong>não serão revertidos</strong>.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancelar
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deletingBusy}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toRecord(r: Row): ClosingRecord {
  return {
    closing_date: r.closing_date,
    closed_at: r.closed_at,
    closed_by_name: r.closed_by_name,
    totals_system: r.totals_system ?? {},
    totals_counted: r.totals_counted ?? {},
    differences: r.differences ?? {},
    pending_resolved: r.pending_resolved ?? [],
    stock_report: r.stock_report ?? [],
    remotes_report: r.remotes_report ?? [],
    notes: r.notes,
  };
}

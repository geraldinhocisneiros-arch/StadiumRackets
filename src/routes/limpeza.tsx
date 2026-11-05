import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Sparkles,
  Truck,
  AlertTriangle,
  Save,
  PackagePlus,
  Receipt,
  Trash2,
} from "lucide-react";
import { dateISO, fmtDateBR } from "@/lib/court-map";
import { fmtBRL, monthStartISO, monthEndISO } from "@/lib/format";
import { CleaningSupplierDialog, type CleaningSupplier } from "@/components/CleaningSupplierDialog";
import {
  CleaningProductDialog,
  type CleaningProduct,
  CLEANING_UNIT_LABELS,
} from "@/components/CleaningProductDialog";
import { CleaningPurchaseDialog, type CleaningPurchase } from "@/components/CleaningPurchaseDialog";

export const Route = createFileRoute("/limpeza")({
  head: () => ({ meta: [{ title: "Limpeza — Stadium Rackets" }] }),
  component: () => (
    <RequireAuth rolesAllowed={["diretoria", "limpeza"]}>
      <LimpezaPage />
    </RequireAuth>
  ),
});

interface CleaningWeeklyUsage {
  id: string;
  product_id: string;
  week_start: string;
  initial_qty: number;
  used_qty: number;
  balance_qty: number;
}

function weekStartOf(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function LimpezaPage() {
  const [suppliers, setSuppliers] = useState<CleaningSupplier[]>([]);
  const [products, setProducts] = useState<CleaningProduct[]>([]);
  const [usageMap, setUsageMap] = useState<Record<string, CleaningWeeklyUsage>>({});
  const [drafts, setDrafts] = useState<Record<string, { initial: string; used: string }>>({});
  const [cursor, setCursor] = useState<Date>(() => weekStartOf(new Date()));
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CleaningProduct | null>(null);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [purchaseDefaultProductId, setPurchaseDefaultProductId] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<CleaningPurchase | null>(null);

  const [reportCursor, setReportCursor] = useState<Date>(() => new Date());
  const [purchases, setPurchases] = useState<CleaningPurchase[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(true);
  const confirm = useConfirm();
  const [allProductNames, setAllProductNames] = useState<Record<string, string>>({});

  const weekStart = useMemo(() => dateISO(cursor), [cursor]);
  const weekEnd = useMemo(() => dateISO(addDays(cursor, 6)), [cursor]);
  const monthStart = useMemo(() => monthStartISO(reportCursor), [reportCursor]);
  const monthEnd = useMemo(() => monthEndISO(reportCursor), [reportCursor]);

  const suppliersById = useMemo(() => {
    const m = new Map<string, CleaningSupplier>();
    suppliers.forEach((s) => m.set(s.id, s));
    return m;
  }, [suppliers]);

  const load = useCallback(async () => {
    setLoading(true);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const [supRes, prodRes, usageRes] = await Promise.all([
      (supabase as any).from("cleaning_suppliers").select("*").order("company_name"),
      (supabase as any).from("cleaning_products").select("*").eq("active", true).order("name"),
      (supabase as any).from("cleaning_weekly_usage").select("*").eq("week_start", weekStart),
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (supRes.error) toast.error(supRes.error.message);
    if (prodRes.error) toast.error(prodRes.error.message);
    if (usageRes.error) toast.error(usageRes.error.message);

    const supplierList = (supRes.data ?? []) as CleaningSupplier[];
    const productList = (prodRes.data ?? []) as CleaningProduct[];
    const usageList = (usageRes.data ?? []) as CleaningWeeklyUsage[];

    const uMap: Record<string, CleaningWeeklyUsage> = {};
    usageList.forEach((u) => {
      uMap[u.product_id] = u;
    });

    const dr: Record<string, { initial: string; used: string }> = {};
    productList.forEach((p) => {
      const existing = uMap[p.id];
      dr[p.id] = existing
        ? { initial: String(existing.initial_qty), used: String(existing.used_qty) }
        : { initial: String(p.current_stock), used: "0" };
    });

    setSuppliers(supplierList);
    setProducts(productList);
    setUsageMap(uMap);
    setDrafts(dr);
    setLoading(false);
  }, [weekStart]);

  const loadReport = useCallback(async () => {
    setLoadingPurchases(true);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const [purchRes, prodRes] = await Promise.all([
      (supabase as any)
        .from("cleaning_purchases")
        .select("*")
        .gte("purchase_date", monthStart)
        .lte("purchase_date", monthEnd)
        .order("purchase_date", { ascending: false }),
      (supabase as any).from("cleaning_products").select("id, name"),
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    setLoadingPurchases(false);
    if (purchRes.error) {
      toast.error(purchRes.error.message);
      return;
    }
    setPurchases((purchRes.data ?? []) as CleaningPurchase[]);
    const names: Record<string, string> = {};
    ((prodRes.data ?? []) as { id: string; name: string }[]).forEach((p) => {
      names[p.id] = p.name;
    });
    setAllProductNames(names);
  }, [monthStart, monthEnd]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    const channel = supabase
      .channel(`cleaning_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cleaning_products" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cleaning_weekly_usage" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cleaning_suppliers" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cleaning_purchases" },
        () => void loadReport(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, loadReport]);

  const shiftWeek = (weeks: number) => {
    setCursor((c) => addDays(c, weeks * 7));
  };

  const shiftMonth = (months: number) => {
    setReportCursor((c) => new Date(c.getFullYear(), c.getMonth() + months, 1));
  };

  const monthLabel = useMemo(() => {
    const label = reportCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [reportCursor]);

  const monthTotal = useMemo(() => purchases.reduce((s, p) => s + p.total_price, 0), [purchases]);

  const purchasesByProduct = useMemo(() => {
    const map: Record<string, { qty: number; total: number }> = {};
    purchases.forEach((p) => {
      const cur = map[p.product_id] ?? { qty: 0, total: 0 };
      cur.qty += p.quantity;
      cur.total += p.total_price;
      map[p.product_id] = cur;
    });
    return Object.entries(map)
      .map(([productId, v]) => ({
        productId,
        name: allProductNames[productId] ?? "—",
        ...v,
      }))
      .sort((a, b) => b.total - a.total);
  }, [purchases, allProductNames]);

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.current_stock <= p.min_stock),
    [products],
  );

  const setDraft = (productId: string, field: "initial" | "used", value: string) => {
    setDrafts((d) => ({ ...d, [productId]: { ...d[productId], [field]: value } }));
  };

  const saveRow = async (product: CleaningProduct) => {
    const draft = drafts[product.id];
    const initial = Number(draft?.initial ?? 0);
    const used = Number(draft?.used ?? 0);
    if (isNaN(initial) || isNaN(used) || initial < 0 || used < 0) {
      toast.error("Quantidades inválidas");
      return;
    }
    setSavingId(product.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("cleaning_weekly_usage")
      .upsert(
        { product_id: product.id, week_start: weekStart, initial_qty: initial, used_qty: used },
        { onConflict: "product_id,week_start" },
      );
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Semana atualizada");
    void load();
  };

  const openNewProduct = () => {
    setEditingProduct(null);
    setProductDialogOpen(true);
  };

  const openEditProduct = (p: CleaningProduct) => {
    setEditingProduct(p);
    setProductDialogOpen(true);
  };

  const openRestock = (productId: string | null) => {
    setEditingPurchase(null);
    setPurchaseDefaultProductId(productId);
    setPurchaseDialogOpen(true);
  };

  const openEditPurchase = (purchase: CleaningPurchase) => {
    setEditingPurchase(purchase);
    setPurchaseDialogOpen(true);
  };

  const deletePurchase = async (purchase: CleaningPurchase) => {
    if (!(await confirm("Excluir este lançamento? A quantidade será removida do estoque atual.")))
      return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("cleaning_delete_purchase", { _id: purchase.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lançamento excluído.");
    void load();
    void loadReport();
  };

  return (
    // Na impressão somem os botões e as tabelas largas não ficam cortadas.
    <div className="space-y-6 print:[&_.overflow-x-auto]:overflow-visible print:[&_button]:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6" /> Limpeza
          </h1>
          <p className="text-sm text-muted-foreground">
            Controle semanal de estoque de material de limpeza.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
          <Button variant="outline" onClick={() => setSupplierDialogOpen(true)}>
            <Truck className="h-4 w-4 mr-2" /> Fornecedores
          </Button>
          <Button variant="outline" onClick={() => openRestock(null)}>
            <PackagePlus className="h-4 w-4 mr-2" /> Repor estoque
          </Button>
          <Button onClick={openNewProduct}>
            <Plus className="h-4 w-4 mr-2" /> Novo produto
          </Button>
        </div>
      </div>

      {lowStockProducts.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/15 px-4 py-3 text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Produtos para repor</div>
            <div className="mt-1 space-y-0.5 text-warning-foreground/90">
              {lowStockProducts.map((p) => {
                const sup = p.supplier_id ? suppliersById.get(p.supplier_id) : null;
                return (
                  <div key={p.id}>
                    <span className="font-medium">{p.name}</span> — estoque atual: {p.current_stock}{" "}
                    {sup && (
                      <span className="text-xs">
                        (fornecedor: {sup.company_name}
                        {sup.phone ? ` · ${sup.phone}` : ""})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftWeek(-1)}
              aria-label="Semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">
              Semana de {fmtDateBR(weekStart)} a {fmtDateBR(weekEnd)}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftWeek(1)}
              aria-label="Próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
            </div>
          ) : products.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum produto cadastrado ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Qtd. inicial</TableHead>
                    <TableHead className="text-right">Usada na semana</TableHead>
                    <TableHead className="text-right">Saldo da semana</TableHead>
                    <TableHead className="text-right">Estoque atual</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const draft = drafts[p.id] ?? { initial: "0", used: "0" };
                    const initial = Number(draft.initial) || 0;
                    const used = Number(draft.used) || 0;
                    const balancePreview = initial - used;
                    const low = p.current_stock <= p.min_stock;
                    const sup = p.supplier_id ? suppliersById.get(p.supplier_id) : null;
                    return (
                      <TableRow key={p.id} className={low ? "bg-warning/10" : ""}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {CLEANING_UNIT_LABELS[p.unit] ?? p.unit}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {sup?.company_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="w-20 ml-auto text-right"
                            value={draft.initial}
                            onChange={(e) => setDraft(p.id, "initial", e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="w-20 ml-auto text-right"
                            value={draft.used}
                            onChange={(e) => setDraft(p.id, "used", e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono">{balancePreview}</TableCell>
                        <TableCell className="text-right">
                          <span className={low ? "font-semibold text-warning" : "font-mono"}>
                            {p.current_stock}
                          </span>
                          {low && (
                            <Badge variant="outline" className="ml-2 border-warning text-warning">
                              Repor
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={savingId === p.id}
                              onClick={() => void saveRow(p)}
                              aria-label="Salvar semana"
                            >
                              {savingId === p.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => openRestock(p.id)}
                              aria-label="Repor estoque"
                            >
                              <PackagePlus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => openEditProduct(p)}
                              aria-label="Editar produto"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Relatório de gastos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftMonth(-1)}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">{monthLabel}</div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftMonth(1)}
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-center py-2">
            <div className="text-xs text-muted-foreground">Total gasto no mês</div>
            <div className="text-3xl font-bold">{fmtBRL(monthTotal)}</div>
          </div>

          {loadingPurchases ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
            </div>
          ) : purchasesByProduct.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma compra registrada neste mês.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Quantidade comprada</TableHead>
                    <TableHead className="text-right">Total gasto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchasesByProduct.map((row) => (
                    <TableRow key={row.productId}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right font-mono">{row.qty}</TableCell>
                      <TableCell className="text-right font-mono">{fmtBRL(row.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {purchases.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-medium text-muted-foreground">Lançamentos do mês</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">Valor unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">{fmtDateBR(p.purchase_date)}</TableCell>
                        <TableCell className="text-sm">
                          {allProductNames[p.product_id] ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtBRL(p.unit_price)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtBRL(p.total_price)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.supplier_id
                            ? (suppliersById.get(p.supplier_id)?.company_name ?? "—")
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => openEditPurchase(p)}
                              aria-label="Editar lançamento"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={() => void deletePurchase(p)}
                              aria-label="Excluir lançamento"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CleaningSupplierDialog
        open={supplierDialogOpen}
        onOpenChange={setSupplierDialogOpen}
        suppliers={suppliers}
        onChanged={load}
      />
      <CleaningProductDialog
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
        product={editingProduct}
        suppliers={suppliers}
        onSaved={load}
      />
      <CleaningPurchaseDialog
        open={purchaseDialogOpen}
        onOpenChange={(v) => {
          setPurchaseDialogOpen(v);
          if (!v) setEditingPurchase(null);
        }}
        products={products}
        suppliers={suppliers}
        defaultProductId={purchaseDefaultProductId}
        editingPurchase={editingPurchase}
        onSaved={() => {
          void load();
          void loadReport();
        }}
      />
    </div>
  );
}

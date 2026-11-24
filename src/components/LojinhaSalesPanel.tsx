import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isStockCategory } from "@/lib/category";
import { fmtBRL } from "@/lib/format";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payment-methods";

// Vendas da Lojinha: quem pegou o quê, quanto e se já pagou. Uma venda é um
// lançamento do caixa numa categoria de produto (ver isStockCategory).
// "Recebi" marca a venda como paga HOJE (o dinheiro entra no caixa do dia em
// que foi recebido, não no dia em que o cliente pegou o produto).

interface SaleRow {
  id: string;
  client_id: string | null;
  category_id: string | null;
  amount: number;
  quantity: number;
  received: boolean;
  paid_at: string;
  notes: string | null;
  clients: { full_name: string } | null;
}

const DAYS_BACK = 120;

export function LojinhaSalesPanel({ refreshKey }: { refreshKey: number }) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [productByCat, setProductByCat] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [paying, setPaying] = useState<SaleRow | null>(null);
  const [method, setMethod] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cats, error: catErr } = await supabase
      .from("client_categories")
      .select("id, name, stock_item_id");
    if (catErr) {
      toast.error(catErr.message);
      setLoading(false);
      return;
    }
    const stockCats = (cats ?? []).filter((c) => isStockCategory(c));
    setProductByCat(new Map(stockCats.map((c) => [c.id, c.name])));
    if (stockCats.length === 0) {
      setSales([]);
      setLoading(false);
      return;
    }
    const since = new Date();
    since.setDate(since.getDate() - DAYS_BACK);
    const { data, error } = await supabase
      .from("payments")
      .select("id, client_id, category_id, amount, quantity, received, paid_at, notes, clients(full_name)")
      .in(
        "category_id",
        stockCats.map((c) => c.id),
      )
      .eq("is_pending_payment", false)
      .gte("paid_at", since.toISOString())
      .order("paid_at", { ascending: false })
      .limit(1000);
    if (error) toast.error(error.message);
    setSales(((data ?? []) as unknown as SaleRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const open = useMemo(() => sales.filter((s) => !s.received), [sales]);
  const openTotal = open.reduce((t, s) => t + Number(s.amount), 0);
  const debtors = useMemo(() => {
    const m = new Map<string, { name: string; total: number; items: number }>();
    for (const s of open) {
      const key = s.client_id ?? "__sem";
      const cur = m.get(key) ?? { name: s.clients?.full_name ?? "Sem nome", total: 0, items: 0 };
      cur.total += Number(s.amount);
      cur.items += Number(s.quantity) || 1;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [open]);

  const shown = onlyOpen ? open : sales;

  const confirmPayment = async () => {
    if (!paying) return;
    if (!method) {
      toast.error("Escolha a forma de pagamento");
      return;
    }
    setSaving(true);
    const soldOn = format(new Date(paying.paid_at), "dd/MM", { locale: ptBR });
    const note = `Pegou em ${soldOn}, pagou depois`;
    const { error } = await supabase
      .from("payments")
      .update({
        received: true,
        method: method as never,
        paid_at: new Date().toISOString(),
        notes: paying.notes ? `${paying.notes} · ${note}` : note,
      })
      .eq("id", paying.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Pagamento registrado no caixa de hoje");
    setPaying(null);
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Vendas da Lojinha</CardTitle>
        <div className="flex gap-1 rounded-md border p-0.5 text-sm">
          <button
            type="button"
            className={`rounded px-2 py-1 ${onlyOpen ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setOnlyOpen(true)}
          >
            Não pagas ({open.length})
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 ${!onlyOpen ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setOnlyOpen(false)}
          >
            Todas
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A venda é lançada no <strong>Caixa</strong>, escolhendo o produto como categoria e o
          nome do cliente. Se ele não pagou na hora, deixe "recebido" desmarcado: a venda aparece
          aqui até você clicar em <strong>Recebi</strong>. Últimos {DAYS_BACK} dias.
        </p>

        {open.length > 0 && (
          <div className="rounded-md border border-warning/50 bg-warning/5 p-3">
            <div className="text-sm font-semibold">
              Em aberto: {fmtBRL(openTotal)} · {debtors.length}{" "}
              {debtors.length === 1 ? "pessoa" : "pessoas"}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {debtors.slice(0, 8).map((d) => (
                <span key={d.name}>
                  {d.name}: <strong className="text-foreground">{fmtBRL(d.total)}</strong>
                </span>
              ))}
              {debtors.length > 8 && <span>+{debtors.length - 8}</span>}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {onlyOpen ? "Ninguém devendo na Lojinha." : "Nenhuma venda no período."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(s.paid_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>{s.clients?.full_name ?? "—"}</TableCell>
                    <TableCell>{(s.category_id && productByCat.get(s.category_id)) || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{s.quantity || 1}</TableCell>
                    <TableCell className="text-right font-mono">{fmtBRL(Number(s.amount))}</TableCell>
                    <TableCell>
                      {s.received ? (
                        <Badge variant="outline" className="border-success text-success">
                          Pago
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-destructive text-destructive">
                          Não pagou
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!s.received && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setMethod("");
                            setPaying(s);
                          }}
                        >
                          <HandCoins className="mr-1 h-4 w-4" /> Recebi
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={paying != null} onOpenChange={(v) => !v && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {paying && (
                <>
                  {paying.clients?.full_name ?? "Cliente"} ·{" "}
                  {(paying.category_id && productByCat.get(paying.category_id)) || "Produto"} ·{" "}
                  {fmtBRL(Number(paying.amount))}. O valor entra no caixa de hoje.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Forma de pagamento</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={confirmPayment} disabled={saving}>
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

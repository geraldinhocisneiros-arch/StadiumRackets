import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Plus, Settings2 } from "lucide-react";
import { StockEntryDialog } from "@/components/StockEntryDialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/estoque")({
  head: () => ({ meta: [{ title: "Estoque — Stadium Rackets" }] }),
  component: EstoquePage,
});

interface StockItem {
  id: string;
  name: string;
  current_quantity: number;
}

interface StockMovement {
  id: string;
  item_id: string;
  movement_type: "entrada" | "saida" | "ajuste";
  quantity: number;
  notes: string | null;
  payment_id: string | null;
  recorded_by: string | null;
  created_at: string;
}

function EstoquePage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"entrada" | "ajuste">("entrada");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [itemsRes, movsRes, profilesRes] = await Promise.all([
      supabase.from("stock_items").select("*").order("name"),
      supabase
        .from("stock_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("profiles").select("id, full_name"),
    ]);
    if (itemsRes.error) toast.error(itemsRes.error.message);
    else setItems((itemsRes.data ?? []) as StockItem[]);
    if (movsRes.error) toast.error(movsRes.error.message);
    else setMovements((movsRes.data ?? []) as StockMovement[]);
    if (profilesRes.data) {
      const map: Record<string, string> = {};
      for (const p of profilesRes.data as Array<{ id: string; full_name: string }>) {
        map[p.id] = p.full_name;
      }
      setUsers(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDialog = (mode: "entrada" | "ajuste") => {
    setDialogMode(mode);
    setDialogOpen(true);
  };

  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? "—";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6" /> Estoque
            </h1>
            <p className="text-sm text-muted-foreground">
              Controle de Terno de bola e Grip. Não entra nas finanças.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openDialog("ajuste")}>
              <Settings2 className="h-4 w-4 mr-2" /> Ajustar
            </Button>
            <Button onClick={() => openDialog("entrada")}>
              <Plus className="h-4 w-4 mr-2" /> Repor estoque
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const low = item.current_quantity <= 3;
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayMovs = movements.filter(
              (m) => m.item_id === item.id && new Date(m.created_at) >= todayStart,
            );
            const restockedToday = todayMovs
              .filter((m) => m.movement_type === "entrada")
              .reduce((s, m) => s + Number(m.quantity), 0);
            const soldToday = todayMovs
              .filter((m) => m.movement_type === "saida")
              .reduce((s, m) => s + Number(m.quantity), 0);
            return (
              <Card key={item.id} className={low ? "border-warning" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{item.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-4xl font-bold ${low ? "text-warning" : ""}`}>
                    {item.current_quantity}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">unidades em estoque</div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Hoje: <span className="text-green-600">+{restockedToday} reposto</span>
                    {" • "}
                    <span className="text-red-600">-{soldToday} vendido</span>
                  </div>
                  {low && (
                    <Badge variant="outline" className="mt-2 border-warning text-warning">
                      Estoque baixo
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de movimentações</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Carregando…</div>
            ) : movements.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nenhuma movimentação ainda.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead>Observação</TableHead>
                      <TableHead>Usuário</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(new Date(m.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell>{itemName(m.item_id)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              m.movement_type === "entrada"
                                ? "border-success text-success"
                                : m.movement_type === "saida"
                                  ? "border-destructive text-destructive"
                                  : ""
                            }
                          >
                            {m.movement_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {m.movement_type === "saida" ? "-" : "+"}
                          {m.quantity}
                        </TableCell>
                        <TableCell className="text-sm">{m.notes ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {m.recorded_by ? (users[m.recorded_by] ?? "—") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <StockEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        items={items}
        onSaved={load}
      />
    </AppLayout>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtBRL, fmtDateTime, normalizeText } from "@/lib/format";
import { CalendarIcon, Loader2, Printer, Pencil, Plus, Trash2, Lock, FileText } from "lucide-react";
import { CashClosingDialog } from "@/components/CashClosingDialog";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { logAction } from "@/lib/audit";
import { isSaldoAnterior, isEstorno } from "@/lib/category";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { EditPaymentDialog } from "@/components/EditPaymentDialog";
import { NewPaymentDialog } from "@/components/NewPaymentDialog";
import { useUrlState } from "@/hooks/useUrlState";
import { PAYMENT_METHOD_LABELS as METHOD_LABELS, PAYMENT_METHOD_OPTIONS } from "@/lib/payment-methods";

export const Route = createFileRoute("/financas")({
  validateSearch: (s: Record<string, unknown>) => ({
    received: s.received === "1" || s.received === 1 ? "1" : undefined,
    dateField: s.dateField === "created_at" ? "created_at" : undefined,
  }),
  component: () => (
    <RequireAuth pageKey="financas">
      <FinancasPage />
    </RequireAuth>
  ),
});


interface PaymentRow {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
  created_at: string;
  start_time: string | null;
  end_time: string | null;
  court: number | null;
  category_id: string | null;
  received: boolean;
  to_account: boolean;
  account_direction: string | null;
  notes: string | null;
  recorded_by: string | null;
  client_id: string | null;
}

interface ClientRow {
  id: string;
  full_name: string;
}

interface ProfileRow {
  id: string;
  full_name: string;
}

interface CategoryRow {
  id: string;
  name: string;
}

const ALL = "all";

function FinancasPage() {
  const search = Route.useSearch();
  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [filterDateStr, setFilterDateStr] = useUrlState<string>("date", todayISO);
  const filterDate = useMemo(() => {
    const [y, m, d] = filterDateStr.split("-").map(Number);
    const parsed = new Date(y, (m ?? 1) - 1, d ?? 1);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [filterDateStr]);
  const setFilterDate = (d: Date) => {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFilterDateStr(s);
  };
  const [filterUser, setFilterUser] = useUrlState<string>("user", ALL);
  const [filterClientName, setFilterClientName] = useUrlState<string>("client_q", "");
  const [filterMethod, setFilterMethod] = useUrlState<string>("method", ALL);
  const [filterCategory, setFilterCategory] = useUrlState<string>("category", ALL);
  const [filterAccount, setFilterAccount] = useUrlState<string>("account", ALL);
  const [filterReceived, setFilterReceived] = useUrlState<string>(
    "received_filter",
    search.received === "1" ? "received" : ALL,
  );
  const [dateField, setDateField] = useUrlState<"paid_at" | "created_at">(
    "dateField",
    search.dateField === "created_at" ? "created_at" : "paid_at",
  );
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [clients, setClients] = useState<Record<string, ClientRow>>({});
  const [loading, setLoading] = useState(true);

  const loadAll = async (ref: Date, field: "paid_at" | "created_at", opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const startOfDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0).toISOString();
      const endOfDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1, 0, 0, 0, 0).toISOString();

      const [paymentsRes, catsRes] = await Promise.all([
        supabase
          .from("payments")
          .select(
            "id, amount, method, paid_at, created_at, start_time, end_time, court, category_id, received, to_account, account_direction, notes, recorded_by, client_id"
          )
          .gte(field, startOfDay)
          .lt(field, endOfDay)
          .order(field, { ascending: false }),
        supabase.from("client_categories").select("id, name").order("name"),
      ]);

      if (paymentsRes.error) throw paymentsRes.error;
      if (catsRes.error) throw catsRes.error;

      const list = (paymentsRes.data ?? []) as PaymentRow[];
      setPayments(list);
      setCategories((catsRes.data ?? []) as CategoryRow[]);

    const ids = Array.from(new Set(list.map((p) => p.recorded_by).filter(Boolean))) as string[];
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const map: Record<string, ProfileRow> = {};
      (profs ?? []).forEach((p) => {
        map[p.id] = p as ProfileRow;
      });
      setProfiles(map);
    } else {
      setProfiles({});
    }

    const clientIds = Array.from(new Set(list.map((p) => p.client_id).filter(Boolean))) as string[];
    if (clientIds.length > 0) {
      const { data: cls } = await supabase
        .from("clients")
        .select("id, full_name")
        .in("id", clientIds);
      const cmap: Record<string, ClientRow> = {};
      (cls ?? []).forEach((c) => {
        cmap[c.id] = c as ClientRow;
      });
      setClients(cmap);
    } else {
      setClients({});
    }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os lançamentos.");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  };

  // Edit dialog state
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [closingOpen, setClosingOpen] = useState(false);
  const confirm = useConfirm();

  const handleDeletePayment = async (id: string) => {
    if (!(await confirm("Excluir este lançamento? Esta ação não pode ser desfeita."))) return;
    await supabase.from("account_entries").delete().eq("payment_id", id);
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAction({ entity: "payment", entity_id: id, action: "delete" });
    toast.success("Lançamento excluído.");
    loadAll(filterDate, dateField, { silent: true });
  };

  useEffect(() => {
    loadAll(filterDate, dateField);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDateStr, dateField]);

  // Lista de usuários disponíveis no dia (apenas quem registrou pagamentos)
  const availableUsers = useMemo(() => {
    const ids = Array.from(new Set(payments.map((p) => p.recorded_by).filter(Boolean))) as string[];
    return ids
      .map((id) => profiles[id])
      .filter(Boolean)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [payments, profiles]);

  // Base filtrada por usuário e categoria (usada para o compilado por forma de pagamento)
  const userFiltered = useMemo(() => {
    const estornoIds = new Set(categories.filter((c) => isEstorno(c.name)).map((c) => c.id));
    let list = payments.filter((p) => !p.category_id || !estornoIds.has(p.category_id));
    if (filterUser !== ALL) list = list.filter((p) => p.recorded_by === filterUser);
    if (filterCategory !== ALL) {
      list = list.filter((p) =>
        filterCategory === "none" ? p.category_id == null : p.category_id === filterCategory
      );
    }
    if (filterAccount !== ALL) {
      if (filterAccount === "credito") {
        list = list.filter((p) => p.to_account === true && p.account_direction === "credito");
      } else if (filterAccount === "debito") {
        list = list.filter((p) => p.to_account === true && p.account_direction === "debito");
      } else if (filterAccount === "none") {
        list = list.filter((p) => !p.to_account);
      }
    }
    if (filterReceived === "received") {
      list = list.filter((p) => p.received === true);
    } else if (filterReceived === "pending") {
      list = list.filter((p) => p.received !== true);
    }
    const q = normalizeText(filterClientName);
    if (q) {
      list = list.filter((p) => {
        const name = p.client_id ? clients[p.client_id]?.full_name ?? "" : "";
        return normalizeText(name).includes(q);
      });
    }
    return list;
  }, [payments, categories, filterUser, filterCategory, filterAccount, filterReceived, filterClientName, clients]);

  // Lista visível considera também o filtro de forma de pagamento
  const visiblePayments = useMemo(() => {
    if (filterMethod === ALL) return userFiltered;
    return userFiltered.filter((p) => p.method === filterMethod);
  }, [userFiltered, filterMethod]);

  // Mapa de id->nome de categoria para identificar "Saldo Anterior" (excluído de somas)
  const catNameById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);
  const isSaldoAnt = (p: PaymentRow) =>
    isSaldoAnterior(p.category_id ? catNameById.get(p.category_id) : null);

  // Compilado por forma de pagamento (ignora o filtro de método para mostrar todas as formas)
  const methodTotals = useMemo(() => {
    const totals: Record<string, { count: number; amount: number }> = {};
    userFiltered.forEach((p) => {
      if (p.received !== true) return;
      if (isSaldoAnt(p)) return;
      const key = p.method;
      if (!totals[key]) totals[key] = { count: 0, amount: 0 };
      totals[key].count += 1;
      totals[key].amount += Number(p.amount);
    });
    return Object.entries(totals).sort((a, b) => b[1].amount - a[1].amount);
  }, [userFiltered, catNameById]);

  const grandTotal = visiblePayments.reduce(
    (s, p) => (p.received === true && !isSaldoAnt(p) ? s + Number(p.amount) : s),
    0
  );

  const handlePrint = () => {
    const dateLabel = format(filterDate, "PPP", { locale: ptBR });
    const userLabel =
      filterUser === ALL ? "Todos" : profiles[filterUser]?.full_name ?? "—";
    const methodLabel =
      filterMethod === ALL ? "Todas" : METHOD_LABELS[filterMethod] ?? filterMethod;
    const categoryLabel =
      filterCategory === ALL
        ? "Todas"
        : filterCategory === "none"
          ? "Sem categoria"
          : categories.find((c) => c.id === filterCategory)?.name ?? "—";

    const methodRows = methodTotals
      .map(
        ([method, { count, amount }]) =>
          `<tr><td>${METHOD_LABELS[method] ?? method}</td><td style="text-align:right">${count}</td><td style="text-align:right">${fmtBRL(amount)}</td></tr>`
      )
      .join("");

    const METHOD_PRINT_ORDER: Record<string, number> = {
      credito: 1,
      debito: 2,
      pix: 3,
      dinheiro: 4,
      letzplay_pix: 5,
      letzplay_cartao: 6,
      rede_itau: 6.1,
      mercadopago: 6.2,
      transferencia: 7,
      conta_corrente: 8,
      outro: 99,
    };
    const sortedForPrint = [...visiblePayments].sort((a, b) => {
      const oa = METHOD_PRINT_ORDER[a.method] ?? 50;
      const ob = METHOD_PRINT_ORDER[b.method] ?? 50;
      if (oa !== ob) return oa - ob;
      // dentro do mesmo método, mais antigo primeiro (ordem cronológica)
      return new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime();
    });

    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

    const itemRows = sortedForPrint
      .map((p) => {
        const catName = p.category_id
          ? categories.find((c) => c.id === p.category_id)?.name ?? "—"
          : "—";
        const clientName = p.client_id
          ? clients[p.client_id]?.full_name ?? "—"
          : "—";
        return `<tr>
          <td>${esc(clientName)}</td>
          <td>${esc(catName)}</td>
          <td>${esc(String(p.court ?? "—"))}</td>
          <td>${esc(p.start_time ? p.start_time.slice(0, 5) : "—")}</td>
          <td>${esc(METHOD_LABELS[p.method] ?? p.method)}</td>
          <td style="text-align:right">${esc(fmtBRL(Number(p.amount)))}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"/>
      <title>Finanças — ${dateLabel}</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #111; }
        h1 { margin: 0 0 4px; font-size: 20px; }
        h2 { font-size: 14px; margin: 24px 0 8px; }
        .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
        .meta div { margin-bottom: 2px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; }
        th { background: #f5f5f5; text-align: left; }
        tfoot td { font-weight: 600; background: #fafafa; }
        @media print { body { padding: 0; } }
      </style></head><body>
        <h1>Finanças — Conciliação do dia</h1>
        <div class="meta">
          <div><strong>Data:</strong> ${esc(dateLabel)}</div>
          <div><strong>Usuário:</strong> ${esc(userLabel)}</div>
          <div><strong>Forma de pagamento:</strong> ${esc(methodLabel)}</div>
          <div><strong>Categoria:</strong> ${esc(categoryLabel)}</div>
        </div>

        <h2>Compilado por forma de pagamento</h2>
        <table>
          <thead><tr><th>Forma</th><th style="text-align:right">Qtde</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>${methodRows || `<tr><td colspan="3" style="text-align:center;color:#888">Sem lançamentos</td></tr>`}</tbody>
          <tfoot><tr><td>Total geral</td><td style="text-align:right">${visiblePayments.length}</td><td style="text-align:right">${fmtBRL(grandTotal)}</td></tr></tfoot>
        </table>

        <h2>Lançamentos do dia (${visiblePayments.length})</h2>
        <table>
          <thead><tr><th>Cliente</th><th>Categoria</th><th>Quadra</th><th>Início</th><th>Forma</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody>${itemRows || `<tr><td colspan="6" style="text-align:center;color:#888">Sem lançamentos</td></tr>`}</tbody>
          <tfoot><tr><td colspan="5" style="text-align:right">Total</td><td style="text-align:right">${fmtBRL(grandTotal)}</td></tr></tfoot>
        </table>

        <script>window.onload=()=>{window.print();}</script>
      </body></html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Finanças</h1>
          <p className="text-sm text-muted-foreground">
            Compilado dos lançamentos do caixa por dia e por usuário, para conciliação bancária.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setClosingOpen(true)} disabled={loading}>
            <Lock className="h-4 w-4 mr-2" /> Fechar caixa
          </Button>
          <Button asChild variant="outline">
            <Link to="/fechamentos">
              <FileText className="h-4 w-4 mr-2" /> Histórico
            </Link>
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={loading}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Filtrar por</Label>
            <Select value={dateField} onValueChange={(v) => setDateField(v as "paid_at" | "created_at")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paid_at">Data do pagamento</SelectItem>
                <SelectItem value="created_at">Data do lançamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Data</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !filterDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filterDate ? format(filterDate, "PPP", { locale: ptBR }) : "Selecione uma data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filterDate}
                  onSelect={(d) => d && setFilterDate(d)}
                  initialFocus
                  locale={ptBR}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Cliente</Label>
            <Input
              placeholder="Buscar por nome do cliente"
              value={filterClientName}
              onChange={(e) => setFilterClientName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Usuário</Label>
            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os usuários" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os usuários</SelectItem>
                {availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Forma de pagamento</Label>
            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Todas as formas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as formas</SelectItem>
                {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Todas as categorias" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as categorias</SelectItem>
                <SelectItem value="none">Sem categoria</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Conta corrente</Label>
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                <SelectItem value="credito">Crédito em conta</SelectItem>
                <SelectItem value="debito">Débito em conta</SelectItem>
                <SelectItem value="none">Sem conta corrente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={filterReceived} onValueChange={setFilterReceived}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                <SelectItem value="received">Apenas recebidos</SelectItem>
                <SelectItem value="pending">Apenas pendentes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Compilado por forma de pagamento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Compilado por forma de pagamento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : methodTotals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum lançamento encontrado para os filtros selecionados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Forma de pagamento</TableHead>
                  <TableHead className="text-right">Qtde</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {methodTotals.map(([method, { count, amount }]) => (
                  <TableRow key={method}>
                    <TableCell className="font-medium">
                      {METHOD_LABELS[method] ?? method}
                    </TableCell>
                    <TableCell className="text-right">{count}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {fmtBRL(amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total geral</TableCell>
                  <TableCell className="text-right">
                    {visiblePayments.length}
                  </TableCell>
                  <TableCell className="text-right">{fmtBRL(grandTotal)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Lista de lançamentos sem nome do cliente */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">
              Lançamentos do dia ({visiblePayments.length})
            </CardTitle>
            <Button
              size="sm"
              onClick={() => setNewOpen(true)}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Plus className="h-4 w-4 mr-2" /> Adicionar registro de pagamento
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visiblePayments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum lançamento encontrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Quadra</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePayments.map((p) => {
                    const catName = p.category_id
                      ? categories.find((c) => c.id === p.category_id)?.name ?? "—"
                      : "—";
                    const userName = p.recorded_by
                      ? profiles[p.recorded_by]?.full_name ?? "—"
                      : "—";
                    const clientName = p.client_id
                      ? clients[p.client_id]?.full_name ?? "—"
                      : "—";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">{fmtDateTime(p.paid_at)}</TableCell>
                        <TableCell className="text-sm">
                          {p.client_id ? (
                            <Link
                              to="/clientes/$clientId"
                              params={{ clientId: p.client_id }}
                              className="text-primary hover:underline"
                            >
                              {clientName}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{catName}</TableCell>
                        <TableCell className="text-sm">{p.court ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {p.start_time ? p.start_time.slice(0, 5) : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {METHOD_LABELS[p.method] ?? p.method}
                        </TableCell>
                        <TableCell className="text-sm">{userName}</TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtBRL(Number(p.amount))}
                        </TableCell>
                        <TableCell className="w-10">
                          <Checkbox aria-label="Marcar como conferido" />
                        </TableCell>
                        <TableCell className="w-10">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Editar lançamento"
                            title="Editar lançamento"
                            onClick={() => {
                              setEditingPaymentId(p.id);
                              setEditOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell className="w-10">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Excluir lançamento"
                            title="Excluir lançamento"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeletePayment(p.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={7} className="text-right">
                      Total
                    </TableCell>
                    <TableCell className="text-right">{fmtBRL(grandTotal)}</TableCell>
                    <TableCell className="w-10"></TableCell>
                    <TableCell className="w-10"></TableCell>
                    <TableCell className="w-10"></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EditPaymentDialog
        paymentId={editingPaymentId}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditingPaymentId(null);
        }}
        onSaved={() => loadAll(filterDate, dateField, { silent: true })}
      />

      <NewPaymentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSaved={() => loadAll(filterDate, dateField, { silent: true })}
      />

      <CashClosingDialog
        open={closingOpen}
        onOpenChange={setClosingOpen}
        onClosed={() => loadAll(filterDate, dateField, { silent: true })}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { logAction } from "@/lib/audit";
import { isSaldoAnterior, isEstorno } from "@/lib/category";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS as METHOD_LABELS } from "@/lib/payment-methods";


const METHODS_ORDER = [
  "dinheiro",
  "pix",
  "debito",
  "credito",
  "transferencia",
  "letzplay_pix",
  "letzplay_cartao",
  "rede_itau",
  "mercadopago",
  "conta_corrente",
  "outro",
];

const EXCLUDED_FROM_CASH = ["transferencia", "conta_corrente"];

interface PendingRow {
  id: string;
  amount: number;
  method: string;
  notes: string | null;
  client_id: string | null;
  category_id: string | null;
  clientName: string;
  resolution: "pending" | "paid" | "kept";
}

interface PaymentLite {
  id: string;
  amount: number;
  method: string;
  received: boolean;
  category_id: string | null;
  client_id: string | null;
  notes: string | null;
  to_account?: boolean | null;
  account_direction?: string | null;
  clientName?: string;
}

interface CategoryLite {
  id: string;
  name: string;
}

export function CashClosingDialog({
  open,
  onOpenChange,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onClosed?: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pending, setPending] = useState<PendingRow[]>([]);
  const [received, setReceived] = useState<PaymentLite[]>([]);
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [userFilter, setUserFilter] = useState<string>("all");

  interface StockRow {
    item_id: string;
    name: string;
    initial: number;
    restocked: number;
    sold: number;
    expected: number;
    countedStr: string;
    note: string;
  }
  const [stockRows, setStockRows] = useState<StockRow[]>([]);

  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  useEffect(() => {
    if (!open) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userFilter]);

  const loadData = async () => {
    setLoading(true);
    setStep(1);
    setNotes("");
    setCounted({});
    setStockRows([]);
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).toISOString();

      let paymentsQuery = supabase
        .from("payments")
        .select("id, amount, method, received, category_id, client_id, notes, to_account, account_direction, recorded_by")
        .gte("paid_at", startOfDay)
        .lt("paid_at", endOfDay);
      if (userFilter !== "all") {
        paymentsQuery = paymentsQuery.eq("recorded_by", userFilter);
      }

      const [paymentsRes, catsRes, existingRes, rolesRes, profilesRes] = await Promise.all([
        paymentsQuery,
        supabase.from("client_categories").select("id, name"),
        supabase
          .from("cash_closings")
          .select("id")
          .eq("closing_date", todayISO)
          .order("closed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("user_roles").select("user_id, role").in("role", ["recepcionista", "diretoria"]),
        supabase.from("profiles").select("id, full_name").order("full_name"),
      ]);

      if (paymentsRes.error) throw paymentsRes.error;
      if (catsRes.error) throw catsRes.error;

      const cats = (catsRes.data ?? []) as CategoryLite[];
      setCategories(cats);
      setExistingId(existingRes.data?.id ?? null);
      const allowedIds = new Set((rolesRes.data ?? []).map((r) => r.user_id));
      setUsers(
        ((profilesRes.data ?? []) as { id: string; full_name: string | null }[])
          .filter((p) => allowedIds.has(p.id))
          .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")),
      );

      const estornoIds = new Set(cats.filter((c) => isEstorno(c.name)).map((c) => c.id));
      const all = (paymentsRes.data ?? []) as PaymentLite[];
      const filtered = all.filter((p) => !p.category_id || !estornoIds.has(p.category_id));

      // Pagamentos lançados como débito/crédito na conta corrente do cliente
      // não passam pelo caixa físico, então não devem aparecer como pendentes a conferir.
      const pendingList = filtered.filter(
        (p) => p.received !== true && !(p.to_account === true && p.account_direction),
      );
      const clientIds = Array.from(
        new Set(
          [...pendingList, ...filtered.filter((p) => p.received === true)]
            .map((p) => p.client_id)
            .filter(Boolean),
        ),
      ) as string[];
      let clientMap: Record<string, string> = {};
      if (clientIds.length) {
        const { data: cls } = await supabase.from("clients").select("id, full_name").in("id", clientIds);
        (cls ?? []).forEach((c) => {
          clientMap[c.id] = c.full_name;
        });
      }

      setPending(
        pendingList.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          notes: p.notes,
          client_id: p.client_id,
          category_id: p.category_id,
          clientName: p.client_id ? clientMap[p.client_id] ?? "—" : "Sem cliente",
          resolution: "pending",
        })),
      );
      setReceived(
        filtered
          .filter((p) => p.received === true)
          .map((p) => ({
            ...p,
            clientName: p.client_id ? clientMap[p.client_id] ?? "—" : "Sem cliente",
          })),
      );

      // Stock report data (Terno de bola / Grip)
      const [itemsRes, movsRes] = await Promise.all([
        supabase.from("stock_items").select("id, name, current_quantity").order("name"),
        supabase
          .from("stock_movements")
          .select("item_id, movement_type, quantity")
          .gte("created_at", startOfDay)
          .lt("created_at", endOfDay),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (movsRes.error) throw movsRes.error;
      const movsToday = (movsRes.data ?? []) as Array<{ item_id: string; movement_type: string; quantity: number }>;
      const rows: StockRow[] = ((itemsRes.data ?? []) as Array<{ id: string; name: string; current_quantity: number }>).map((it) => {
        const itemMovs = movsToday.filter((m) => m.item_id === it.id);
        const restocked = itemMovs.filter((m) => m.movement_type === "entrada").reduce((s, m) => s + Number(m.quantity), 0);
        const sold = itemMovs.filter((m) => m.movement_type === "saida").reduce((s, m) => s + Number(m.quantity), 0);
        const current = Number(it.current_quantity);
        const expected = current; // current already reflects today's movements
        const initial = current - restocked + sold;
        return {
          item_id: it.id,
          name: it.name,
          initial,
          restocked,
          sold,
          expected,
          countedStr: "",
          note: "",
        };
      });
      setStockRows(rows);

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar dados do fechamento.");
    } finally {
      setLoading(false);
    }
  };

  const catNameById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const isSaldoAnt = (p: PaymentLite) =>
    isSaldoAnterior(p.category_id ? catNameById.get(p.category_id) : null);

  const systemTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    METHODS_ORDER.forEach((m) => (totals[m] = 0));
    received.forEach((p) => {
      if (isSaldoAnt(p)) return;
      if (!(p.method in totals)) totals[p.method] = 0;
      totals[p.method] += Number(p.amount);
    });
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received, catNameById]);

  const methodsToShow = useMemo(() => {
    const set = new Set<string>(METHODS_ORDER);
    Object.keys(systemTotals).forEach((k) => set.add(k));
    return Array.from(set);
  }, [systemTotals]);

  const methodsToShowCash = useMemo(
    () => methodsToShow.filter((m) => !EXCLUDED_FROM_CASH.includes(m)),
    [methodsToShow]
  );

  const allPendingResolved = pending.every((p) => p.resolution !== "pending");

  const stockAllCounted = stockRows.every((r) => r.countedStr.trim() !== "" && !isNaN(parseInt(r.countedStr, 10)));
  const stockNeedsNote = stockRows.some((r) => {
    const c = parseInt(r.countedStr, 10);
    return !isNaN(c) && c !== r.expected && !r.note.trim();
  });

  const updateStockRow = (item_id: string, patch: Partial<{ countedStr: string; note: string }>) => {
    setStockRows((rows) => rows.map((r) => (r.item_id === item_id ? { ...r, ...patch } : r)));
  };

  const handleResolvePending = async (id: string, action: "paid" | "kept") => {
    if (action === "paid") {
      const { error } = await supabase.from("payments").update({ received: true }).eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      await logAction({ entity: "payment", entity_id: id, action: "update", details: { received: true, via: "cash_closing" } });
      // move to received
      const p = pending.find((x) => x.id === id);
      if (p) {
        setReceived((cur) => [
          ...cur,
          {
            id: p.id,
            amount: p.amount,
            method: p.method,
            received: true,
            category_id: p.category_id,
            client_id: p.client_id,
            notes: p.notes,
            clientName: p.clientName,
          },
        ]);
      }
    }
    setPending((cur) => cur.map((p) => (p.id === id ? { ...p, resolution: action } : p)));
  };

  const grandSystem = methodsToShowCash.reduce((s, m) => s + (systemTotals[m] ?? 0), 0);
  const grandCounted = methodsToShowCash.reduce((s, m) => s + (Number(counted[m] || 0) || 0), 0);
  const grandDiff = grandCounted - grandSystem;

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Sessão expirada.");

      const totals_system: Record<string, number> = {};
      const totals_counted: Record<string, number> = {};
      const differences: Record<string, number> = {};
      methodsToShowCash.forEach((m) => {
        const sys = Number((systemTotals[m] ?? 0).toFixed(2));
        const cnt = Number((Number(counted[m] || 0) || 0).toFixed(2));
        totals_system[m] = sys;
        totals_counted[m] = cnt;
        differences[m] = Number((cnt - sys).toFixed(2));
      });

      const pending_resolved = pending.map((p) => ({
        payment_id: p.id,
        client: p.clientName,
        amount: p.amount,
        method: p.method,
        action: p.resolution,
      }));

      const selectedUser = users.find((u) => u.id === userFilter);
      const userPrefix =
        userFilter !== "all" && selectedUser
          ? `[Usuário: ${selectedUser.full_name ?? userFilter}] `
          : "";
      const stock_report = stockRows.map((r) => {
        const c = parseInt(r.countedStr, 10);
        const counted = isNaN(c) ? r.expected : c;
        return {
          item_id: r.item_id,
          name: r.name,
          initial: r.initial,
          restocked: r.restocked,
          sold: r.sold,
          expected: r.expected,
          counted,
          diff: counted - r.expected,
          note: r.note.trim() || null,
        };
      });

      const { error } = await supabase.from("cash_closings").insert({
        closing_date: todayISO,
        closed_by: uid,
        cash_user_id: userFilter !== "all" ? userFilter : null,
        totals_system,
        totals_counted,
        differences,
        pending_resolved,
        stock_report,
        notes: (userPrefix + (notes.trim() || "")).trim() || null,
      });
      if (error) throw error;

      // Apply physical-count adjustments to stock
      for (const r of stock_report) {
        if (r.diff !== 0) {
          await supabase.from("stock_movements").insert({
            item_id: r.item_id,
            movement_type: "ajuste",
            quantity: Math.abs(r.diff),
            notes: `Ajuste fechamento de caixa${r.note ? ` — ${r.note}` : ""} (esperado ${r.expected}, contado ${r.counted})`,
            recorded_by: uid,
          });
          // current_quantity was based on system; bring it to counted
          await supabase
            .from("stock_items")
            .update({ current_quantity: r.counted })
            .eq("id", r.item_id);
        }
      }

      await logAction({
        entity: "cash_closing",
        entity_id: todayISO,
        action: "create",
        details: { totals_system, totals_counted, differences, stock_report },
      });
      toast.success("Caixa fechado com sucesso!");
      handlePrint();
      onOpenChange(false);
      onClosed?.();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && "message" in e && typeof e.message === "string"
            ? e.message
            : "Não foi possível salvar o fechamento.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    const dateStr = new Date().toLocaleDateString("pt-BR");
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const selectedUser = users.find((u) => u.id === userFilter);
    const userLabel = userFilter !== "all" && selectedUser ? (selectedUser.full_name ?? userFilter) : "Todos";

    const receivedNonZero = received
      .filter((p) => Number(p.amount) > 0 && !isSaldoAnt(p))
      .sort((a, b) => {
        const ai = METHODS_ORDER.indexOf(a.method);
        const bi = METHODS_ORDER.indexOf(b.method);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

    const byMethod = new Map<string, PaymentLite[]>();
    receivedNonZero.forEach((p) => {
      const list = byMethod.get(p.method) ?? [];
      list.push(p);
      byMethod.set(p.method, list);
    });

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const sectionsHtml = Array.from(byMethod.entries())
      .map(([method, items]) => {
        const subtotal = items.reduce((s, p) => s + Number(p.amount), 0);
        const rows = items
          .map(
            (p) => `
              <tr>
                <td>${esc(p.clientName ?? "—")}</td>
                <td>${esc(p.category_id ? catNameById.get(p.category_id) ?? "" : "")}</td>
                <td>${esc(p.notes ?? "")}</td>
                <td class="r">${fmtBRL(Number(p.amount))}</td>
              </tr>`,
          )
          .join("");
        return `
          <h3>${esc(METHOD_LABELS[method] ?? method)}</h3>
          <table>
            <thead><tr><th>Cliente</th><th>Categoria</th><th>Obs.</th><th class="r">Valor</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td colspan="3" class="r"><strong>Subtotal</strong></td><td class="r"><strong>${fmtBRL(subtotal)}</strong></td></tr></tfoot>
          </table>`;
      })
      .join("");

    const total = receivedNonZero.reduce((s, p) => s + Number(p.amount), 0);

    const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Fechamento de caixa — ${dateStr}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .muted { color: #666; font-size: 12px; margin-bottom: 16px; }
  h3 { margin: 18px 0 6px; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th.r, td.r { text-align: right; }
  tfoot td { border-top: 1px solid #999; border-bottom: none; }
  .total { margin-top: 18px; font-size: 14px; text-align: right; border-top: 2px solid #000; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h1>Fechamento de caixa — ${dateStr}</h1>
  <div class="muted">Emitido às ${timeStr} • Usuário: ${esc(userLabel)}</div>
  ${receivedNonZero.length === 0 ? "<p>Nenhum pagamento recebido.</p>" : sectionsHtml}
  <div class="total"><strong>Total recebido: ${fmtBRL(total)}</strong></div>
  <script>window.onload = () => { window.print(); };</script>
</body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      toast.error("Permita pop-ups para imprimir o fechamento.");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fechar caixa — {new Date().toLocaleDateString("pt-BR")}</DialogTitle>
          <DialogDescription>
            Etapa {step} de 4 — {step === 1 ? "pendentes do dia" : step === 2 ? "conferência por forma" : step === 3 ? "prestação de contas (loja)" : "confirmação"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Usuário:</Label>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="h-8 w-full sm:w-64">
              <SelectValue placeholder="Todos os usuários" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os usuários</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name ?? u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {existingId && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
            <div>
              Já existe um fechamento registrado para hoje. Continuar criará um novo registro (fechamento corretivo).
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {step === 1 && (
              <div className="space-y-3">
                {pending.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Nenhum pagamento pendente hoje.
                  </div>
                ) : (
                  <div className="max-h-[50vh] overflow-y-auto space-y-2">
                    {pending.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{p.clientName}</div>
                          <div className="text-xs text-muted-foreground">
                            {METHOD_LABELS[p.method] ?? p.method} • {fmtBRL(p.amount)}
                            {p.notes ? ` • ${p.notes}` : ""}
                          </div>
                        </div>
                        {p.resolution === "pending" ? (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleResolvePending(p.id, "paid")}>
                              Foi pago
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResolvePending(p.id, "kept")}
                            >
                              Continua pendente
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={p.resolution === "paid" ? "default" : "secondary"}>
                            {p.resolution === "paid" ? "Marcado como pago" : "Mantido pendente"}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Forma</TableHead>
                        <TableHead className="text-right">Sistema</TableHead>
                        <TableHead className="text-right">Conferido</TableHead>
                        <TableHead className="text-right">Diferença</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {methodsToShowCash.map((m) => {
                        const sys = systemTotals[m] ?? 0;
                        const cnt = Number(counted[m] || 0) || 0;
                        const diff = cnt - sys;
                        return (
                          <TableRow key={m}>
                            <TableCell className="font-medium">
                              {METHOD_LABELS[m] ?? m}
                            </TableCell>
                            <TableCell className="text-right">{fmtBRL(sys)}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                inputMode="decimal"
                                className="ml-auto h-8 w-28 text-right"
                                value={counted[m] ?? ""}
                                onChange={(e) =>
                                  setCounted((c) => ({ ...c, [m]: e.target.value.replace(",", ".") }))
                                }
                                placeholder="0,00"
                              />
                            </TableCell>
                            <TableCell
                              className={`text-right ${
                                Math.abs(diff) < 0.005
                                  ? "text-green-600"
                                  : "text-red-600 font-medium"
                              }`}
                            >
                              {fmtBRL(diff)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold">{fmtBRL(grandSystem)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtBRL(grandCounted)}</TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
                            Math.abs(grandDiff) < 0.005 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {fmtBRL(grandDiff)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                <div className="space-y-2">
                  <Label>Observação (opcional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Algo a registrar sobre este fechamento?"
                    rows={2}
                  />
                </div>
                {Math.abs(grandDiff) >= 0.005 && (
                  <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-red-600" />
                    <div>
                      Há diferença entre o sistema e o conferido. Ajuste os valores antes de continuar.
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  Prestação de contas para a loja (Terno de bola e Grip). Não entra nas finanças do caixa.
                </div>
                {stockRows.length === 0 ? (
                  <div className="text-muted-foreground text-sm">Nenhum item de estoque cadastrado.</div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Inicial</TableHead>
                          <TableHead className="text-right">+ Reposição</TableHead>
                          <TableHead className="text-right">- Vendido</TableHead>
                          <TableHead className="text-right">= Esperado</TableHead>
                          <TableHead className="text-right">Contagem física</TableHead>
                          <TableHead className="text-right">Dif.</TableHead>
                          <TableHead>Observação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockRows.map((r) => {
                          const c = parseInt(r.countedStr, 10);
                          const hasCount = !isNaN(c);
                          const diff = hasCount ? c - r.expected : 0;
                          return (
                            <TableRow key={r.item_id}>
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell className="text-right">{r.initial}</TableCell>
                              <TableCell className="text-right text-green-600">+{r.restocked}</TableCell>
                              <TableCell className="text-right text-red-600">-{r.sold}</TableCell>
                              <TableCell className="text-right font-semibold">{r.expected}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  inputMode="numeric"
                                  className="ml-auto h-8 w-20 text-right"
                                  value={r.countedStr}
                                  onChange={(e) => updateStockRow(r.item_id, { countedStr: e.target.value.replace(/[^0-9]/g, "") })}
                                  placeholder="0"
                                />
                              </TableCell>
                              <TableCell className={`text-right font-medium ${!hasCount ? "text-muted-foreground" : diff === 0 ? "text-green-600" : "text-red-600"}`}>
                                {hasCount ? (diff > 0 ? `+${diff}` : diff) : "—"}
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8"
                                  value={r.note}
                                  onChange={(e) => updateStockRow(r.item_id, { note: e.target.value })}
                                  placeholder={hasCount && diff !== 0 ? "Obrigatório se houver diferença" : "Opcional"}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {!stockAllCounted && stockRows.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
                    <div>Informe a contagem física de todos os itens antes de continuar.</div>
                  </div>
                )}
                {stockAllCounted && stockNeedsNote && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
                    <div>Itens com diferença precisam de observação explicando o motivo.</div>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Sistema</div>
                    <div className="font-semibold">{fmtBRL(grandSystem)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Conferido</div>
                    <div className="font-semibold">{fmtBRL(grandCounted)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Diferença</div>
                    <div
                      className={`font-semibold ${
                        Math.abs(grandDiff) < 0.005 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {fmtBRL(grandDiff)}
                    </div>
                  </div>
                </div>
                {Math.abs(grandDiff) >= 0.005 && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
                    <div>
                      Há diferença entre o sistema e o que foi conferido. Confirme se deseja registrar mesmo assim.
                    </div>
                  </div>
                )}
                <div className="rounded-md border p-3">
                  <div className="font-medium mb-1">Pendentes revisados</div>
                  {pending.length === 0 ? (
                    <div className="text-muted-foreground text-xs">Nenhum pendente no dia.</div>
                  ) : (
                    <ul className="text-xs space-y-1">
                      {pending.map((p) => (
                        <li key={p.id} className="flex justify-between">
                          <span>
                            {p.clientName} — {fmtBRL(p.amount)} ({METHOD_LABELS[p.method] ?? p.method})
                          </span>
                          <span className={p.resolution === "paid" ? "text-green-600" : "text-muted-foreground"}>
                            {p.resolution === "paid" ? "pago" : "mantido pendente"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {stockRows.length > 0 && (
                  <div className="rounded-md border p-3">
                    <div className="font-medium mb-1">Prestação de contas — Loja</div>
                    <ul className="text-xs space-y-1">
                      {stockRows.map((r) => {
                        const c = parseInt(r.countedStr, 10);
                        const counted = isNaN(c) ? r.expected : c;
                        const diff = counted - r.expected;
                        return (
                          <li key={r.item_id} className="flex justify-between">
                            <span>
                              {r.name}: inicial {r.initial} • +{r.restocked} reposto • -{r.sold} vendido • contado {counted}
                            </span>
                            <span className={diff === 0 ? "text-green-600" : "text-red-600"}>
                              {diff === 0 ? "ok" : diff > 0 ? `+${diff}` : diff}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1))}
              disabled={saving}
            >
              Voltar
            </Button>
          )}
          {step < 4 && (
            <Button
              onClick={() => setStep((s) => (s === 1 ? 2 : s === 2 ? 3 : 4))}
              disabled={
                loading ||
                (step === 1 && !allPendingResolved) ||
                (step === 2 && Math.abs(grandDiff) >= 0.005) ||
                (step === 3 && (!stockAllCounted || stockNeedsNote))
              }
            >
              Continuar
            </Button>
          )}
          {step === 4 && (
            <>
              <Button variant="outline" onClick={handlePrint} disabled={saving}>
                Imprimir
              </Button>
              <Button onClick={handleConfirm} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar fechamento
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

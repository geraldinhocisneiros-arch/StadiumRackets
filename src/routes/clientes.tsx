import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtBRL, normalizeText, toTitleCase } from "@/lib/format";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Plus, Pencil, Loader2, Eye, Trash2, Printer } from "lucide-react";
import { useUrlState } from "@/hooks/useUrlState";
import { fetchAll } from "@/lib/fetchAll";
import { MonthEndProjectionButton } from "@/components/MonthEndProjectionButton";
import { useServerFn } from "@tanstack/react-start";
import { deleteClientAccount } from "@/lib/users.functions";

export const Route = createFileRoute("/clientes")({
  component: () => (
    <RequireAuth pageKey="clientes">
      <ClientesPage />
    </RequireAuth>
  ),
});

interface Client {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  due_day: number | null;
  active: boolean;
  category_id: string | null;
  financial_responsible: string | null;
  is_gympass: boolean;
  notes: string | null;
  default_discount_percent: number | null;
  teacher_id: string | null;
  custom_amount: number | null;
}

interface ClientWithBalance extends Client {
  balance: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function ClientesPage() {
  const { isAdmin, isRecepcionista, isDiretoria } = useAuth();
  const canUseMonthEndProjection = isAdmin || isRecepcionista || isDiretoria;
  const location = useLocation();
  const [clients, setClients] = useState<ClientWithBalance[]>([]);
  const [categoryList, setCategoryList] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const deleteClientAccountFn = useServerFn(deleteClientAccount);
  const [editing, setEditing] = useState<Client | null>(null);
  const [search, setSearch] = useUrlState<string>("q", "");
  const [showInactive, setShowInactive] = useUrlState<boolean>("inactive", false);
  const [balanceFilter, setBalanceFilter] = useUrlState<"all" | "credit" | "low_credit" | "debit">("balance", "all");
  const [gympassFilter, setGympassFilter] = useUrlState<"all" | "gympass" | "non_gympass">("gympass", "all");
  const [categoryFilter, setCategoryFilter] = useUrlState<string>("cat", "all");
  const [letterFrom, setLetterFrom] = useUrlState<string>("letterFrom", "all");
  const [letterTo, setLetterTo] = useUrlState<string>("letterTo", "all");

  const load = async () => {
    setLoading(true);
    const [cli, { data: cats }] = await Promise.all([
      fetchAll<Client>(
        "clients",
        "id, full_name, phone, email, due_day, active, category_id, financial_responsible, is_gympass, notes, default_discount_percent, teacher_id, custom_amount",
      ),
      supabase.from("client_categories").select("id, name").order("name"),
    ]);
    setCategoryList((cats ?? []) as Array<{ id: string; name: string }>);

    const list = (cli ?? []) as Client[];

    // load balances for each client (sum of credits - debits)
    // Use paginated fetch to bypass Supabase's 1000-row default limit
    const entries = await fetchAll<{ client_id: string; entry_type: string; amount: number }>(
      "account_entries",
      "client_id, entry_type, amount",
    );

    const balanceMap = new Map<string, number>();
    (entries ?? []).forEach((e) => {
      const cur = balanceMap.get(e.client_id) ?? 0;
      const delta = e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
      balanceMap.set(e.client_id, cur + delta);
    });

    const withBalance = list.map((c) => ({ ...c, balance: balanceMap.get(c.id) ?? 0 }));
    withBalance.sort((a, b) =>
      normalizeText(a.full_name).localeCompare(normalizeText(b.full_name), "pt-BR")
    );
    setClients(withBalance);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const searchTerms = normalizeText(search).split(/\s+/).filter(Boolean);
  const filtered = clients.filter(
    (c) => {
      const normalizedName = normalizeText(c.full_name);
      return (showInactive || c.active) &&
      (searchTerms.length === 0 || searchTerms.every((term) => normalizedName.includes(term))) &&
      (balanceFilter === "all" ||
        (balanceFilter === "credit" && c.balance > 0) ||
        (balanceFilter === "low_credit" && c.balance > 0 && c.balance <= 250) ||
        (balanceFilter === "debit" && c.balance < 0)) &&
      (gympassFilter === "all" ||
        (gympassFilter === "gympass" && c.is_gympass) ||
        (gympassFilter === "non_gympass" && !c.is_gympass)) &&
      (categoryFilter === "all" ||
        (categoryFilter === "none" && !c.category_id) ||
        c.category_id === categoryFilter) &&
      (() => {
        if (letterFrom === "all" && letterTo === "all") return true;
        const first = normalizedName.charAt(0);
        if (!first) return false;
        const from = letterFrom === "all" ? "a" : letterFrom;
        const to = letterTo === "all" ? "z" : letterTo;
        const lo = from <= to ? from : to;
        const hi = from <= to ? to : from;
        return first >= lo && first <= hi;
      })();
    }
  );

  const inactiveMatches = !showInactive && searchTerms.length > 0
    ? clients.filter((c) => {
        const normalizedName = normalizeText(c.full_name);
        return !c.active && searchTerms.every((term) => normalizedName.includes(term));
      })
    : [];

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const handlePrint = () => {
    const now = new Date().toLocaleString("pt-BR");
    const filterDesc: string[] = [];
    if (search) filterDesc.push(`Busca: "${search}"`);
    if (balanceFilter === "credit") filterDesc.push("Com crédito");
    else if (balanceFilter === "low_credit") filterDesc.push("Crédito ≤ R$ 250");
    else if (balanceFilter === "debit") filterDesc.push("Com débito");
    if (gympassFilter === "gympass") filterDesc.push("Apenas Gympass");
    else if (gympassFilter === "non_gympass") filterDesc.push("Sem Gympass");
    if (categoryFilter !== "all") {
      const catName = categoryFilter === "none"
        ? "Sem categoria"
        : categoryList.find((c) => c.id === categoryFilter)?.name ?? "Categoria";
      filterDesc.push(`Categoria: ${catName}`);
    }
    if (letterFrom !== "all" || letterTo !== "all") {
      filterDesc.push(`Letras: ${(letterFrom === "all" ? "A" : letterFrom).toUpperCase()} - ${(letterTo === "all" ? "Z" : letterTo).toUpperCase()}`);
    }
    if (showInactive) filterDesc.push("Incluindo inativos");

    const showCreditTotal = balanceFilter === "credit" || balanceFilter === "low_credit";
    const totalCredit = filtered.reduce((sum, c) => sum + c.balance, 0);

    const rows = filtered.map((c) => {
      const isDebt = c.balance < 0;
      const isLowCredit = c.balance > 0 && c.balance <= 250;
      const rowStyle = isDebt
        ? 'style="background:#fecaca;"'
        : isLowCredit
          ? 'style="background:#fef08a;"'
          : "";
      const balanceColor = isDebt ? "color:#b91c1c;font-weight:600;" : c.balance > 0 ? "color:#15803d;font-weight:600;" : "color:#6b7280;";
      return `<tr ${rowStyle}>
        <td>${escapeHtml(c.full_name)}</td>
        <td>${escapeHtml(c.phone ?? "—")}</td>
        <td>${c.due_day ? `Dia ${c.due_day}` : "—"}</td>
        <td style="text-align:center;">${c.is_gympass ? "Sim" : "—"}</td>
        <td style="text-align:right;${balanceColor}">${fmtBRL(c.balance)}</td>
        <td>${c.active ? "Ativo" : "Inativo"}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Clientes - ${now}</title>
<style>
  body{font-family:Arial,sans-serif;padding:20px;color:#111;}
  h1{margin:0 0 4px;font-size:20px;}
  .meta{color:#555;font-size:12px;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;}
  th{background:#f3f4f6;}
  .total{margin:8px 0;font-size:13px;}
  @media print{ button{display:none;} }
</style></head><body>
  <h1>Lista de Clientes</h1>
  <div class="meta">Gerado em ${now} • ${filtered.length} ${filtered.length === 1 ? "cliente" : "clientes"}${filterDesc.length ? " • " + filterDesc.join(" • ") : ""}</div>
  ${showCreditTotal ? `<div class="total"><strong>Total de crédito:</strong> ${fmtBRL(totalCredit)}</div>` : ""}
  <table>
    <thead><tr><th>Nome</th><th>Telefone</th><th>Vencimento</th><th style="text-align:center">Gympass</th><th style="text-align:right">Saldo</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload=()=>{window.print();}</script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Permita pop-ups para imprimir.");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  if (location.pathname !== "/clientes") {
    return <Outlet />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">{clients.filter((c) => c.active).length} clientes ativos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Novo cliente
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={letterFrom} onValueChange={setLetterFrom}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue placeholder="De" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">De: A</SelectItem>
                  {alphabet.map((l) => (
                    <SelectItem key={l} value={l.toLowerCase()}>
                      De: {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={letterTo} onValueChange={setLetterTo}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue placeholder="Até" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Até: Z</SelectItem>
                  {alphabet.map((l) => (
                    <SelectItem key={l} value={l.toLowerCase()}>
                      Até: {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={balanceFilter} onValueChange={(v) => setBalanceFilter(v as "all" | "credit" | "low_credit" | "debit")}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Saldo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os saldos</SelectItem>
                  <SelectItem value="credit">Com crédito</SelectItem>
                  <SelectItem value="low_credit">Crédito ≤ R$ 250</SelectItem>
                  <SelectItem value="debit">Com débito</SelectItem>
                </SelectContent>
              </Select>
              <Select value={gympassFilter} onValueChange={(v) => setGympassFilter(v as "all" | "gympass" | "non_gympass")}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Gympass" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="gympass">Apenas Gympass</SelectItem>
                  <SelectItem value="non_gympass">Sem Gympass</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {categoryList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch id="inactive" checked={showInactive} onCheckedChange={setShowInactive} />
                <Label htmlFor="inactive" className="cursor-pointer">
                  Mostrar inativos
                </Label>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <div className="overflow-x-auto">
              {inactiveMatches.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  <span>
                    {inactiveMatches.length === 1
                      ? `${inactiveMatches[0].full_name} existe, mas está inativo.`
                      : `${inactiveMatches.length} clientes encontrados estão inativos.`}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setShowInactive(true)}>
                    Mostrar inativos
                  </Button>
                </div>
              )}
              {(balanceFilter === "credit" || balanceFilter === "low_credit") && (
                <div className="mb-3 text-sm text-muted-foreground">
                  Total de crédito ({filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}):{" "}
                  <span className="font-semibold text-success">
                    {fmtBRL(filtered.reduce((sum, c) => sum + c.balance, 0))}
                  </span>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-center">Gympass</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const isDebt = c.balance < 0;
                    const isCredit = c.balance > 0;
                    const isLowCredit = c.balance > 0 && c.balance <= 250;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <Link
                            to="/clientes/$clientId"
                            params={{ clientId: c.id }}
                            className={
                              isDebt
                                ? "hover:underline rounded px-1.5 py-0.5 bg-red-500 text-white dark:bg-red-600 font-semibold"
                                : isLowCredit
                                  ? "hover:underline rounded px-1.5 py-0.5 bg-yellow-300 text-yellow-950 dark:bg-yellow-400 dark:text-yellow-950 font-semibold"
                                  : "hover:underline"
                            }
                            title={
                              isDebt
                                ? "Saldo negativo"
                                : isLowCredit
                                  ? "Crédito baixo (≤ R$ 250)"
                                  : undefined
                            }
                          >
                            {c.full_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                        <TableCell>{c.due_day ? `Dia ${c.due_day}` : "—"}</TableCell>
                        <TableCell className="text-center">
                          {c.is_gympass ? (
                            <Badge className="bg-purple-600 hover:bg-purple-600 text-white">Gympass</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span
                              className={
                                isDebt
                                  ? "text-destructive font-medium"
                                  : isCredit
                                    ? "text-success font-medium"
                                    : "text-muted-foreground"
                              }
                            >
                              {fmtBRL(c.balance)}
                            </span>
                            {canUseMonthEndProjection && (
                              <MonthEndProjectionButton clientId={c.id} iconOnly />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {c.active ? (
                            <Badge className="bg-success text-success-foreground">Ativo</Badge>
                          ) : (
                            <Badge variant="secondary">Inativo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="space-x-1 text-right">
                          <Button variant="outline" size="sm" title="Ver detalhes do cliente" asChild>
                            <Link to="/clientes/$clientId" params={{ clientId: c.id }}>
                              <Eye className="h-4 w-4 mr-1" /> Ver detalhes
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditing(c);
                              setOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {(isAdmin || isDiretoria || isRecepcionista) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Excluir cliente"
                              onClick={async () => {
                                if (!(await confirm(`Excluir o cliente "${c.full_name}"? Lançamentos da conta corrente também serão removidos.`))) return;
                                try {
                                  await deleteClientAccountFn({ data: { clientId: c.id } });
                                  toast.success("Cliente excluído.");
                                  load();
                                  window.dispatchEvent(new Event("clients:updated"));
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Sem permissão para excluir este cliente.",
                                  );
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum cliente encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ClientDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        canDelete={isAdmin || isDiretoria || isRecepcionista}
        onSaved={load}
      />
    </div>
  );
}

export function ClientDialog({
  open,
  onOpenChange,
  editing,
  canDelete,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Client | null;
  canDelete: boolean;
  onSaved: (newId?: string) => void;
}) {
  const { isAdmin, isDiretoria, isRecepcionista } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [active, setActive] = useState(true);
  const [categoryId, setCategoryId] = useState<string>("none");
  const [financialResponsible, setFinancialResponsible] = useState("");
  const [isGympass, setIsGympass] = useState(false);
  const [notes, setNotes] = useState("");
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [teacherId, setTeacherId] = useState<string>("none");
  const [additionalTeacherIds, setAdditionalTeacherIds] = useState<string[]>([]);
  // "Este cadastro é do professor X" (clients.linked_teacher_id): cadastro
  // que na verdade é o próprio professor — o diálogo de reserva recusa novas
  // reservas nele. Só admin/diretoria alteram. Carregado aqui (não vem no
  // `editing`) porque o diálogo é aberto de várias telas.
  const [linkedTeacherId, setLinkedTeacherId] = useState<string>("none");
  const [linkedTeacherLoaded, setLinkedTeacherLoaded] = useState(false);
  const canEditLinkedTeacher = isAdmin || isDiretoria;
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [teachers, setTeachers] = useState<Array<{ id: string; name: string }>>([]);
  const [allClientNames, setAllClientNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const confirm = useConfirm();
  const deleteClientAccountFn = useServerFn(deleteClientAccount);

  useEffect(() => {
    if (open) {
      setName(editing?.full_name ?? "");
      setPhone(editing?.phone ?? "");
      setEmail(editing?.email ?? "");
      setDueDay(editing?.due_day?.toString() ?? "");
      setActive(editing?.active ?? true);
      setCategoryId(editing?.category_id ?? "none");
      setFinancialResponsible(editing?.financial_responsible ?? "");
      setIsGympass(editing?.is_gympass ?? false);
      setNotes(editing?.notes ?? "");
      setDefaultDiscountPercent(
        editing?.default_discount_percent && editing.default_discount_percent > 0
          ? String(editing.default_discount_percent)
          : ""
      );
      setCustomAmount(
        editing?.custom_amount != null ? String(editing.custom_amount) : ""
      );
      setTeacherId(editing?.teacher_id ?? "none");
      setAdditionalTeacherIds([]);
      setLinkedTeacherId("none");
      setLinkedTeacherLoaded(!editing?.id);
      supabase
        .from("teachers")
        .select("id, name, active")
        .order("name")
        .then(({ data }) =>
          setTeachers(
            ((data ?? []) as Array<{ id: string; name: string; active: boolean }>)
              .filter((t) => t.active || t.id === editing?.teacher_id)
              .map((t) => ({ id: t.id, name: t.name }))
          )
        );
      if (editing?.id) {
        supabase
          .from("clients")
          .select("linked_teacher_id")
          .eq("id", editing.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) return;
            setLinkedTeacherId(data?.linked_teacher_id ?? "none");
            setLinkedTeacherLoaded(true);
          });
        supabase
          .from("client_teachers")
          .select("teacher_id")
          .eq("client_id", editing.id)
          .then(({ data }) =>
            setAdditionalTeacherIds(
              ((data ?? []) as Array<{ teacher_id: string }>)
                .map((r) => r.teacher_id)
                .filter((id) => id !== editing?.teacher_id),
            ),
          );
      }
      supabase
        .from("client_categories")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .then(({ data }) => setCategories(data ?? []));
      fetchAll<{ full_name: string; active: boolean }>("clients", "full_name, active")
        .then((data) =>
          setAllClientNames(
            data
              .filter((c) => c.active)
              .map((c) => c.full_name)
              .sort((a, b) => a.localeCompare(b, "pt-BR")),
          ),
        );
    }
  }, [open, editing]);

  // Auto-preenche 10% de desconto padrão quando a categoria selecionada é "mensalista"
  // e o campo ainda está vazio. Assim ao criar novo cliente ou trocar para mensalista
  // no cadastro, o desconto já vem sugerido (pode ser ajustado manualmente).
  useEffect(() => {
    if (!open) return;
    if (categoryId === "none" || !categories.length) return;
    const cat = categories.find((c) => c.id === categoryId);
    const norm = (cat?.name ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (norm === "mensalista" && defaultDiscountPercent.trim() === "") {
      setDefaultDiscountPercent("10");
    }
  }, [categoryId, categories, open, defaultDiscountPercent]);

  const handleSubmit = async (e: React.FormEvent, force = false) => {
    e.preventDefault();
    setSubmitting(true);

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const phoneDigits = trimmedPhone.replace(/\D/g, "");
    const normName = normalizeText(trimmedName);

    // Duplicate check (skip when forced confirmation)
    if (!force) {
      const existing = await fetchAll<{ id: string; full_name: string; phone: string | null }>(
        "clients",
        "id, full_name, phone",
      );

      const dupes: string[] = [];
      existing.forEach((c) => {
        if (editing && c.id === editing.id) return;
        if (normName && normalizeText(c.full_name) === normName) {
          dupes.push(`Nome igual: "${c.full_name}"`);
          return;
        }
        const otherDigits = (c.phone ?? "").replace(/\D/g, "");
        if (phoneDigits && otherDigits && phoneDigits === otherDigits) {
          dupes.push(`Telefone igual ao de "${c.full_name}" (${c.phone})`);
        }
      });

      if (dupes.length > 0) {
        setSubmitting(false);
        const ok = await confirm(
          `Já existe cadastro similar:\n\n${dupes.join("\n")}\n\nDeseja cadastrar mesmo assim?`
        );
        if (!ok) return;
        // Re-run forced
        return handleSubmit(e, true);
      }
    }

    const payload = {
      full_name: trimmedName,
      phone: trimmedPhone || null,
      email: email || null,
      due_day: dueDay ? Number(dueDay) : null,
      active,
      category_id: categoryId === "none" ? null : categoryId,
      financial_responsible: financialResponsible.trim() || null,
      is_gympass: isGympass,
      notes: notes.trim() || null,
      default_discount_percent: Math.min(Math.max(Number(defaultDiscountPercent) || 0, 0), 100),
      custom_amount: customAmount.trim() === "" ? null : Number(customAmount) || 0,
      teacher_id: teacherId === "none" ? null : teacherId,
      ...(canEditLinkedTeacher && linkedTeacherLoaded
        ? { linked_teacher_id: linkedTeacherId === "none" ? null : linkedTeacherId }
        : {}),
    };
    const { data, error } = editing
      ? await supabase.from("clients").update(payload).eq("id", editing.id).select("id").single()
      : await supabase.from("clients").insert(payload).select("id").single();
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }

    const clientId = data?.id ?? editing?.id;
    if (clientId) {
      const desiredTeacherIds = new Set(additionalTeacherIds);
      if (teacherId !== "none") desiredTeacherIds.add(teacherId);
      const { data: existingLinks } = await supabase
        .from("client_teachers")
        .select("teacher_id")
        .eq("client_id", clientId);
      const existingIds = new Set(
        ((existingLinks ?? []) as Array<{ teacher_id: string }>).map((r) => r.teacher_id),
      );
      const toAdd = [...desiredTeacherIds].filter((id) => !existingIds.has(id));
      const toRemove = [...existingIds].filter((id) => !desiredTeacherIds.has(id));
      await Promise.all([
        toAdd.length
          ? supabase
              .from("client_teachers")
              .insert(toAdd.map((teacher_id) => ({ client_id: clientId, teacher_id })))
          : Promise.resolve(),
        toRemove.length
          ? supabase
              .from("client_teachers")
              .delete()
              .eq("client_id", clientId)
              .in("teacher_id", toRemove)
          : Promise.resolve(),
      ]);
    }

    setSubmitting(false);
    toast.success(editing ? "Cliente atualizado!" : "Cliente criado!");
    onOpenChange(false);
    onSaved(data?.id);
    window.dispatchEvent(new Event("clients:updated"));
  };

  const handleDelete = async () => {
    if (!editing || !(await confirm("Excluir este cliente? Lançamentos da conta corrente também serão removidos."))) return;
    try {
      await deleteClientAccountFn({ data: { clientId: editing.id } });
      toast.success("Cliente excluído.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sem permissão para excluir este cliente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome completo</Label>
            <Input id="name" required value={name} onChange={(e) => setName(toTitleCase(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Categoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
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
            <Label htmlFor="teacher">Professor</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger id="teacher">
                <SelectValue placeholder="Selecione um professor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Sem professor —</SelectItem>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="linked-teacher">Este cadastro é do professor</Label>
            <Select
              value={linkedTeacherId}
              onValueChange={setLinkedTeacherId}
              disabled={!canEditLinkedTeacher || !linkedTeacherLoaded}
            >
              <SelectTrigger id="linked-teacher">
                <SelectValue placeholder="Não é cadastro de professor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Não é cadastro de professor —</SelectItem>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Marque quando este cliente for o próprio professor (ex.: "Guel professor"). A recepção
              não consegue criar novas reservas nele — a reserva deve ficar no nome do aluno, com o
              professor marcado.
              {!canEditLinkedTeacher && " Só admin ou diretoria alteram este campo."}
            </p>
          </div>
          {teachers.length > 0 && (
            <div className="space-y-2">
              <Label>Professores adicionais</Label>
              <p className="text-xs text-muted-foreground">
                Além do professor principal acima, marque outros professores vinculados a este cliente.
              </p>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-md border p-2">
                {teachers
                  .filter((t) => t.id !== teacherId)
                  .map((t) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`additional-teacher-${t.id}`}
                        checked={additionalTeacherIds.includes(t.id)}
                        onCheckedChange={(checked) =>
                          setAdditionalTeacherIds((prev) =>
                            checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <Label htmlFor={`additional-teacher-${t.id}`} className="cursor-pointer font-normal text-sm">
                        {t.name}
                      </Label>
                    </div>
                  ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="dueDay">Data de vencimento (dia do mês)</Label>
            <Input
              id="dueDay"
              type="number"
              min="1"
              max="31"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              placeholder="Ex: 10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="financialResponsible">Responsável financeiro</Label>
            <Input
              id="financialResponsible"
              list="financial-responsible-options"
              value={financialResponsible}
              onChange={(e) => setFinancialResponsible(toTitleCase(e.target.value))}
              placeholder="Nome de quem paga por este cliente"
            />
            <datalist id="financial-responsible-options">
              {allClientNames
                .filter((n) => !editing || n !== editing.full_name)
                .map((n) => (
                  <option key={n} value={n} />
                ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Observação (interna)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações internas — não aparecem no PDF"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultDiscount">Desconto padrão (%)</Label>
            <Input
              id="defaultDiscount"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={defaultDiscountPercent}
              onChange={(e) => setDefaultDiscountPercent(e.target.value)}
              placeholder="0"
              onWheel={(e) => e.currentTarget.blur()}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <p className="text-xs text-muted-foreground">
              Aplicado automaticamente em novos pagamentos. Pode ser ajustado na hora do lançamento.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customAmount">Valor personalizado (R$)</Label>
            <Input
              id="customAmount"
              type="number"
              min="0"
              step="0.01"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Deixe em branco para usar o valor padrão da categoria"
              onWheel={(e) => e.currentTarget.blur()}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <p className="text-xs text-muted-foreground">
              Sobrescreve o valor padrão da categoria nos lançamentos deste cliente — usado, por
              exemplo, para o valor de mensalista sugerido no Caixa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="gympass" checked={isGympass} onCheckedChange={setIsGympass} />
            <Label htmlFor="gympass" className="cursor-pointer">
              Gympass
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="active" className="cursor-pointer">
              Cliente ativo
            </Label>
          </div>
          <DialogFooter className="gap-2">
            {editing && canDelete && (
              <Button type="button" variant="destructive" onClick={handleDelete} className="mr-auto">
                Excluir
              </Button>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Loader2, Check, ChevronsUpDown, X, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { logAction } from "@/lib/audit";
import { todayISO, dateISOInRecife, recifeDateToISO, fmtBRL, accentInsensitiveFilter } from "@/lib/format";
import { ClientDialog } from "@/routes/clientes";
import { calcPrice, weekdayFromYmd, fmtHours, type PriceBand } from "@/lib/pricing";
import { fetchAll } from "@/lib/fetchAll";
import { PAYMENT_METHOD_OPTIONS as METHOD_OPTIONS } from "@/lib/payment-methods";

interface ClientRow {
  id: string;
  full_name: string;
  custom_amount: number | null;
  category_id: string | null;
  client_categories: { name: string; default_amount: number } | null;
  active?: boolean;
}
interface CategoryRow {
  id: string;
  name: string;
  default_amount: number;
}

interface FormState {
  clientId: string;
  categoryId: string;
  amount: string;
  passthroughAmount: string;
  method: string;
  paidAt: string;
  startTime: string;
  endTime: string;
  court: string;
  received: boolean;
  accountDirection: "" | "credito" | "debito";
  notes: string;
  isNewPlanSale: boolean;
  commissionUserId: string;
  quantity: string;
  isPendingPayment: boolean;
}

const emptyForm = (): FormState => ({
  clientId: "",
  categoryId: "",
  amount: "",
  passthroughAmount: "",
  method: "",
  paidAt: todayISO(),
  startTime: "",
  endTime: "",
  court: "",
  received: false,
  accountDirection: "",
  notes: "",
  isNewPlanSale: false,
  commissionUserId: "",
  quantity: "1",
  isPendingPayment: false,
});



import { COURTS, courtLabel } from "@/lib/court-map";
const NONE_VALUE = "__none__";

export interface EditPaymentDialogProps {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function EditPaymentDialog({ paymentId, open, onOpenChange, onSaved }: EditPaymentDialogProps) {
  const { user, isDiretoria, isAdmin } = useAuth();
  const canEditCommissionUser = isDiretoria || isAdmin;
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string }>>([]);
  const [allProfiles, setAllProfiles] = useState<Array<{ id: string; full_name: string }>>([]);
  const [priceBands, setPriceBands] = useState<PriceBand[]>([]);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);

  // Load supporting data once when dialog first opens
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [cls, { data: cats }, { data: profs }, { data: pb }] = await Promise.all([
        fetchAll<ClientRow>(
          "clients",
          "id, full_name, custom_amount, category_id, active, client_categories(name, default_amount)",
        ),
        supabase.from("client_categories").select("id, name, default_amount").eq("active", true).order("name"),
        supabase.from("profiles").select("id, full_name").order("full_name"),
        supabase.from("price_table").select("id, categories, weekday, start_time, end_time, price_per_hour, courts, starts_on, ends_on"),
      ]);
      const { data: recepRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "recepcionista");
      setClients(
        cls
          .filter((c) => c.active)
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
      );
      setCategories((cats as unknown as CategoryRow[]) ?? []);
      const allProfs = (profs as unknown as Array<{ id: string; full_name: string }>) ?? [];
      const recepIds = new Set((recepRoles ?? []).map((r) => r.user_id));
      setAllProfiles(allProfs);
      setProfiles(allProfs.filter((p) => recepIds.has(p.id)));
      setPriceBands((pb as unknown as PriceBand[]) ?? []);
    })();
  }, [open]);

  // Load the payment whenever the targeted id changes
  useEffect(() => {
    if (!open || !paymentId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, client_id, category_id, amount, passthrough_amount, method, paid_at, start_time, end_time, court, received, to_account, account_direction, notes, is_new_plan_sale, commission_user_id, recorded_by, quantity, is_pending_payment",
        )
        .eq("id", paymentId)
        .maybeSingle();
      setLoading(false);
      if (error) {
        toast.error("Não foi possível carregar o pagamento: " + error.message);
        onOpenChange(false);
        return;
      }
      if (!data) {
        toast.error("Pagamento não encontrado.");
        onOpenChange(false);
        return;
      }
      setForm({
        clientId: data.client_id ?? "",
        categoryId: data.category_id ?? "",
        amount: String(data.amount),
        passthroughAmount:
          (data as { passthrough_amount?: number | null }).passthrough_amount &&
          Number((data as { passthrough_amount?: number | null }).passthrough_amount) > 0
            ? String((data as { passthrough_amount?: number | null }).passthrough_amount)
            : "",
        method: data.method,
        paidAt: dateISOInRecife(new Date(data.paid_at)),
        startTime: data.start_time ? data.start_time.slice(0, 5) : "",
        endTime: data.end_time ? data.end_time.slice(0, 5) : "",
        court: data.court ? String(data.court) : "",
        received: data.received,
        accountDirection: (data.account_direction as "credito" | "debito" | null) ?? "",
        notes: data.notes ?? "",
        isNewPlanSale: data.is_new_plan_sale ?? false,
        commissionUserId:
          (data as { commission_user_id?: string | null }).commission_user_id ??
          (data as { recorded_by?: string | null }).recorded_by ??
          "",
        quantity: String((data as { quantity?: number | null }).quantity ?? 1),
        isPendingPayment: (data as { is_pending_payment?: boolean | null }).is_pending_payment ?? false,
      });

    })();
  }, [open, paymentId, onOpenChange]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const requiresAccountDirection = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    const norm = (cat?.name ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    return norm === "mensalista" || norm === "debito avulso" || norm === "saldo anterior" || norm === "pendencia avulsa" || norm === "estorno" || norm === "credito gympass";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentId || !user) return;
    if (!form.clientId) {
      toast.error("Selecione um cliente.");
      return;
    }
    if (!form.categoryId) {
      toast.error("Selecione uma categoria.");
      return;
    }
    const catSel = categories.find((c) => c.id === form.categoryId);
    const catSelNorm = (catSel?.name ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (catSelNorm === "mensalista" && form.accountDirection === "credito" && !form.method) {
      toast.error("Mensalista com Crédito exige uma forma de pagamento.");
      return;
    }
    if ((catSelNorm === "ranking masculino" || catSelNorm === "ranking feminino") && (!form.court || !form.startTime)) {
      toast.error("Para Ranking, informe a quadra e o horário de início.");
      return;
    }
    const isMensDeb = catSelNorm === "mensalista" && form.accountDirection === "debito";
    if (isMensDeb && (!form.amount || !form.court || !form.startTime || !form.endTime)) {
      toast.error("Para Mensalista com Débito, informe valor, quadra, horário de início e de término.");
      return;
    }
    if (catSelNorm === "inscricao ranking masculino" && (!form.amount || !form.method)) {
      toast.error("Para Inscrição Ranking Masculino, informe valor e forma de pagamento.");
      return;
    }
    if (
      requiresAccountDirection(form.categoryId) &&
      form.accountDirection !== "credito" &&
      form.accountDirection !== "debito"
    ) {
      toast.error("Marque Crédito ou Débito em conta corrente para esta categoria.");
      return;
    }
    setSubmitting(true);
    const isGympass = catSelNorm === "credito gympass";
    const isStockCat = catSelNorm === "grip" || catSelNorm === "terno de bola";
    const qtyNum = isStockCat ? Math.max(1, parseInt(form.quantity, 10) || 1) : 1;
    // Busca o usuário logado agora (não o do contexto, que pode estar
    // desatualizado num computador compartilhado onde outro recepcionista
    // acabou de trocar de sessão no mesmo navegador).
    const { data: freshUserData } = await supabase.auth.getUser();
    const updaterId = freshUserData.user?.id ?? user.id;
    const payload = {
      client_id: form.clientId || null,
      category_id: form.categoryId || null,
      amount: Number(form.amount) || 0,
      passthrough_amount: isGympass ? Number(form.passthroughAmount) || 0 : 0,
      method: (form.method || "outro") as never,
      paid_at: recifeDateToISO(form.paidAt || todayISO()),
      start_time: form.startTime || null,
      end_time: form.endTime || null,
      court: form.court ? Number(form.court) : null,
      received:
        catSelNorm === "ranking masculino" || catSelNorm === "ranking feminino"
          ? form.received
          : (Number(form.amount) || 0) === 0
            ? true
            : form.received,
      to_account: form.accountDirection !== "",
      account_direction: form.accountDirection || null,
      notes: form.notes || null,
      updated_by: updaterId,
      updated_at: new Date().toISOString(),
      is_new_plan_sale: form.isNewPlanSale,
      commission_user_id: form.isNewPlanSale ? form.commissionUserId || null : null,
      quantity: qtyNum,
      is_pending_payment: isStockCat ? form.isPendingPayment : false,
    };

    const { error } = await supabase.from("payments").update(payload).eq("id", paymentId);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAction({
      entity: "payment",
      entity_id: paymentId,
      action: "update",
      details: { amount: payload.amount, client_id: payload.client_id },
    });
    toast.success("Pagamento atualizado!");
    onOpenChange(false);
    onSaved?.();
  };

  const cat = categories.find((c) => c.id === form.categoryId);
  const catNorm = (cat?.name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const isEstorno = catNorm === "estorno";
  const isStockCat = catNorm === "grip" || catNorm === "terno de bola";
  const isAutoCC = catNorm === "credito gympass";
  const autoCCDirection: "credito" | "debito" = "credito";
  const eligible =
    !!form.clientId &&
    (catNorm === "mensalista" ||
      catNorm === "debito avulso" ||
      catNorm === "saldo anterior" ||
      catNorm === "credito gympass" ||
      catNorm === "pendencia avulsa" ||
      catNorm === "energia (luz)" ||
      catNorm === "ranking masculino" ||
      catNorm === "ranking feminino" ||
      isEstorno);
  const isCommissionable = catNorm === "mensalista";
  const isMensalistaDebito = catNorm === "mensalista" && form.accountDirection === "debito";
  const isMensalistaCredito = catNorm === "mensalista" && form.accountDirection === "credito";
  const isInscricaoRanking = catNorm === "inscricao ranking masculino";
  const noTimeCourt = [
    "grip",
    "inscricao ranking masculino",
    "saldo anterior",
    "tenis de mesa (mensalista)",
    "terno de bola",
    "credito gympass",
  ].includes(catNorm) || isMensalistaCredito || isEstorno;
  useEffect(() => {
    if (noTimeCourt && (form.court || form.startTime || form.endTime)) {
      setForm((f) => ({ ...f, court: "", startTime: "", endTime: "" }));
    }
  }, [noTimeCourt, form.court, form.startTime, form.endTime]);
  useEffect(() => {
    if ((isMensalistaDebito || isEstorno || isAutoCC) && form.method) {
      setForm((f) => ({ ...f, method: "" }));
    }
  }, [isMensalistaDebito, isEstorno, isAutoCC, form.method]);
  useEffect(() => {
    if (isEstorno) {
      if (form.received) setForm((f) => ({ ...f, received: false }));
      if (form.accountDirection !== "credito") setForm((f) => ({ ...f, accountDirection: "credito" }));
    }
  }, [isEstorno, form.received, form.accountDirection]);
  useEffect(() => {
    if (isAutoCC) {
      if (form.received) setForm((f) => ({ ...f, received: false }));
      if (form.accountDirection !== autoCCDirection) {
        setForm((f) => ({ ...f, accountDirection: autoCCDirection }));
      }
    }
  }, [isAutoCC, autoCCDirection, form.received, form.accountDirection]);
  useEffect(() => {
    if (!isCommissionable && form.isNewPlanSale) {
      setForm((f) => ({ ...f, isNewPlanSale: false }));
    }
  }, [isCommissionable, form.isNewPlanSale]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar pagamento</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente <span className="text-destructive">*</span></Label>
                <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {(() => {
                          const sel = clients.find((c) => c.id === form.clientId);
                          return sel ? (
                            sel.full_name
                          ) : (
                            <span className="text-muted-foreground">
                              Buscar cliente (ou deixe em branco para avulso)
                            </span>
                          );
                        })()}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                    <Command filter={accentInsensitiveFilter}>
                      <CommandInput placeholder="Buscar cliente por nome..." />
                      <CommandList>
                        <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__novo__ Cadastrar novo cliente"
                            onSelect={() => {
                              setNewClientOpen(true);
                              setClientPopoverOpen(false);
                            }}
                          >
                            <UserPlus className="mr-2 h-4 w-4 text-primary" />
                            <span className="text-primary">Cadastrar novo cliente</span>
                          </CommandItem>
                          <CommandItem
                            value="__avulso__ Avulso sem cliente"
                            onSelect={() => {
                              update({ clientId: "" });
                              setClientPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn("mr-2 h-4 w-4", !form.clientId ? "opacity-100" : "opacity-0")}
                            />
                            Avulso (sem cliente)
                          </CommandItem>
                          {clients.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.full_name} ${c.client_categories?.name ?? ""}`}
                              onSelect={() => {
                                update({ clientId: c.id });
                                setClientPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.clientId === c.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {c.full_name}
                              {c.client_categories?.name && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  — {c.client_categories.name}
                                </span>
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Categoria <span className="text-destructive">*</span></Label>
                <Select
                  key={form.categoryId === "" ? "empty-cat" : "set-cat"}
                  value={form.categoryId || undefined}
                  onValueChange={(v) => {
                    const newCatId = v;
                    const c = categories.find((x) => x.id === newCatId);
                    const norm = (c?.name ?? "")
                      .normalize("NFD")
                      .replace(/[\u0300-\u036f]/g, "")
                      .toLowerCase()
                      .trim();
                    if (norm === "credito gympass" || norm === "estorno") {
                      update({
                        categoryId: newCatId,
                        accountDirection: "credito",
                        received: false,
                        method: "",
                        court: norm === "estorno" ? "" : form.court,
                        startTime: norm === "estorno" ? "" : form.startTime,
                        endTime: norm === "estorno" ? "" : form.endTime,
                      });
                    } else {
                      update({ categoryId: newCatId });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              {isStockCat && (
                <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <div className="space-y-2">
                    <Label>Tipo de lançamento <span className="text-destructive">*</span></Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => update({ isPendingPayment: false })}
                        className={`rounded-md border p-2 text-sm text-left transition ${
                          !form.isPendingPayment
                            ? "border-primary bg-primary/10 font-medium"
                            : "border-input hover:bg-accent"
                        }`}
                      >
                        Venda nova
                        <div className="text-xs text-muted-foreground font-normal">
                          Cliente pegou agora — abate do estoque.
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ isPendingPayment: true })}
                        className={`rounded-md border p-2 text-sm text-left transition ${
                          form.isPendingPayment
                            ? "border-primary bg-primary/10 font-medium"
                            : "border-input hover:bg-accent"
                        }`}
                      >
                        Pagamento de pendência
                        <div className="text-xs text-muted-foreground font-normal">
                          Cliente já tinha pego antes — não abate do estoque.
                        </div>
                      </button>
                    </div>
                  </div>
                  {!form.isPendingPayment && (
                    <div className="space-y-2">
                      <Label>Quantidade vendida <span className="text-destructive">*</span></Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={form.quantity}
                        onChange={(e) => update({ quantity: e.target.value })}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <p className="text-xs text-muted-foreground">
                        Alterar aqui ajusta o estoque de <strong>{cat?.name}</strong>.
                      </p>
                    </div>
                  )}
                </div>
              )}



              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    Valor (R$){" "}
                    {isMensalistaDebito || isInscricaoRanking ? (
                      <span className="text-destructive">*</span>
                    ) : (
                      <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={isMensalistaDebito || isInscricaoRanking ? "" : "Deixe em branco se não houver valor"}
                    value={form.amount}
                    onChange={(e) => update({ amount: e.target.value })}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {(() => {
                    if (!form.categoryId || !form.startTime || !form.endTime || !form.paidAt) return null;
                    const wd = weekdayFromYmd(form.paidAt);
                    if (wd == null) return null;
                    const calc = calcPrice({
                      bands: priceBands,
                      weekday: wd,
                      startTime: form.startTime,
                      endTime: form.endTime,
                      categoryId: form.categoryId,
                      court: form.court ? Number(form.court) : null,
                      date: form.paidAt || null,
                    });
                    if (!calc || !calc.matched) return null;
                    const suggested = calc.total.toFixed(2);
                    if (form.amount === suggested) return null;
                    return (
                      <p className="text-xs text-muted-foreground">
                        Tabela sugere {fmtBRL(calc.total)} ({fmtHours(calc.durationMin)}).
                        <button
                          type="button"
                          className="ml-1 underline"
                          onClick={() => update({ amount: suggested })}
                        >
                          Aplicar
                        </button>
                      </p>
                    );
                  })()}
                </div>
                <div className={`space-y-2 ${isMensalistaDebito || isEstorno || isAutoCC ? "opacity-50" : ""}`}>
                  <Label>Forma de pagamento {((catNorm === "mensalista" && form.accountDirection === "credito") || isInscricaoRanking) && <span className="text-destructive">*</span>}</Label>
                  <div className="flex gap-2">
                    <Select
                      key={form.method === "" ? "empty" : "set"}
                      value={form.method || undefined}
                      onValueChange={(v) => update({ method: v })}
                      disabled={isMensalistaDebito || isEstorno || isAutoCC}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {METHOD_OPTIONS.map(([v, l]) => (
                          <SelectItem key={v} value={v}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.method !== "" && !isMensalistaDebito && !isEstorno && !isAutoCC && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => update({ method: "" })}
                        title="Limpar forma de pagamento"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {catNorm === "credito gympass" && (
                <div className="rounded-md border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
                  <Label>Valor repassado a outro CNPJ (R$) <span className="text-xs text-muted-foreground font-normal">(opcional)</span></Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    value={form.passthroughAmount}
                    onChange={(e) => update({ passthroughAmount: e.target.value })}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Parte do valor do Gympass que NÃO fica com a empresa nem é
                    creditada na conta do cliente.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data</Label>
                  <Input
                    type="date"
                    value={form.paidAt}
                    onChange={(e) => update({ paidAt: e.target.value })}
                  />
                </div>
                <div className={`space-y-2 ${noTimeCourt ? "opacity-50" : ""}`}>
                  <Label>Quadra {(catNorm === "ranking masculino" || catNorm === "ranking feminino" || isMensalistaDebito) && <span className="text-destructive">*</span>}</Label>
                  <div className="flex gap-2">
                    <Select
                      key={form.court === "" ? "empty" : "set"}
                      value={form.court || undefined}
                      onValueChange={(v) => update({ court: v })}
                      disabled={noTimeCourt}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {COURTS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {courtLabel(n)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.court !== "" && !noTimeCourt && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => update({ court: "" })}
                        title="Limpar quadra"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className={`space-y-2 ${noTimeCourt ? "opacity-50" : ""}`}>
                  <Label>Horário de início {(catNorm === "ranking masculino" || catNorm === "ranking feminino" || isMensalistaDebito) && <span className="text-destructive">*</span>}</Label>
                  <Input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => update({ startTime: e.target.value })}
                    disabled={noTimeCourt}
                  />
                </div>
                <div className={`space-y-2 ${noTimeCourt ? "opacity-50" : ""}`}>
                  <Label>Horário de término {isMensalistaDebito && <span className="text-destructive">*</span>}</Label>
                  <Input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => update({ endTime: e.target.value })}
                    disabled={noTimeCourt}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className={`flex items-center gap-2 rounded-md border p-3 ${isEstorno || isAutoCC ? "opacity-50" : ""}`}>
                    <Checkbox
                      disabled={isEstorno || isAutoCC}
                      checked={form.received}
                      onCheckedChange={(v) => update({ received: v === true })}
                    />
                    <Label className="cursor-pointer font-normal">Pagamento recebido</Label>
                  </div>
                  <div
                    className={`flex items-center gap-2 rounded-md border p-3 ${!eligible ? "opacity-50" : ""}`}
                  >
                    <Checkbox
                      disabled={!eligible}
                      checked={form.accountDirection === "credito"}
                      onCheckedChange={(v) => {
                        if (isEstorno) return;
                        const next = v === true ? "credito" : "";
                        if (next === "credito" && catNorm === "mensalista") {
                          update({ accountDirection: next, received: true });
                        } else {
                          update({ accountDirection: next });
                        }
                      }}
                    />
                    <Label className="cursor-pointer font-normal text-center leading-tight">Creditar na<br />C/C</Label>
                  </div>
                  <div
                    className={`flex items-center gap-2 rounded-md border p-3 ${!eligible || isAutoCC || isEstorno ? "opacity-50" : ""}`}
                  >
                    <Checkbox
                      disabled={!eligible || isAutoCC || isEstorno}
                      checked={form.accountDirection === "debito"}
                      onCheckedChange={(v) => update({ accountDirection: v === true ? "debito" : "" })}
                    />
                    <Label className="cursor-pointer font-normal text-center leading-tight">Debitar da<br />C/C</Label>
                  </div>
                </div>
                {!eligible && (
                  <p className="text-xs text-muted-foreground">
                    Crédito/Débito em conta corrente disponível apenas para categorias{" "}
                    <strong>Mensalista</strong>, <strong>Débito avulso</strong>,{" "}
                    <strong>Saldo anterior</strong> ou <strong>crédito GYMPASS</strong>.
                  </p>
                )}
                {catNorm === "avulso" && form.clientId && !form.received && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Será lançado como débito na conta corrente do cliente até a quitação.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Observações (opcional)</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                  rows={2}
                />
              </div>

              {isCommissionable && (
                <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={form.isNewPlanSale}
                      onCheckedChange={(v) => update({ isNewPlanSale: v === true })}
                    />
                    <Label className="cursor-pointer font-normal">
                      Venda de novo plano (gera comissão)
                    </Label>
                  </div>
                  {form.isNewPlanSale && (
                    <div className="space-y-2">
                      <Label>Comissão para</Label>
                      {canEditCommissionUser ? (
                        <Select
                          value={form.commissionUserId || NONE_VALUE}
                          onValueChange={(v) =>
                            update({ commissionUserId: v === NONE_VALUE ? "" : v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o usuário" />
                          </SelectTrigger>
                          <SelectContent>
                            {(profiles.some((p) => p.id === form.commissionUserId)
                              ? profiles
                              : [
                                  ...profiles,
                                  ...allProfiles.filter((p) => p.id === form.commissionUserId),
                                ]
                            ).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.full_name || p.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {allProfiles.find((p) => p.id === form.commissionUserId)?.full_name ??
                            "—"}{" "}
                          <span className="text-xs">
                            (somente Diretoria pode alterar)
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salvar alterações
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ClientDialog
        open={newClientOpen}
        onOpenChange={setNewClientOpen}
        editing={null}
        canDelete={false}
        onSaved={async (newId) => {
          // Refresh client list
          const cls = await fetchAll<ClientRow>(
            "clients",
            "id, full_name, custom_amount, category_id, active, client_categories(name, default_amount)",
          );
          setClients(
            cls
              .filter((c) => c.active)
              .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
          );
          if (newId) update({ clientId: newId });
        }}
      />
    </>
  );
}

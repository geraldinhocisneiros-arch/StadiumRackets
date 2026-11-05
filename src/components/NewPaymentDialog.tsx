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
import { todayISO, recifeDateToISO, fmtBRL, accentInsensitiveFilter } from "@/lib/format";
import { offerWhatsAppPaymentNotification } from "@/lib/whatsapp";
import { ClientDialog } from "@/routes/clientes";
import { calcPrice, weekdayFromYmd, fmtHours, type PriceBand } from "@/lib/pricing";
import { fetchAll } from "@/lib/fetchAll";
import { PAYMENT_METHOD_OPTIONS as METHOD_OPTIONS } from "@/lib/payment-methods";

interface ClientRow {
  id: string;
  full_name: string;
  custom_amount: number | null;
  category_id: string | null;
  default_discount_percent: number | null;
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
  discountPercent: string;
  method: string;
  paidAt: string;
  startTime: string;
  endTime: string;
  court: string;
  received: boolean;
  accountDirection: "" | "credito" | "debito";
  notes: string;
  isNewPlanSale: boolean;
  quantity: string;
  isPendingPayment: boolean;
}

const emptyForm = (paidAt?: string): FormState => ({
  clientId: "",
  categoryId: "",
  amount: "",
  passthroughAmount: "",
  discountPercent: "",
  method: "",
  paidAt: paidAt ?? todayISO(),
  startTime: "",
  endTime: "",
  court: "",
  received: false,
  accountDirection: "",
  notes: "",
  isNewPlanSale: false,
  quantity: "1",
  isPendingPayment: false,
});

const computeFinalAmount = (amount: string, discountPercent: string) => {
  const base = Number(amount) || 0;
  const pct = Number(discountPercent) || 0;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const final = base * (1 - clamped / 100);
  return Math.round(final * 100) / 100;
};


import { COURTS, courtLabel } from "@/lib/court-map";
const NONE_VALUE = "__none__";

export interface NewPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPaidAt?: string; // YYYY-MM-DD
  onSaved?: () => void;
}

export function NewPaymentDialog({ open, onOpenChange, defaultPaidAt, onSaved }: NewPaymentDialogProps) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(emptyForm(defaultPaidAt));
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [priceBands, setPriceBands] = useState<PriceBand[]>([]);
  const [amountManuallyEdited, setAmountManuallyEdited] = useState(false);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(defaultPaidAt));
    setAmountManuallyEdited(false);
    (async () => {
      const [cls, { data: cats }, { data: pb }] = await Promise.all([
        fetchAll<ClientRow>(
          "clients",
          "id, full_name, custom_amount, category_id, default_discount_percent, active, client_categories(name, default_amount)",
        ),
        supabase.from("client_categories").select("id, name, default_amount").eq("active", true).order("name"),
        supabase.from("price_table").select("id, categories, weekday, start_time, end_time, price_per_hour, courts, starts_on, ends_on"),
      ]);
      setClients(
        cls
          .filter((c) => c.active)
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
      );
      setCategories((cats as unknown as CategoryRow[]) ?? []);
      setPriceBands((pb as unknown as PriceBand[]) ?? []);
    })();
  }, [open, defaultPaidAt]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Cálculo automático de valor via tabela de preços
  const priceCalc = (() => {
    if (!form.startTime || !form.endTime || !form.paidAt) return null;
    const wd = weekdayFromYmd(form.paidAt);
    if (wd == null) return null;
    return calcPrice({
      bands: priceBands,
      weekday: wd,
      startTime: form.startTime,
      endTime: form.endTime,
      categoryId: form.categoryId || null,
      court: form.court ? Number(form.court) : null,
      date: form.paidAt || null,
    });
  })();

  // Preenche o campo Valor com o cálculo da tabela, a menos que o usuário tenha editado manualmente
  useEffect(() => {
    if (amountManuallyEdited) return;
    if (!priceCalc || !priceCalc.matched) return;
    const next = priceCalc.total.toFixed(2);
    setForm((f) => (f.amount === next ? f : { ...f, amount: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceCalc?.total, priceCalc?.matched, amountManuallyEdited]);


  // Auto-aplica o desconto padrão do cliente quando ele é selecionado.
  // Só aplica quando a categoria SELECIONADA no formulário é "mensalista".
  // Se mudar para outra categoria, limpa o desconto.
  useEffect(() => {
    if (!form.clientId) {
      setForm((f) => (f.discountPercent ? { ...f, discountPercent: "" } : f));
      return;
    }
    const selCatName = categories.find((cat) => cat.id === form.categoryId)?.name ?? "";
    const selCatNorm = selCatName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const isMensalistaSelecionada = selCatNorm === "mensalista";
    // Crédito em C/C não recebe desconto — limpa e não aplica.
    const isCreditoCC = form.accountDirection === "credito";

    if (!isMensalistaSelecionada || isCreditoCC) {
      setForm((f) => (f.discountPercent ? { ...f, discountPercent: "" } : f));
      return;
    }

    // Se o usuário digitou o valor manualmente, assume que já é o valor final
    // (com ou sem desconto a critério dele) — não auto-aplica o desconto pra
    // evitar duplicação.
    if (amountManuallyEdited) {
      setForm((f) => (f.discountPercent ? { ...f, discountPercent: "" } : f));
      return;
    }

    const c = clients.find((cl) => cl.id === form.clientId);
    let discountToApply: number | null = null;
    if (c?.default_discount_percent != null) {
      discountToApply = c.default_discount_percent;
    } else {
      discountToApply = 10;
    }

    if (discountToApply != null) {
      setForm((f) => (f.discountPercent ? f : { ...f, discountPercent: String(discountToApply) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.clientId, form.categoryId, form.accountDirection, amountManuallyEdited, clients, categories]);

  const requiresAccountDirection = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    const norm = (cat?.name ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    return norm === "debito avulso" || norm === "saldo anterior" || norm === "pendencia avulsa" || norm === "estorno" || norm === "credito gympass";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
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
    const isGympassCat = catSelNorm === "credito gympass";
    if (!isMensDeb && catSelNorm !== "estorno" && !isGympassCat && !form.method) {
      toast.error("Selecione a forma de pagamento.");
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
    const finalAmount = computeFinalAmount(form.amount, form.discountPercent);
    const discountPct = Math.min(Math.max(Number(form.discountPercent) || 0, 0), 100);
    const baseAmount = Number(form.amount) || 0;
    const mergedNotes = form.notes?.trim() || null;
    const isStockCat = catSelNorm === "grip" || catSelNorm === "terno de bola";
    const qtyNum = isStockCat ? Math.max(1, parseInt(form.quantity, 10) || 1) : 1;
    // Busca o usuário logado agora (não o do contexto, que pode estar
    // desatualizado num computador compartilhado onde outro recepcionista
    // acabou de trocar de sessão no mesmo navegador).
    const { data: freshUserData } = await supabase.auth.getUser();
    const recorderId = freshUserData.user?.id ?? user.id;
    const payload = {
      client_id: form.clientId || null,
      category_id: form.categoryId || null,
      amount: finalAmount,
      passthrough_amount: isGympass ? Number(form.passthroughAmount) || 0 : 0,
      method: (form.method || "outro") as never,
      paid_at: recifeDateToISO(form.paidAt || todayISO()),
      start_time: form.startTime || null,
      end_time: form.endTime || null,
      court: form.court ? Number(form.court) : null,
      received:
        catSelNorm === "ranking masculino" || catSelNorm === "ranking feminino"
          ? form.received
          : finalAmount === 0
            ? true
            : form.received,
      to_account: form.accountDirection !== "",
      account_direction: form.accountDirection || null,
      notes: mergedNotes || null,
      recorded_by: recorderId,
      is_new_plan_sale: form.isNewPlanSale,
      quantity: qtyNum,
      is_pending_payment: isStockCat ? form.isPendingPayment : false,
    };
    const { data, error } = await supabase.from("payments").insert(payload).select("id").maybeSingle();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAction({
      entity: "payment",
      entity_id: data?.id ?? null,
      action: "create",
      details: { amount: payload.amount, client_id: payload.client_id, discount_percent: discountPct },
    });
    toast.success("Pagamento registrado!");
    onOpenChange(false);
    onSaved?.();
    if (payload.client_id) {
      void offerWhatsAppPaymentNotification({
        clientId: payload.client_id,
        amount: payload.amount,
        accountDirection: payload.account_direction,
        categoryName: cat?.name ?? null,
      });
    }
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
  // Auto-calcula valor para Grip/Terno de bola = quantidade * preço da categoria
  useEffect(() => {
    if (!isStockCat) return;
    if (amountManuallyEdited) return;
    const unit = Number(cat?.default_amount) || 0;
    const qty = Math.max(1, parseInt(form.quantity, 10) || 1);
    const total = (unit * qty).toFixed(2);
    setForm((f) => (f.amount === total ? f : { ...f, amount: total }));
  }, [isStockCat, cat?.default_amount, form.quantity, amountManuallyEdited]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
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

            {isCommissionable && (
              <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                <Checkbox
                  checked={form.isNewPlanSale}
                  onCheckedChange={(v) => update({ isNewPlanSale: v === true })}
                />
                <Label className="cursor-pointer font-normal">
                  Venda de novo plano (gera comissão)
                </Label>
              </div>
            )}


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
                    const dir = "credito";
                    update({
                      categoryId: newCatId,
                      accountDirection: dir,
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
                      Será abatido do estoque de <strong>{cat?.name}</strong>.
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
                  onChange={(e) => {
                    setAmountManuallyEdited(true);
                    update({ amount: e.target.value });
                  }}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                {priceCalc && priceCalc.matched && !amountManuallyEdited && (
                  <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-900 dark:text-amber-200">
                    Tabela: {fmtBRL(priceCalc.total)} ({fmtHours(priceCalc.durationMin)})
                    {priceCalc.uncoveredMin > 0
                      ? ` — ${fmtHours(priceCalc.uncoveredMin)} sem preço cadastrado`
                      : ""}
                    . Edite se necessário.
                  </p>
                )}
                {priceCalc && priceCalc.matched && amountManuallyEdited && (
                  <p className="text-xs text-muted-foreground">
                    Tabela sugeriria {fmtBRL(priceCalc.total)} ({fmtHours(priceCalc.durationMin)}).
                    <button
                      type="button"
                      className="ml-1 underline"
                      onClick={() => {
                        setAmountManuallyEdited(false);
                        update({ amount: priceCalc.total.toFixed(2) });
                      }}
                    >
                      Aplicar
                    </button>
                  </p>
                )}
              </div>
              {catNorm === "mensalista" && form.accountDirection !== "credito" && (
                <div className="space-y-2">
                  <Label>
                    Desconto (%){" "}
                    <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  {(() => {
                    const sel = clients.find((c) => c.id === form.clientId);
                    const cd = Number(sel?.default_discount_percent) || 0;
                    if (!sel || cd <= 0) return null;
                    return (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                        <strong>{sel.full_name}</strong> tem {String(cd).replace(".", ",")}% de desconto cadastrado — já aplicado abaixo.
                      </div>
                    );
                  })()}
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="0"
                    value={form.discountPercent}
                    onChange={(e) => update({ discountPercent: e.target.value })}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {(() => {
                    const base = Number(form.amount) || 0;
                    const pct = Math.min(Math.max(Number(form.discountPercent) || 0, 0), 100);
                    if (base <= 0 || pct <= 0) return null;
                    const final = computeFinalAmount(form.amount, form.discountPercent);
                    return (
                      <p className="text-xs text-muted-foreground">
                        Valor final após desconto:{" "}
                        <strong className="text-foreground">
                          R$ {final.toFixed(2).replace(".", ",")}
                        </strong>{" "}
                        (de R$ {base.toFixed(2).replace(".", ",")} − {pct.toString().replace(".", ",")}%)
                      </p>
                    );
                  })()}
                </div>
              )}

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
                  Parte do valor recebido do Gympass que NÃO fica com a empresa
                  nem é creditada na conta do cliente. Apenas a diferença entra
                  no faturamento e no crédito do cliente.
                </p>
              </div>
            )}

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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={form.paidAt}
                  onChange={(e) => update({ paidAt: e.target.value })}
                />
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


            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Registrar
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Observações (opcional)</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => update({ notes: e.target.value })}
                rows={2}
              />
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ClientDialog
        open={newClientOpen}
        onOpenChange={setNewClientOpen}
        editing={null}
        canDelete={false}
        onSaved={async (newId) => {
          const cls = await fetchAll<ClientRow>(
            "clients",
            "id, full_name, custom_amount, category_id, default_discount_percent, active, client_categories(name, default_amount)",
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

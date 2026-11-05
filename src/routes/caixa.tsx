import { createFileRoute, Link, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, Fragment } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogTrigger,
  
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtBRL, fmtDateTime, todayISO, normalizeText, dateISOInRecife, recifeDateToISO, dayStartISO, dayEndExclusiveISO } from "@/lib/format";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { offerWhatsAppPaymentNotification, sendWhatsAppPaymentNotification } from "@/lib/whatsapp";
import { Plus, Loader2, UserPlus, Pencil, CalendarIcon, Printer, Trash2, X, Paperclip, MessageCircle } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { format, startOfMonth, endOfMonth, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { logAction } from "@/lib/audit";
import { isSaldoAnterior } from "@/lib/category";
import { Check, ChevronsUpDown } from "lucide-react";
import { ClientDialog } from "@/routes/clientes";
import { useUrlState } from "@/hooks/useUrlState";
import { calcPrice, weekdayFromYmd, type PriceBand } from "@/lib/pricing";
import { fetchAll } from "@/lib/fetchAll";
import { ReceiveOpenDebtOption } from "@/components/ReceiveOpenDebtOption";
import {
  EMPTY_RECEIVE_OPEN_DEBT,
  OPEN_DEBT_SETTLEMENT_NOTE,
  receiveOpenDebtAmount,
  type ReceiveOpenDebtValue,
} from "@/lib/open-debt";
import {
  PAYMENT_METHOD_LABELS as METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS as METHOD_OPTIONS,
} from "@/lib/payment-methods";

export const Route = createFileRoute("/caixa")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { editPayment?: string; lateCancel?: string } => ({
    editPayment: typeof search.editPayment === "string" ? search.editPayment : undefined,
    lateCancel: typeof search.lateCancel === "string" ? search.lateCancel : undefined,
  }),
  component: () => (
    <RequireAuth pageKey="caixa">
      <CaixaPage />
    </RequireAuth>
  ),
});

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
interface PaymentRow {
  id: string;
  client_id: string | null;
  category_id: string | null;
  amount: number;
  passthrough_amount?: number | null;
  method: string;
  paid_at: string;
  start_time: string | null;
  end_time: string | null;
  court: number | null;
  received: boolean;
  to_account: boolean;
  account_direction: string | null;
  notes: string | null;
  updated_at: string | null;
  recorded_by: string | null;
  is_new_plan_sale?: boolean;
  clients: { full_name: string; category_id?: string | null } | null;
  profiles: { full_name: string } | null;
  updater: { full_name: string } | null;
}



const methodLabel = (m?: string | null) =>
  m && m !== "outro" ? (METHOD_LABELS[m] ?? m) : "";



import { COURTS, courtLabel, courtShort } from "@/lib/court-map";
const NEW_CLIENT_VALUE = "__new__";
const NONE_VALUE = "__none__";

const normalizeCategoryName = (name?: string | null) =>
  (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

interface FormState {
  clientId: string;
  clientIds: string[];
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
  commissionUserId: string;
  quantity: string;
  isPendingPayment: boolean;
}

const emptyForm = (): FormState => ({
  clientId: "",
  clientIds: [],
  categoryId: "",
  amount: "",
  passthroughAmount: "",
  discountPercent: "",
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


const restoreScrollPosition = (top: number) => {
  if (typeof window === "undefined") return;
  const left = window.scrollX;
  const restore = () => window.scrollTo({ top, left, behavior: "auto" });
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 50);
  });
};

function CaixaPage() {
  const { user, isDiretoria, isAdmin, isRecepcionista } = useAuth();
  const canEditCommissionUser = isDiretoria || isAdmin;
  const [allProfiles, setAllProfiles] = useState<Array<{ id: string; full_name: string }>>([]);
  const [recepcionistaProfiles, setRecepcionistaProfiles] = useState<
    Array<{ id: string; full_name: string }>
  >([]);

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [priceBands, setPriceBands] = useState<PriceBand[]>([]);
  const [amountManuallyEdited, setAmountManuallyEdited] = useState(false);
  const [editAmountManuallyEdited, setEditAmountManuallyEdited] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [extraEntries, setExtraEntries] = useState<PaymentRow[]>([]);
  const [paymentsWithReceipt, setPaymentsWithReceipt] = useState<Set<string>>(new Set());
  const [receiptPathsByPayment, setReceiptPathsByPayment] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // create dialog
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  // Aviso de cancelamento tardio que originou o lançamento aberto (se houver).
  const [lateCancelNotifId, setLateCancelNotifId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // "Pagar junto": cliente negativo pagando outra coisa no caixa (quadra,
  // produto, aula) — oferece receber o débito em aberto no mesmo lançamento.
  const [receiveDebt, setReceiveDebt] = useState<ReceiveOpenDebtValue>(EMPTY_RECEIVE_OPEN_DEBT);

  // edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [clientPopoverEditOpen, setClientPopoverEditOpen] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientTarget, setNewClientTarget] = useState<"create" | "edit">("create");

  // Autocomplete de clientes (busca no servidor com debounce)
  const [clientSearch, setClientSearch] = useState("");
  const [clientSearchResults, setClientSearchResults] = useState<ClientRow[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    const q = clientSearch.trim();
    if (!q) {
      setClientSearchResults([]);
      setClientSearchLoading(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      const terms = normalizeText(q).split(/\s+/).filter(Boolean);
      setClientSearchResults(
        clients.filter((c) => {
          const name = normalizeText(c.full_name);
          return terms.every((term) => name.includes(term));
        }),
      );
      setClientSearchLoading(false);
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
  }, [clientSearch, clients]);
  useEffect(() => {
    if (!clientPopoverOpen && !clientPopoverEditOpen) {
      setClientSearch("");
      setClientSearchResults([]);
    }
  }, [clientPopoverOpen, clientPopoverEditOpen]);


  const todayDateISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [filterDateStr, setFilterDateStr] = useUrlState<string>("date", todayDateISO);
  const filterDate = useMemo(() => {
    const [y, m, d] = filterDateStr.split("-").map(Number);
    const parsed = new Date(y, (m ?? 1) - 1, d ?? 1);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [filterDateStr]);
  const setFilterDate = (d: Date) => {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFilterDateStr(s);
  };
  const [dateMode, setDateMode] = useUrlState<"day" | "month">("dateMode", "day");
  const [filterCourt, setFilterCourt] = useUrlState<string>("court", "all");
  const [filterMethod, setFilterMethod] = useUrlState<string>("method", "all");
  const [filterCategory, setFilterCategory] = useUrlState<string>("category", "all");
  const [filterStatus, setFilterStatus] = useUrlState<string>("status", "all");
  const [filterUser, setFilterUser] = useUrlState<string>("user", "all");
  const [filterClientName, setFilterClientName] = useUrlState<string>("clientName", "");
  const [sortBy, setSortBy] = useUrlState<"recent" | "court" | "start_time">("sort", "start_time");
  const [groupByCourt, setGroupByCourt] = useUrlState<boolean>("group", false);

  // Marca clientes que já receberam aviso de WhatsApp (persistido por dia em sessionStorage)
  const notifiedStorageKey = `wa-notified-${filterDateStr}`;
  const [notifiedClients, setNotifiedClients] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem(`wa-notified-${todayDateISO}`);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      let local = new Set<string>();
      try {
        const raw = window.sessionStorage.getItem(notifiedStorageKey);
        local = raw ? new Set(JSON.parse(raw)) : new Set();
      } catch {
        /* ignore */
      }
      // Busca envios já registrados no banco para o dia filtrado
      try {
        const [y, m, d] = filterDateStr.split("-").map(Number);
        const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString();
        const end = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0).toISOString();
        const { data } = await supabase
          .from("whatsapp_notifications")
          .select("client_id")
          .gte("sent_at", start)
          .lt("sent_at", end);
        (data ?? []).forEach((r) => {
          if (r.client_id) local.add(r.client_id);
        });
      } catch {
        /* ignore */
      }
      if (!cancelled) setNotifiedClients(local);
    })();

    // Realtime: novos envios feitos por outros usuários
    const [y, m, d] = filterDateStr.split("-").map(Number);
    const startMs = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
    const endMs = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0).getTime();
    const channel = supabase
      .channel(`wa-notif-${filterDateStr}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_notifications" },
        (payload) => {
          const row = payload.new as { client_id?: string; sent_at?: string };
          if (!row?.client_id || !row?.sent_at) return;
          const t = new Date(row.sent_at).getTime();
          if (t < startMs || t >= endMs) return;
          setNotifiedClients((prev) => {
            if (prev.has(row.client_id!)) return prev;
            const next = new Set(prev);
            next.add(row.client_id!);
            try {
              window.sessionStorage.setItem(notifiedStorageKey, JSON.stringify(Array.from(next)));
            } catch {
              /* ignore */
            }
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [notifiedStorageKey, filterDateStr]);
  const markClientNotified = (clientId: string) => {
    setNotifiedClients((prev) => {
      if (prev.has(clientId)) return prev;
      const next = new Set(prev);
      next.add(clientId);
      try {
        window.sessionStorage.setItem(notifiedStorageKey, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Dados de apoio (clientes ativos, categorias, tabela de preços, usuários).
  // Carregados uma vez ao abrir o Caixa e de novo só quando um cliente é
  // cadastrado/editado — não a cada lançamento.
  const loadReferenceData = async () => {
    try {
      const [clientsData, catsRes, pbRes, allProfsRes, recepRolesRes] = await Promise.all([
        // Só clientes ativos: o filtro roda no banco em vez de baixar a
        // tabela inteira (inclusive inativos) e descartar no navegador.
        fetchAll<ClientRow>(
          "clients",
          "id, full_name, custom_amount, category_id, default_discount_percent, active, client_categories(name, default_amount)",
          { build: (q) => q.eq("active", true) },
        ),
        supabase.from("client_categories").select("id, name, default_amount").eq("active", true).order("name"),
        supabase
          .from("price_table")
          .select("id, categories, weekday, start_time, end_time, price_per_hour, courts, starts_on, ends_on"),
        // Lista de usuários pra exibir nome de quem registrou/editou cada lançamento.
        supabase.from("profiles").select("id, full_name").order("full_name"),
        // Só recepcionistas devem aparecer como opção de "Comissão para".
        // RPC porque user_roles só mostra o próprio papel pra recepcionista;
        // se ainda não existir no banco, cai na consulta antiga.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .rpc("list_recepcionista_ids")
          .then((r: { data: { user_id: string }[] | null; error: unknown }) =>
            r.error ? supabase.from("user_roles").select("user_id").eq("role", "recepcionista") : r,
          ),
      ]);
      if (catsRes.error) throw catsRes.error;
      setPriceBands((pbRes.data as unknown as PriceBand[]) ?? []);
      const allProfs = (allProfsRes.data ?? []) as Array<{ id: string; full_name: string }>;
      setAllProfiles(allProfs);
      const recepIds = new Set(
        ((recepRolesRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
      );
      setRecepcionistaProfiles(allProfs.filter((p) => recepIds.has(p.id)));
      setClients(
        clientsData
          .filter((c) => c.active)
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
      );
      setCategories((catsRes.data ?? []) as CategoryRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os clientes.");
    }
  };

  useEffect(() => {
    loadReferenceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async (dateRef?: Date, modeRef?: "day" | "month", opts?: { silent?: boolean; preserveScrollY?: number }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const ref = dateRef ?? filterDate;
      const mode = modeRef ?? dateMode;
      // Usa sempre o fuso fixo de Recife (mesmo usado para gravar paid_at em
      // recifeDateToISO) em vez de new Date(...).toISOString(), que depende do
      // fuso do navegador de quem está acessando — em "Mês" isso podia deixar
      // de fora lançamentos do início do mês para quem acessa de um fuso
      // diferente do de Recife.
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const dayYmd = `${ref.getFullYear()}-${pad2(ref.getMonth() + 1)}-${pad2(ref.getDate())}`;
      const monthStartYmd = `${ref.getFullYear()}-${pad2(ref.getMonth() + 1)}-01`;
      const nextMonthRef = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
      const nextMonthYmd = `${nextMonthRef.getFullYear()}-${pad2(nextMonthRef.getMonth() + 1)}-01`;
      const startOfDay = mode === "month" ? dayStartISO(monthStartYmd) : dayStartISO(dayYmd);
      const endOfDay = mode === "month" ? dayStartISO(nextMonthYmd) : dayEndExclusiveISO(dayYmd);
      // Só os lançamentos do período são recarregados aqui. Clientes,
      // categorias, tabela de preços e usuários mudam raramente e são
      // carregados à parte (loadReferenceData) — antes eram baixados de novo
      // a cada abertura, troca de data e a cada lançamento feito por
      // qualquer recepcionista (via realtime), o que deixava o Caixa lento.
      //
      // O Supabase (PostgREST) limita cada resposta a 1000 linhas por
      // padrão, independente do .limit() pedido pelo cliente. Em "Mês",
      // com todas as categorias combinadas, isso passava de 1000 linhas
      // e cortava silenciosamente os lançamentos mais antigos do mês —
      // por isso fetchAll pagina em blocos de 1000 até trazer tudo.
      const paymentsData = await fetchAll<Omit<PaymentRow, "profiles" | "updater"> & { recorded_by: string | null; updated_by: string | null }>(
        "payments",
        "id, client_id, category_id, amount, passthrough_amount, method, paid_at, start_time, end_time, court, received, to_account, account_direction, notes, recorded_by, updated_by, updated_at, is_new_plan_sale, commission_user_id, clients(full_name, category_id)",
        {
          build: (q) =>
            q.gte("paid_at", startOfDay).lt("paid_at", endOfDay).order("paid_at", { ascending: false }),
        },
      );
    // Fetch profiles for recorders + editors (no FK between payments and profiles)
    const ids = new Set<string>();
    paymentsData.forEach((p) => {
      if (p.recorded_by) ids.add(p.recorded_by);
      if (p.updated_by) ids.add(p.updated_by);
    });
    const paymentIds = paymentsData.map((p) => p.id);
    // Nenhuma depende da outra — só dependem de `paymentsData`, já disponível.
    const [profilesRes, receiptsRes] = await Promise.all([
      ids.size > 0
        ? supabase.from("profiles").select("id, full_name").in("id", Array.from(ids))
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      paymentIds.length > 0
        ? supabase
            .from("payment_receipts")
            .select("payment_id, file_path, created_at")
            .in("payment_id", paymentIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as { payment_id: string; file_path: string; created_at: string }[] }),
    ]);
    const profilesMap: Record<string, { full_name: string }> = Object.fromEntries(
      (profilesRes.data ?? []).map((p) => [p.id, { full_name: p.full_name }]),
    );
    const enriched: PaymentRow[] = paymentsData.map((p) => ({
      ...p,
      profiles: p.recorded_by ? profilesMap[p.recorded_by] ?? null : null,
      updater: p.updated_by ? profilesMap[p.updated_by] ?? null : null,
    }));
    setPayments(enriched);
    // Carregar quais pagamentos possuem comprovante anexado
    if (paymentIds.length > 0) {
      const setIds = new Set<string>();
      const pathMap: Record<string, string> = {};
      (receiptsRes.data ?? []).forEach((r) => {
        if (r.payment_id) {
          setIds.add(r.payment_id);
          // mantém o mais recente (já ordenado desc)
          if (!pathMap[r.payment_id]) pathMap[r.payment_id] = r.file_path;
        }
      });
      setPaymentsWithReceipt(setIds);
      setReceiptPathsByPayment(pathMap);
    } else {
      setPaymentsWithReceipt(new Set());
      setReceiptPathsByPayment({});
    }
      setLoading(false);
      if (typeof opts?.preserveScrollY === "number") {
        restoreScrollPosition(opts.preserveScrollY);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os lançamentos.");
      if (!opts?.silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadAll(filterDate, dateMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDateStr, dateMode]);

  // Realtime: recarrega quando outro usuário insere/edita/remove pagamentos
  useEffect(() => {
    let realtimeTimer: number | undefined;
    const channel = supabase
      .channel("caixa-payments-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        () => {
          // Um lançamento dividido entre vários clientes (ou várias
          // recepcionistas lançando ao mesmo tempo) gera uma rajada de
          // eventos — agrupa tudo numa única recarga.
          if (realtimeTimer) window.clearTimeout(realtimeTimer);
          realtimeTimer = window.setTimeout(() => {
            realtimeTimer = undefined;
            loadAll(filterDate, dateMode, { silent: true, preserveScrollY: window.scrollY });
          }, 400);
        }
      )
      .subscribe();
    return () => {
      if (realtimeTimer) window.clearTimeout(realtimeTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDateStr, dateMode]);

  // Extras: quando em modo Mês + busca por nome, traz lançamentos manuais
  // em conta corrente (account_entries sem payment_id) do(s) cliente(s) que
  // batem com a busca — para refletir o que aparece no extrato.
  useEffect(() => {
    const q = filterClientName.trim();
    if (dateMode !== "month" || !q || clients.length === 0) {
      setExtraEntries([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const nq = normalizeText(q);
      const matched = clients.filter((c) => normalizeText(c.full_name).includes(nq));
      if (matched.length === 0) {
        if (!cancelled) setExtraEntries([]);
        return;
      }
      const start = `${filterDate.getFullYear()}-${String(filterDate.getMonth() + 1).padStart(2, "0")}-01`;
      const nextMonth = new Date(filterDate.getFullYear(), filterDate.getMonth() + 1, 1);
      const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("account_entries")
        .select("id, client_id, entry_type, amount, description, entry_date, payment_id, recorded_by")
        .is("payment_id", null)
        .gte("entry_date", start)
        .lt("entry_date", end)
        .in("client_id", matched.map((c) => c.id))
        .order("entry_date", { ascending: false })
        .limit(2000);
      if (cancelled || error) return;
      const clientMap = new Map(clients.map((c) => [c.id, c]));
      const profileMap = new Map(allProfiles.map((p) => [p.id, p]));
      const mapped: PaymentRow[] = (data ?? []).map((e: any) => {
        const c = clientMap.get(e.client_id);
        return {
          id: `ae:${e.id}`,
          client_id: e.client_id,
          category_id: null,
          amount: Number(e.amount) || 0,
          passthrough_amount: 0,
          method: "",
          paid_at: `${e.entry_date}T12:00:00`,
          start_time: null,
          end_time: null,
          court: null,
          received: false,
          to_account: true,
          account_direction: e.entry_type,
          notes: e.description,
          updated_at: null,
          recorded_by: e.recorded_by,
          is_new_plan_sale: false,
          clients: c ? { full_name: c.full_name, category_id: c.category_id } : null,
          profiles: e.recorded_by ? (profileMap.get(e.recorded_by) ?? null) : null,
          updater: null,
        };
      });
      setExtraEntries(mapped);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterClientName, dateMode, filterDateStr, clients, allProfiles]);

  // Auto-fill amount + category + discount when single client selected (create form)
  useEffect(() => {
    if (form.clientIds.length !== 1) {
      // Limpa desconto auto-aplicado quando não há um único cliente selecionado
      setForm((f) => (f.discountPercent ? { ...f, discountPercent: "" } : f));
      return;
    }
    const currentCatNorm = normalizeCategoryName(categories.find((cat) => cat.id === form.categoryId)?.name);
    if (currentCatNorm === "estorno") {
      setForm((f) => ({ ...f, amount: "", method: "", court: "", startTime: "", endTime: "", received: true, accountDirection: "credito", isNewPlanSale: false, discountPercent: "" }));
      return;
    }
    const c = clients.find((c) => c.id === form.clientIds[0]);
    if (!c) return;
    const v = c.custom_amount ?? c.client_categories?.default_amount ?? 0;
    // Mensalista sem desconto próprio cadastrado usa 10% por padrão — mesma
    // regra do formulário de pagamento em Finanças (NewPaymentDialog.tsx).
    const clientDiscount =
      c.default_discount_percent != null ? Number(c.default_discount_percent) : 10;
    // Só aplica desconto se a categoria SELECIONADA no form for mensalista
    // E não for crédito em C/C (creditar na conta corrente não tem desconto).
    // Se o usuário digitou o valor manualmente, assume que já é o valor final
    // e não auto-aplica desconto (evita duplicar).
    const isMensalistaSelecionada = currentCatNorm === "mensalista";
    const isCreditoCC = form.accountDirection === "credito";
    const aplicaDesconto = isMensalistaSelecionada && !isCreditoCC && !amountManuallyEdited;
    setForm((f) => ({
      ...f,
      amount: v > 0 && !f.amount ? String(v) : f.amount,
      categoryId: c.category_id && !f.categoryId ? c.category_id : f.categoryId,
      discountPercent: aplicaDesconto
        ? (clientDiscount > 0 && !f.discountPercent ? String(clientDiscount) : f.discountPercent)
        : "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.clientIds, form.categoryId, form.accountDirection, amountManuallyEdited, clients, categories]);

  // Auto-fill amount from price table (create form) — débito da C/C OU categoria "Avulso"
  useEffect(() => {
    if (amountManuallyEdited) return;
    const catNorm = normalizeCategoryName(categories.find((c) => c.id === form.categoryId)?.name);
    const isAvulso = catNorm === "avulso";
    if (form.accountDirection !== "debito" && !isAvulso) return;
    if (!form.startTime || !form.endTime || !form.paidAt) return;
    const wd = weekdayFromYmd(form.paidAt);
    if (wd == null) return;
    const calc = calcPrice({
      bands: priceBands,
      weekday: wd,
      startTime: form.startTime,
      endTime: form.endTime,
      categoryId: form.categoryId || null,
      court: form.court ? Number(form.court) : null,
      date: form.paidAt || null,
    });
    if (!calc || !calc.matched) return;
    const next = calc.total.toFixed(2);
    setForm((f) => {
      const patch: Partial<FormState> = {};
      if (f.amount !== next) patch.amount = next;
      // Avulso: sem desconto
      if (isAvulso && f.discountPercent) patch.discountPercent = "";
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
  }, [form.startTime, form.endTime, form.paidAt, form.court, form.categoryId, form.accountDirection, priceBands, amountManuallyEdited, categories]);

  // Auto-fill amount from price table (edit form) — débito da C/C OU categoria "Avulso"
  useEffect(() => {
    if (editAmountManuallyEdited) return;
    const catNorm = normalizeCategoryName(categories.find((c) => c.id === editForm.categoryId)?.name);
    const isAvulso = catNorm === "avulso";
    if (editForm.accountDirection !== "debito" && !isAvulso) return;
    if (!editForm.startTime || !editForm.endTime || !editForm.paidAt) return;
    const wd = weekdayFromYmd(editForm.paidAt);
    if (wd == null) return;
    const calc = calcPrice({
      bands: priceBands,
      weekday: wd,
      startTime: editForm.startTime,
      endTime: editForm.endTime,
      categoryId: editForm.categoryId || null,
      court: editForm.court ? Number(editForm.court) : null,
      date: editForm.paidAt || null,
    });
    if (!calc || !calc.matched) return;
    const next = calc.total.toFixed(2);
    setEditForm((f) => {
      const patch: Partial<FormState> = {};
      if (f.amount !== next) patch.amount = next;
      if (isAvulso && f.discountPercent) patch.discountPercent = "";
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
  }, [editForm.startTime, editForm.endTime, editForm.paidAt, editForm.court, editForm.categoryId, editForm.accountDirection, priceBands, editAmountManuallyEdited, categories]);

  const toggleClientCreate = (value: string) => {
    if (value === NEW_CLIENT_VALUE) {
      setNewClientTarget("create");
      setNewClientOpen(true);
      return;
    }
    setForm((f) =>
      f.clientIds.includes(value)
        ? { ...f, clientIds: f.clientIds.filter((id) => id !== value) }
        : { ...f, clientIds: [...f.clientIds, value] }
    );
  };

  const buildInsertPayload = (f: FormState, overrideClientId?: string | null, overrideAmount?: number) => {
    const catNorm = normalizeCategoryName(categories.find((c) => c.id === f.categoryId)?.name);
    const isEstorno = catNorm === "estorno";
    const isGympass = catNorm === "credito gympass";
    const isAutoCCPayload = isGympass;
    const isStockCat = catNorm === "grip" || catNorm === "terno de bola";
    const isRanking = catNorm === "ranking masculino" || catNorm === "ranking feminino";

    const rawAmount = overrideAmount !== undefined ? overrideAmount : Number(f.amount) || 0;
    const pct = Math.min(Math.max(Number(f.discountPercent) || 0, 0), 100);
    const finalAmount =
      pct > 0 && rawAmount > 0 ? Math.round(rawAmount * (1 - pct / 100) * 100) / 100 : rawAmount;
    const mergedNotes = f.notes?.trim() || null;

    return {
      client_id:
        overrideClientId !== undefined
          ? overrideClientId
          : f.clientId && f.clientId !== NEW_CLIENT_VALUE
            ? f.clientId
            : null,
      category_id: f.categoryId || null,
      amount: finalAmount,
      passthrough_amount: isGympass ? Number(f.passthroughAmount) || 0 : 0,
      method: (isEstorno ? "outro" : f.method || "outro") as never,
      paid_at: recifeDateToISO(f.paidAt || todayISO()),
      start_time: isEstorno ? null : f.startTime || null,
      end_time: isEstorno ? null : f.endTime || null,
      court: isEstorno ? null : f.court ? Number(f.court) : null,
      received: isRanking
        ? f.received
        : finalAmount === 0
          ? true
          : isEstorno
            ? true
            : isAutoCCPayload
              ? false
              : f.received,
      to_account: isEstorno || isAutoCCPayload ? true : f.accountDirection !== "",
      account_direction: isEstorno ? "credito" : isAutoCCPayload ? (isGympass ? "credito" : "debito") : f.accountDirection || null,
      notes: mergedNotes || null,
      is_new_plan_sale: isEstorno ? false : f.isNewPlanSale,
      commission_user_id:
        !isEstorno && f.isNewPlanSale ? f.commissionUserId || user?.id || null : null,
      quantity: isStockCat ? Math.max(1, parseInt(f.quantity, 10) || 1) : 1,
      is_pending_payment: isStockCat ? f.isPendingPayment : false,
    };

  };

  const requiresAccountDirection = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    const norm = normalizeCategoryName(cat?.name);
    return norm === "mensalista" || norm === "debito avulso" || norm === "saldo anterior" || norm === "pendencia avulsa" || norm === "estorno" || norm === "credito gympass";
  };

  // Só oferece o "receber junto" num pagamento comum de um único cliente —
  // não em lançamentos que já mexem na conta corrente (crédito/débito, que
  // já são cobrança/quitação).
  const canOfferReceiveDebt = (f: FormState) => {
    if (f.clientIds.length !== 1 || !f.categoryId || f.accountDirection) return false;
    const norm = normalizeCategoryName(categories.find((c) => c.id === f.categoryId)?.name);
    return ![
      "pendencia avulsa",
      "debito avulso",
      "saldo anterior",
      "estorno",
      "credito gympass",
    ].includes(norm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (form.clientIds.length === 0) {
      toast.error("Selecione pelo menos um cliente.");
      return;
    }
    if (!form.categoryId) {
      toast.error("Selecione uma categoria.");
      return;
    }
    const submitCat = categories.find((c) => c.id === form.categoryId);
    const submitCatNorm = normalizeCategoryName(submitCat?.name);
    if (submitCatNorm === "estorno") {
      setForm((f) => ({ ...f, amount: "", method: "", court: "", startTime: "", endTime: "", received: true, accountDirection: "credito", isNewPlanSale: false }));
    }
    if (submitCatNorm === "mensalista" && form.accountDirection === "credito" && !form.method) {
      toast.error("Mensalista com Crédito exige uma forma de pagamento.");
      return;
    }
    if ((submitCatNorm === "ranking masculino" || submitCatNorm === "ranking feminino") && (!form.court || !form.startTime)) {
      toast.error("Para Ranking, informe a quadra e o horário de início.");
      return;
    }
    if (submitCatNorm === "mensalista" && form.accountDirection === "debito" && (!form.amount || !form.court || !form.startTime || !form.endTime)) {
      toast.error("Para Mensalista com Débito, informe valor, quadra, horário de início e de término.");
      return;
    }
    if (submitCatNorm === "inscricao ranking masculino" && (!form.amount || !form.method)) {
      toast.error("Para Inscrição Ranking Masculino, informe valor e forma de pagamento.");
      return;
    }
    if (submitCatNorm !== "estorno" && requiresAccountDirection(form.categoryId) && form.accountDirection !== "credito" && form.accountDirection !== "debito") {
      toast.error("Marque Crédito ou Débito em conta corrente para esta categoria.");
      return;
    }
    const debtToReceive = canOfferReceiveDebt(form) ? receiveOpenDebtAmount(receiveDebt) : 0;
    const debtCreditCatId =
      categories.find((c) => normalizeCategoryName(c.name) === "pendencia avulsa")?.id ??
      categories.find((c) => normalizeCategoryName(c.name) === "mensalista")?.id;
    if (debtToReceive > 0 && !form.method) {
      toast.error("Escolha a forma de pagamento pra receber o débito em aberto junto.");
      return;
    }
    if (debtToReceive > 0 && !debtCreditCatId) {
      toast.error('Não encontrei a categoria "Pendência avulsa" pra quitar o débito. Avise o suporte.');
      return;
    }
    setSubmitting(true);
    const total = Number(form.amount) || 0;

    let rows: ReturnType<typeof buildInsertPayload>[];
    if (form.clientIds.length > 1) {
      // Divide o valor igualmente; o último lançamento absorve eventuais centavos de arredondamento
      const n = form.clientIds.length;
      const cents = Math.round(total * 100);
      const baseCents = Math.floor(cents / n);
      const remainder = cents - baseCents * n;
      rows = form.clientIds.map((cid, idx) => {
        const amt = (baseCents + (idx === n - 1 ? remainder : 0)) / 100;
        return buildInsertPayload(form, cid, amt);
      });
    } else {
      const single = form.clientIds[0] ?? null;
      rows = [buildInsertPayload(form, single)];
    }

    if (debtToReceive > 0 && debtCreditCatId) {
      rows.push({
        client_id: form.clientIds[0],
        category_id: debtCreditCatId,
        amount: debtToReceive,
        passthrough_amount: 0,
        method: form.method as never,
        paid_at: recifeDateToISO(form.paidAt || todayISO()),
        start_time: null,
        end_time: null,
        court: null,
        received: true,
        to_account: true,
        account_direction: "credito",
        notes: OPEN_DEBT_SETTLEMENT_NOTE,
        is_new_plan_sale: false,
        commission_user_id: null,
        quantity: 1,
        is_pending_payment: false,
      });
    }

    // Busca o usuário logado agora (não o do contexto, que pode estar
    // desatualizado num computador compartilhado onde outro recepcionista
    // acabou de trocar de sessão no mesmo navegador).
    const { data: freshUserData } = await supabase.auth.getUser();
    const recorderId = freshUserData.user?.id ?? user.id;
    const { data: inserted, error } = await supabase
      .from("payments")
      .insert(rows.map((r) => ({ ...r, recorded_by: recorderId })))
      .select("id, amount, client_id");
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      // Audit log para cada pagamento criado
      if (inserted) {
        await Promise.all(
          inserted.map((p) =>
            logAction({
              entity: "payment",
              entity_id: p.id,
              action: "create",
              details: { amount: p.amount, client_id: p.client_id },
            })
          )
        );
      }

      // Upload do comprovante (se anexado) — anexa a cada pagamento/cliente
      if (receiptFile && inserted && inserted.length > 0) {
        if (receiptFile.size > 10 * 1024 * 1024) {
          toast.error("Comprovante: tamanho máximo 10MB. Pagamento registrado sem anexo.");
        } else {
          const ext = receiptFile.name.includes(".") ? receiptFile.name.split(".").pop() : "";
          const targets = inserted.filter((p) => p.client_id);
          for (const p of targets) {
            const path = `${p.client_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? "." + ext : ""}`;
            const { error: upErr } = await supabase.storage
              .from("payment-receipts")
              .upload(path, receiptFile, { contentType: receiptFile.type || undefined, upsert: false });
            if (upErr) {
              toast.error(`Comprovante: ${upErr.message}`);
              continue;
            }
            const { error: insErr } = await supabase.from("payment_receipts").insert({
              client_id: p.client_id as string,
              payment_id: p.id,
              file_path: path,
              file_name: receiptFile.name,
              mime_type: receiptFile.type || null,
              size_bytes: receiptFile.size,
              uploaded_by: user.id,
            });
            if (insErr) {
              await supabase.storage.from("payment-receipts").remove([path]);
              toast.error(`Comprovante: ${insErr.message}`);
            }
          }
          if (targets.length === 0) {
            toast.message("Comprovante não anexado: pagamento avulso (sem cliente).");
          }
        }
      }

      toast.success(
        form.clientIds.length > 1
          ? `Pagamento dividido entre ${form.clientIds.length} clientes!`
          : "Pagamento registrado!"
      );
      if (lateCancelNotifId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: resolveErr } = await (supabase as any).rpc("professor_late_cancel_resolve", {
          _notification_id: lateCancelNotifId,
          _outcome: "charged",
        });
        if (resolveErr) toast.error(`Aviso de cancelamento: ${resolveErr.message}`);
        setLateCancelNotifId(null);
      }
      setOpen(false);
      setForm(emptyForm());
      setAmountManuallyEdited(false);
      setReceiptFile(null);
      setReceiveDebt(EMPTY_RECEIVE_OPEN_DEBT);
      if (debtToReceive > 0) toast.success(`Débito em aberto recebido: ${fmtBRL(debtToReceive)}`);
      loadAll();
      // Oferece envio de WhatsApp para cada cliente vinculado ao pagamento.
      // Para divisão entre vários clientes, dispara um toast por cliente
      // (visíveis simultaneamente — visibleToasts=6 no Toaster).
      if (inserted) {
        // Agrupa por client_id para somar quando o mesmo cliente recebeu múltiplas
        // entradas no mesmo lançamento (improvável, mas seguro).
        const byClient = new Map<string, number>();
        for (const p of inserted) {
          if (!p.client_id) continue;
          byClient.set(p.client_id, (byClient.get(p.client_id) ?? 0) + (Number(p.amount) || 0));
        }
        // A quitação do débito não entra no valor "do lançamento" da
        // mensagem — o saldo atualizado já aparece nela.
        if (debtToReceive > 0) {
          const cid = form.clientIds[0];
          const cur = byClient.get(cid);
          if (cur != null) byClient.set(cid, Math.round((cur - debtToReceive) * 100) / 100);
        }
        const paidAtIso = new Date().toISOString();
        const catName = categories.find((c) => c.id === form.categoryId)?.name ?? null;
        for (const [clientId, amt] of byClient) {
          void offerWhatsAppPaymentNotification(
            {
              clientId,
              amount: amt,
              accountDirection: form.accountDirection || null,
              paidAt: paidAtIso,
              startTime: form.startTime || null,
              categoryName: catName,
            },
            (cid) => markClientNotified(cid),
          );
        }
      }
    }
  };

  const openEdit = (p: PaymentRow) => {
    setEditingId(p.id);
    setEditForm({
      clientId: p.client_id ?? "",
      clientIds: [],
      categoryId: p.category_id ?? "",
      amount: String(p.amount),
      passthroughAmount: p.passthrough_amount && Number(p.passthrough_amount) > 0 ? String(p.passthrough_amount) : "",
      discountPercent: "",
      method: p.method,
      paidAt: dateISOInRecife(new Date(p.paid_at)),
      startTime: p.start_time ? p.start_time.slice(0, 5) : "",
      endTime: p.end_time ? p.end_time.slice(0, 5) : "",
      court: p.court ? String(p.court) : "",
      received: p.received,
      accountDirection: (p.account_direction as "credito" | "debito" | null) ?? "",
      notes: p.notes ?? "",
      isNewPlanSale: (p as PaymentRow & { is_new_plan_sale?: boolean }).is_new_plan_sale ?? false,
      commissionUserId:
        (p as PaymentRow & { commission_user_id?: string | null }).commission_user_id ??
        p.recorded_by ??
        "",
      quantity: String((p as PaymentRow & { quantity?: number | null }).quantity ?? 1),
      isPendingPayment: (p as PaymentRow & { is_pending_payment?: boolean | null }).is_pending_payment ?? false,
    });

    setEditAmountManuallyEdited(true); // don't overwrite existing amount when opening edit
    setEditOpen(true);
  };

  // Auto-open edit dialog when navigated with ?editPayment=<id>
  const search = useSearch({ from: "/caixa" });
  const navigate = useNavigate();
  const [processedEditId, setProcessedEditId] = useState<string | null>(null);
  useEffect(() => {
    const targetId = search.editPayment;
    if (!targetId) return;
    if (processedEditId === targetId) return;
    setProcessedEditId(targetId);
    (async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, client_id, category_id, amount, passthrough_amount, method, paid_at, start_time, end_time, court, received, to_account, account_direction, notes, updated_at, recorded_by, is_new_plan_sale, commission_user_id")
        .eq("id", targetId)
        .maybeSingle();
      if (error) {
        toast.error("Não foi possível carregar o pagamento: " + error.message);
        return;
      }
      if (!data) {
        toast.error("Pagamento não encontrado.");
        return;
      }
      openEdit(data as unknown as PaymentRow);
      // Clear the query param so reopening works next time
      navigate({ to: "/caixa", search: { editPayment: undefined }, replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.editPayment]);

  // Aviso "Cancelamento com menos de 3h" → ?lateCancel=<id do aviso>: abre o
  // Novo pagamento já com cliente, débito, quadra e horário. Categoria,
  // valor (tabela de preços) e desconto do mensalista vêm das regras
  // normais do formulário. O aviso só é fechado quando o lançamento é salvo.
  useEffect(() => {
    const notifId = search.lateCancel;
    if (!notifId) return;
    (async () => {
      const { data, error } = await supabase
        .from("app_notifications")
        .select("id, kind, metadata, read_at")
        .eq("id", notifId)
        .maybeSingle();
      navigate({ to: "/caixa", search: { lateCancel: undefined }, replace: true });
      if (error || !data || data.kind !== "professor_late_cancel") {
        toast.error("Aviso de cancelamento não encontrado.");
        return;
      }
      const m = (data.metadata ?? {}) as {
        client_id?: string;
        teacher_name?: string | null;
        court?: number | null;
        date?: string;
        start_time?: string;
        end_time?: string;
        cancelled_at?: string;
        outcome?: string;
      };
      if (m.outcome) {
        toast.message("Este cancelamento já foi resolvido por outra pessoa da recepção.");
        return;
      }
      if (!m.client_id || !m.date || !m.start_time || !m.end_time) {
        toast.error("Aviso de cancelamento incompleto.");
        return;
      }
      const cancelledAt = m.cancelled_at
        ? new Date(m.cancelled_at).toLocaleTimeString("pt-BR", {
            timeZone: "America/Recife",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      setAmountManuallyEdited(false);
      setForm({
        ...emptyForm(),
        clientIds: [m.client_id],
        accountDirection: "debito",
        paidAt: m.date,
        court: m.court ? String(m.court) : "",
        startTime: m.start_time.slice(0, 5),
        endTime: m.end_time.slice(0, 5),
        notes: `Cancelamento com menos de 3h pelo professor ${m.teacher_name ?? ""}${
          cancelledAt ? ` (cancelou às ${cancelledAt})` : ""
        }`.replace(/\s+/g, " "),
      });
      setLateCancelNotifId(data.id);
      setOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.lateCancel]);

  // Fechou o Novo pagamento sem salvar: solta o aviso (ele volta a
  // aparecer nas outras telas) para não ser resolvido por outro lançamento.
  useEffect(() => {
    if (!open) setLateCancelNotifId(null);
  }, [open]);



  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !user) return;
    if (!editForm.clientId) {
      toast.error("Selecione um cliente.");
      return;
    }
    if (!editForm.categoryId) {
      toast.error("Selecione uma categoria.");
      return;
    }
    const scrollYBeforeSave = window.scrollY;
    const editCat = categories.find((c) => c.id === editForm.categoryId);
    const editCatNorm = normalizeCategoryName(editCat?.name);
    if (editCatNorm === "estorno") {
      setEditForm((f) => ({ ...f, amount: "", method: "", court: "", startTime: "", endTime: "", received: true, accountDirection: "credito", isNewPlanSale: false }));
    }
    if (editCatNorm === "mensalista" && editForm.accountDirection === "credito" && !editForm.method) {
      toast.error("Mensalista com Crédito exige uma forma de pagamento.");
      return;
    }
    if ((editCatNorm === "ranking masculino" || editCatNorm === "ranking feminino") && (!editForm.court || !editForm.startTime)) {
      toast.error("Para Ranking, informe a quadra e o horário de início.");
      return;
    }
    if (editCatNorm === "mensalista" && editForm.accountDirection === "debito" && (!editForm.amount || !editForm.court || !editForm.startTime || !editForm.endTime)) {
      toast.error("Para Mensalista com Débito, informe valor, quadra, horário de início e de término.");
      return;
    }
    if (editCatNorm === "inscricao ranking masculino" && (!editForm.amount || !editForm.method)) {
      toast.error("Para Inscrição Ranking Masculino, informe valor e forma de pagamento.");
      return;
    }
    if (editCatNorm !== "estorno" && requiresAccountDirection(editForm.categoryId) && editForm.accountDirection !== "credito" && editForm.accountDirection !== "debito") {
      toast.error("Marque Crédito ou Débito em conta corrente para esta categoria.");
      return;
    }
    setEditSubmitting(true);
    const { data: freshEditUserData } = await supabase.auth.getUser();
    const payload = {
      ...buildInsertPayload(editForm),
      updated_by: freshEditUserData.user?.id ?? user.id,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("payments").update(payload).eq("id", editingId);
    setEditSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      await logAction({
        entity: "payment",
        entity_id: editingId,
        action: "update",
        details: { amount: payload.amount, client_id: payload.client_id },
      });
      toast.success("Pagamento atualizado!");
      setEditOpen(false);
      setEditingId(null);
      restoreScrollPosition(scrollYBeforeSave);
      loadAll(filterDate, dateMode, { silent: true, preserveScrollY: scrollYBeforeSave });
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm("Excluir este lançamento do caixa? Esta ação não pode ser desfeita."))) return;
    await supabase.from("account_entries").delete().eq("payment_id", id);
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      await logAction({ entity: "payment", entity_id: id, action: "delete" });
      toast.success("Lançamento excluído.");
      loadAll();
    }
  };


  const visiblePayments = (() => {
    let list: PaymentRow[] = extraEntries.length > 0 ? [...payments, ...extraEntries] : payments;
    if (filterCourt !== "all") {
      list = list.filter((p) =>
        filterCourt === "none" ? p.court == null : String(p.court) === filterCourt
      );
    }
    if (filterMethod !== "all") {
      list = list.filter((p) => p.method === filterMethod);
    }
    if (filterCategory !== "all") {
      list = list.filter((p) => {
        const cat = p.category_id ?? p.clients?.category_id ?? null;
        return filterCategory === "none" ? cat == null : cat === filterCategory;
      });
    }
    if (filterStatus !== "all") {
      list = list.filter((p) => {
        const isCC = p.to_account === true && p.received === false;
        if (filterStatus === "cc") return isCC;
        if (filterStatus === "received") return !isCC && p.received === true;
        return !isCC && p.received === false;
      });
    }
    if (filterUser !== "all") {
      list = list.filter((p) =>
        filterUser === "none" ? !p.recorded_by : p.recorded_by === filterUser
      );
    }
    const q = normalizeText(filterClientName);
    if (q) {
      list = list.filter((p) =>
        normalizeText(p.clients?.full_name).includes(q)
      );
    }
    const sorted = [...list];
    if (sortBy === "court") {
      sorted.sort((a, b) => (a.court ?? 99) - (b.court ?? 99));
    } else if (sortBy === "start_time") {
      sorted.sort((a, b) => (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99"));
    }
    return sorted;
  })();
  // "Saldo Anterior" nunca entra em nenhuma soma (apenas dado importado)
  const catNameById = new Map<string, string>(categories.map((c) => [c.id, c.name]));
  const isSaldoAnt = (p: PaymentRow) =>
    isSaldoAnterior(p.category_id ? catNameById.get(p.category_id) : null);
  // Para Crédito Gympass, parte do valor é repassada a outro CNPJ e
  // não compõe o faturamento da empresa. Subtraímos o passthrough_amount.
  const effectiveAmount = (p: PaymentRow) =>
    Number(p.amount) - Number(p.passthrough_amount ?? 0);
  const isAccountEntryRow = (p: PaymentRow) => p.id.startsWith("ae:");
  const todayTotal = visiblePayments.reduce(
    (s, p) => (isSaldoAnt(p) || isAccountEntryRow(p) ? s : s + effectiveAmount(p)),
    0
  );

  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const handlePrint = () => {
    const dateLabel =
      dateMode === "month"
        ? format(filterDate, "MMMM 'de' yyyy", { locale: ptBR })
        : format(filterDate, "dd/MM/yyyy", { locale: ptBR });
    const rows = visiblePayments
      .filter((p) => !isSaldoAnt(p) && !isAccountEntryRow(p))
      .map((p) => {
        const catId = p.category_id ?? p.clients?.category_id ?? null;
        const catName = catId ? categories.find((c) => c.id === catId)?.name ?? "—" : "—";
        const passthrough = Number(p.passthrough_amount ?? 0);
        const eff = effectiveAmount(p);
        return `
        <tr>
          <td>${esc(fmtDateTime(p.paid_at))}</td>
          <td>${esc(p.clients?.full_name ?? "Avulso")}</td>
          <td>${esc(catName)}</td>
          <td>${esc(String(p.court ?? "—"))}</td>
          <td>${esc(p.start_time?.slice(0, 5) ?? "—")}</td>
          <td>${esc(p.end_time?.slice(0, 5) ?? "—")}</td>
          <td>${esc(methodLabel(p.method))}</td>
          <td>${esc(p.to_account && p.received === false ? "C/C" : p.received ? "Recebido" : "Pendente")}${p.to_account && p.received === true ? " / C.C." : ""}</td>
          <td style="text-align:right">${esc(fmtBRL(eff))}${passthrough > 0 ? `<br><span style="font-size:10px;color:#666">bruto ${esc(fmtBRL(Number(p.amount)))} − ${esc(fmtBRL(passthrough))} repasse</span>` : ""}</td>
        </tr>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Caixa ${dateLabel}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px;font-size:20px}
        p{margin:0 0 16px;color:#555;font-size:13px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f3f4f6}
        tfoot td{font-weight:bold;background:#f9fafb}
      </style></head><body>
      <h1>Caixa — ${dateLabel}</h1>
      <p>Total: ${fmtBRL(todayTotal)} — ${visiblePayments.length} lançamento(s)</p>
      <table>
        <thead><tr>
          <th>Hora reg.</th><th>Cliente</th><th>Categoria</th><th>Quadra</th><th>Início</th><th>Término</th>
          <th>Forma</th><th>Status</th><th style="text-align:right">Valor</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="8" style="text-align:right">Total</td><td style="text-align:right">${fmtBRL(todayTotal)}</td></tr></tfoot>
      </table>
      <script>window.onload=()=>{window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permita pop-ups para imprimir."); return; }
    w.document.write(html);
    w.document.close();
  };

  // ------- Form fields component (shared between create + edit) -------
  const renderFormFields = (f: FormState, setF: (u: FormState) => void, isCreate: boolean) => {
    const update = (patch: Partial<FormState>) => setF({ ...f, ...patch });
    const fCat = categories.find((x) => x.id === f.categoryId);
    const fCatNorm = normalizeCategoryName(fCat?.name);
    const isEstorno = fCatNorm === "estorno";
    const isAutoCC = fCatNorm === "credito gympass";
    const isMensalistaDebito = fCatNorm === "mensalista" && f.accountDirection === "debito";
    const isMensalistaCredito = fCatNorm === "mensalista" && f.accountDirection === "credito";
    const isInscricaoRanking = fCatNorm === "inscricao ranking masculino";
    const isStockCat = fCatNorm === "grip" || fCatNorm === "terno de bola";
    const noTimeCourt = [
      "grip",
      "inscricao ranking masculino",
      "saldo anterior",
      "tenis de mesa (mensalista)",
      "terno de bola",
      "credito gympass",
    ].includes(fCatNorm) || isMensalistaCredito || isEstorno;
    return (
      <div className="space-y-4">
        {isCreate ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Clientes <span className="text-destructive">*</span></Label>
              {f.clientIds.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  Valor será dividido igualmente entre {f.clientIds.length} clientes ({fmtBRL((Number(f.amount) || 0) / f.clientIds.length)} cada)
                </span>
              )}
            </div>
            {f.clientIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {f.clientIds.map((cid) => {
                  const c = clients.find((x) => x.id === cid);
                  return (
                    <Badge key={cid} variant="secondary" className="gap-1 pr-1">
                      {c?.full_name ?? cid}
                      <button
                        type="button"
                        onClick={() => toggleClientCreate(cid)}
                        className="ml-1 rounded hover:bg-background/50 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate text-muted-foreground">
                    {f.clientIds.length === 0
                      ? "Buscar cliente (ou deixe em branco para avulso)"
                      : "Adicionar mais clientes..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Buscar cliente por nome..."
                    value={clientSearch}
                    onValueChange={setClientSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {clientSearchLoading
                        ? "Buscando..."
                        : clientSearch.trim()
                          ? "Nenhum cliente encontrado."
                          : "Digite para buscar clientes."}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__novo__"
                        onSelect={() => {
                          toggleClientCreate(NEW_CLIENT_VALUE);
                          setClientPopoverOpen(false);
                        }}
                      >
                        <UserPlus className="mr-2 h-4 w-4 text-primary" />
                        <span className="text-primary">Cadastrar novo cliente</span>
                      </CommandItem>
                      {clientSearchResults
                        .filter((c) => !f.clientIds.includes(c.id))
                        .map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.id}
                            onSelect={() => {
                              setClients((prev) =>
                                prev.some((p) => p.id === c.id) ? prev : [...prev, c],
                              );
                              toggleClientCreate(c.id);
                              setClientPopoverOpen(false);
                            }}
                          >
                            <Check className="mr-2 h-4 w-4 opacity-0" />
                            {c.full_name}
                            {c.client_categories?.name && (
                              <span className="text-muted-foreground"> — {c.client_categories.name}</span>
                            )}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Selecione vários clientes para dividir o valor igualmente. Cada cliente terá um lançamento próprio.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Cliente <span className="text-destructive">*</span></Label>
            <Popover open={clientPopoverEditOpen} onOpenChange={setClientPopoverEditOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {(() => {
                      const sel = clients.find((c) => c.id === f.clientId);
                      return sel ? sel.full_name : <span className="text-muted-foreground">Buscar cliente (ou deixe em branco para avulso)</span>;
                    })()}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Buscar cliente por nome..."
                    value={clientSearch}
                    onValueChange={setClientSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {clientSearchLoading
                        ? "Buscando..."
                        : clientSearch.trim()
                          ? "Nenhum cliente encontrado."
                          : "Digite para buscar clientes."}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__novo__"
                        onSelect={() => {
                          setNewClientTarget("edit");
                          setNewClientOpen(true);
                          setClientPopoverEditOpen(false);
                        }}
                      >
                        <UserPlus className="mr-2 h-4 w-4 text-primary" />
                        <span className="text-primary">Cadastrar novo cliente</span>
                      </CommandItem>
                      <CommandItem
                        value="__avulso__"
                        onSelect={() => {
                          update({ clientId: "" });
                          setClientPopoverEditOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", !f.clientId ? "opacity-100" : "opacity-0")} />
                        Avulso (sem cliente)
                      </CommandItem>
                      {clientSearchResults.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.id}
                          onSelect={() => {
                            setClients((prev) =>
                              prev.some((p) => p.id === c.id) ? prev : [...prev, c],
                            );
                            update({ clientId: c.id });
                            setClientPopoverEditOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", f.clientId === c.id ? "opacity-100" : "opacity-0")} />
                          {c.full_name}
                          {c.client_categories?.name && (
                            <span className="text-muted-foreground"> — {c.client_categories.name}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {fCatNorm === "mensalista" && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={f.isNewPlanSale}
                onCheckedChange={(v) => {
                  const checked = v === true;
                  update({
                    isNewPlanSale: checked,
                    commissionUserId: checked
                      ? f.commissionUserId || user?.id || ""
                      : f.commissionUserId,
                  });
                }}
              />
              <Label className="cursor-pointer font-normal">
                Venda de novo plano (gera comissão)
              </Label>
            </div>
            {f.isNewPlanSale && (
              <div className="space-y-2">
                <Label>Comissão para</Label>
                {/* Recepcionista também escolhe a quem vai a comissão ao
                    lançar (o banco aceita no INSERT); na edição o valor é
                    preservado pelo trigger, então segue só Diretoria/Admin. */}
                {canEditCommissionUser || (isCreate && isRecepcionista) ? (
                  <Select
                    value={f.commissionUserId || ""}
                    onValueChange={(v) => update({ commissionUserId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o usuário" />
                    </SelectTrigger>
                    <SelectContent>
                      {(recepcionistaProfiles.some((p) => p.id === f.commissionUserId)
                        ? recepcionistaProfiles
                        : [
                            ...recepcionistaProfiles,
                            ...allProfiles.filter((p) => p.id === f.commissionUserId),
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
                    {allProfiles.find((p) => p.id === (f.commissionUserId || user?.id))
                      ?.full_name ?? "—"}{" "}
                    <span className="text-xs">(somente Diretoria pode alterar)</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}


        <div className="space-y-2">
          <Label>Categoria <span className="text-destructive">*</span></Label>
          <Select
            key={f.categoryId === "" ? "empty-cat" : "set-cat"}
            value={f.categoryId || undefined}
            onValueChange={(v) => {
              const newCatId = v;
              const cat = categories.find((c) => c.id === newCatId);
              const norm = normalizeCategoryName(cat?.name);
              const stillCommissionable = norm === "mensalista";
              const patch: Partial<FormState> = { categoryId: newCatId };
              if (!stillCommissionable) patch.isNewPlanSale = false;
              if (norm === "credito gympass") patch.accountDirection = "credito";
              if (norm !== "credito gympass") patch.passthroughAmount = "";
              if (norm === "credito gympass") {
                patch.method = "";
                patch.received = false;
              }
              if (norm === "estorno") {
                patch.amount = "";
                patch.method = "";
                patch.court = "";
                patch.startTime = "";
                patch.endTime = "";
                patch.received = true;
                patch.accountDirection = "credito";
              }
              update(patch);
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

        {isCreate && canOfferReceiveDebt(f) && (
          <ReceiveOpenDebtOption
            clientId={f.clientIds[0]}
            value={receiveDebt}
            onChange={setReceiveDebt}
          />
        )}

        {isStockCat && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="space-y-2">
              <Label>Tipo de lançamento <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => update({ isPendingPayment: false })}
                  className={`rounded-md border p-2 text-sm text-left transition ${
                    !f.isPendingPayment
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
                    f.isPendingPayment
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
            {!f.isPendingPayment && (
              <div className="space-y-2">
                <Label>Quantidade vendida <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={f.quantity}
                  onChange={(e) => {
                    const qty = Math.max(1, parseInt(e.target.value, 10) || 1);
                    const unit = Number(fCat?.default_amount) || 0;
                    const manuallyEdited = isCreate ? amountManuallyEdited : editAmountManuallyEdited;
                    const patch: Partial<FormState> = { quantity: e.target.value };
                    if (unit > 0 && !manuallyEdited) {
                      patch.amount = (unit * qty).toFixed(2);
                    }
                    update(patch);
                  }}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <p className="text-xs text-muted-foreground">
                  Será abatido do estoque de <strong>{fCat?.name}</strong>.
                </p>
              </div>
            )}
          </div>
        )}


        <div className="grid grid-cols-2 gap-4">


          <div className="space-y-2">
            <Label>Valor (R$) {isMensalistaDebito || isInscricaoRanking ? <span className="text-destructive">*</span> : <span className="text-xs text-muted-foreground font-normal">(opcional)</span>}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder={isMensalistaDebito || isInscricaoRanking || isEstorno ? "" : "Deixe em branco se não houver valor"}
              value={f.amount}
              onChange={(e) => {
                if (isCreate) setAmountManuallyEdited(true);
                else setEditAmountManuallyEdited(true);
                update({ amount: e.target.value });
              }}
              onWheel={(e) => e.currentTarget.blur()}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          {fCatNorm === "mensalista" && f.accountDirection !== "credito" && (
            <div className="space-y-2">
              <Label>
                Desconto (%){" "}
                <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
              </Label>
              {(() => {
                if (f.clientIds.length !== 1) return null;
                const sel = clients.find((c) => c.id === f.clientIds[0]);
                const clientDiscount = Number(sel?.default_discount_percent) || 0;
                if (!sel || clientDiscount <= 0) return null;
                return (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <strong>{sel.full_name}</strong> tem {String(clientDiscount).replace(".", ",")}% de desconto cadastrado — já aplicado abaixo.
                  </div>
                );
              })()}
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="0"
                value={f.discountPercent}
                onChange={(e) => update({ discountPercent: e.target.value })}
                onWheel={(e) => e.currentTarget.blur()}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {(() => {
                const base = Number(f.amount) || 0;
                const pct = Math.min(Math.max(Number(f.discountPercent) || 0, 0), 100);
                if (base <= 0 || pct <= 0) return null;
                const final = Math.round(base * (1 - pct / 100) * 100) / 100;
                return (
                  <p className="text-xs text-muted-foreground">
                    Valor final após desconto:{" "}
                    <strong className="text-foreground">
                      R$ {final.toFixed(2).replace(".", ",")}
                    </strong>{" "}
                    (de R$ {base.toFixed(2).replace(".", ",")} − {String(pct).replace(".", ",")}%)
                  </p>
                );
              })()}
            </div>
          )}
        </div>

        {fCatNorm === "credito gympass" && (
          <div className="rounded-md border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
            <Label>
              Valor repassado a outro CNPJ (R$){" "}
              <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={f.passthroughAmount}
              onChange={(e) => update({ passthroughAmount: e.target.value })}
              onWheel={(e) => e.currentTarget.blur()}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <p className="text-xs text-muted-foreground">
              Parte do valor recebido do Gympass que NÃO fica com a empresa nem
              é creditada na conta do cliente. O cliente receberá apenas{" "}
              <strong>
                {fmtBRL(
                  Math.max(
                    0,
                    (Number(f.amount) || 0) - (Number(f.passthroughAmount) || 0),
                  ),
                )}
              </strong>{" "}
              de crédito e o faturamento conta apenas esse mesmo valor.
            </p>
          </div>
        )}

        <div className={`space-y-2 ${noTimeCourt ? "opacity-50" : ""}`}>
          <Label>Quadra {(fCatNorm === "ranking masculino" || fCatNorm === "ranking feminino" || isMensalistaDebito) && <span className="text-destructive">*</span>}</Label>
          <div className="flex gap-2">
            <Select
              key={f.court === "" ? "empty" : "set"}
              value={isEstorno ? undefined : f.court || undefined}
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
            {f.court !== "" && !noTimeCourt && (
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
            <Label>Horário de início {(fCatNorm === "ranking masculino" || fCatNorm === "ranking feminino" || isMensalistaDebito) && <span className="text-destructive">*</span>}</Label>
            <Input type="time" value={isEstorno ? "" : f.startTime} onChange={(e) => update({ startTime: e.target.value })} disabled={noTimeCourt} />
          </div>
          <div className={`space-y-2 ${noTimeCourt ? "opacity-50" : ""}`}>
            <Label>Horário de término {isMensalistaDebito && <span className="text-destructive">*</span>}</Label>
            <Input type="time" value={isEstorno ? "" : f.endTime} onChange={(e) => update({ endTime: e.target.value })} disabled={noTimeCourt} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Data</Label>
            <Input
              type="date"
              value={f.paidAt}
              onChange={(e) => update({ paidAt: e.target.value })}
            />
          </div>
          <div className={`space-y-2 ${isMensalistaDebito || isEstorno || isAutoCC ? "opacity-50" : ""}`}>
            <Label>Forma de pagamento {((fCatNorm === "mensalista" && f.accountDirection === "credito") || isInscricaoRanking) && <span className="text-destructive">*</span>}</Label>
            <div className="flex gap-2">
              <Select
                key={f.method === "" ? "empty" : "set"}
                value={isEstorno || isAutoCC ? undefined : f.method || undefined}
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
              {f.method !== "" && !isMensalistaDebito && !isEstorno && !isAutoCC && (
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

        {(() => {
          const cat = categories.find((c) => c.id === f.categoryId);
          const catNorm = normalizeCategoryName(cat?.name);
          const isEstornoAccount = catNorm === "estorno";
          const hasClient = isCreate ? f.clientIds.length > 0 : !!f.clientId && f.clientId !== NEW_CLIENT_VALUE;
          const eligible =
            hasClient &&
            (catNorm === "mensalista" || catNorm === "debito avulso" || catNorm === "saldo anterior" || catNorm === "credito gympass" || catNorm === "pendencia avulsa" || catNorm === "energia (luz)" || catNorm === "ranking masculino" || catNorm === "ranking feminino" || isEstornoAccount);
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className={`flex items-center gap-2 rounded-md border p-3 ${isEstornoAccount || isAutoCC ? "opacity-50" : ""}`}>
                  <Checkbox
                    disabled={isEstornoAccount || isAutoCC}
                    checked={!isEstornoAccount && !isAutoCC && f.received}
                    onCheckedChange={(v) => update({ received: v === true })}
                  />
                  <Label className="cursor-pointer font-normal">Pagamento recebido</Label>
                </div>
                <div
                  className={`flex items-center gap-2 rounded-md border p-3 ${!eligible || (isAutoCC && fCatNorm !== "credito gympass") ? "opacity-50" : ""}`}
                >
                  <Checkbox
                    disabled={!eligible || (isAutoCC && fCatNorm !== "credito gympass")}
                    checked={isEstornoAccount || f.accountDirection === "credito"}
                    onCheckedChange={(v) => {
                      if (isEstornoAccount) {
                        update({ accountDirection: "credito", received: false, amount: "", method: "", court: "", startTime: "", endTime: "" });
                        return;
                      }
                      const next = v === true ? "credito" : "";
                      const cat = categories.find((c) => c.id === f.categoryId);
                      const norm = normalizeCategoryName(cat?.name);
                      if (next === "credito" && norm === "mensalista") {
                        update({ accountDirection: next, received: true, court: "", startTime: "", endTime: "" });
                      } else {
                        update({ accountDirection: next });
                      }
                    }}
                  />
                  <Label className="cursor-pointer font-normal text-center leading-tight">Creditar na<br />C/C</Label>
                </div>
                <div
                  className={`flex items-center gap-2 rounded-md border p-3 ${!eligible || fCatNorm === "credito gympass" || isEstornoAccount ? "opacity-50" : ""}`}
                >
                  <Checkbox
                    disabled={!eligible || fCatNorm === "credito gympass" || isEstornoAccount}
                    checked={f.accountDirection === "debito"}
                    onCheckedChange={(v) => {
                      const next = v === true ? "debito" : "";
                      if (next === "debito" && fCatNorm === "mensalista") {
                        update({ accountDirection: next, method: "" });
                      } else {
                        update({ accountDirection: next });
                      }
                    }}
                  />
                  <Label className="cursor-pointer font-normal text-center leading-tight">Debitar da<br />C/C</Label>
                </div>
              </div>
              {!eligible && (
                <p className="text-xs text-muted-foreground">
                  Crédito/Débito em conta corrente disponível apenas para categorias <strong>Mensalista</strong>, <strong>Débito avulso</strong>, <strong>Saldo anterior</strong> ou <strong>crédito GYMPASS</strong>.
                </p>
              )}
            </div>
          );
        })()}

      </div>
    );
  };

  const renderObservations = (f: FormState, setF: (u: FormState) => void) => (
    <div className="space-y-2">
      <Label>Observações (opcional)</Label>
      <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Caixa</h1>
          <p className="text-muted-foreground">
            Lançamentos de {dateMode === "month" ? format(filterDate, "MMMM 'de' yyyy", { locale: ptBR }) : format(filterDate, "dd/MM/yyyy", { locale: ptBR })}: {fmtBRL(todayTotal)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={dateMode} onValueChange={(v) => setDateMode(v as "day" | "month")}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Dia</SelectItem>
              <SelectItem value="month">Mês</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("justify-start text-left font-normal", !filterDate && "text-muted-foreground")}
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                {dateMode === "month"
                  ? format(filterDate, "MMMM 'de' yyyy", { locale: ptBR })
                  : format(filterDate, "dd/MM/yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={filterDate}
                onSelect={(d) => {
                  if (d) setFilterDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
                }}
                initialFocus
                locale={ptBR}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={handlePrint} disabled={visiblePayments.length === 0}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Novo pagamento
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Registrar pagamento</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {renderFormFields(form, setForm, true)}
                <div className="flex justify-end">
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Registrar
                  </Button>
                </div>
                {renderObservations(form, setForm)}
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>
            Pagamentos de {dateMode === "month" ? format(filterDate, "MMMM 'de' yyyy", { locale: ptBR }) : format(filterDate, "dd/MM/yyyy", { locale: ptBR })}
          </CardTitle>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Filtrar por quadra</Label>
              <Select value={filterCourt} onValueChange={setFilterCourt}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as quadras</SelectItem>
                  <SelectItem value="none">Sem quadra</SelectItem>
                  {COURTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{courtLabel(n)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Forma de pagamento</Label>
              <Select value={filterMethod} onValueChange={setFilterMethod}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as formas</SelectItem>
                  {METHOD_OPTIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Recepcionista</Label>
              <Select value={filterUser} onValueChange={setFilterUser}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Array.from(
                    new Map(
                      payments
                        .filter((p) => p.recorded_by && p.profiles?.full_name)
                        .map((p) => [p.recorded_by as string, p.profiles!.full_name])
                    ).entries()
                  )
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="received">Recebido</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="cc">Conta corrente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cliente</Label>
              <Input
                value={filterClientName}
                onChange={(e) => setFilterClientName(e.target.value)}
                placeholder="Buscar por nome..."
                className="w-[200px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ordenar por</Label>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Mais recentes</SelectItem>
                  <SelectItem value="court">Quadra (1 → 9)</SelectItem>
                  <SelectItem value="start_time">Horário de início</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Checkbox
                id="group-by-court"
                checked={groupByCourt}
                onCheckedChange={(v) => setGroupByCourt(v === true)}
              />
              <Label htmlFor="group-by-court" className="text-xs cursor-pointer font-normal">
                Agrupar por quadra
              </Label>
            </div>
            <div className="text-xs text-muted-foreground">
              {visiblePayments.length} lançamento(s)
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Carregando...</div>
          ) : visiblePayments.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">Nenhum pagamento encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora reg.</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Quadra</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Término</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Recepcionista</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                {(() => {
                  const renderRow = (p: PaymentRow) => {
                    const isAE = isAccountEntryRow(p);
                    return (
                    <TableRow key={p.id} className={isAE ? "bg-muted/30" : undefined}>

                      <TableCell className="text-sm">{fmtDateTime(p.paid_at)}</TableCell>
                       <TableCell>
                        {p.clients && p.client_id ? (
                          <Link
                            to="/clientes/$clientId"
                            params={{ clientId: p.client_id }}
                            className={cn(
                              "hover:underline font-medium",
                              notifiedClients.has(p.client_id)
                                ? "text-purple-600"
                                : "text-primary",
                            )}
                            title={
                              notifiedClients.has(p.client_id)
                                ? "WhatsApp já enviado"
                                : undefined
                            }
                          >
                            {p.clients.full_name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Avulso</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {(() => {
                          const catId = p.category_id ?? p.clients?.category_id ?? null;
                          const name = catId ? categories.find((c) => c.id === catId)?.name : null;
                          return (
                            <div className="flex items-center gap-1.5">
                              {name ?? <span className="text-muted-foreground">—</span>}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {p.court ? <Badge variant="outline">{courtShort(p.court)}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{p.start_time?.slice(0, 5) ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.end_time?.slice(0, 5) ?? "—"}</TableCell>
                      <TableCell>
                        {methodLabel(p.method) ? <Badge variant="secondary">{methodLabel(p.method)}</Badge> : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {isAE ? (
                            <Badge variant="outline" title={p.notes ?? undefined}>
                              {p.account_direction === "credito" ? "Crédito C/C" : "Débito C/C"}
                            </Badge>
                          ) : p.to_account && p.received === false ? (
                            <Badge variant="secondary">C/C</Badge>
                          ) : (
                            <>
                              {p.received ? <Badge>Recebido</Badge> : <Badge variant="outline">Pendente</Badge>}
                              {p.to_account && <Badge variant="secondary">C/C</Badge>}
                            </>
                          )}
                        </div>
                      </TableCell>

                      {(() => {
                        const catId = p.category_id ?? p.clients?.category_id ?? null;
                        const catName = normalizeText(
                          catId ? categories.find((c) => c.id === catId)?.name ?? "" : ""
                        );
                        const isDebitMensalista =
                          catName === "mensalista" &&
                          p.to_account === true &&
                          p.account_direction === "debito";
                        const isCreditMensalistaOuGympass =
                          (catName === "mensalista" || catName === "credito gympass" || catName === "estorno") &&
                          p.to_account === true &&
                          p.account_direction === "credito";
                        const colorClass = isDebitMensalista
                          ? "text-destructive"
                          : isCreditMensalistaOuGympass
                          ? "text-blue-600 dark:text-blue-400"
                          : "";
                        return (
                          <TableCell className={`text-right font-medium ${colorClass}`}>
                            {fmtBRL(p.amount)}
                            {Number(p.passthrough_amount ?? 0) > 0 && (
                              <div className="text-xs text-muted-foreground font-normal">
                                − {fmtBRL(Number(p.passthrough_amount))} outro CNPJ
                              </div>
                            )}
                          </TableCell>
                        );
                      })()}
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex flex-col leading-tight">
                          <span>{p.profiles?.full_name ?? "—"}</span>
                          {p.updater && p.updated_at && (
                            <span className="text-xs text-warning-foreground/80">
                              editado por {p.updater.full_name}
                              {" · "}
                              {fmtDateTime(p.updated_at)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 items-center">
                          {isAE ? (
                            p.client_id ? (
                              <Link
                                to="/clientes/$clientId"
                                params={{ clientId: p.client_id }}
                                className="text-xs text-primary hover:underline"
                                title={p.notes ?? "Abrir extrato do cliente"}
                              >
                                ver extrato
                              </Link>
                            ) : null
                          ) : (<>

                          {paymentsWithReceipt.has(p.id) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Abrir comprovante anexado"
                              aria-label="Abrir comprovante anexado"
                              onClick={async () => {
                                const path = receiptPathsByPayment[p.id];
                                if (!path) {
                                  toast.error("Comprovante não encontrado.");
                                  return;
                                }
                                const { data, error } = await supabase.storage
                                  .from("payment-receipts")
                                  .createSignedUrl(path, 60 * 5);
                                if (error || !data?.signedUrl) {
                                  toast.error("Não foi possível abrir o comprovante.");
                                  return;
                                }
                                window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <Paperclip className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                          {p.client_id && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Enviar WhatsApp"
                              onClick={() => {
                                const cid = p.client_id as string;
                                const catName = categories.find((c) => c.id === p.category_id)?.name ?? null;
                                void sendWhatsAppPaymentNotification({
                                  clientId: cid,
                                  amount: Number(p.amount) || 0,
                                  accountDirection: p.account_direction,
                                  paidAt: p.paid_at,
                                  startTime: p.start_time,
                                  categoryName: catName,
                                });
                                markClientNotified(cid);
                              }}
                            >
                              <MessageCircle className="h-4 w-4 text-green-600" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDelete(p.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          </>)}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  };


                  if (!groupByCourt) {
                    return <TableBody>{visiblePayments.map(renderRow)}</TableBody>;
                  }

                  // Group rows by court (null/undefined → "Sem quadra"), preserving sort order within group
                  const groups = new Map<string, PaymentRow[]>();
                  for (const p of visiblePayments) {
                    const key = p.court != null ? String(p.court) : "none";
                    const arr = groups.get(key) ?? [];
                    arr.push(p);
                    groups.set(key, arr);
                  }
                  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    if (a === "none") return 1;
                    if (b === "none") return -1;
                    return Number(a) - Number(b);
                  });

                  return (
                    <TableBody>
                      {sortedKeys.map((key) => {
                        const rows = groups.get(key)!;
                        const subtotal = rows.reduce((s, r) => (isSaldoAnt(r) || isAccountEntryRow(r) ? s : s + effectiveAmount(r)), 0);
                        const label = key === "none" ? "Sem quadra" : `Quadra ${key}`;
                        return (
                          <Fragment key={`grp-${key}`}>
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableCell colSpan={8} className="font-semibold text-sm">
                                {label} · {rows.length} lançamento(s)
                              </TableCell>
                              <TableCell className="text-right font-semibold text-sm">
                                {fmtBRL(subtotal)}
                              </TableCell>
                              <TableCell colSpan={2} />
                            </TableRow>
                            {rows.map(renderRow)}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  );
                })()}
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar pagamento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            {renderFormFields(editForm, setEditForm, false)}
            <div className="flex justify-end">
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar alterações
              </Button>
            </div>
            {renderObservations(editForm, setEditForm)}
          </form>
        </DialogContent>
      </Dialog>

      <ClientDialog
        open={newClientOpen}
        onOpenChange={setNewClientOpen}
        editing={null}
        canDelete={false}
        onSaved={async (newId) => {
          await Promise.all([loadReferenceData(), loadAll(filterDate, dateMode)]);
          if (newId) {
            if (newClientTarget === "create") {
              setForm((f) => ({ ...f, clientIds: [...f.clientIds, newId] }));
            } else {
              setEditForm((f) => ({ ...f, clientId: newId }));
            }
          }
        }}
      />
    </div>
  );
}

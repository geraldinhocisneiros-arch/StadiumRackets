import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtBRL, todayISO } from "@/lib/format";
import {
  describeEntryText,
  monthSummaryOf,
  runningBalances,
} from "@/lib/extrato";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import {
  ArrowLeft,
  ArrowLeftRight,
  Download,
  Eye,
  FileDown,
  Loader2,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ClientDialog } from "@/routes/clientes";
import { buildWhatsAppUrl, logWhatsAppSent, openWhatsApp } from "@/lib/whatsapp";
import { ClientPortalAccess } from "@/components/ClientPortalAccess";
import { ClientSchedulesCard } from "@/components/ClientSchedulesCard";
import { ClientAttendanceCard } from "@/components/ClientAttendanceCard";
import { ClientRentalHistoryCard } from "@/components/ClientRentalHistoryCard";
import { ClientAvatar } from "@/components/ClientAvatar";
import { MonthEndProjectionButton } from "@/components/MonthEndProjectionButton";
import { TENNIS_CLASS_LABELS, formatBirthday } from "@/lib/tennisClass";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { fetchAll } from "@/lib/fetchAll";
import { PAYMENT_METHOD_LABELS as METHOD_LABELS } from "@/lib/payment-methods";
import { courtShort } from "@/lib/court-map";

export const Route = createFileRoute("/clientes/$clientId")({
  component: ClientDetailPage,
});

interface ClientInfo {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  due_day: number | null;
  active: boolean;
  financial_responsible: string | null;
  category_id: string | null;
  is_gympass: boolean;
  notes: string | null;
  default_discount_percent: number | null;
  teacher_id: string | null;
  birth_day: number | null;
  birth_month: number | null;
  tennis_class: string | null;
  custom_amount: number | null;
}
interface Entry {
  id: string;
  entry_type: "debito" | "credito";
  amount: number;
  description: string;
  entry_date: string;
  payment_id: string | null;
  created_at: string;
  bucket?: string | null;
}
interface PaymentHist {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
  start_time: string | null;
  end_time: string | null;
  court: number | null;
  received: boolean;
  to_account: boolean;
  notes: string | null;
}


function fmtDateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function ClientDetailPage() {
  const { clientId } = useParams({ from: "/clientes/$clientId" });
  const navigate = useNavigate();
  const { user, isAdmin, isRecepcionista, isDiretoria } = useAuth();
  const canManage = isAdmin || isRecepcionista;
  const canUseMonthEndProjection = isAdmin || isRecepcionista || isDiretoria;
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryCategories, setEntryCategories] = useState<Record<string, string>>({});
  const [entryCourts, setEntryCourts] = useState<Record<string, number | null>>({});
  const [entryStartTimes, setEntryStartTimes] = useState<Record<string, string | null>>({});
  const [entryEndTimes, setEntryEndTimes] = useState<Record<string, string | null>>({});
  const [paymentHist, setPaymentHist] = useState<PaymentHist[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [viewing, setViewing] = useState<Entry | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("all"); // "all" | "YYYY-MM"
  const [paymentMonthFilter, setPaymentMonthFilter] = useState<string>("all");
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [responsibleClientId, setResponsibleClientId] = useState<string | null>(null);
  const [dependents, setDependents] = useState<Array<{ id: string; full_name: string }>>([]);
  const [dependentEntries, setDependentEntries] = useState<Record<string, Entry[]>>({});
  const [pdfRangeOpen, setPdfRangeOpen] = useState(false);
  const [pdfMode, setPdfMode] = useState<"download" | "whatsapp">("download");
  const [pdfFrom, setPdfFrom] = useState<string>("");
  const [pdfTo, setPdfTo] = useState<string>("");
  const [debtLimitExcepted, setDebtLimitExcepted] = useState(false);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const [cli, ent, pays] = await Promise.all([
      (supabase as any)
        .from("clients")
        .select(
          "id, full_name, phone, email, due_day, active, financial_responsible, category_id, is_gympass, notes, default_discount_percent, teacher_id, profile_photo_path, profile_photo_updated_at, birth_day, birth_month, tennis_class, custom_amount",
        )
        .eq("id", clientId)
        .maybeSingle(),
      supabase
        .from("account_entries")
        .select("id, entry_type, amount, description, entry_date, payment_id, created_at, bucket")
        .eq("client_id", clientId)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select(
          "id, amount, method, paid_at, start_time, end_time, court, received, to_account, notes, category_id",
        )
        .eq("client_id", clientId)
        .order("paid_at", { ascending: false }),
    ]);
    const clientData = (cli.data ?? null) as ClientInfo | null;
    setClient(clientData);
    if (clientData?.financial_responsible) {
      const { data: match } = await supabase
        .from("clients")
        .select("id")
        .ilike("full_name", clientData.financial_responsible.trim())
        .maybeSingle();
      setResponsibleClientId(match?.id ?? null);
    } else {
      setResponsibleClientId(null);
    }
    if (clientData?.full_name) {
      const { data: deps } = await supabase
        .from("clients")
        .select("id, full_name")
        .ilike("financial_responsible", clientData.full_name.trim())
        .neq("id", clientId)
        .order("full_name");
      const depsList = (deps ?? []) as Array<{ id: string; full_name: string }>;
      setDependents(depsList);
      if (depsList.length > 0) {
        const { data: depEntries } = await supabase
          .from("account_entries")
          .select(
            "id, client_id, entry_type, amount, description, entry_date, payment_id, created_at",
          )
          .in(
            "client_id",
            depsList.map((d) => d.id),
          )
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false });
        const grouped: Record<string, Entry[]> = {};
        (depEntries ?? []).forEach((row: any) => {
          if (!grouped[row.client_id]) grouped[row.client_id] = [];
          grouped[row.client_id].push(row as Entry);
        });
        setDependentEntries(grouped);
      } else {
        setDependentEntries({});
      }
    } else {
      setDependents([]);
      setDependentEntries({});
    }
    const entriesData = (ent.data ?? []) as Entry[];
    const paymentsData = (pays.data ?? []) as (PaymentHist & { category_id: string | null })[];

    // Fetch payment details for entries that came from payments
    const paymentIds = entriesData.map((e) => e.payment_id).filter(Boolean) as string[];
    const catMap: Record<string, string> = {};
    const courtMap: Record<string, number | null> = {};
    const startMap: Record<string, string | null> = {};
    const endMap: Record<string, string | null> = {};
    if (paymentIds.length > 0) {
      const { data: payRows } = await supabase
        .from("payments")
        .select("id, category_id, court, start_time, end_time")
        .in("id", paymentIds);

      const categoryIds = [
        ...new Set((payRows ?? []).map((p) => p.category_id).filter(Boolean) as string[]),
      ];
      const categoriesById: Record<string, string> = {};
      if (categoryIds.length > 0) {
        const { data: categoryRows } = await supabase
          .from("client_categories")
          .select("id, name")
          .in("id", categoryIds);
        (categoryRows ?? []).forEach((category) => {
          categoriesById[category.id] = category.name;
        });
      }

      (payRows ?? []).forEach((p) => {
        if (p.category_id && categoriesById[p.category_id])
          catMap[p.id] = categoriesById[p.category_id];
        courtMap[p.id] = p.court ?? null;
        startMap[p.id] = p.start_time ?? null;
        endMap[p.id] = p.end_time ?? null;
      });
    }
    setEntryCategories(catMap);
    setEntryCourts(courtMap);
    setEntryStartTimes(startMap);
    setEntryEndTimes(endMap);
    setEntries(entriesData);
    setPaymentHist(paymentsData);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    (supabase as any)
      .rpc("debt_limit_is_client_excepted", { _client_id: clientId })
      .then(({ data }: { data: boolean | null }) => {
        if (alive) setDebtLimitExcepted(!!data);
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const balance = entries.reduce(
    (s, e) => s + (e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount)),
    0,
  );

  const { sorted: sortedEntriesAsc, map: runningBalanceById } = useMemo(
    () => runningBalances(entries),
    [entries],
  );
  const describeEntry = (e: Entry) =>
    describeEntryText(
      e.description,
      e.payment_id
        ? {
            category: entryCategories[e.payment_id],
            court: entryCourts[e.payment_id],
            start_time: entryStartTimes[e.payment_id],
            end_time: entryEndTimes[e.payment_id],
          }
        : undefined,
    );

  const availableMonths = Array.from(new Set(entries.map((e) => e.entry_date.slice(0, 7)))).sort(
    (a, b) => b.localeCompare(a),
  );

  const filteredEntries =
    monthFilter === "all" ? entries : entries.filter((e) => e.entry_date.startsWith(monthFilter));

  // Resumo do mês filtrado, no formato de fatura: o que veio do mês
  // anterior, o que foi cobrado, o que entrou e como fechou.
  const monthSummary = monthFilter === "all" ? null : monthSummaryOf(entries, monthFilter);

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    const names = [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ];
    return `${names[Number(m) - 1]}/${y}`;
  };

  // YYYY-MM no fuso de Recife
  const ymInRecife = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Recife",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    return `${y}-${m}`;
  };

  const availablePaymentMonths = Array.from(
    new Set(paymentHist.map((p) => ymInRecife(p.paid_at))),
  ).sort((a, b) => b.localeCompare(a));

  const filteredPayments =
    paymentMonthFilter === "all"
      ? paymentHist
      : paymentHist.filter((p) => ymInRecife(p.paid_at) === paymentMonthFilter);

  const stats = useMemo(() => {
    const fmtAvg = (days: number | null) => {
      if (days == null) return "—";
      if (days < 1) return "menos de 1 dia";
      if (days < 30) return `${Math.round(days)} ${Math.round(days) === 1 ? "dia" : "dias"}`;
      const months = days / 30;
      if (months < 2) return `cerca de 1 mês (${Math.round(days)} dias)`;
      return `cerca de ${months.toFixed(1)} meses (${Math.round(days)} dias)`;
    };
    const dayDiff = (a: string, b: string) =>
      Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

    // Sort entries oldest first
    const sorted = [...entries].sort((a, b) =>
      a.entry_date === b.entry_date
        ? a.created_at.localeCompare(b.created_at)
        : a.entry_date.localeCompare(b.entry_date),
    );

    // 1) Frequência de aportes (créditos)
    const creditDates = sorted.filter((e) => e.entry_type === "credito").map((e) => e.entry_date);
    let avgDepositGap: number | null = null;
    const depositCount = creditDates.length;
    if (creditDates.length >= 2) {
      let total = 0;
      for (let i = 1; i < creditDates.length; i++)
        total += dayDiff(creditDates[i], creditDates[i - 1]);
      avgDepositGap = total / (creditDates.length - 1);
    }

    // 2) Tempo para gastar crédito positivo / 3) Tempo para quitar saldo negativo
    let running = 0;
    let prev = 0;
    let positiveStart: string | null = null;
    let negativeStart: string | null = null;
    const positiveDurations: number[] = [];
    const negativeDurations: number[] = [];

    for (const e of sorted) {
      const delta = e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
      running += delta;

      // Positive period closed (became <= 0)
      if (prev > 0 && running <= 0 && positiveStart) {
        positiveDurations.push(dayDiff(e.entry_date, positiveStart));
        positiveStart = null;
      }
      // Negative period closed (became >= 0)
      if (prev < 0 && running >= 0 && negativeStart) {
        negativeDurations.push(dayDiff(e.entry_date, negativeStart));
        negativeStart = null;
      }
      // Positive period opened (was <= 0, now > 0)
      if (prev <= 0 && running > 0 && !positiveStart) {
        positiveStart = e.entry_date;
      }
      // Negative period opened (was >= 0, now < 0)
      if (prev >= 0 && running < 0 && !negativeStart) {
        negativeStart = e.entry_date;
      }

      prev = running;
    }

    const avg = (arr: number[]) =>
      arr.length === 0 ? null : arr.reduce((s, n) => s + n, 0) / arr.length;

    return {
      depositCount,
      avgDepositGap,
      avgDepositGapLabel: fmtAvg(avgDepositGap),
      positiveCount: positiveDurations.length,
      avgPositiveLabel: fmtAvg(avg(positiveDurations)),
      negativeCount: negativeDurations.length,
      avgNegativeLabel: fmtAvg(avg(negativeDurations)),
      openPositive: positiveStart,
      openNegative: negativeStart,
    };
  }, [entries]);

  const handleDelete = async (id: string) => {
    if (!(await confirm("Excluir este lançamento?"))) return;
    const { error } = await supabase.from("account_entries").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Lançamento removido.");
      load();
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!(await confirm("Excluir este pagamento? Esta ação não pode ser desfeita."))) return;
    // Remove related account entries first (to avoid orphan FKs / wrong balance)
    await supabase.from("account_entries").delete().eq("payment_id", id);
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Pagamento removido.");
      load();
    }
  };

  const generatePDF = (download = true, range?: { from?: string; to?: string }): jsPDF => {
    const from = range?.from || "";
    const to = range?.to || "";
    const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
    const periodLabel =
      from && to
        ? `Período: ${fmtDateBR(from)} a ${fmtDateBR(to)}`
        : from
          ? `Período: a partir de ${fmtDateBR(from)}`
          : to
            ? `Período: até ${fmtDateBR(to)}`
            : "Período: completo";

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Extrato — Conta corrente", 14, 18);
    doc.setFontSize(11);
    doc.text(`Cliente: ${client?.full_name ?? ""}`, 14, 28);
    let headerY = 34;
    if (client?.phone) {
      doc.text(`Telefone: ${client.phone}`, 14, headerY);
      headerY += 6;
    }
    doc.text(`Emitido em: ${fmtDateBR(todayISO())}`, 14, headerY);
    headerY += 6;
    doc.text(periodLabel, 14, headerY);
    headerY += 6;


    const sortedAll = sortedEntriesAsc;
    let opening = 0;
    if (from) {
      for (const e of sortedAll) {
        if (e.entry_date < from) {
          opening += e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
        }
      }
    }
    const inPeriod = sortedAll.filter((e) => inRange(e.entry_date));
    let run = opening;
    let periodDebits = 0;
    let periodCredits = 0;
    const rows: string[][] = [];
    if (from) {
      rows.push([fmtDateBR(from), "Saldo que veio do período anterior", "", "", fmtBRL(opening)]);
    }
    for (const e of inPeriod) {
      const amt = Number(e.amount);
      if (e.entry_type === "credito") {
        run += amt;
        periodCredits += amt;
      } else {
        run -= amt;
        periodDebits += amt;
      }
      rows.push([
        fmtDateBR(e.entry_date),
        describeEntry(e),
        e.entry_type === "debito" ? `-${fmtBRL(amt)}` : "",
        e.entry_type === "credito" ? `+${fmtBRL(amt)}` : "",
        fmtBRL(run),
      ]);
    }
    let finalY = headerY;
    autoTable(doc, {
      startY: finalY,
      head: [["Data", "O que foi", "Cobrança", "Pagamento / crédito", "Saldo"]],
      body: rows.length ? rows : [["—", "Sem lançamentos no período", "", "", ""]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [34, 84, 61] },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
      },
    });
    finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // Resumo do período, como uma fatura
    doc.setFontSize(10);
    if (from) {
      doc.text(`Saldo que veio do período anterior: ${fmtBRL(opening)}`, 14, finalY);
      finalY += 5;
    }
    doc.text(`Cobranças no período: -${fmtBRL(periodDebits)}`, 14, finalY);
    finalY += 5;
    doc.text(`Pagamentos / créditos no período: +${fmtBRL(periodCredits)}`, 14, finalY);
    finalY += 7;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    if (run < 0) doc.setTextColor(180, 0, 0);
    else if (run > 0) doc.setTextColor(0, 120, 0);
    doc.text(
      run < 0
        ? `Saldo devedor: ${fmtBRL(Math.abs(run))}`
        : run > 0
          ? `Saldo a favor: ${fmtBRL(run)}`
          : "Saldo: zerado",
      14,
      finalY,
    );
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    finalY += 6;
    doc.setFontSize(11);
    finalY += 2;

    // Dependents sections
    for (const dep of dependents) {
      const allDepEntries = dependentEntries[dep.id] ?? [];
      const depEntries = allDepEntries.filter((e) => inRange(e.entry_date));
      if (depEntries.length === 0) continue;
      const depSorted = [...depEntries].sort((a, b) => {
        const d = a.entry_date.localeCompare(b.entry_date);
        if (d !== 0) return d;
        if (a.entry_type === b.entry_type) return 0;
        return a.entry_type === "credito" ? -1 : 1;
      });
      // Saldo anterior do dependente
      let depOpening = 0;
      if (from) {
        for (const e of allDepEntries) {
          if (e.entry_date < from) {
            depOpening += e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
          }
        }
      }
      let depRunning = depOpening;
      const depRows: (string | number)[][] = [];
      if (from && depOpening !== 0) {
        depRows.push([
          fmtDateBR(from),
          `Saldo anterior a ${fmtDateBR(from)}`,
          "",
          "",
          fmtBRL(depOpening),
        ]);
      }
      for (const e of depSorted) {
        const delta = e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
        depRunning += delta;
        depRows.push([
          fmtDateBR(e.entry_date),
          e.description,
          e.entry_type === "debito" ? `-${fmtBRL(Number(e.amount))}` : "",
          e.entry_type === "credito" ? fmtBRL(Number(e.amount)) : "",
          fmtBRL(depRunning),
        ]);
      }
      doc.setFontSize(12);
      doc.text(`Dependente: ${dep.full_name}`, 14, finalY + 4);
      autoTable(doc, {
        startY: finalY + 8,
        head: [["Data", "Descrição", "Débito", "Crédito", "Saldo"]],
        body: depRows,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [34, 84, 61] },
      });
      finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.setFontSize(11);
      const depLabel =
        depRunning < 0 ? "Saldo devedor:" : depRunning > 0 ? "Saldo a favor:" : "Saldo:";
      doc.text(`${depLabel} ${fmtBRL(Math.abs(depRunning))}  (${dep.full_name})`, 14, finalY);
      finalY += 8;
    }

    if (download) {
      doc.save(`extrato-${client?.full_name?.replace(/\s+/g, "_") ?? "cliente"}.pdf`);
    }
    return doc;
  };

  const sendWhatsApp = (range?: { from?: string; to?: string }) => {
    if (!client?.phone) {
      toast.error("Cliente sem telefone cadastrado.");
      return;
    }
    // generate PDF for download too
    generatePDF(true, range);
    const phoneDigits = client.phone.replace(/\D/g, "");
    const number = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
    const balLabel =
      balance < 0 ? "está devendo" : balance > 0 ? "tem saldo a favor de" : "está com saldo zerado";
    const msg = `Olá ${client.full_name}, segue o extrato da sua conta corrente. Atualmente você ${balLabel} ${fmtBRL(Math.abs(balance))}.`;
    openWhatsApp(buildWhatsAppUrl(number, msg));
    void logWhatsAppSent(client.id, "extrato");
    toast.info("PDF baixado. Anexe-o à conversa do WhatsApp aberta.");
  };

  const openPdfRange = (mode: "download" | "whatsapp") => {
    if (mode === "whatsapp" && !client?.phone) {
      toast.error("Cliente sem telefone cadastrado.");
      return;
    }
    setPdfMode(mode);
    setPdfFrom("");
    setPdfTo("");
    setPdfRangeOpen(true);
  };

  const confirmPdfRange = () => {
    if (pdfFrom && pdfTo && pdfFrom > pdfTo) {
      toast.error("A data inicial deve ser anterior ou igual à data final.");
      return;
    }
    const range = { from: pdfFrom || undefined, to: pdfTo || undefined };
    setPdfRangeOpen(false);
    if (pdfMode === "download") generatePDF(true, range);
    else sendWhatsApp(range);
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">Carregando...</div>;
  if (!client)
    return <div className="py-12 text-center text-muted-foreground">Cliente não encontrado.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              navigate({ to: "/clientes" });
            }
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <ClientAvatar
            clientId={client.id}
            name={client.full_name}
            path={(client as any).profile_photo_path ?? null}
            updatedAt={(client as any).profile_photo_updated_at ?? null}
            size={72}
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{client.full_name}</h1>
            <p className="text-muted-foreground text-sm">
              {client.phone ?? "Sem telefone"} {client.email ? `• ${client.email}` : ""}{" "}
              {client.due_day ? `• Vencimento dia ${client.due_day}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => openPdfRange("download")}>
            <FileDown className="h-4 w-4 mr-2" /> Baixar PDF
          </Button>
          <Button variant="outline" onClick={() => openPdfRange("whatsapp")}>
            <MessageCircle className="h-4 w-4 mr-2" /> Enviar no WhatsApp
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Dados cadastrais</CardTitle>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditClientOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Editar
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Nome completo</div>
            <div className="font-medium">{client.full_name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Telefone</div>
            <div className="font-medium">{client.phone ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">E-mail</div>
            <div className="font-medium">{client.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Dia de vencimento</div>
            <div className="font-medium">{client.due_day ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Aniversário</div>
            <div className="font-medium">
              {formatBirthday(client.birth_day, client.birth_month)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Classe no tênis</div>
            <div className="font-medium">
              {client.tennis_class
                ? ((TENNIS_CLASS_LABELS as any)[client.tennis_class] ?? client.tennis_class)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Responsável financeiro</div>
            <div className="font-medium">
              {client.financial_responsible ? (
                responsibleClientId ? (
                  <Link
                    to="/clientes/$clientId"
                    params={{ clientId: responsibleClientId }}
                    className="text-primary hover:underline"
                  >
                    {client.financial_responsible}
                  </Link>
                ) : (
                  client.financial_responsible
                )
              ) : (
                "—"
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="font-medium">{client.active ? "Ativo" : "Inativo"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Gympass</div>
            <div className="font-medium">
              {client.is_gympass ? (
                <Badge className="bg-purple-600 hover:bg-purple-600 text-white">Sim</Badge>
              ) : (
                "Não"
              )}
            </div>
            {debtLimitExcepted && (
              <div>
                <div className="text-xs text-muted-foreground">Exceção</div>
                <div className="font-medium">
                  <Badge className="bg-amber-600 hover:bg-amber-600 text-white">
                    Na lista de exceções
                  </Badge>
                </div>
              </div>
            )}
            {client.notes && (
              <div className="sm:col-span-2">
                <div className="text-xs text-muted-foreground">Observação (interna)</div>
                <div className="font-medium whitespace-pre-wrap">{client.notes}</div>
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground">Responsável financeiro de</div>
            <div className="font-medium">
              {dependents.length > 0 ? (
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {dependents.map((d, i) => (
                    <span key={d.id}>
                      <Link
                        to="/clientes/$clientId"
                        params={{ clientId: d.id }}
                        className="text-primary hover:underline"
                      >
                        {d.full_name}
                      </Link>
                      {i < dependents.length - 1 ? "," : ""}
                    </span>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <ClientPortalAccess
        clientId={client.id}
        clientName={client.full_name}
        clientEmail={client.email ?? null}
        clientPhone={client.phone ?? null}
        canManage={canManage}
      />

      <ClientSchedulesCard
        clientId={client.id}
        categoryId={client.category_id}
        canManage={canManage}
      />

      <ClientAttendanceCard clientId={client.id} />

      <ClientRentalHistoryCard clientId={client.id} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo atual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                balance < 0 ? "text-destructive" : balance > 0 ? "text-success" : ""
              }`}
            >
              {fmtBRL(balance)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {balance < 0
                ? "Cliente está devendo"
                : balance > 0
                  ? "Cliente tem crédito"
                  : "Conta zerada"}
            </p>
          </CardContent>
        </Card>
      </div>



      {canUseMonthEndProjection && client && <MonthEndProjectionButton clientId={client.id} />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Extrato</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder="Filtrar por mês" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <ArrowLeftRight className="h-4 w-4 mr-1" /> Transferir
                </Button>
              </DialogTrigger>
              <TransferEntryDialog
                open={transferOpen}
                sourceClient={client}
                userId={user?.id ?? null}
                onClose={() => setTransferOpen(false)}
                onSaved={load}
              />
            </Dialog>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Novo lançamento
                </Button>
              </DialogTrigger>
              <NewEntryDialog
                clientId={client.id}
                userId={user?.id ?? null}
                onClose={() => setOpen(false)}
                onSaved={load}
              />
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {monthSummary && (
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <span>
                Veio do mês anterior:{" "}
                <span className="font-medium">{fmtBRL(monthSummary.opening)}</span>
              </span>
              <span>
                Cobranças:{" "}
                <span className="font-medium text-destructive">-{fmtBRL(monthSummary.debits)}</span>
              </span>
              <span>
                Pagamentos / créditos:{" "}
                <span className="font-medium text-success">+{fmtBRL(monthSummary.credits)}</span>
              </span>
              <span>
                Fechou o mês em:{" "}
                <span
                  className={`font-semibold ${
                    monthSummary.closing < 0
                      ? "text-destructive"
                      : monthSummary.closing > 0
                        ? "text-success"
                        : ""
                  }`}
                >
                  {fmtBRL(monthSummary.closing)}
                </span>
              </span>
            </div>
          )}
          {filteredEntries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {entries.length === 0 ? "Nenhum lançamento ainda." : "Nenhum lançamento neste mês."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>O que foi</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    {canManage && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">{fmtDateBR(e.entry_date)}</TableCell>
                      <TableCell>{describeEntry(e)}</TableCell>
                      <TableCell>
                        {e.entry_type === "debito" ? (
                          <Badge variant="destructive">Cobrança</Badge>
                        ) : (
                          <Badge className="bg-success text-success-foreground">
                            Pagamento / crédito
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          e.entry_type === "debito" ? "text-destructive" : "text-success"
                        }`}
                      >
                        {e.entry_type === "debito" ? "-" : "+"}
                        {fmtBRL(Number(e.amount))}
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm ${
                          (runningBalanceById[e.id] ?? 0) < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {fmtBRL(runningBalanceById[e.id] ?? 0)}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewing(e)}
                              title="Ver detalhes"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (e.payment_id) {
                                  navigate({
                                    to: "/caixa",
                                    search: { editPayment: e.payment_id },
                                  });
                                } else {
                                  setEditing(e);
                                }
                              }}
                              title={
                                e.payment_id ? "Editar registro de pagamento" : "Editar lançamento"
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(e.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {dependents.map((dep) => {
        const depEntries = dependentEntries[dep.id] ?? [];
        if (depEntries.length === 0) return null;
        const depBalance = depEntries.reduce(
          (s, e) => s + (e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount)),
          0,
        );
        return (
          <Card key={dep.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>Extrato — {dep.full_name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Dependente financeiro de {client.full_name}
                </p>
              </div>
              <div
                className={`text-lg font-semibold ${
                  depBalance < 0 ? "text-destructive" : depBalance > 0 ? "text-success" : ""
                }`}
              >
                {fmtBRL(depBalance)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {depEntries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">{fmtDateBR(e.entry_date)}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell>
                          {e.entry_type === "debito" ? (
                            <Badge variant="destructive">Débito</Badge>
                          ) : (
                            <Badge className="bg-success text-success-foreground">Crédito</Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            e.entry_type === "debito" ? "text-destructive" : "text-success"
                          }`}
                        >
                          {e.entry_type === "debito" ? "-" : "+"}
                          {fmtBRL(Number(e.amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Histórico de pagamentos</CardTitle>
          <Select value={paymentMonthFilter} onValueChange={setPaymentMonthFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Filtrar por mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {availablePaymentMonths.map((m) => (
                <SelectItem key={m} value={m}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {filteredPayments.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {paymentHist.length === 0
                ? "Nenhum pagamento registrado."
                : "Nenhum pagamento neste mês."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Quadra</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Término</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">
                        {new Date(p.paid_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        {p.court ? (
                          <Badge variant="outline">{courtShort(p.court)}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{p.start_time?.slice(0, 5) ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.end_time?.slice(0, 5) ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{METHOD_LABELS[p.method] ?? p.method}</Badge>
                      </TableCell>
                      <TableCell>
                        {p.received ? (
                          <Badge>Recebido</Badge>
                        ) : (
                          <Badge variant="outline">Pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtBRL(Number(p.amount))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeletePayment(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ReceiptsCard clientId={client.id} userId={user?.id ?? null} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle>Comportamento financeiro do cliente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Frequência de aportes
            </div>
            <div className="mt-2 text-2xl font-semibold">{stats.avgDepositGapLabel}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.depositCount === 0
                ? "Nenhum crédito registrado ainda."
                : stats.depositCount === 1
                  ? "Apenas 1 crédito registrado — sem intervalo para calcular."
                  : `Média entre ${stats.depositCount} aportes de crédito.`}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Tempo para gastar o crédito
            </div>
            <div className="mt-2 text-2xl font-semibold">{stats.avgPositiveLabel}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.positiveCount === 0
                ? stats.openPositive
                  ? "Cliente está com crédito atualmente — ainda não consumido."
                  : "Sem períodos de saldo positivo concluídos."
                : `Média de ${stats.positiveCount} ${stats.positiveCount === 1 ? "ciclo" : "ciclos"} de crédito consumido.${stats.openPositive ? " (período atual em aberto)" : ""}`}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Tempo para quitar saldo negativo
            </div>
            <div className="mt-2 text-2xl font-semibold">{stats.avgNegativeLabel}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.negativeCount === 0
                ? stats.openNegative
                  ? "Cliente está negativo atualmente — ainda não quitado."
                  : "Sem períodos de saldo negativo concluídos."
                : `Média de ${stats.negativeCount} ${stats.negativeCount === 1 ? "quitação" : "quitações"} de débito.${stats.openNegative ? " (saldo negativo atual em aberto)" : ""}`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <EditEntryDialog entry={editing} onClose={() => setEditing(null)} onSaved={load} />
        )}
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        {viewing && <ViewEntryDialog entry={viewing} onClose={() => setViewing(null)} />}
      </Dialog>

      <ClientDialog
        open={editClientOpen}
        onOpenChange={setEditClientOpen}
        editing={client}
        canDelete={isAdmin}
        onSaved={load}
      />

      <Dialog open={pdfRangeOpen} onOpenChange={setPdfRangeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pdfMode === "download" ? "Baixar extrato em PDF" : "Enviar extrato no WhatsApp"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione o período do extrato. Deixe em branco para incluir tudo.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pdf-from">Data inicial</Label>
                <Input
                  id="pdf-from"
                  type="date"
                  value={pdfFrom}
                  onChange={(e) => setPdfFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pdf-to">Data final</Label>
                <Input
                  id="pdf-to"
                  type="date"
                  value={pdfTo}
                  onChange={(e) => setPdfTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfRangeOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmPdfRange}>
              {pdfMode === "download" ? "Baixar PDF" : "Gerar e enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewEntryDialog({
  clientId,
  userId,
  onClose,
  onSaved,
}: {
  clientId: string;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<"debito" | "credito">("debito");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Busca o usuário logado agora (não o do contexto, que pode estar
    // desatualizado num computador compartilhado onde outro recepcionista
    // acabou de trocar de sessão no mesmo navegador).
    const { data: freshUserData } = await supabase.auth.getUser();
    const { error } = await supabase.from("account_entries").insert({
      client_id: clientId,
      entry_type: type,
      amount: Number(amount),
      description,
      entry_date: date,
      recorded_by: freshUserData.user?.id ?? userId,
    });
    setSubmitting(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Lançamento registrado!");
      setAmount("");
      setDescription("");
      onClose();
      onSaved();
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Novo lançamento na conta corrente</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={type} onValueChange={(v) => setType(v as "debito" | "credito")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debito">Débito (cliente passa a dever)</SelectItem>
              <SelectItem value="credito">Crédito (abate saldo / pagamento)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="amt">Valor (R$)</Label>
            <Input
              id="amt"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dt">Data</Label>
            <Input
              id="dt"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">Descrição</Label>
          <Input
            id="desc"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Aula avulsa, aluguel de quadra..."
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditEntryDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: Entry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<"debito" | "credito">(entry.entry_type);
  const [amount, setAmount] = useState(String(entry.amount));
  const [description, setDescription] = useState(entry.description);
  const [date, setDate] = useState(entry.entry_date);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase
      .from("account_entries")
      .update({
        entry_type: type,
        amount: Number(amount),
        description,
        entry_date: date,
      })
      .eq("id", entry.id);
    setSubmitting(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Lançamento atualizado!");
      onClose();
      onSaved();
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Editar lançamento</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={type} onValueChange={(v) => setType(v as "debito" | "credito")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debito">Débito (cliente passa a dever)</SelectItem>
              <SelectItem value="credito">Crédito (abate saldo / pagamento)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="eamt">Valor (R$)</Label>
            <Input
              id="eamt"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edt">Data</Label>
            <Input
              id="edt"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edesc">Descrição</Label>
          <Input
            id="edesc"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

interface Receipt {
  id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

function ReceiptsCard({
  clientId,
  userId,
  canManage,
}: {
  clientId: string;
  userId: string | null;
  canManage: boolean;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_receipts")
      .select("id, file_path, file_name, mime_type, size_bytes, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setReceipts((data ?? []) as Receipt[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [clientId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: tamanho máximo 10MB`);
          continue;
        }
        const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
        const path = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? "." + ext : ""}`;
        const { error: upErr } = await supabase.storage
          .from("payment-receipts")
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (upErr) {
          toast.error(`${file.name}: ${upErr.message}`);
          continue;
        }
        const { error: insErr } = await supabase.from("payment_receipts").insert({
          client_id: clientId,
          file_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: userId,
        });
        if (insErr) {
          await supabase.storage.from("payment-receipts").remove([path]);
          toast.error(`${file.name}: ${insErr.message}`);
        }
      }
      toast.success("Comprovante(s) anexado(s).");
      await load();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (r: Receipt) => {
    const { data, error } = await supabase.storage
      .from("payment-receipts")
      .createSignedUrl(r.file_path, 60);
    if (error || !data) {
      toast.error(error?.message ?? "Erro ao gerar link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const handleDelete = async (r: Receipt) => {
    if (!(await confirm(`Excluir o comprovante "${r.file_name}"?`))) return;
    const { error: delDb } = await supabase.from("payment_receipts").delete().eq("id", r.id);
    if (delDb) {
      toast.error(delDb.message);
      return;
    }
    await supabase.storage.from("payment-receipts").remove([r.file_path]);
    toast.success("Comprovante removido.");
    load();
  };

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-5 w-5" /> Comprovantes de pagamento
        </CardTitle>
        {canManage && (
          <div>
            <input
              id="receipt-upload"
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button
              size="sm"
              onClick={() => document.getElementById("receipt-upload")?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Anexar arquivo
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : receipts.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            Nenhum comprovante anexado.{" "}
            {canManage && 'Clique em "Anexar arquivo" para enviar do seu computador.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead className="w-32 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium break-all">{r.file_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.mime_type ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{fmtSize(r.size_bytes)}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleDownload(r)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        {canManage && (
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(r)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PaymentDetail {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
  start_time: string | null;
  end_time: string | null;
  court: number | null;
  received: boolean;
  to_account: boolean;
  account_direction: string | null;
  notes: string | null;
  category_id: string | null;
}

function ViewEntryDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [categoryName, setCategoryName] = useState<string>("");

  useEffect(() => {
    if (!entry.payment_id) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select(
          "id, amount, method, paid_at, start_time, end_time, court, received, to_account, account_direction, notes, category_id",
        )
        .eq("id", entry.payment_id!)
        .maybeSingle();
      if (data) {
        setPayment(data as PaymentDetail);
        if (data.category_id) {
          const { data: cat } = await supabase
            .from("client_categories")
            .select("name")
            .eq("id", data.category_id)
            .maybeSingle();
          setCategoryName(cat?.name ?? "");
        }
      }
      setLoading(false);
    })();
  }, [entry.payment_id]);

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Detalhes do lançamento</DialogTitle>
      </DialogHeader>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-1">
          <Row label="Data" value={fmtDateBR(entry.entry_date)} />
          <Row label="Descrição" value={entry.description} />
          <Row
            label="Tipo"
            value={
              entry.entry_type === "debito" ? (
                <Badge variant="destructive">Débito</Badge>
              ) : (
                <Badge className="bg-success text-success-foreground">Crédito</Badge>
              )
            }
          />
          <Row
            label="Valor"
            value={
              <span className={entry.entry_type === "debito" ? "text-destructive" : "text-success"}>
                {entry.entry_type === "debito" ? "-" : "+"}
                {fmtBRL(Number(entry.amount))}
              </span>
            }
          />

          {payment && (
            <>
              <div className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Registro de pagamento
              </div>
              {categoryName && <Row label="Categoria" value={categoryName} />}
              <Row label="Forma" value={METHOD_LABELS[payment.method] ?? payment.method} />
              <Row label="Valor pago" value={fmtBRL(Number(payment.amount))} />
              <Row label="Data/hora" value={new Date(payment.paid_at).toLocaleString("pt-BR")} />
              {payment.court && <Row label="Quadra" value={`${courtShort(payment.court)}`} />}
              {(payment.start_time || payment.end_time) && (
                <Row
                  label="Horário"
                  value={`${payment.start_time?.slice(0, 5) ?? "—"} → ${payment.end_time?.slice(0, 5) ?? "—"}`}
                />
              )}
              <Row
                label="Status"
                value={
                  payment.received ? (
                    <Badge>Recebido</Badge>
                  ) : (
                    <Badge variant="outline">Pendente</Badge>
                  )
                }
              />
              {payment.to_account && (
                <Row
                  label="Conta corrente"
                  value={
                    payment.account_direction === "credito"
                      ? "Crédito"
                      : payment.account_direction === "debito"
                        ? "Débito"
                        : "Sim"
                  }
                />
              )}
              {payment.notes && <Row label="Observações" value={payment.notes} />}
            </>
          )}

          {!payment && !entry.payment_id && (
            <p className="pt-3 text-xs text-muted-foreground">
              Lançamento manual — sem registro de pagamento associado.
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function TransferEntryDialog({
  open,
  sourceClient,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  sourceClient: ClientInfo;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [destId, setDestId] = useState("");
  const [kind, setKind] = useState<"credito" | "debito">("credito");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);

  // Recarrega a lista de clientes toda vez que o diálogo abre — antes só
  // buscava uma vez quando o componente montava (que fica sempre montado
  // dentro do <Dialog>, mesmo fechado), então um cliente cadastrado depois
  // que a página do cliente foi aberta não aparecia como destino até
  // recarregar a página.
  useEffect(() => {
    if (!open) return;
    void fetchAll<ClientOption & { active: boolean }>("clients", "id, full_name, active").then(
      (data) =>
        setClients(
          data
            .filter((c) => c.active && c.id !== sourceClient.id)
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
        ),
    );
  }, [open, sourceClient.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destId) {
      toast.error("Selecione o cliente de destino");
      return;
    }
    const value = Number(amount);
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    const destClient = clients.find((c) => c.id === destId);
    setSubmitting(true);
    const baseDesc = description.trim() || `Transferência de ${kind}`;
    const sourceType: "debito" | "credito" = kind === "credito" ? "debito" : "credito";
    const destType: "debito" | "credito" = kind;
    // Busca o usuário logado agora (não o do contexto, que pode estar
    // desatualizado num computador compartilhado onde outro recepcionista
    // acabou de trocar de sessão no mesmo navegador).
    const { data: freshUserData } = await supabase.auth.getUser();
    const recorderId = freshUserData.user?.id ?? userId;

    const { error: e1 } = await supabase.from("account_entries").insert({
      client_id: sourceClient.id,
      entry_type: sourceType,
      amount: value,
      description: `${baseDesc} — Transferido para ${destClient?.full_name ?? ""}`,
      entry_date: date,
      recorded_by: recorderId,
    });
    if (e1) {
      setSubmitting(false);
      toast.error(e1.message);
      return;
    }
    const { error: e2 } = await supabase.from("account_entries").insert({
      client_id: destId,
      entry_type: destType,
      amount: value,
      description: `${baseDesc} — Recebido de ${sourceClient.full_name}`,
      entry_date: date,
      recorded_by: recorderId,
    });
    setSubmitting(false);
    if (e2) {
      toast.error(`Origem lançada, mas falhou no destino: ${e2.message}`);
      return;
    }
    toast.success("Transferência realizada!");
    setAmount("");
    setDescription("");
    setDestId("");
    onClose();
    onSaved();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Transferir entre contas correntes</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Origem: <span className="font-medium text-foreground">{sourceClient.full_name}</span>
        </div>
        <div className="space-y-2">
          <Label>Tipo de transferência</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "credito" | "debito")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="credito">
                Crédito (origem perde saldo, destino ganha saldo)
              </SelectItem>
              <SelectItem value="debito">
                Débito (origem deixa de dever, destino passa a dever)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Cliente de destino</Label>
          <ClientCombobox
            clients={clients}
            value={destId}
            onChange={setDestId}
            placeholder="Buscar cliente de destino..."
            allowClear={false}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tamt">Valor (R$)</Label>
            <Input
              id="tamt"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tdt">Data</Label>
            <Input
              id="tdt"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tdesc">Descrição (opcional)</Label>
          <Input
            id="tdesc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Motivo da transferência"
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Transferir
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}


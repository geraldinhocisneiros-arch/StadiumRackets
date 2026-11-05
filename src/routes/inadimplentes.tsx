import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/format";
import { fetchAll } from "@/lib/fetchAll";
import { useUrlState } from "@/hooks/useUrlState";
import {
  AlertCircle,
  History,
  Printer,
  MessageCircle,
  Send,
  SkipForward,
  X as XIcon,
} from "lucide-react";
import { sendOverdueBalanceReminder } from "@/lib/whatsapp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { MonthEndProjectionButton } from "@/components/MonthEndProjectionButton";

export const Route = createFileRoute("/inadimplentes")({
  component: () => (
    <RequireAuth rolesAllowed={["diretoria", "recepcionista"]} debtInfo>
      <InadimplentesPage />
    </RequireAuth>
  ),
});

const INADIMPLENTES_SCROLL_KEY = "inadimplentes:scrollY";

function saveInadimplentesScrollPosition() {
  sessionStorage.setItem(INADIMPLENTES_SCROLL_KEY, String(window.scrollY));
}

function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

interface Row {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  due_day: number | null;
  financial_responsible: string | null;
  financial_responsible_id: string | null;
  balance: number;
  message_sent: boolean;
  followup_date: string | null;
  is_gympass: boolean;
  is_debt_limit_excepted: boolean;
}

interface WeekSnapshot {
  weekNum: number; // 1..5
  endDate: Date;
  totalNegative: number;
  countNegative: number;
}

interface MonthHistory {
  key: string; // YYYY-MM
  label: string; // "Maio 2025"
  weeks: WeekSnapshot[];
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function InadimplentesPage() {
  const { isAdmin, isRecepcionista, isDiretoria } = useAuth();
  const canUseMonthEndProjection = isAdmin || isRecepcionista || isDiretoria;
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<MonthHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlState<string>("q", "");
  const [letterFrom, setLetterFrom] = useUrlState<string>("letterFrom", "all");
  const [letterTo, setLetterTo] = useUrlState<string>("letterTo", "all");
  const [sortBy, setSortBy] = useUrlState<string>("sortBy", "balance_asc");
  const [followupFilter, setFollowupFilter] = useUrlState<string>("followup", "all");
  const [gympassFilter, setGympassFilter] = useUrlState<string>("gympass", "all");
  const [queueIds, setQueueIds] = useState<string[] | null>(null);
  const [queueIdx, setQueueIdx] = useState(0);

  const load = async () => {
    setLoading(true);
    const [cliAll, entries, { data: followups }, { data: exceptedIds }] = await Promise.all([
      // fetchAll em vez de select() cru: o Supabase limita seleções sem
      // paginação a 1000 linhas por padrão. Com 1181+ clientes ativos, essa
      // busca cortava silenciosamente uma parte (em ordem alfabética) da
      // lista de inadimplentes — quem ficasse depois do corte nunca
      // aparecia como devedor aqui, mesmo com saldo negativo real.
      fetchAll<{
        id: string;
        full_name: string;
        phone: string | null;
        email: string | null;
        due_day: number | null;
        financial_responsible: string | null;
        active: boolean;
        is_gympass: boolean;
      }>(
        "clients",
        "id, full_name, phone, email, due_day, financial_responsible, active, is_gympass",
      ),
      fetchAll<{ client_id: string; entry_type: string; amount: number; entry_date: string }>(
        "account_entries",
        "client_id, entry_type, amount, entry_date",
      ),
      supabase.from("client_followups" as any).select("client_id, message_sent, followup_date"),
      supabase.rpc("debt_limit_excepted_client_ids" as any),
    ]);

    const cli = cliAll
      .filter((c) => c.active)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));

    const exceptedSet = new Set((exceptedIds ?? []) as string[]);

    const balanceMap = new Map<string, number>();
    (entries ?? []).forEach((e: { client_id: string; entry_type: string; amount: number }) => {
      const cur = balanceMap.get(e.client_id) ?? 0;
      const delta = e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
      balanceMap.set(e.client_id, cur + delta);
    });

    const followupMap = new Map<string, { message_sent: boolean; followup_date: string | null }>();
    ((followups ?? []) as any[]).forEach((f) => {
      followupMap.set(f.client_id, {
        message_sent: !!f.message_sent,
        followup_date: f.followup_date ?? null,
      });
    });

    // Map normalized name -> id for resolving financial_responsible to a client link
    const nameToId = new Map<string, string>();
    cli.forEach((c) => {
      nameToId.set(normalizeText(c.full_name).trim(), c.id);
    });

    const list: Row[] = cli
      .map((c) => {
        const fu = followupMap.get(c.id);
        return {
          id: c.id,
          full_name: c.full_name,
          phone: c.phone,
          email: c.email,
          due_day: c.due_day,
          financial_responsible: c.financial_responsible,
          financial_responsible_id: c.financial_responsible
            ? (nameToId.get(normalizeText(c.financial_responsible).trim()) ?? null)
            : null,
          balance: balanceMap.get(c.id) ?? 0,
          message_sent: fu?.message_sent ?? false,
          followup_date: fu?.followup_date ?? null,
          is_gympass: !!c.is_gympass,
          is_debt_limit_excepted: exceptedSet.has(c.id),
        };
      })
      .filter((c) => c.balance < 0)
      .sort((a, b) => a.balance - b.balance);

    setRows(list);

    // Build weekly history (snapshots at end of each week of each month)
    const allEntries = (entries ?? []) as Array<{
      client_id: string;
      entry_type: string;
      amount: number;
      entry_date: string;
    }>;

    if (allEntries.length > 0) {
      // Sort by date asc
      const sorted = [...allEntries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      const minDate = new Date(sorted[0].entry_date + "T00:00:00");
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      const months: MonthHistory[] = [];
      const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      while (cursor <= today) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        // Define week boundaries within the month: 1-7, 8-14, 15-21, 22-28, 29-end
        const weekRanges = [
          [1, 7],
          [8, 14],
          [15, 21],
          [22, 28],
          [29, lastDay],
        ].filter(([s]) => s <= lastDay);

        const weeks: WeekSnapshot[] = [];
        weekRanges.forEach(([, end], idx) => {
          const realEnd = Math.min(end, lastDay);
          const endDate = new Date(year, month, realEnd, 23, 59, 59, 999);
          if (endDate < minDate) return;
          // Compute balance per client up to endDate
          const bal = new Map<string, number>();
          for (const e of sorted) {
            const ed = new Date(e.entry_date + "T00:00:00");
            if (ed > endDate) break;
            const cur = bal.get(e.client_id) ?? 0;
            const delta = e.entry_type === "credito" ? Number(e.amount) : -Number(e.amount);
            bal.set(e.client_id, cur + delta);
          }
          let totalNeg = 0;
          let countNeg = 0;
          bal.forEach((v) => {
            if (v < 0) {
              totalNeg += v;
              countNeg += 1;
            }
          });
          weeks.push({
            weekNum: idx + 1,
            endDate,
            totalNegative: totalNeg,
            countNegative: countNeg,
          });
        });

        if (weeks.length > 0) {
          months.push({
            key: `${year}-${String(month + 1).padStart(2, "0")}`,
            label: `${MONTH_NAMES[month]} ${year}`,
            weeks,
          });
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }

      // Most recent first
      months.reverse();
      setHistory(months);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading) return;

    const saved = sessionStorage.getItem(INADIMPLENTES_SCROLL_KEY);
    if (!saved) return;

    const targetY = Number(saved);
    if (!Number.isFinite(targetY)) {
      sessionStorage.removeItem(INADIMPLENTES_SCROLL_KEY);
      return;
    }

    let attempts = 0;
    const restore = () => {
      window.scrollTo({ top: targetY, behavior: "auto" });
      attempts += 1;

      if (Math.abs(window.scrollY - targetY) <= 2 || attempts >= 12) {
        sessionStorage.removeItem(INADIMPLENTES_SCROLL_KEY);
        return;
      }

      requestAnimationFrame(restore);
    };

    requestAnimationFrame(restore);
  }, [loading, rows.length]);

  const updateFollowup = async (
    clientId: string,
    patch: { message_sent?: boolean; followup_date?: string | null },
  ) => {
    const current = rows.find((r) => r.id === clientId);
    const next = {
      client_id: clientId,
      message_sent: patch.message_sent ?? current?.message_sent ?? false,
      followup_date:
        patch.followup_date !== undefined ? patch.followup_date : (current?.followup_date ?? null),
    };
    setRows((prev) =>
      prev.map((r) =>
        r.id === clientId
          ? { ...r, message_sent: next.message_sent, followup_date: next.followup_date }
          : r,
      ),
    );
    const { error } = await supabase
      .from("client_followups" as any)
      .upsert(next, { onConflict: "client_id" });
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      load();
    }
  };

  const setAllMessagesSent = async (value: boolean) => {
    const ids = filtered.map((r) => r.id);
    if (ids.length === 0) return;
    const followupMap = new Map(rows.map((r) => [r.id, r.followup_date]));

    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, message_sent: value } : r)));

    const payload = ids.map((id) => ({
      client_id: id,
      message_sent: value,
      followup_date: followupMap.get(id) ?? null,
    }));

    const chunkSize = 500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("client_followups" as any)
        .upsert(chunk, { onConflict: "client_id" });
      if (error) {
        toast.error("Erro ao salvar: " + error.message);
        load();
        return;
      }
    }
  };

  const filtered = useMemo(() => {
    const terms = normalizeText(search).split(/\s+/).filter(Boolean);
    const result = rows.filter((r) => {
      const n = normalizeText(r.full_name);
      if (terms.length > 0 && !terms.every((t) => n.includes(t))) return false;
      if (letterFrom !== "all" || letterTo !== "all") {
        const first = n.charAt(0);
        if (!first) return false;
        const from = letterFrom === "all" ? "a" : letterFrom;
        const to = letterTo === "all" ? "z" : letterTo;
        const lo = from <= to ? from : to;
        const hi = from <= to ? to : from;
        if (first < lo || first > hi) return false;
      }
      if (followupFilter !== "all") {
        const fd = r.followup_date;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
        const weekEnd = new Date(today);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`;

        if (followupFilter === "none") {
          if (fd) return false;
        } else if (followupFilter === "overdue") {
          if (!fd || fd >= todayStr) return false;
        } else if (followupFilter === "today") {
          if (fd !== todayStr) return false;
        } else if (followupFilter === "tomorrow") {
          if (fd !== tomorrowStr) return false;
        } else if (followupFilter === "week") {
          if (!fd || fd < todayStr || fd > weekEndStr) return false;
        }
      }
      if (gympassFilter !== "all") {
        if (gympassFilter === "gympass" && !r.is_gympass) return false;
        if (gympassFilter === "none" && r.is_gympass) return false;
      }
      return true;
    });
    const sorted = [...result];
    switch (sortBy) {
      case "balance_desc":
        sorted.sort((a, b) => b.balance - a.balance);
        break;
      case "name_asc":
        sorted.sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));
        break;
      case "name_desc":
        sorted.sort((a, b) => b.full_name.localeCompare(a.full_name, "pt-BR"));
        break;
      case "balance_asc":
      default:
        sorted.sort((a, b) => a.balance - b.balance);
        break;
    }
    return sorted;
  }, [rows, search, letterFrom, letterTo, sortBy, followupFilter, gympassFilter]);

  const total = useMemo(() => filtered.reduce((s, r) => s + r.balance, 0), [filtered]);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inadimplentes</h1>
          <p className="text-muted-foreground">Clientes ativos com saldo negativo na conta</p>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="text-orange-500 font-bold">*</span> = na lista de exceções — não
            cobrar automaticamente
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button
            variant="default"
            onClick={() => {
              if (filtered.length === 0) {
                toast.info("Nenhum cliente na lista filtrada.");
                return;
              }
              setQueueIds(filtered.map((r) => r.id));
              setQueueIdx(0);
            }}
          >
            <Send className="h-4 w-4" />
            Disparar WhatsApp ({filtered.length})
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Clientes negativados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{loading ? "..." : filtered.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total negativado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">
              {loading ? "..." : fmtBRL(total)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <Accordion type="single" collapsible>
          <AccordionItem value="hist" className="border-0">
            <AccordionTrigger className="px-6 py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4" />
                Histórico semanal de inadimplência
                {history.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({history.length} {history.length === 1 ? "mês" : "meses"})
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando...</div>
              ) : history.length === 0 ? (
                <div className="text-sm text-muted-foreground">Sem dados.</div>
              ) : (
                <div className="space-y-3">
                  {history.map((m) => (
                    <div key={m.key} className="rounded-md border p-3">
                      <div className="text-sm font-semibold mb-2 capitalize">{m.label}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                        {m.weeks.map((w) => (
                          <div key={w.weekNum} className="rounded bg-muted/40 px-2 py-1.5 text-xs">
                            <div className="text-muted-foreground">Semana {w.weekNum}</div>
                            <div className="font-semibold text-destructive">
                              {fmtBRL(w.totalNegative)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {w.countNegative} {w.countNegative === 1 ? "cliente" : "clientes"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
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
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balance_asc">Maior débito</SelectItem>
                <SelectItem value="balance_desc">Menor débito</SelectItem>
                <SelectItem value="name_asc">Nome (A-Z)</SelectItem>
                <SelectItem value="name_desc">Nome (Z-A)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={followupFilter} onValueChange={setFollowupFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Follow up" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os follow ups</SelectItem>
                <SelectItem value="overdue">Follow up vencido</SelectItem>
                <SelectItem value="today">Follow up hoje</SelectItem>
                <SelectItem value="tomorrow">Follow up amanhã</SelectItem>
                <SelectItem value="week">Próximos 7 dias</SelectItem>
                <SelectItem value="none">Sem follow up</SelectItem>
              </SelectContent>
            </Select>
            <Select value={gympassFilter} onValueChange={setGympassFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Gympass" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                <SelectItem value="gympass">Apenas Gympass</SelectItem>
                <SelectItem value="none">Sem Gympass</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Responsável financeiro</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="text-center">Dia venc.</TableHead>
                  <TableHead className="text-center">Gympass</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span>Msg</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => setAllMessagesSent(true)}
                        >
                          Todos
                        </button>
                        <span className="text-[10px] text-muted-foreground">|</span>
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => setAllMessagesSent(false)}
                        >
                          Nenhum
                        </button>
                      </div>
                    </div>
                  </TableHead>
                  <TableHead className="text-center">Follow up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Nenhum cliente inadimplente
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Link
                            to="/clientes/$clientId"
                            params={{ clientId: r.id }}
                            onClick={saveInadimplentesScrollPosition}
                            className="hover:underline"
                          >
                            {r.full_name}
                          </Link>
                          {r.is_debt_limit_excepted && (
                            <span
                              className="text-orange-500 font-bold"
                              title="Na lista de exceções — não cobrar automaticamente"
                            >
                              *
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 print:hidden"
                            title="Enviar WhatsApp"
                            onClick={() => sendOverdueBalanceReminder(r.id)}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.financial_responsible ? (
                          r.financial_responsible_id ? (
                            <Link
                              to="/clientes/$clientId"
                              params={{ clientId: r.financial_responsible_id }}
                              onClick={saveInadimplentesScrollPosition}
                              className="hover:underline text-foreground"
                            >
                              {r.financial_responsible}
                            </Link>
                          ) : (
                            r.financial_responsible
                          )
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {r.due_day ?? "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.is_gympass ? (
                          <span className="inline-block rounded bg-purple-600 text-white text-[10px] font-semibold px-1.5 py-0.5">
                            Gympass
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-semibold text-destructive">{fmtBRL(r.balance)}</span>
                          {canUseMonthEndProjection && (
                            <MonthEndProjectionButton clientId={r.id} iconOnly />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <Checkbox
                            checked={r.message_sent}
                            onCheckedChange={(v) =>
                              updateFollowup(r.id, { message_sent: v === true })
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="date"
                          value={r.followup_date ?? ""}
                          onChange={(e) =>
                            updateFollowup(r.id, {
                              followup_date: e.target.value || null,
                            })
                          }
                          className="h-8 w-[150px] mx-auto"
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={queueIds !== null}
        onOpenChange={(o) => {
          if (!o) {
            setQueueIds(null);
            setQueueIdx(0);
          }
        }}
      >
        <DialogContent className="max-w-md">
          {queueIds &&
            (() => {
              const total = queueIds.length;
              const done = queueIdx >= total;
              const currentId = !done ? queueIds[queueIdx] : null;
              const current = currentId ? rows.find((r) => r.id === currentId) : null;
              const advance = () => {
                if (queueIdx + 1 >= total) {
                  toast.success("Fila concluída!");
                  setQueueIds(null);
                  setQueueIdx(0);
                } else {
                  setQueueIdx(queueIdx + 1);
                }
              };
              if (done || !current) {
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>Fila concluída</DialogTitle>
                      <DialogDescription>Todos os clientes foram processados.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        onClick={() => {
                          setQueueIds(null);
                          setQueueIdx(0);
                        }}
                      >
                        Fechar
                      </Button>
                    </DialogFooter>
                  </>
                );
              }
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      Cobrança {queueIdx + 1} de {total}
                    </DialogTitle>
                    <DialogDescription>
                      Clique em <strong>Enviar</strong> para abrir a conversa do WhatsApp com a
                      mensagem pronta. Depois volte aqui e siga para o próximo.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="rounded-md border p-4 space-y-1">
                    <div className="font-semibold">
                      {current.full_name}
                      {current.is_debt_limit_excepted && (
                        <span className="text-orange-500 font-bold ml-1">*</span>
                      )}
                    </div>
                    {current.is_debt_limit_excepted && (
                      <div className="text-xs text-orange-600 font-medium">
                        Na lista de exceções — confira antes de cobrar.
                      </div>
                    )}
                    {current.financial_responsible && (
                      <div className="text-xs text-muted-foreground">
                        Responsável: {current.financial_responsible}
                      </div>
                    )}
                    <div className="text-sm">
                      Telefone:{" "}
                      <span className={current.phone ? "" : "text-destructive"}>
                        {current.phone || "sem telefone"}
                      </span>
                    </div>
                    <div className="text-sm">
                      Saldo:{" "}
                      <span className="font-semibold text-destructive">
                        {fmtBRL(current.balance)}
                      </span>
                    </div>
                  </div>
                  <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQueueIds(null);
                        setQueueIdx(0);
                      }}
                    >
                      <XIcon className="h-4 w-4" />
                      Encerrar
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={advance}>
                        <SkipForward className="h-4 w-4" />
                        Pular
                      </Button>
                      <Button
                        onClick={async () => {
                          await sendOverdueBalanceReminder(current.id);
                          advance();
                        }}
                      >
                        <Send className="h-4 w-4" />
                        Enviar
                      </Button>
                    </div>
                  </DialogFooter>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

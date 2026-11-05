import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Loader2, Plus, Trash2, ClipboardList, CalendarClock, Printer, CheckCircle2, Settings, Pencil, Search, X } from "lucide-react";
import { fetchAll } from "@/lib/fetchAll";
import { WEEKDAY_LABELS } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { FixedWaitlistCourtSettings } from "@/components/FixedWaitlistCourtSettings";
import {
  ANY_PICKLEBALL,
  TENNIS_COURT,
  avulsaCourtLabel,
  courtLabel,
  courtShort,
  fixedWaitlistCourtLabel,
  isPickleballCourt,
} from "@/lib/court-map";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export const Route = createFileRoute("/espera")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <EsperaPage />
    </RequireAuth>
  ),
});

interface WaitlistRow {
  id: string;
  client_id: string | null;
  guest_name: string | null;
  desired_date: string;
  start_time: string;
  end_time: string;
  court: number | null;
  priority: number;
  notes: string | null;
  status: string;
  created_at: string;
  source_booking_id: string | null;
  clients?: { full_name: string } | null;
}

interface FixedWaitlistRow {
  id: string;
  client_id: string | null;
  guest_name: string | null;
  desired_weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
  priority: number;
  notes: string | null;
  status: string;
  created_at: string;
  contacted_at: string | null;
  updated_at: string;
  clients?: { full_name: string } | null;
}

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

const fmtWaitingFor = (iso: string) => {
  const d = daysSince(iso);
  return d <= 0
    ? "esperando resposta desde hoje"
    : d === 1
      ? "esperando resposta há 1 dia"
      : `esperando resposta há ${d} dias`;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const statusLabel: Record<string, string> = {
  waiting: "Aguardando",
  notified: "Avisado",
  contacted: "Contatado",
  awaiting_confirmation: "Aguardando confirmação",
  fulfilled: "Efetivada",
  declined: "Recusada",
  cancelled: "Cancelada",
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  waiting: "default",
  notified: "secondary",
  contacted: "secondary",
  awaiting_confirmation: "secondary",
  fulfilled: "outline",
  declined: "destructive",
  cancelled: "destructive",
};

// Na fila fixa, "Contatado" é a vaga oferecida esperando a resposta do
// cliente: continua na fila e segura a vez.
const fixedStatusLabel: Record<string, string> = {
  ...statusLabel,
  contacted: "Aguardando confirmação",
};

function StatusBadge({
  status,
  labels = statusLabel,
}: {
  status: string;
  labels?: Record<string, string>;
}) {
  return (
    <Badge variant={statusVariant[status] ?? "outline"}>
      {labels[status] ?? status}
    </Badge>
  );
}

function EsperaPage() {
  const [listType, setListType] = useState<"avulsa" | "fixa">("avulsa");
  const [clients, setClients] = useState<ClientOption[]>([]);

  useEffect(() => {
    void fetchAll<ClientOption & { active: boolean }>("clients", "id, full_name, active")
      .then((data) =>
        setClients(
          data
            .filter((c) => c.active)
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
        ),
      );
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Lista de espera de quadras
        </h1>
        <p className="text-sm text-muted-foreground">
          Avulsa: um dia/horário específico — o próprio cliente ou professor também pode entrar
          pelo portal. Fixa: um horário semanal fixo — só a equipe pode cadastrar.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setListType("avulsa")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
            listType === "avulsa"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Avulsa
        </button>
        <button
          type="button"
          onClick={() => setListType("fixa")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5",
            listType === "fixa"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarClock className="h-4 w-4" /> Fixa
        </button>
      </div>

      {listType === "avulsa" ? (
        <AvulsaWaitlist clients={clients} />
      ) : (
        <FixaWaitlist clients={clients} />
      )}
    </div>
  );
}

function AvulsaWaitlist({ clients }: { clients: ClientOption[] }) {
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("waiting");

  const [clientId, setClientId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [court, setCourt] = useState<string>("any");
  const [priority, setPriority] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("court_waitlist")
      .select("*, clients:client_id(full_name)")
      .order("desired_date", { ascending: true })
      .order("start_time", { ascending: true });
    setRows((data ?? []) as unknown as WaitlistRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  const openAdd = () => {
    setClientId("");
    setGuestName("");
    setDate(todayISO());
    setStartTime("18:00");
    setEndTime("19:00");
    setCourt("any");
    setPriority("0");
    setNotes("");
    setAddOpen(true);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId && !guestName.trim()) {
      toast.error("Escolha um cliente ou informe um nome livre.");
      return;
    }
    if (startTime >= endTime) {
      toast.error("Horário final deve ser depois do inicial.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("court_waitlist").insert({
      client_id: clientId || null,
      guest_name: clientId ? null : guestName.trim(),
      desired_date: date,
      start_time: startTime,
      end_time: endTime,
      court: court === "pickleball" ? ANY_PICKLEBALL : court === "tenis" ? TENNIS_COURT : null,
      priority: Number(priority) || 0,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Adicionado à lista de espera.");
    setAddOpen(false);
    void load();
  };

  const remove = async (id: string) => {
    if (!(await confirm("Remover da lista de espera?"))) return;
    const { error } = await supabase.from("court_waitlist").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido.");
    void load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("court_waitlist").update({ status: status as "waiting" | "awaiting_confirmation" | "fulfilled" | "declined" | "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  };

  return (
    <>
      <div className="flex justify-end gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="waiting">Aguardando</SelectItem>
            <SelectItem value="awaiting_confirmation">Aguardando confirmação</SelectItem>
            <SelectItem value="fulfilled">Efetivadas</SelectItem>
            <SelectItem value="declined">Recusadas</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Entradas</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma entrada.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Quadra</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Obs.</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.clients?.full_name ?? r.guest_name ?? "—"}
                      {r.source_booking_id && (
                        <span
                          className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 align-middle"
                          title="Já tem outra quadra marcada — pedido de troca de horário. Entra depois de quem está sem quadra marcada."
                        >
                          troca
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{r.desired_date.split("-").reverse().join("/")}</TableCell>
                    <TableCell>{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</TableCell>
                    <TableCell>{avulsaCourtLabel(r.court)}</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {r.status !== "waiting" && (
                        <Button size="sm" variant="ghost" onClick={() => void setStatus(r.id, "waiting")}>
                          Reativar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nova entrada na lista de espera avulsa</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <div>
              <Label>Cliente</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={(id) => { setClientId(id); if (id) setGuestName(""); }}
              />
            </div>
            <div>
              <Label>Ou nome livre</Label>
              <Input
                value={guestName}
                onChange={(e) => { setGuestName(e.target.value); if (e.target.value) setClientId(""); }}
                placeholder="Nome livre (sem cadastro)"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Data desejada</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <Label>Quadra</Label>
                <Select value={court} onValueChange={setCourt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    <SelectItem value="tenis">Tênis (saibro)</SelectItem>
                    <SelectItem value="pickleball">Pickleball (qualquer quadra)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Início</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div>
                <Label>Fim</Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </div>
              <div>
                <Label>Prioridade</Label>
                <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface WaitlistPosition {
  position: number;
  total: number;
  tied: boolean;
  // Quantos de "Qualquer"/"Pickleball" estão à frente nesta quadra (só fila de quadra específica).
  genericAhead?: number;
}

const ACTIVE_WAITLIST_STATUSES = ["waiting", "notified", "contacted"];

function FixaWaitlist({ clients }: { clients: ClientOption[] }) {
  const { isDiretoria } = useAuth();
  const [rows, setRows] = useState<FixedWaitlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Quando preenchido, o diálogo de "Adicionar" funciona como edição desta linha.
  const [editTarget, setEditTarget] = useState<FixedWaitlistRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("waiting");
  const [courtFilter, setCourtFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");
  const [nameSearch, setNameSearch] = useState("");

  const [clientId, setClientId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [weekdays, setWeekdays] = useState<string[]>(["1"]);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [court, setCourt] = useState<string>("any");
  const [priority, setPriority] = useState("0");
  const [notes, setNotes] = useState("");
  // Só na edição de quem está na fila: Aguardando ⇄ Aguardando confirmação.
  const [entryStatus, setEntryStatus] = useState("waiting");
  const [saving, setSaving] = useState(false);

  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [assignTarget, setAssignTarget] = useState<FixedWaitlistRow | null>(null);
  const [assignTeacherId, setAssignTeacherId] = useState<string>("none");
  // Quadra real em que o fixo vai ser criado — a inscrição guarda só a
  // preferência (Qualquer/Tênis/Pickleball); a recepção escolhe a que vagou.
  const [assignCourt, setAssignCourt] = useState<string>("");
  const [assignValidFrom, setAssignValidFrom] = useState(todayISO());
  const [assignNotes, setAssignNotes] = useState("");
  const [assigning, setAssigning] = useState(false);
  // Inscrição → quadras livres que ela pode pegar agora (RPC
  // fixed_waitlist_free_matches): só quem está na vez de ser chamado aparece.
  // A primeira quadra da lista é a sugerida (a que menos faz falta pra quem
  // vem atrás).
  const [freeMatches, setFreeMatches] = useState<Map<string, number[]>>(new Map());
  // Quem espera num horário com quadra livre mas não foi chamado: as quadras
  // livres do horário e as que a preferência dele aceita.
  const [notCalled, setNotCalled] = useState<
    Map<string, { accepted: number[]; slotFree: number[] }>
  >(new Map());
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, mRes] = await Promise.all([
      supabase
        .from("fixed_court_waitlist")
        .select("*, clients:client_id(full_name)")
        .order("desired_weekday", { ascending: true })
        .order("start_time", { ascending: true }),
      supabase.rpc("fixed_waitlist_free_matches" as never),
    ]);
    if (error) toast.error(error.message);
    if (mRes.error) toast.error(mRes.error.message);
    setRows((data ?? []) as unknown as FixedWaitlistRow[]);
    const m = new Map<string, number[]>();
    const nc = new Map<string, { accepted: number[]; slotFree: number[] }>();
    for (const r of (mRes.data ?? []) as unknown as {
      entry_id: string;
      free_courts: number[];
      called: boolean;
      slot_free: number[];
    }[]) {
      if (r.called) m.set(r.entry_id, r.free_courts);
      else nc.set(r.entry_id, { accepted: r.free_courts, slotFree: r.slot_free });
    }
    setFreeMatches(m);
    setNotCalled(nc);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void supabase
      .from("teachers")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setTeachers((data as { id: string; name: string }[]) ?? []));
  }, [load]);

  // Posição/empate calculados dentro de cada slot (quadra+dia+horário),
  // considerando só as inscrições ainda ativas — mesma regra da RPC
  // _fixed_waitlist_position (ordem por created_at, id). Na fila de uma
  // quadra específica também concorre, no mesmo dia/horário, quem pediu
  // "Qualquer" (null) e, se a quadra é de pickleball, quem pediu
  // "Pickleball" (0): chegou antes, fica à frente. "Pickleball" e "Qualquer"
  // dividem a mesma fila entre si. A mesma pessoa em mais de uma lista conta
  // uma vez, pela inscrição mais antiga.
  const positionMap = useMemo(() => {
    const map = new Map<string, WaitlistPosition>();
    const active = rows.filter((r) => ACTIVE_WAITLIST_STATUSES.includes(r.status));
    const byArrival = (a: FixedWaitlistRow, b: FixedWaitlistRow) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
    const person = (r: FixedWaitlistRow) => r.client_id ?? r.id;
    const slotOf = (r: FixedWaitlistRow) => `${r.desired_weekday}|${r.start_time}|${r.end_time}`;
    const isGeneric = (r: FixedWaitlistRow) => r.court === null || r.court === 0;
    const groups = new Map<string, FixedWaitlistRow[]>();
    for (const r of active) {
      const key = `${r.court}|${slotOf(r)}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      const sample = arr[0];
      const slot = slotOf(sample);
      // "Pickleball" e "Qualquer" formam uma fila só (quem aceita qualquer
      // quadra também aceita pickleball).
      const merged = isGeneric(sample)
        ? [...(groups.get(`null|${slot}`) ?? []), ...(groups.get(`0|${slot}`) ?? [])]
        : [
            ...arr,
            ...(groups.get(`null|${slot}`) ?? []),
            ...(isPickleballCourt(sample.court!) ? (groups.get(`0|${slot}`) ?? []) : []),
          ];
      // Uma linha por pessoa: a inscrição mais antiga dela no pool.
      const first = new Map<string, FixedWaitlistRow>();
      for (const r of [...merged].sort(byArrival)) {
        if (!first.has(person(r))) first.set(person(r), r);
      }
      const queue = Array.from(first.values());
      for (const r of arr) {
        const anchor = first.get(person(r))!;
        const idx = queue.indexOf(anchor);
        const tied = queue.some(
          (other) => other !== anchor && other.created_at === anchor.created_at,
        );
        const genericAhead = isGeneric(r) ? 0 : queue.slice(0, idx).filter(isGeneric).length;
        map.set(r.id, { position: idx + 1, total: queue.length, tied, genericAhead });
      }
    }
    return map;
  }, [rows]);

  // Quadras e horários presentes nas inscrições atuais — só oferece no
  // filtro o que de fato existe, e o horário reage à quadra escolhida.
  const courtOptions = useMemo(() => {
    const set = new Set<number>();
    rows.forEach((r) => {
      if (r.court) set.add(r.court);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [rows]);

  const timeOptions = useMemo(() => {
    const relevant =
      courtFilter === "all"
        ? rows
        : rows.filter((r) =>
            courtFilter === "any" ? r.court === null : r.court === Number(courtFilter),
          );
    const set = new Set<string>();
    relevant.forEach((r) => set.add(`${r.start_time}|${r.end_time}`));
    return Array.from(set).sort();
  }, [rows, courtFilter]);

  useEffect(() => {
    setTimeFilter("all");
  }, [courtFilter]);

  // Busca pelo nome sem acento e sem diferenciar maiúscula ("joao" acha "João").
  const filtered = useMemo(() => {
    const norm = (v: string) =>
      v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const q = norm(nameSearch);
    return rows.filter((r) => {
      if (q && !norm(r.clients?.full_name ?? r.guest_name ?? "").includes(q)) return false;
      // "Aguardando" inclui Avisado/Contatado: continuam na fila e seguram
      // a vez — escondê-los fazia o 1º da fila "sumir".
      if (statusFilter === "waiting") {
        if (!ACTIVE_WAITLIST_STATUSES.includes(r.status)) return false;
      } else if (statusFilter === "awaiting_confirmation") {
        if (r.status !== "contacted" && r.status !== "awaiting_confirmation") return false;
      } else if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (courtFilter === "any" && r.court !== null) return false;
      if (courtFilter !== "all" && courtFilter !== "any" && r.court !== Number(courtFilter))
        return false;
      if (timeFilter !== "all" && `${r.start_time}|${r.end_time}` !== timeFilter) return false;
      return true;
    });
  }, [rows, statusFilter, courtFilter, timeFilter, nameSearch]);

  const openAdd = () => {
    setEditTarget(null);
    setClientId("");
    setGuestName("");
    setWeekdays(["1"]);
    setStartTime("18:00");
    setEndTime("19:00");
    setCourt("any");
    setPriority("0");
    setNotes("");
    setAddOpen(true);
  };

  // Editar mantém o created_at da inscrição — a posição na fila continua
  // sendo pela ordem de chegada original, mesmo trocando quadra/dia/horário.
  const openEdit = (row: FixedWaitlistRow) => {
    setEditTarget(row);
    setClientId(row.client_id ?? "");
    setGuestName(row.client_id ? "" : (row.guest_name ?? ""));
    setWeekdays([String(row.desired_weekday)]);
    setStartTime(row.start_time.slice(0, 5));
    setEndTime(row.end_time.slice(0, 5));
    setCourt(row.court === null ? "any" : String(row.court));
    setPriority(String(row.priority ?? 0));
    setNotes(row.notes ?? "");
    setEntryStatus(row.status);
    setAddOpen(true);
  };

  const toggleWeekday = (day: string, checked: boolean) => {
    // Na edição, a linha é de um único dia: marcar outro dia troca o dia.
    if (editTarget) {
      if (checked) setWeekdays([day]);
      return;
    }
    setWeekdays((prev) =>
      checked ? [...prev, day].sort() : prev.filter((d) => d !== day),
    );
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId && !guestName.trim()) {
      toast.error("Escolha um cliente ou informe um nome livre.");
      return;
    }
    if (weekdays.length === 0) {
      toast.error("Selecione ao menos um dia da semana.");
      return;
    }
    if (startTime >= endTime) {
      toast.error("Horário final deve ser depois do inicial.");
      return;
    }
    setSaving(true);
    if (editTarget) {
      const { error } = await supabase
        .from("fixed_court_waitlist")
        .update({
          client_id: clientId || null,
          guest_name: clientId ? null : guestName.trim(),
          desired_weekday: Number(weekdays[0]),
          start_time: startTime,
          end_time: endTime,
          court: court === "any" ? null : Number(court),
          priority: Number(priority) || 0,
          notes: notes.trim() || null,
          ...(ACTIVE_WAITLIST_STATUSES.includes(editTarget.status) &&
          entryStatus !== editTarget.status
            ? {
                status: entryStatus as "waiting" | "notified" | "contacted",
                ...(entryStatus === "contacted" ? { contacted_at: new Date().toISOString() } : {}),
              }
            : {}),
        })
        .eq("id", editTarget.id);
      setSaving(false);
      if (error) {
        // fixed_court_waitlist_active_dedup_uidx: o cliente já aguarda nesse
        // mesmo quadra+dia+horário.
        if (error.code === "23505")
          return toast.error(
            "Esse cliente já está na fila desse mesmo dia, horário e quadra. Remova a inscrição duplicada (fique com a mais antiga) antes de editar.",
          );
        return toast.error(error.message);
      }
      toast.success("Entrada atualizada — a ordem de chegada foi mantida.");
      setAddOpen(false);
      setEditTarget(null);
      void load();
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    // Um dia diferente com horário diferente é outra inscrição — a equipe
    // repete o "Adicionar" só pra esse dia. Aqui, os dias marcados juntos
    // compartilham o mesmo horário e viram uma linha cada.
    const { error } = await supabase.from("fixed_court_waitlist").insert(
      weekdays.map((day) => ({
        client_id: clientId || null,
        guest_name: clientId ? null : guestName.trim(),
        desired_weekday: Number(day),
        start_time: startTime,
        end_time: endTime,
        court: court === "any" ? null : Number(court),
        priority: Number(priority) || 0,
        notes: notes.trim() || null,
        created_by: user?.id ?? null,
      })),
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      weekdays.length > 1
        ? `Adicionado à lista de espera fixa em ${weekdays.length} dias.`
        : "Adicionado à lista de espera fixa.",
    );
    setAddOpen(false);
    void load();
  };

  const remove = async (id: string) => {
    if (!(await confirm("Remover da lista de espera fixa?"))) return;
    const { error } = await supabase.from("fixed_court_waitlist").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido.");
    void load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("fixed_court_waitlist")
      .update({ status: status as "waiting" | "awaiting_confirmation" | "fulfilled" | "declined" | "cancelled" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  };

  const declineViaRpc = async (id: string, reason?: string) => {
    const { data, error } = await supabase.rpc("fixed_waitlist_remove", {
      _entry_id: id,
      _reason: reason ?? null,
    } as never);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Não foi possível remover.");
    toast.success("Removido da fila.");
    void load();
  };

  const openAssign = (row: FixedWaitlistRow) => {
    // Já vem com a quadra sugerida marcada; a recepção pode trocar.
    const free = freeMatches.get(row.id) ?? [];
    setAssignCourt(free.length > 0 ? String(free[0]) : "");
    setAssignTarget(row);
    setAssignTeacherId("none");
    setAssignValidFrom(todayISO());
    setAssignNotes("");
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    if (!assignCourt) return toast.error("Escolha a quadra que vagou.");
    setAssigning(true);
    const { data, error } = await supabase.rpc("fixed_waitlist_assign", {
      _entry_id: assignTarget.id,
      _court: assignCourt ? Number(assignCourt) : null,
      _teacher_id: assignTeacherId === "none" ? null : assignTeacherId,
      _valid_from: assignValidFrom || null,
      // Fixo é por tempo indeterminado: sem data de fim.
      _valid_months: null,
      _notes: assignNotes.trim() || null,
    } as never);
    setAssigning(false);
    const res = data as unknown as { ok: boolean; error?: string } | null;
    if (error) return toast.error(error.message);
    if (!res?.ok) return toast.error(res?.error ?? "Não foi possível atribuir.");
    toast.success("Horário fixo atribuído com sucesso!");
    setAssignTarget(null);
    void load();
  };

  const handlePrint = () => {
    const now = new Date().toLocaleString("pt-BR");
    const filterParts: string[] = [];
    if (courtFilter === "any") filterParts.push("Qualquer quadra");
    else if (courtFilter === "0") filterParts.push("Qualquer quadra de pickleball");
    else if (courtFilter !== "all") filterParts.push(courtLabel(Number(courtFilter)));
    if (timeFilter !== "all") {
      const [start, end] = timeFilter.split("|");
      filterParts.push(`${start.slice(0, 5)}–${end.slice(0, 5)}`);
    }
    if (nameSearch.trim()) filterParts.push(`Cliente: "${nameSearch.trim()}"`);
    const filterLabel =
      filterParts.length > 0 ? filterParts.join(" • ") : "Todas as quadras e horários";
    const rowsHtml = filtered
      .map((r) => {
        const pos = positionMap.get(r.id);
        return `<tr>
        <td>${escapeHtml(r.clients?.full_name ?? r.guest_name ?? "—")}</td>
        <td>${escapeHtml(WEEKDAY_LABELS[r.desired_weekday])}</td>
        <td>${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}</td>
        <td>${fixedWaitlistCourtLabel(r.court)}</td>
        <td>${pos ? `${pos.position}º de ${pos.total}${pos.tied ? " (empate)" : ""}` : "—"}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`;
      })
      .join("");
    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Fila fixa - ${now}</title>
<style>
  body{font-family:Arial,sans-serif;padding:20px;color:#111;}
  h1{margin:0 0 4px;font-size:20px;}
  .meta{color:#555;font-size:12px;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;}
  th{background:#f3f4f6;}
  @media print{ button{display:none;} }
</style></head><body>
  <h1>Fila de espera — horário fixo</h1>
  <div class="meta">Gerado em ${now} • ${escapeHtml(filterLabel)} • ${filtered.length} ${filtered.length === 1 ? "entrada" : "entradas"}</div>
  <table>
    <thead><tr><th>Cliente</th><th>Dia</th><th>Horário</th><th>Quadra</th><th>Posição</th><th>Status</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
        Lista de espera para horário fixo semanal (ex.: toda segunda 17h). Clientes e professores
        também podem entrar pelo portal, por ordem de chegada — a equipe pode adicionar entradas
        aqui manualmente também. Na fila de uma quadra, quem está em "Qualquer" (e, nas quadras
        de pickleball, quem está em "Pickleball") no mesmo dia/horário e entrou antes
        fica à frente. "Pickleball" e "Qualquer" dividem uma fila só. A quadra exata é escolhida
        na hora de atribuir.
      </div>

      {freeMatches.size > 0 && (
        <div className="rounded-md border border-green-600/50 bg-green-500/10 p-3 text-sm space-y-1">
          <div className="font-medium text-green-800 dark:text-green-300">
            {freeMatches.size === 1
              ? "1 cliente da fila tem quadra livre agora — fale com ele:"
              : `${freeMatches.size} clientes da fila têm quadra livre agora — fale com eles:`}
          </div>
          <ul className="text-green-900 dark:text-green-200">
            {rows
              .filter((r) => freeMatches.has(r.id))
              .sort(
                (a, b) =>
                  ((a.desired_weekday + 6) % 7) - ((b.desired_weekday + 6) % 7) ||
                  a.start_time.localeCompare(b.start_time),
              )
              .map((r) => (
                <li key={r.id}>
                  • {WEEKDAY_LABELS[r.desired_weekday]} {r.start_time.slice(0, 5)}–
                  {r.end_time.slice(0, 5)} — <strong>{r.clients?.full_name ?? r.guest_name}</strong>{" "}
                  ({fixedWaitlistCourtLabel(r.court)}):{" "}
                  {(freeMatches.get(r.id) ?? []).map((c) => courtShort(c)).join(", ")} livre
                  {!r.client_id && " — cadastre o cliente para poder atribuir"}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <div className="relative w-full sm:w-56 sm:mr-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="pl-8 pr-8"
          />
          {nameSearch && (
            <button
              type="button"
              onClick={() => setNameSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={courtFilter} onValueChange={setCourtFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as quadras</SelectItem>
            <SelectItem value="any">Qualquer</SelectItem>
            <SelectItem value="0">Pickleball (qualquer)</SelectItem>
            {courtOptions.map((c) => (
              <SelectItem key={c} value={String(c)}>{courtLabel(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={setTimeFilter} disabled={timeOptions.length === 0}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Todos horários" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos horários</SelectItem>
            {timeOptions.map((t) => {
              const [start, end] = t.split("|");
              return (
                <SelectItem key={t} value={t}>
                  {start.slice(0, 5)}–{end.slice(0, 5)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="waiting">Aguardando</SelectItem>
            <SelectItem value="awaiting_confirmation">Aguardando confirmação</SelectItem>
            <SelectItem value="fulfilled">Efetivadas</SelectItem>
            <SelectItem value="declined">Recusadas</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handlePrint} disabled={filtered.length === 0}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Entradas</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma entrada.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Dia da semana</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Quadra</TableHead>
                  <TableHead>Posição</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vaga</TableHead>
                  <TableHead>Obs.</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const pos = positionMap.get(r.id);
                  // Só dá pra atribuir quando existe quadra livre de verdade
                  // para essa inscrição — não basta ser o 1º da fila.
                  const free = freeMatches.get(r.id);
                  const waitingFree = notCalled.get(r.id);
                  const active = ACTIVE_WAITLIST_STATUSES.includes(r.status);
                  const canAssign = active && !!free && !!r.client_id;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.clients?.full_name ?? r.guest_name ?? "—"}</TableCell>
                      <TableCell>{WEEKDAY_LABELS[r.desired_weekday]}</TableCell>
                      <TableCell>{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</TableCell>
                      <TableCell>{fixedWaitlistCourtLabel(r.court)}</TableCell>
                      <TableCell
                        title={`Entrou na fila em ${new Date(r.created_at).toLocaleString("pt-BR")}`}
                      >
                        {pos ? (
                          <span className="inline-flex items-center gap-1">
                            {pos.position}º de {pos.total}
                            {pos.tied && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                ⚠️ empate
                              </Badge>
                            )}
                            {!!pos.genericAhead && (
                              <span
                                className="text-[10px] text-muted-foreground"
                                title='Clientes em "Qualquer" ou "Pickleball" que entraram antes no mesmo dia/horário'
                              >
                                ({pos.genericAhead} de "Qualquer/Pickleball" à frente)
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} labels={fixedStatusLabel} />
                        {r.status === "contacted" && (
                          <div
                            className={cn(
                              "text-[10px] mt-0.5",
                              daysSince(r.contacted_at ?? r.updated_at) >= 3
                                ? "text-destructive font-medium"
                                : "text-muted-foreground",
                            )}
                            title="Desde quando a vaga foi oferecida"
                          >
                            {fmtWaitingFor(r.contacted_at ?? r.updated_at)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {free ? (
                          <Badge className="bg-green-600 hover:bg-green-600">
                            Livre: {free.map((c) => courtShort(c)).join(", ")}
                          </Badge>
                        ) : waitingFree ? (
                          <span
                            className="text-xs text-amber-700 dark:text-amber-400"
                            title={
                              waitingFree.accepted.length === 0
                                ? "A quadra livre nesse horário não serve para a preferência desta inscrição."
                                : "As quadras livres vão para quem entrou antes na fila desse horário."
                            }
                          >
                            {waitingFree.slotFree.map((c) => courtShort(c)).join(", ")} livre —{" "}
                            {waitingFree.accepted.length === 0
                              ? "não serve pra preferência"
                              : "vai pra quem está à frente"}
                          </span>
                        ) : active ? (
                          <span className="text-xs text-muted-foreground">Sem vaga</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        {canAssign && (
                          <Button size="sm" onClick={() => openAssign(r)}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Atribuir
                          </Button>
                        )}
                        {active && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void declineViaRpc(r.id)}
                          >
                            Recusar
                          </Button>
                        )}
                        {!active && (
                          <Button size="sm" variant="ghost" onClick={() => void setStatus(r.id, "waiting")}>
                            Reativar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(r)}
                          title="Editar"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "Editar entrada da lista de espera fixa" : "Nova entrada na lista de espera fixa"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3">
            {editTarget && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                Entrou na fila em{" "}
                <strong>{new Date(editTarget.created_at).toLocaleString("pt-BR")}</strong>. Essa
                data é mantida: no novo dia/horário/quadra, a posição é calculada pela ordem de
                chegada original.
              </div>
            )}
            <div>
              <Label>Cliente</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={(id) => { setClientId(id); if (id) setGuestName(""); }}
              />
            </div>
            <div>
              <Label>Ou nome livre</Label>
              <Input
                value={guestName}
                onChange={(e) => { setGuestName(e.target.value); if (e.target.value) setClientId(""); }}
                placeholder="Nome livre (sem cadastro)"
              />
            </div>
            <div>
              <Label>{editTarget ? "Dia da semana" : "Dia(s) da semana"}</Label>
              {!editTarget && (
                <p className="text-xs text-muted-foreground mb-1">
                  Marque vários dias se o horário abaixo é o mesmo em todos. Se um dia quiser
                  horário diferente, adicione-o separadamente.
                </p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {WEEKDAY_LABELS.map((label, idx) => {
                  const value = String(idx);
                  const checked = weekdays.includes(value);
                  return (
                    <label key={idx} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleWeekday(value, v === true)}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Quadra</Label>
                <Select value={court} onValueChange={setCourt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer (tênis ou pickleball)</SelectItem>
                    <SelectItem value="1">Tênis (saibro)</SelectItem>
                    <SelectItem value="0">Pickleball (qualquer quadra)</SelectItem>
                    {/* Inscrição presa a uma quadra de pickleball específica: mantém a
                        opção só pra não trocar sem querer ao editar. */}
                    {court !== "any" && court !== "0" && court !== "1" && (
                      <SelectItem value={court}>{courtLabel(Number(court))}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Início</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div>
                <Label>Fim</Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </div>
              <div>
                <Label>Prioridade</Label>
                <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              </div>
            </div>
            {editTarget && ACTIVE_WAITLIST_STATUSES.includes(editTarget.status) && (
              <div>
                <Label>Status</Label>
                <Select value={entryStatus} onValueChange={setEntryStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="waiting">Aguardando</SelectItem>
                    <SelectItem value="contacted">Aguardando confirmação</SelectItem>
                    {editTarget.status === "notified" && (
                      <SelectItem value="notified">Avisado (antigo)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Aguardando confirmação: você ofereceu a vaga e espera a resposta — ele continua
                  na fila e segura a vez. Quando responder, clique em Atribuir ou Recusar.
                </p>
              </div>
            )}
            <div>
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignTarget} onOpenChange={(v) => !v && setAssignTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Atribuir horário fixo</DialogTitle>
          </DialogHeader>
          {assignTarget && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {assignTarget.clients?.full_name ?? assignTarget.guest_name}
                </span>{" "}
                — {fixedWaitlistCourtLabel(assignTarget.court)},{" "}
                {WEEKDAY_LABELS[assignTarget.desired_weekday]}{" "}
                {assignTarget.start_time.slice(0, 5)}–{assignTarget.end_time.slice(0, 5)}
              </div>
              <div>
                <Label>Quadra que vagou</Label>
                <Select value={assignCourt} onValueChange={setAssignCourt}>
                  <SelectTrigger><SelectValue placeholder="Escolha a quadra" /></SelectTrigger>
                  <SelectContent>
                    {(freeMatches.get(assignTarget.id) ?? []).map((n, i, all) => (
                      <SelectItem key={n} value={String(n)}>
                        {courtLabel(n)}
                        {i === 0 && all.length > 1 ? " (sugerida)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(freeMatches.get(assignTarget.id) ?? []).length > 1 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    A sugerida deixa as outras livres pra quem vem atrás na fila — escolher outra
                    pode tirar a vaga do próximo.
                  </p>
                )}
              </div>
              <div>
                <Label>Professor (opcional)</Label>
                <Select value={assignTeacherId} onValueChange={setAssignTeacherId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem professor</SelectItem>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Começa em</Label>
                <Input
                  type="date"
                  value={assignValidFrom}
                  onChange={(e) => setAssignValidFrom(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Fixo por tempo indeterminado — sem data de fim.
                </p>
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignTarget(null)}>Cancelar</Button>
            <Button onClick={handleAssign} disabled={assigning}>
              {assigning && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirmar atribuição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isDiretoria && <FixedWaitlistCourtSettings />}
    </>
  );
}

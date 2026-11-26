import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Plus, Pencil, Loader2, UserMinus, Receipt, Users, CircleStop } from "lucide-react";
import { fetchAll } from "@/lib/fetchAll";
import { fmtBRL, fmtDate, todayISO } from "@/lib/format";
import { PICKLEBALL_COURTS, courtShort, weekdayShort } from "@/lib/court-map";
import {
  classIsActiveOn,
  memberIsActiveOn,
  monthLabel,
  type PickleballClass,
  type PickleballClassMember,
} from "@/lib/pickleball-classes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/turmas")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <TurmasPage />
    </RequireAuth>
  ),
});

const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
/** Mensalidade do cadastro: custom_amount; sem ele, o padrão da categoria
 * só se ela for Escolinha Pickleball (mesma regra do gerador). */
function clientMonthlyFee(
  c: {
    custom_amount: number | null;
    client_categories: { name: string; default_amount: number | null } | null;
  } | null,
): number | null {
  if (!c) return null;
  if (c.custom_amount != null) return Number(c.custom_amount);
  const cat = c.client_categories;
  if (cat && cat.name.trim().toLowerCase() === "escolinha pickleball" && cat.default_amount != null)
    return Number(cat.default_amount) || null;
  return null;
}

// Ordem de exibição: segunda a domingo.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface Teacher {
  id: string;
  name: string;
  active: boolean;
}

function TurmasPage() {
  const [classes, setClasses] = useState<PickleballClass[]>([]);
  const [members, setMembers] = useState<PickleballClassMember[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnded, setShowEnded] = useState(false);
  const [editing, setEditing] = useState<PickleballClass | null>(null);
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const today = todayISO();

  const load = async () => {
    setLoading(true);
    const [cRes, mRes, tRes] = await Promise.all([
      supabase.from("pickleball_classes").select("*").order("weekday").order("start_time"),
      supabase
        .from("client_schedules")
        .select(
          "id, class_id, client_id, valid_from, valid_until, clients!client_id(full_name, phone, custom_amount, client_categories(name, default_amount))",
        )
        .not("class_id", "is", null),
      supabase.from("teachers").select("id, name, active").order("name"),
    ]);
    if (cRes.error) toast.error(cRes.error.message);
    if (mRes.error) toast.error(mRes.error.message);
    setClasses((cRes.data ?? []) as PickleballClass[]);
    setMembers(
      (
        (mRes.data ?? []) as unknown as Array<
          Omit<PickleballClassMember, "full_name" | "phone" | "monthly_fee"> & {
            clients: {
              full_name: string;
              phone: string | null;
              custom_amount: number | null;
              client_categories: { name: string; default_amount: number | null } | null;
            } | null;
          }
        >
      ).map(({ clients: c, ...m }) => ({
        ...m,
        full_name: c?.full_name ?? "—",
        phone: c?.phone ?? null,
        monthly_fee: clientMonthlyFee(c),
      })),
    );
    setTeachers((tRes.data ?? []) as Teacher[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    fetchAll<ClientOption & { active: boolean }>("clients", "id, full_name, active", {
      build: (q) => q.eq("active", true).order("full_name"),
    })
      .then((rows) => setClients(rows))
      .catch((e) => toast.error(String(e?.message ?? e)));
  }, []);

  const teacherName = (id: string | null) => teachers.find((t) => t.id === id)?.name ?? null;

  const visible = classes.filter(
    (c) => showEnded || classIsActiveOn(c, today) || (c.valid_from ?? "") > today,
  );
  const byWeekday = WEEK_ORDER.map((wd) => ({
    wd,
    list: visible.filter((c) => c.weekday === wd),
  })).filter((g) => g.list.length > 0);

  const activeMembers = members.filter((m) => memberIsActiveOn(m, today));
  // Uma mensalidade por aluno, mesmo que ele esteja em 2+ turmas.
  const feeByClient = new Map(activeMembers.map((m) => [m.client_id, Number(m.monthly_fee ?? 0)]));
  const monthlyTotal = [...feeByClient.values()].reduce((s, v) => s + v, 0);
  const studentCount = feeByClient.size;
  // Em quantas turmas (ativas ou futuras) cada aluno está.
  const classCountByClient = new Map<string, number>();
  for (const m of members)
    if (memberIsActiveOn(m, today) || (m.valid_from ?? "") > today)
      classCountByClient.set(m.client_id, (classCountByClient.get(m.client_id) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Turmas de pickleball</h1>
          <p className="text-muted-foreground max-w-2xl">
            Turma fixa ocupa a quadra no horário dela. A mensalidade é do aluno (valor do cadastro
            dele): uma só por mês, não importa em quantas turmas ele esteja — não há cobrança por
            aula. Horário sem turma fica livre para locação.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setFeesOpen(true)}>
            <Receipt className="h-4 w-4 mr-2" /> Gerar mensalidades
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setClassDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Nova turma
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Turmas ativas</div>
            <div className="text-2xl font-semibold">
              {classes.filter((c) => classIsActiveOn(c, today)).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Alunos matriculados</div>
            <div className="text-2xl font-semibold">{studentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Mensalidades por mês</div>
            <div className="text-2xl font-semibold">{fmtBRL(monthlyTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <MakeupBalances members={members} />

      <div className="flex items-center gap-2">
        <Switch id="show-ended" checked={showEnded} onCheckedChange={setShowEnded} />
        <Label htmlFor="show-ended">Mostrar turmas encerradas</Label>
      </div>

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">Carregando...</div>
      ) : byWeekday.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhuma turma cadastrada. Clique em <strong>Nova turma</strong> para começar.
          </CardContent>
        </Card>
      ) : (
        byWeekday.map((g) => (
          <div key={g.wd} className="space-y-3">
            <h2 className="text-lg font-semibold">{WEEKDAY_LONG[g.wd]}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {g.list.map((c) => (
                <ClassCard
                  key={c.id}
                  cls={c}
                  teacherName={teacherName(c.teacher_id)}
                  members={members.filter((m) => m.class_id === c.id)}
                  classCountByClient={classCountByClient}
                  clients={clients}
                  today={today}
                  onEdit={() => {
                    setEditing(c);
                    setClassDialogOpen(true);
                  }}
                  onChanged={load}
                />
              ))}
            </div>
          </div>
        ))
      )}

      <ClassDialog
        open={classDialogOpen}
        onOpenChange={setClassDialogOpen}
        editing={editing}
        teachers={teachers}
        onSaved={load}
      />
      <FeesDialog open={feesOpen} onOpenChange={setFeesOpen} />
    </div>
  );
}

// ------------------------------------------------------------------ card ---

function ClassCard({
  cls,
  teacherName,
  members,
  clients,
  classCountByClient,
  today,
  onEdit,
  onChanged,
}: {
  cls: PickleballClass;
  teacherName: string | null;
  members: PickleballClassMember[];
  classCountByClient: Map<string, number>;
  clients: ClientOption[];
  today: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [addClient, setAddClient] = useState("");
  const [addStart, setAddStart] = useState(today);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const active = members.filter((m) => memberIsActiveOn(m, today) || (m.valid_from ?? "") > today);
  const past = members.filter((m) => !active.includes(m));
  const ended = !classIsActiveOn(cls, today) && (cls.valid_from ?? "") <= today;
  const full = cls.capacity != null && active.length >= cls.capacity;
  const enrolledIds = new Set(active.map((m) => m.client_id));

  const addMember = async () => {
    if (!addClient) return toast.error("Escolha o aluno.");
    setBusy(true);
    const { error } = await supabase.rpc("pickleball_class_add_member", {
      _class_id: cls.id,
      _client_id: addClient,
      _start: addStart || today,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Aluno matriculado");
    setAddClient("");
    onChanged();
  };

  const changeAmount = async (m: PickleballClassMember) => {
    const raw = window.prompt(
      `Mensalidade de ${m.full_name} (R$) — fica no cadastro do cliente e vale para todas as turmas dele. Deixe vazio para usar o padrão da categoria:`,
      m.monthly_fee != null ? String(m.monthly_fee) : "",
    );
    if (raw == null) return;
    const v = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (v != null && (Number.isNaN(v) || v < 0)) return toast.error("Valor inválido.");
    const { error } = await supabase
      .from("clients")
      .update({ custom_amount: v })
      .eq("id", m.client_id);
    if (error) return toast.error(error.message);
    toast.success("Mensalidade atualizada");
    onChanged();
  };

  const endClass = async () => {
    if (
      !(await confirm(
        `Encerrar a turma ${cls.name} agora?\n\n` +
          `• ${active.length} aluno(s) saem da turma e o horário fica livre para locação a partir de hoje.\n` +
          `• Quem não estiver em outra turma deixa de ter mensalidade gerada a partir do próximo mês, ` +
          `inclusive quem é da categoria Escolinha Pickleball.\n` +
          `• Quem for continuar, coloque em outra turma — a mensalidade continua a do cadastro.\n\n` +
          `O histórico fica guardado.`,
      ))
    )
      return;
    setBusy(true);
    const { error } = await supabase.rpc("pickleball_class_end", { _class_id: cls.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Turma encerrada");
    onChanged();
  };

  const removeMember = async (m: PickleballClassMember) => {
    if (
      !(await confirm(
        `Tirar ${m.full_name} da turma ${cls.name}? A partir de hoje o horário dele(a) deixa de ocupar a quadra. Se não estiver em outra turma, a mensalidade deixa de ser gerada. O histórico fica guardado.`,
      ))
    )
      return;
    const { error } = await supabase.rpc("pickleball_class_remove_member", { _schedule_id: m.id });
    if (error) return toast.error(error.message);
    toast.success("Aluno retirado da turma");
    onChanged();
  };

  return (
    <Card className={cn(ended && "opacity-60")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{cls.name}</CardTitle>
            <div className="text-sm text-muted-foreground">
              {weekdayShort[cls.weekday]} {cls.start_time.slice(0, 5)}–{cls.end_time.slice(0, 5)} ·{" "}
              {courtShort(cls.court)} · {teacherName ? `Prof. ${teacherName}` : "sem professor"}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge variant={full ? "destructive" : "secondary"}>
                <Users className="h-3 w-3 mr-1" />
                {active.length}
                {cls.capacity != null ? ` / ${cls.capacity}` : ""} alunos
              </Badge>
              {ended && (
                <Badge variant="outline">
                  Encerrada em {fmtDate(cls.valid_until + "T12:00:00")}
                </Badge>
              )}
              {!ended && cls.valid_from && cls.valid_from > today && (
                <Badge variant="outline">Começa em {fmtDate(cls.valid_from + "T12:00:00")}</Badge>
              )}
              {!ended && cls.valid_until && (
                <Badge variant="outline">Até {fmtDate(cls.valid_until + "T12:00:00")}</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!ended && (
              <Button
                variant="outline"
                size="sm"
                onClick={endClass}
                disabled={busy}
                className="text-destructive"
              >
                <CircleStop className="h-4 w-4 mr-1" />
                Encerrar turma
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar turma">
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {active.length === 0 && !ended && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
            Turma sem aluno não ocupa a quadra: o horário aparece livre para locação no mapa.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead className="text-right">Mensalidade</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div>{m.full_name}</div>
                    {m.valid_from && m.valid_from > today && (
                      <div className="text-xs text-muted-foreground">
                        entra em {fmtDate(m.valid_from + "T12:00:00")}
                      </div>
                    )}
                    {m.valid_until && (
                      <div className="text-xs text-muted-foreground">
                        até {fmtDate(m.valid_until + "T12:00:00")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      className={cn(
                        "underline-offset-2 hover:underline",
                        m.monthly_fee == null && "text-amber-700 dark:text-amber-400",
                      )}
                      onClick={() => changeAmount(m)}
                      title="Alterar a mensalidade no cadastro do aluno"
                    >
                      {m.monthly_fee != null ? fmtBRL(m.monthly_fee) : "sem valor"}
                    </button>
                    {(classCountByClient.get(m.client_id) ?? 0) > 1 && (
                      <div className="text-xs text-muted-foreground">
                        {classCountByClient.get(m.client_id)} turmas · 1 mensalidade
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMember(m)}
                      aria-label={`Tirar ${m.full_name} da turma`}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!ended && !full && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">Matricular aluno</div>
            <ClientCombobox
              clients={clients.filter((c) => !enrolledIds.has(c.id))}
              value={addClient}
              onChange={setAddClient}
              placeholder="Pesquisar cliente"
            />
            <div className="space-y-1 max-w-[12rem]">
              <Label className="text-xs">A partir de</Label>
              <Input type="date" value={addStart} onChange={(e) => setAddStart(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              A mensalidade vem do cadastro do aluno — uma só por mês, mesmo em 2 ou mais turmas
              (ex.: R$ 400 para 2x por semana). Clique no valor do aluno para alterar.
            </p>
            <Button size="sm" onClick={addMember} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Matricular
            </Button>
          </div>
        )}

        {past.length > 0 && (
          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowPast((v) => !v)}
            >
              {showPast ? "Ocultar" : "Ver"} ex-alunos ({past.length})
            </button>
            {showPast && (
              <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                {past.map((m) => (
                  <li key={m.id}>
                    {m.full_name} — saiu em {fmtDate((m.valid_until ?? "") + "T12:00:00")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------- criar/editar ---

function ClassDialog({
  open,
  onOpenChange,
  editing,
  teachers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PickleballClass | null;
  teachers: Teacher[];
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [court, setCourt] = useState("2");
  const [weekday, setWeekday] = useState("1");
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("20:00");
  const [teacherId, setTeacherId] = useState("none");
  const [capacity, setCapacity] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setCourt(String(editing?.court ?? 2));
    setWeekday(String(editing?.weekday ?? 1));
    setStart(editing?.start_time.slice(0, 5) ?? "19:00");
    setEnd(editing?.end_time.slice(0, 5) ?? "20:00");
    setTeacherId(editing?.teacher_id ?? "none");
    setCapacity(editing?.capacity != null ? String(editing.capacity) : "");
    setValidFrom(editing?.valid_from ?? "");
    setValidUntil(editing?.valid_until ?? "");
    setNotes(editing?.notes ?? "");
  }, [open, editing]);

  const save = async () => {
    if (!name.trim()) return toast.error("Dê um nome à turma (ex.: Iniciante Terça 19h).");
    if (end <= start) return toast.error("O horário final precisa ser depois do inicial.");
    const cap = capacity.trim() ? Number(capacity) : null;
    if (cap != null && (!Number.isInteger(cap) || cap <= 0))
      return toast.error("Limite de alunos inválido.");
    setSaving(true);
    const { error } = await supabase.rpc("pickleball_class_save", {
      _id: editing?.id ?? (null as unknown as string),
      _name: name,
      _court: Number(court),
      _weekday: Number(weekday),
      _start: start,
      _end: end,
      _teacher_id: teacherId === "none" ? (null as unknown as string) : teacherId,
      _capacity: cap as unknown as number,
      _valid_from: (validFrom || null) as unknown as string,
      _valid_until: (validUntil || null) as unknown as string,
      _notes: notes,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Turma atualizada" : "Turma criada");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar turma" : "Nova turma"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Mudar dia, horário, quadra ou professor muda também o horário de todos os alunos matriculados."
              : "Cada turma é um horário semanal. Depois de criar, matricule os alunos no cartão da turma."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Iniciante Terça 19h"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Quadra</Label>
              <Select value={court} onValueChange={setCourt}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PICKLEBALL_COURTS.map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      {courtShort(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Dia da semana</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_ORDER.map((wd) => (
                    <SelectItem key={wd} value={String(wd)}>
                      {WEEKDAY_LONG[wd]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Início</Label>
              <Input
                type="time"
                step={1800}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Fim</Label>
              <Input type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Professor</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem professor</SelectItem>
                  {teachers
                    .filter((t) => t.active || t.id === editing?.teacher_id)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Limite de alunos</Label>
              <Input
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="sem limite"
              />
            </div>
            <div className="space-y-1">
              <Label>Começa em</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Encerra em</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Para encerrar a turma, preencha “Encerra em”: os alunos saem junto nessa data e o
            horário volta a ficar livre para locação.
          </p>
          <div className="space-y-1">
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------- saldo de reposições ---

interface MakeupRow {
  client_id: string;
  full_name: string;
  earned: number;
  used: number;
  available: number;
}

/**
 * Reposições em aberto: cancelamentos no prazo (ou abonados) na chamada da
 * turma menos reposições já usadas. Sem validade — é aula que a academia
 * deve ao aluno, então o total aqui é um passivo a acompanhar.
 */
function MakeupBalances({ members }: { members: PickleballClassMember[] }) {
  const [rows, setRows] = useState<MakeupRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members) m.set(x.client_id, x.full_name);
    return m;
  }, [members]);
  const key = [...names.keys()].sort().join(",");

  useEffect(() => {
    const ids = [...names.keys()];
    if (ids.length === 0) {
      setRows([]);
      return;
    }
    supabase.rpc("pickleball_makeup_balance", { _client_ids: ids }).then(({ data, error }) => {
      if (error) return toast.error(error.message);
      setRows(
        ((data ?? []) as Omit<MakeupRow, "full_name">[])
          .filter((r) => r.earned > 0 || r.used > 0)
          .map((r) => ({ ...r, full_name: names.get(r.client_id) ?? "—" }))
          .sort((a, b) => b.available - a.available || a.full_name.localeCompare(b.full_name)),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!rows) return null;
  const open = rows.filter((r) => r.available > 0);
  const totalOpen = open.reduce((s, r) => s + r.available, 0);
  const list = showAll ? rows : open;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Reposições a usar</CardTitle>
            <p className="text-sm text-muted-foreground">
              Aulas que os alunos têm para repor (cancelaram no prazo ou foram abonados). Não vencem
              — acompanhe para não lotar as turmas.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold">{totalOpen}</div>
            <div className="text-xs text-muted-foreground">
              {open.length} aluno{open.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhum cancelamento com reposição ainda."
              : "Ninguém com reposição em aberto."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead className="text-right">Ganhas</TableHead>
                <TableHead className="text-right">Usadas</TableHead>
                <TableHead className="text-right">A usar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.client_id}>
                  <TableCell>{r.full_name}</TableCell>
                  <TableCell className="text-right">{r.earned}</TableCell>
                  <TableCell className="text-right">{r.used}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-semibold",
                      r.available >= 3 && "text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {r.available}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rows.length > open.length && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Mostrar só quem tem a usar" : `Ver histórico de todos (${rows.length})`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------ mensalidades ---

interface FeeRow {
  client_id: string;
  full_name: string;
  amount: number;
  classes: string;
  status: "gerar" | "ja_gerada" | "ja_lancada" | "sem_valor";
  /** Valor editável na prévia (vem do cadastro e o digitado volta pra ele). */
  from_category: boolean;
}

const parseAmount = (v: string): number =>
  Math.round((Number(v.replace(",", ".")) || 0) * 100) / 100;

const FEE_STATUS: Record<FeeRow["status"], { label: string; cls: string }> = {
  gerar: {
    label: "Vai gerar",
    cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  },
  ja_gerada: { label: "Já gerada", cls: "bg-muted text-muted-foreground" },
  ja_lancada: { label: "Já lançada à mão", cls: "bg-muted text-muted-foreground" },
  sem_valor: {
    label: "Sem valor (R$ 0)",
    cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  },
};

const FEE_KINDS = {
  pickleball: {
    label: "Pickleball",
    preview: "pickleball_class_fee_preview",
    generate: "pickleball_class_generate_fees",
    desc: "Mensalidade pickleball",
    empty: "Nenhum aluno em turma nem na categoria Escolinha Pickleball nesse mês.",
  },
  tenis: {
    label: "Tênis",
    preview: "tennis_school_fee_preview",
    generate: "tennis_school_generate_fees",
    desc: "Mensalidade tênis",
    empty: "Nenhum cliente ativo na categoria Escolinha Tenis.",
  },
} as const;
type FeeKind = keyof typeof FEE_KINDS;

function FeesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [kind, setKind] = useState<FeeKind>("pickleball");
  const K = FEE_KINDS[kind];
  const months = useMemo(() => {
    const t = todayISO();
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    const mk = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
    const next = m === 12 ? mk(y + 1, 1) : mk(y, m + 1);
    return [mk(y, m), next];
  }, []);
  const [month, setMonth] = useState(months[0]!);
  const [rows, setRows] = useState<FeeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Valor digitado para aluno sem turma (vai pro cadastro do cliente).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const confirm = useConfirm();

  const loadPreview = async (m: string) => {
    setLoading(true);
    setRows(null);
    setEdits({});
    const { data, error } = await supabase.rpc(FEE_KINDS[kind].preview, { _month: m });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows((data ?? []) as FeeRow[]);
  };

  useEffect(() => {
    if (open) loadPreview(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, month, kind]);

  // Valor digitado aqui vai pro cadastro do aluno (pickleball: todas as linhas).
  const editable = (r: FeeRow) =>
    r.from_category && (r.status === "gerar" || r.status === "sem_valor");
  const effectiveAmount = (r: FeeRow) =>
    editable(r) && edits[r.client_id] !== undefined
      ? parseAmount(edits[r.client_id]!)
      : Number(r.amount);
  const toGenerate = (rows ?? []).filter(
    (r) => (r.status === "gerar" || r.status === "sem_valor") && effectiveAmount(r) > 0,
  );
  const totalToGenerate = toGenerate.reduce((s, r) => s + effectiveAmount(r), 0);
  const stillWithoutValue = (rows ?? []).filter(
    (r) => (r.status === "gerar" || r.status === "sem_valor") && effectiveAmount(r) <= 0,
  ).length;

  const generate = async () => {
    if (toGenerate.length === 0) return;
    if (
      !(await confirm(
        `Lançar ${toGenerate.length} mensalidade(s) de ${monthLabel(month)}, total ${fmtBRL(totalToGenerate)}, como débito na conta de cada aluno?`,
      ))
    )
      return;
    setGenerating(true);
    // Grava no cadastro do aluno o valor digitado: o gerador lê de lá, e o
    // Caixa já preenche esse valor quando o aluno vier pagar.
    const changed = (rows ?? []).filter(
      (r) =>
        editable(r) && edits[r.client_id] !== undefined && effectiveAmount(r) !== Number(r.amount),
    );
    for (const r of changed) {
      const { error: upErr } = await supabase
        .from("clients")
        .update({ custom_amount: effectiveAmount(r) > 0 ? effectiveAmount(r) : null })
        .eq("id", r.client_id);
      if (upErr) {
        setGenerating(false);
        return toast.error(`Não consegui salvar o valor de ${r.full_name}: ${upErr.message}`);
      }
    }
    const { data, error } = await supabase.rpc(K.generate, { _month: month });
    setGenerating(false);
    if (error) return toast.error(error.message);
    const r = (data as Array<{ generated: number; total: number }> | null)?.[0];
    toast.success(`${r?.generated ?? 0} mensalidade(s) lançada(s) — ${fmtBRL(r?.total ?? 0)}`);
    loadPreview(month);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerar mensalidades da escolinha</DialogTitle>
          <DialogDescription>
            Lança um débito por aluno (“{K.desc} — mês/ano”) com o valor do cadastro do cliente.
            {kind === "pickleball" &&
              " No pickleball é uma mensalidade por aluno, mesmo que ele esteja em várias turmas."}{" "}
            Nunca lança duas vezes no mesmo mês. Quando o aluno paga no Caixa, o crédito abate o
            débito — saldo zerado é mês quitado.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Label>Escolinha</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as FeeKind)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FEE_KINDS) as FeeKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {FEE_KINDS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="ml-2">Mês</Label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {loading || !rows ? (
            <div className="py-6 text-center text-muted-foreground">Carregando prévia...</div>
          ) : rows.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground">{K.empty}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Turmas</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.client_id}>
                    <TableCell>{r.full_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.classes}</TableCell>
                    <TableCell className="text-right">
                      {editable(r) ? (
                        <Input
                          inputMode="decimal"
                          className="ml-auto h-8 w-24 text-right"
                          placeholder="R$"
                          value={
                            edits[r.client_id] ?? (Number(r.amount) > 0 ? String(r.amount) : "")
                          }
                          onChange={(e) =>
                            setEdits((m) => ({ ...m, [r.client_id]: e.target.value }))
                          }
                        />
                      ) : (
                        fmtBRL(r.amount)
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const st = editable(r)
                          ? effectiveAmount(r) > 0
                            ? "gerar"
                            : "sem_valor"
                          : r.status;
                        return (
                          <span className={cn("rounded px-1.5 py-0.5 text-xs", FEE_STATUS[st].cls)}>
                            {FEE_STATUS[st].label}
                          </span>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="text-sm">
            A gerar: <strong>{toGenerate.length}</strong> ·{" "}
            <strong>{fmtBRL(totalToGenerate)}</strong>
            {stillWithoutValue > 0 && (
              <span className="ml-2 text-amber-700 dark:text-amber-300">
                · {stillWithoutValue} sem valor (não serão gerados)
              </span>
            )}
          </div>
          <Button onClick={generate} disabled={generating || toGenerate.length === 0}>
            {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Lançar mensalidades
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

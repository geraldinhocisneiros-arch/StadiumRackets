// Tela de turmas (aba "Turmas pickleball" e aba "Escolinha Kids").
//
// As duas funcionam igual: turma = horário semanal na quadra, matrícula,
// mensalidade por aluno (valor do cadastro), chamada no mapa e reposição.
// A Escolinha Kids é na quadra de tênis e ainda tem a AULA AVULSA (R$ 70 por
// aula, para quem não paga mensalidade — sem direito a reposição).
// Ver supabase/migrations/20261127120000_escolinha_kids.sql.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Plus, Pencil, Loader2, UserMinus, Receipt, Users, CircleStop, Ticket } from "lucide-react";
import { fetchAll } from "@/lib/fetchAll";
import { fmtBRL, fmtDate, todayISO } from "@/lib/format";
import { PICKLEBALL_COURTS, TENNIS_COURT, courtShort, weekdayShort } from "@/lib/court-map";
import {
  KIDS_DROP_IN_PRICE,
  classIsActiveOn,
  memberIsActiveOn,
  monthLabel,
  type ClassProgram,
  type PickleballClass,
  type PickleballClassMember,
} from "@/lib/pickleball-classes";
import { cn } from "@/lib/utils";

const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Categoria da Escolinha Kids (aceita o nome antigo "Escolinha Tenis") —
 * mesma lista de public._is_kids_category. */
const KIDS_CATEGORY_NAMES = [
  "escolinha kids",
  "escolinha tenis",
  "escolinha tênis",
  "escolinha kids tenis",
  "escolinha kids tênis",
];
const isProgramCategory = (program: ClassProgram, name: string | null | undefined) => {
  const n = (name ?? "").trim().toLowerCase();
  return program === "kids" ? KIDS_CATEGORY_NAMES.includes(n) : n === "escolinha pickleball";
};

const PROGRAMS = {
  pickleball: {
    title: "Turmas de pickleball",
    intro:
      "Turma fixa ocupa a quadra no horário dela. A mensalidade é do aluno (valor do cadastro dele): uma só por mês, não importa em quantas turmas ele esteja — não há cobrança por aula. Horário sem turma fica livre para locação.",
    courts: [...PICKLEBALL_COURTS] as number[],
    categoryLabel: "Escolinha Pickleball",
  },
  kids: {
    title: "Escolinha Kids de tênis",
    intro: `Turmas da escolinha (quadras de pickleball ou de tênis), com os dias da semana de cada turma. Mensalidade por aluno (valor do cadastro; sem ele, o padrão da categoria × nº de dias por semana: 1x = R$ 200, 2x = R$ 400). Quem não paga mensalidade vem como AVULSO: R$ ${KIDS_DROP_IN_PRICE} por aula, lançado na chamada, sem direito a reposição.`,
    courts: [...PICKLEBALL_COURTS, TENNIS_COURT] as number[],
    categoryLabel: "Escolinha Kids",
  },
} as const;

/** Mensalidade do cadastro: custom_amount; sem ele, o padrão da categoria só
 * se ela for a do programa (mesma regra do gerador). Na kids o padrão é por
 * turma (× nº de turmas). */
function clientMonthlyFee(
  program: ClassProgram,
  c: {
    custom_amount: number | null;
    client_categories: { name: string; default_amount: number | null } | null;
  } | null,
  classCount: number,
): number | null {
  if (!c) return null;
  if (c.custom_amount != null) return Number(c.custom_amount);
  const cat = c.client_categories;
  if (cat && isProgramCategory(program, cat.name) && cat.default_amount != null) {
    const v = Number(cat.default_amount) * (program === "kids" ? Math.max(classCount, 1) : 1);
    return v || null;
  }
  return null;
}

// Ordem de exibição: segunda a domingo.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const weekPos = (wd: number) => WEEK_ORDER.indexOf(wd);
const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "Segunda e Quarta", "Terça, Quinta e Sábado". */
function daysLong(wds: number[]): string {
  const names = [...wds].sort((a, b) => weekPos(a) - weekPos(b)).map((d) => WEEKDAY_LONG[d]!);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

interface Teacher {
  id: string;
  name: string;
  active: boolean;
}

/** Turma = um grupo de dias (cada dia é uma linha em pickleball_classes). */
interface ClassGroup {
  key: string;
  /** Todos os dias já cadastrados (inclusive encerrados), em ordem seg→dom. */
  all: PickleballClass[];
  /** Dias ativos hoje ou que ainda vão começar. */
  current: PickleballClass[];
  /** Dia de referência (nome, horário, quadra, professor). */
  ref: PickleballClass;
}

const groupKey = (c: PickleballClass) => c.group_id ?? c.id;
const isCurrent = (c: PickleballClass, today: string) =>
  classIsActiveOn(c, today) || (c.valid_from ?? "") > today;

function buildGroups(classes: PickleballClass[], today: string): ClassGroup[] {
  const map = new Map<string, PickleballClass[]>();
  for (const c of classes) map.set(groupKey(c), [...(map.get(groupKey(c)) ?? []), c]);
  return [...map.entries()].map(([key, list]) => {
    const all = list.sort(
      (a, b) => weekPos(a.weekday) - weekPos(b.weekday) || a.start_time.localeCompare(b.start_time),
    );
    const current = all.filter((c) => isCurrent(c, today));
    return { key, all, current, ref: current[0] ?? all[all.length - 1]! };
  });
}

export function ClassesPage({ program }: { program: ClassProgram }) {
  const P = PROGRAMS[program];
  const [classes, setClasses] = useState<PickleballClass[]>([]);
  const [members, setMembers] = useState<PickleballClassMember[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnded, setShowEnded] = useState(false);
  const [editing, setEditing] = useState<ClassGroup | null>(null);
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const today = todayISO();

  const load = async () => {
    setLoading(true);
    const [cRes, mRes, tRes] = await Promise.all([
      supabase
        .from("pickleball_classes")
        .select("*")
        .eq("program", program)
        .order("weekday")
        .order("start_time"),
      supabase
        .from("client_schedules")
        .select(
          "id, class_id, client_id, valid_from, valid_until, pickleball_classes!inner(program), clients!client_id(full_name, phone, custom_amount, client_categories(name, default_amount))",
        )
        .not("class_id", "is", null)
        .eq("pickleball_classes.program", program),
      supabase.from("teachers").select("id, name, active").order("name"),
    ]);
    if (cRes.error) toast.error(cRes.error.message);
    if (mRes.error) toast.error(mRes.error.message);
    setClasses((cRes.data ?? []) as unknown as PickleballClass[]);
    const raw = (mRes.data ?? []) as unknown as Array<
      Omit<PickleballClassMember, "full_name" | "phone" | "monthly_fee"> & {
        pickleball_classes?: unknown;
        clients: {
          full_name: string;
          phone: string | null;
          custom_amount: number | null;
          client_categories: { name: string; default_amount: number | null } | null;
        } | null;
      }
    >;
    // Dias de aula por semana (ativos ou futuros) por aluno: na kids o padrão
    // da categoria é por dia (1x = R$ 200, 2x = R$ 400).
    const t = todayISO();
    const nByClient = new Map<string, number>();
    for (const m of raw)
      if (memberIsActiveOn(m, t) || (m.valid_from ?? "") > t)
        nByClient.set(m.client_id, (nByClient.get(m.client_id) ?? 0) + 1);
    setMembers(
      raw.map(({ clients: c, pickleball_classes: _pc, ...m }) => ({
        ...m,
        full_name: c?.full_name ?? "—",
        phone: c?.phone ?? null,
        monthly_fee: clientMonthlyFee(program, c, nByClient.get(m.client_id) ?? 1),
      })),
    );
    setTeachers((tRes.data ?? []) as Teacher[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program]);

  useEffect(() => {
    fetchAll<ClientOption & { active: boolean }>("clients", "id, full_name, active", {
      build: (q) => q.eq("active", true).order("full_name"),
    })
      .then((rows) => setClients(rows))
      .catch((e) => toast.error(String(e?.message ?? e)));
  }, []);

  const teacherName = (id: string | null) => teachers.find((t) => t.id === id)?.name ?? null;

  const groups = buildGroups(classes, today);
  const visible = groups
    .filter((g) => showEnded || g.current.length > 0)
    .sort(
      (a, b) =>
        weekPos((a.current[0] ?? a.ref).weekday) - weekPos((b.current[0] ?? b.ref).weekday) ||
        a.ref.start_time.localeCompare(b.ref.start_time) ||
        a.ref.name.localeCompare(b.ref.name),
    );
  // Seções por combinação de dias ("Segunda e Quarta", "Terça e Quinta"...).
  const sections: { label: string; list: ClassGroup[] }[] = [];
  for (const g of visible) {
    const label = g.current.length
      ? daysLong(g.current.map((c) => c.weekday))
      : "Turmas encerradas";
    const s = sections.find((x) => x.label === label);
    if (s) s.list.push(g);
    else sections.push({ label, list: [g] });
  }
  sections.sort(
    (a, b) =>
      Number(a.label === "Turmas encerradas") - Number(b.label === "Turmas encerradas") ||
      sections.indexOf(a) - sections.indexOf(b),
  );

  const activeMembers = members.filter((m) => memberIsActiveOn(m, today));
  // Uma mensalidade por aluno, mesmo que ele esteja em 2+ dias/turmas.
  const feeByClient = new Map(activeMembers.map((m) => [m.client_id, Number(m.monthly_fee ?? 0)]));
  const monthlyTotal = [...feeByClient.values()].reduce((s, v) => s + v, 0);
  const studentCount = feeByClient.size;
  // Quantos dias por semana (ativos ou futuros) cada aluno tem.
  const classCountByClient = new Map<string, number>();
  for (const m of members)
    if (memberIsActiveOn(m, today) || (m.valid_from ?? "") > today)
      classCountByClient.set(m.client_id, (classCountByClient.get(m.client_id) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{P.title}</h1>
          <p className="text-muted-foreground max-w-2xl">{P.intro}</p>
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
              {groups.filter((g) => g.current.some((c) => classIsActiveOn(c, today))).length}
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

      {program === "kids" && <KidsDropInsCard clients={clients} />}

      <MakeupBalances members={members} program={program} />

      <div className="flex items-center gap-2">
        <Switch id="show-ended" checked={showEnded} onCheckedChange={setShowEnded} />
        <Label htmlFor="show-ended">Mostrar turmas encerradas</Label>
      </div>

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">Carregando...</div>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhuma turma cadastrada. Clique em <strong>Nova turma</strong> para começar.
          </CardContent>
        </Card>
      ) : (
        sections.map((s) => (
          <div key={s.label} className="space-y-3">
            <h2 className="text-lg font-semibold">{s.label}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {s.list.map((g) => (
                <ClassCard
                  key={g.key}
                  program={program}
                  group={g}
                  teacherName={teacherName(g.ref.teacher_id)}
                  members={members.filter((m) => g.all.some((c) => c.id === m.class_id))}
                  classCountByClient={classCountByClient}
                  clients={clients}
                  today={today}
                  onEdit={() => {
                    setEditing(g);
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
        members={members}
        teachers={teachers}
        program={program}
        today={today}
        onSaved={load}
      />
      <FeesDialog open={feesOpen} onOpenChange={setFeesOpen} kind={program} />
    </div>
  );
}

// ------------------------------------------------------------------ card ---

function ClassCard({
  program,
  group,
  teacherName,
  members,
  clients,
  classCountByClient,
  today,
  onEdit,
  onChanged,
}: {
  program: ClassProgram;
  group: ClassGroup;
  teacherName: string | null;
  members: PickleballClassMember[];
  classCountByClient: Map<string, number>;
  clients: ClientOption[];
  today: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const cls = group.ref;
  const days = group.current;
  const [addClient, setAddClient] = useState("");
  const [addStart, setAddStart] = useState(today);
  const [addDays, setAddDays] = useState<string[]>(days.map((d) => d.id));
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const daysKey = days.map((d) => d.id).join(",") + "|" + members.length;

  useEffect(() => {
    setAddDays(days.filter((d) => !fullDay(d)).map((d) => d.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey]);

  const isMemberCurrent = (m: PickleballClassMember) =>
    days.some((d) => d.id === m.class_id) &&
    (memberIsActiveOn(m, today) || (m.valid_from ?? "") > today);
  const active = members.filter(isMemberCurrent);
  const ended = days.length === 0;

  // Alunos (um por linha) com as matrículas de cada dia.
  const students = new Map<
    string,
    { name: string; fee: number | null; byDay: Map<string, PickleballClassMember> }
  >();
  for (const m of active) {
    const s = students.get(m.client_id) ?? {
      name: m.full_name,
      fee: m.monthly_fee,
      byDay: new Map<string, PickleballClassMember>(),
    };
    s.byDay.set(m.class_id, m);
    students.set(m.client_id, s);
  }
  const studentList = [...students.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const countByDay = (classId: string) => active.filter((m) => m.class_id === classId).length;
  const fullDay = (d: PickleballClass) => d.capacity != null && countByDay(d.id) >= d.capacity;
  const allFull = days.length > 0 && days.every(fullDay);
  const pastIds = new Set(studentList.map(([id]) => id));
  const past = [
    ...new Map(
      members
        .filter((m) => !pastIds.has(m.client_id) && !isMemberCurrent(m))
        .map((m) => [m.client_id, m] as const),
    ).values(),
  ];

  const addMember = async () => {
    if (!addClient) return toast.error("Escolha o aluno.");
    if (addDays.length === 0) return toast.error("Marque pelo menos um dia.");
    setBusy(true);
    const { error } = await supabase.rpc("class_group_add_member", {
      _class_ids: addDays,
      _client_id: addClient,
      _start: addStart || today,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Aluno matriculado (${addDays.length}x por semana)`);
    setAddClient("");
    onChanged();
  };

  // Liga/desliga um dia do aluno.
  const toggleDay = async (clientId: string, name: string, d: PickleballClass) => {
    const m = students.get(clientId)?.byDay.get(d.id);
    if (m) {
      if (
        !(await confirm(
          `Tirar ${name} da ${WEEKDAY_LONG[d.weekday]?.toLowerCase()} da turma ${cls.name}? A partir de hoje esse dia deixa de ocupar a vaga.`,
        ))
      )
        return;
      setBusy(true);
      const { error } = await supabase.rpc("pickleball_class_remove_member", {
        _schedule_id: m.id,
      });
      setBusy(false);
      if (error) return toast.error(error.message);
    } else {
      setBusy(true);
      const { error } = await supabase.rpc("pickleball_class_add_member", {
        _class_id: d.id,
        _client_id: clientId,
        _start: today,
      });
      setBusy(false);
      if (error) return toast.error(error.message);
    }
    onChanged();
  };

  const changeAmount = async (clientId: string, name: string, fee: number | null) => {
    const raw = window.prompt(
      `Mensalidade de ${name} (R$) — fica no cadastro do cliente e vale para todas as turmas dele. Deixe vazio para usar o padrão da categoria:`,
      fee != null ? String(fee) : "",
    );
    if (raw == null) return;
    const v = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (v != null && (Number.isNaN(v) || v < 0)) return toast.error("Valor inválido.");
    const { error } = await supabase
      .from("clients")
      .update({ custom_amount: v })
      .eq("id", clientId);
    if (error) return toast.error(error.message);
    toast.success("Mensalidade atualizada");
    onChanged();
  };

  const endClass = async () => {
    if (
      !(await confirm(
        `Encerrar a turma ${cls.name} (${daysLong(days.map((d) => d.weekday))}) agora?\n\n` +
          `• ${studentList.length} aluno(s) saem da turma e os horários ficam livres para locação a partir de hoje.\n` +
          `• Quem não estiver em outra turma deixa de ter mensalidade gerada a partir do próximo mês, ` +
          `inclusive quem é da categoria ${PROGRAMS[program].categoryLabel}.\n` +
          `• Quem for continuar, coloque em outra turma — a mensalidade continua a do cadastro.\n\n` +
          `O histórico fica guardado.`,
      ))
    )
      return;
    setBusy(true);
    for (const d of days) {
      const { error } = await supabase.rpc("pickleball_class_end", { _class_id: d.id });
      if (error) {
        setBusy(false);
        toast.error(error.message);
        return onChanged();
      }
    }
    setBusy(false);
    toast.success("Turma encerrada");
    onChanged();
  };

  const removeMember = async (clientId: string, name: string) => {
    if (
      !(await confirm(
        `Tirar ${name} da turma ${cls.name} (todos os dias)? A partir de hoje o horário dele(a) deixa de ocupar a quadra. Se não estiver em outra turma, a mensalidade deixa de ser gerada. O histórico fica guardado.`,
      ))
    )
      return;
    setBusy(true);
    for (const m of students.get(clientId)?.byDay.values() ?? []) {
      const { error } = await supabase.rpc("pickleball_class_remove_member", {
        _schedule_id: m.id,
      });
      if (error) {
        setBusy(false);
        toast.error(error.message);
        return onChanged();
      }
    }
    setBusy(false);
    toast.success("Aluno retirado da turma");
    onChanged();
  };

  const capLabel = (d: PickleballClass) =>
    `${WEEKDAY_SHORT[d.weekday]} ${countByDay(d.id)}${d.capacity != null ? `/${d.capacity}` : ""}`;

  return (
    <Card className={cn(ended && "opacity-60")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{cls.name}</CardTitle>
            <div className="text-sm text-muted-foreground">
              {(days.length ? days : group.all).map((d) => weekdayShort[d.weekday]).join(" e ")}{" "}
              {cls.start_time.slice(0, 5)}–{cls.end_time.slice(0, 5)} · {courtShort(cls.court)} ·{" "}
              {teacherName ? `Prof. ${teacherName}` : "sem professor"}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge variant={allFull ? "destructive" : "secondary"}>
                <Users className="h-3 w-3 mr-1" />
                {studentList.length} aluno{studentList.length === 1 ? "" : "s"}
              </Badge>
              {days.length > 1 &&
                days.map((d) => (
                  <Badge key={d.id} variant={fullDay(d) ? "destructive" : "outline"}>
                    {capLabel(d)}
                  </Badge>
                ))}
              {days.length === 1 && cls.capacity != null && (
                <Badge variant={fullDay(cls) ? "destructive" : "outline"}>
                  limite {cls.capacity}
                </Badge>
              )}
              {ended && cls.valid_until && (
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
            {!ended && (
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar turma">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {studentList.length === 0 && !ended && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
            Turma sem aluno não ocupa a quadra: o horário aparece livre para locação no mapa.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {studentList.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                {days.length > 1 && <TableHead>Dias</TableHead>}
                <TableHead className="text-right">Mensalidade</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentList.map(([clientId, s]) => {
                const any = [...s.byDay.values()][0]!;
                return (
                  <TableRow key={clientId}>
                    <TableCell>
                      <div>{s.name}</div>
                      {any.valid_from && any.valid_from > today && (
                        <div className="text-xs text-muted-foreground">
                          entra em {fmtDate(any.valid_from + "T12:00:00")}
                        </div>
                      )}
                      {any.valid_until && (
                        <div className="text-xs text-muted-foreground">
                          até {fmtDate(any.valid_until + "T12:00:00")}
                        </div>
                      )}
                    </TableCell>
                    {days.length > 1 && (
                      <TableCell>
                        <div className="flex gap-1">
                          {days.map((d) => {
                            const on = s.byDay.has(d.id);
                            return (
                              <button
                                key={d.id}
                                type="button"
                                disabled={busy}
                                onClick={() => toggleDay(clientId, s.name, d)}
                                title={on ? "Tirar desse dia" : "Colocar nesse dia"}
                                className={cn(
                                  "rounded border px-1.5 py-0.5 text-xs font-medium disabled:opacity-50",
                                  on
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background text-muted-foreground hover:bg-muted",
                                )}
                              >
                                {WEEKDAY_SHORT[d.weekday]}
                              </button>
                            );
                          })}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className={cn(
                          "underline-offset-2 hover:underline",
                          s.fee == null && "text-amber-700 dark:text-amber-400",
                        )}
                        onClick={() => changeAmount(clientId, s.name, s.fee)}
                        title="Alterar a mensalidade no cadastro do aluno"
                      >
                        {s.fee != null ? fmtBRL(s.fee) : "sem valor"}
                      </button>
                      {(classCountByClient.get(clientId) ?? 0) > 1 && (
                        <div className="text-xs text-muted-foreground">
                          {classCountByClient.get(clientId)}x por semana · 1 mensalidade
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        onClick={() => removeMember(clientId, s.name)}
                        aria-label={`Tirar ${s.name} da turma`}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {!ended && !allFull && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">Matricular aluno</div>
            <ClientCombobox
              clients={clients.filter((c) => !students.has(c.id))}
              value={addClient}
              onChange={setAddClient}
              placeholder="Pesquisar cliente"
            />
            {days.length > 1 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground">Dias:</span>
                {days.map((d) => (
                  <label key={d.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={addDays.includes(d.id)}
                      disabled={fullDay(d)}
                      onCheckedChange={(v) =>
                        setAddDays((cur) =>
                          v === true ? [...cur, d.id] : cur.filter((x) => x !== d.id),
                        )
                      }
                    />
                    {WEEKDAY_LONG[d.weekday]}
                    {fullDay(d) && <span className="text-xs text-destructive">(cheia)</span>}
                  </label>
                ))}
              </div>
            )}
            <div className="space-y-1 max-w-[12rem]">
              <Label className="text-xs">A partir de</Label>
              <Input type="date" value={addStart} onChange={(e) => setAddStart(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              A mensalidade vem do cadastro do aluno — uma só por mês, mesmo em 2 ou mais dias (ex.:
              R$ 400 para 2x por semana). Clique no valor do aluno para alterar.
              {program === "kids" &&
                " Sem valor no cadastro, usa o padrão da categoria × nº de dias por semana."}
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
  members,
  teachers,
  program,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ClassGroup | null;
  members: PickleballClassMember[];
  teachers: Teacher[];
  program: ClassProgram;
  today: string;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const courts = PROGRAMS[program].courts;
  const ref = editing?.ref ?? null;
  const [name, setName] = useState("");
  const [court, setCourt] = useState(String(courts[0]));
  const [weekdays, setWeekdays] = useState<number[]>([1]);
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
    setName(ref?.name ?? "");
    setCourt(String(ref?.court ?? courts[0]));
    setWeekdays(editing ? editing.current.map((c) => c.weekday) : [1]);
    setStart(ref?.start_time.slice(0, 5) ?? "19:00");
    setEnd(ref?.end_time.slice(0, 5) ?? "20:00");
    setTeacherId(ref?.teacher_id ?? "none");
    setCapacity(ref?.capacity != null ? String(ref.capacity) : "");
    setValidFrom(ref?.valid_from ?? "");
    setValidUntil(ref?.valid_until ?? "");
    setNotes(ref?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const toggleWeekday = (wd: number, on: boolean) =>
    setWeekdays((cur) => (on ? [...new Set([...cur, wd])] : cur.filter((x) => x !== wd)));

  const save = async () => {
    if (!name.trim()) return toast.error("Dê um nome à turma (ex.: Kids 16h).");
    if (weekdays.length === 0) return toast.error("Marque pelo menos um dia da semana.");
    if (end <= start) return toast.error("O horário final precisa ser depois do inicial.");
    const cap = capacity.trim() ? Number(capacity) : null;
    if (cap != null && (!Number.isInteger(cap) || cap <= 0))
      return toast.error("Limite de alunos inválido.");

    // Dias desmarcados encerram aquele dia (alunos saem dele).
    const removed = (editing?.current ?? []).filter((c) => !weekdays.includes(c.weekday));
    if (removed.length) {
      const affected = new Set(
        members
          .filter(
            (m) =>
              removed.some((c) => c.id === m.class_id) &&
              (memberIsActiveOn(m, today) || (m.valid_from ?? "") > today),
          )
          .map((m) => m.client_id),
      ).size;
      if (
        !(await confirm(
          `Tirar ${daysLong(removed.map((c) => c.weekday))} da turma? Esse(s) dia(s) são encerrados a partir de hoje` +
            (affected ? ` e ${affected} aluno(s) saem dele(s).` : "."),
        ))
      )
        return;
    }

    setSaving(true);
    const { error } = await supabase.rpc("class_group_save", {
      _group_id: (editing?.key ?? null) as unknown as string,
      _name: name,
      _court: Number(court),
      _weekdays: weekdays,
      _start: start,
      _end: end,
      _teacher_id: teacherId === "none" ? (null as unknown as string) : teacherId,
      _capacity: cap as unknown as number,
      _valid_from: (validFrom || null) as unknown as string,
      _valid_until: (validUntil || null) as unknown as string,
      _notes: notes,
      _program: program,
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
              ? "Mudar dias, horário, quadra ou professor muda também o horário dos alunos matriculados."
              : "Marque os dias da semana da turma. Depois de criar, matricule os alunos no cartão da turma escolhendo os dias de cada um."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={program === "kids" ? "ex.: Kids 16h" : "ex.: Iniciante 19h"}
            />
          </div>
          <div className="space-y-1">
            <Label>Dias da semana</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-2">
              {WEEK_ORDER.map((wd) => (
                <label key={wd} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={weekdays.includes(wd)}
                    onCheckedChange={(v) => toggleWeekday(wd, v === true)}
                  />
                  {WEEKDAY_SHORT[wd]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Quadra</Label>
              <Select value={court} onValueChange={setCourt}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {courts.map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      {courtShort(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Limite de alunos (por dia)</Label>
              <Input
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="sem limite"
              />
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
            <div className="space-y-1 col-span-2">
              <Label>Professor</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem professor</SelectItem>
                  {teachers
                    .filter((t) => t.active || t.id === ref?.teacher_id)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
function MakeupBalances({
  members,
  program,
}: {
  members: PickleballClassMember[];
  program: ClassProgram;
}) {
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
    supabase
      .rpc("pickleball_makeup_balance", { _client_ids: ids, _program: program })
      .then(({ data, error }) => {
        if (error) return toast.error(error.message);
        setRows(
          ((data ?? []) as Omit<MakeupRow, "full_name">[])
            .filter((r) => r.earned > 0 || r.used > 0)
            .map((r) => ({ ...r, full_name: names.get(r.client_id) ?? "—" }))
            .sort((a, b) => b.available - a.available || a.full_name.localeCompare(b.full_name)),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, program]);

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

// ------------------------------------------------ avulsos (kids) ---

interface DropInRow {
  id: string;
  client_id: string;
  class_date: string;
  amount: number;
  full_name: string;
  class_name: string;
}

/**
 * Escolinha Kids: aulas avulsas do mês (R$ 70 cada, lançadas na chamada) e
 * clientes marcados como avulsos (não geram mensalidade).
 */
function KidsDropInsCard({ clients }: { clients: ClientOption[] }) {
  const confirm = useConfirm();
  const months = useMemo(() => {
    const t = todayISO();
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    const mk = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
    return [m === 1 ? mk(y - 1, 12) : mk(y, m - 1), mk(y, m)];
  }, []);
  const [month, setMonth] = useState(months[1]!);
  const [rows, setRows] = useState<DropInRow[]>([]);
  const [avulsos, setAvulsos] = useState<{ id: string; full_name: string }[]>([]);
  const [addClient, setAddClient] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const end = (() => {
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(5, 7));
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    })();
    const [dRes, aRes] = await Promise.all([
      supabase
        .from("class_drop_ins")
        .select(
          "id, client_id, class_date, amount, clients!client_id(full_name), pickleball_classes!inner(name, program)",
        )
        .eq("pickleball_classes.program", "kids")
        .gte("class_date", month)
        .lt("class_date", end)
        .order("class_date"),
      supabase.from("clients").select("id, full_name").eq("kids_avulso", true).order("full_name"),
    ]);
    if (dRes.error) toast.error(dRes.error.message);
    if (aRes.error) toast.error(aRes.error.message);
    setRows(
      (
        (dRes.data ?? []) as unknown as {
          id: string;
          client_id: string;
          class_date: string;
          amount: number;
          clients: { full_name: string } | null;
          pickleball_classes: { name: string } | null;
        }[]
      ).map((r) => ({
        id: r.id,
        client_id: r.client_id,
        class_date: r.class_date,
        amount: Number(r.amount),
        full_name: r.clients?.full_name ?? "—",
        class_name: r.pickleball_classes?.name ?? "",
      })),
    );
    setAvulsos((aRes.data ?? []) as { id: string; full_name: string }[]);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const setAvulso = async (clientId: string, value: boolean, name: string) => {
    if (
      !value &&
      !(await confirm(
        `Tirar ${name} dos avulsos? A partir da próxima geração, volta a ter mensalidade se estiver em turma kids ou na categoria Escolinha Kids.`,
      ))
    )
      return;
    setBusy(true);
    const { error } = await supabase.rpc("kids_set_avulso", {
      _client_id: clientId,
      _avulso: value,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setAddClient("");
    void load();
  };

  // Por cliente: quantas aulas avulsas no mês e quanto deu.
  const byClient = new Map<string, { name: string; n: number; total: number }>();
  for (const r of rows) {
    const x = byClient.get(r.client_id) ?? { name: r.full_name, n: 0, total: 0 };
    x.n += 1;
    x.total += r.amount;
    byClient.set(r.client_id, x);
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const avulsoIds = new Set(avulsos.map((a) => a.id));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Ticket className="h-4 w-4" /> Aulas avulsas
            </CardTitle>
            <p className="text-sm text-muted-foreground max-w-xl">
              Cliente que não paga mensalidade: cada aula é R$ {KIDS_DROP_IN_PRICE}, lançada na
              chamada da turma (mapa de quadras) como débito na conta dele. Avulso não tem
              reposição.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-44">
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
            <div className="text-right">
              <div className="text-2xl font-semibold">{fmtBRL(total)}</div>
              <div className="text-xs text-muted-foreground">{rows.length} aula(s)</div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {byClient.size > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Aulas</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byClient.entries()].map(([id, x]) => (
                <TableRow key={id}>
                  <TableCell>
                    {x.name}
                    {!avulsoIds.has(id) && (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        não está marcado como avulso — confira se não paga mensalidade também
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {rows
                      .filter((r) => r.client_id === id)
                      .map((r) => `${fmtDate(r.class_date + "T12:00:00")} (${r.class_name})`)
                      .join(", ")}
                  </TableCell>
                  <TableCell className="text-right">
                    {x.n} × = {fmtBRL(x.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma aula avulsa em {monthLabel(month)}.
          </p>
        )}

        <div className="rounded-md border p-3 space-y-2">
          <div className="text-sm font-medium">
            Clientes avulsos ({avulsos.length}) — não geram mensalidade
          </div>
          {avulsos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {avulsos.map((a) => (
                <Badge key={a.id} variant="secondary" className="gap-1">
                  {a.full_name}
                  <button
                    type="button"
                    disabled={busy}
                    className="ml-1 opacity-60 hover:opacity-100"
                    onClick={() => setAvulso(a.id, false, a.full_name)}
                    aria-label={`Tirar ${a.full_name} dos avulsos`}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <ClientCombobox
                clients={clients.filter((c) => !avulsoIds.has(c.id))}
                value={addClient}
                onChange={setAddClient}
                placeholder="Marcar cliente como avulso"
              />
            </div>
            <Button
              size="sm"
              disabled={!addClient || busy}
              onClick={() =>
                setAvulso(addClient, true, clients.find((c) => c.id === addClient)?.full_name ?? "")
              }
            >
              Marcar
            </Button>
          </div>
        </div>
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
  status: "gerar" | "ja_gerada" | "ja_lancada" | "sem_valor" | "avulso";
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
  avulso: {
    label: "Avulso (paga por aula)",
    cls: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  },
};

const FEE_KINDS = {
  pickleball: {
    preview: "pickleball_class_fee_preview",
    generate: "pickleball_class_generate_fees",
    desc: "Mensalidade pickleball",
    empty: "Nenhum aluno em turma nem na categoria Escolinha Pickleball nesse mês.",
  },
  kids: {
    preview: "tennis_school_fee_preview",
    generate: "tennis_school_generate_fees",
    desc: "Mensalidade escolinha kids",
    empty: "Nenhum aluno em turma kids nem na categoria Escolinha Kids nesse mês.",
  },
} as const;

function FeesDialog({
  open,
  onOpenChange,
  kind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: ClassProgram;
}) {
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
  // Valor digitado (vai pro cadastro do cliente).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const confirm = useConfirm();

  const loadPreview = async (m: string) => {
    setLoading(true);
    setRows(null);
    setEdits({});
    const { data, error } = await supabase.rpc(K.preview, { _month: m });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows((data ?? []) as FeeRow[]);
  };

  useEffect(() => {
    if (open) loadPreview(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, month, kind]);

  const toggleAvulso = async (r: FeeRow) => {
    const value = r.status !== "avulso";
    const { error } = await supabase.rpc("kids_set_avulso", {
      _client_id: r.client_id,
      _avulso: value,
    });
    if (error) return toast.error(error.message);
    toast.success(
      value
        ? `${r.full_name} marcado como avulso: não gera mensalidade, paga R$ ${KIDS_DROP_IN_PRICE} por aula.`
        : `${r.full_name} volta a ter mensalidade.`,
    );
    loadPreview(month);
  };

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
  const avulsoCount = (rows ?? []).filter((r) => r.status === "avulso").length;

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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Gerar mensalidades — {kind === "kids" ? "Escolinha Kids" : "pickleball"}
          </DialogTitle>
          <DialogDescription>
            Lança um débito por aluno (“{K.desc} — mês/ano”) com o valor do cadastro do cliente. Uma
            mensalidade por aluno, mesmo que ele esteja em várias turmas.
            {kind === "kids" &&
              " Sem valor no cadastro, usa o padrão da categoria × nº de turmas. Cliente marcado como avulso não gera mensalidade (paga cada aula na chamada)."}{" "}
            Nunca lança duas vezes no mesmo mês. Quando o aluno paga no Caixa, o crédito abate o
            débito — saldo zerado é mês quitado.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Label>Mês</Label>
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
                  {kind === "kids" && <TableHead className="text-center">Avulso</TableHead>}
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
                      ) : r.status === "avulso" ? (
                        <span className="text-muted-foreground">—</span>
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
                    {kind === "kids" && (
                      <TableCell className="text-center">
                        {r.status === "ja_gerada" || r.status === "ja_lancada" ? null : (
                          <Switch
                            checked={r.status === "avulso"}
                            onCheckedChange={() => toggleAvulso(r)}
                            aria-label={`Avulso: ${r.full_name}`}
                          />
                        )}
                      </TableCell>
                    )}
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
            {avulsoCount > 0 && (
              <span className="ml-2 text-muted-foreground">· {avulsoCount} avulso(s)</span>
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

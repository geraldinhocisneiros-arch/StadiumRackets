import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Check,
  RotateCcw,
  X,
  Repeat,
  MessageSquare,
} from "lucide-react";
import { dateISO, fmtDateBR } from "@/lib/court-map";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/tarefas")({
  head: () => ({ meta: [{ title: "Gestão — Stadium Rackets" }] }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria"]}>
      <TarefasPage />
    </RequireAuth>
  ),
});

type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];
type TaskRecurrence = Database["public"]["Enums"]["task_recurrence"];

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  created_by: string;
  status: TaskStatus;
  priority: TaskPriority;
  next_followup_at: string | null;
  completed_at: string | null;
  recurrence: TaskRecurrence;
  recurrence_interval: number;
  parent_task_id: string | null;
}

interface TaskUpdate {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  none: "Não repete",
  daily: "dia(s)",
  weekly: "semana(s)",
  monthly: "mês(es)",
};

function recurrenceSummary(recurrence: TaskRecurrence, interval: number): string | null {
  if (recurrence === "none") return null;
  if (recurrence === "daily")
    return interval === 1 ? "Repete diariamente" : `Repete a cada ${interval} dias`;
  if (recurrence === "weekly")
    return interval === 1 ? "Repete semanalmente" : `Repete a cada ${interval} semanas`;
  return interval === 1 ? "Repete mensalmente" : `Repete a cada ${interval} meses`;
}

function addRecurrence(base: Date, recurrence: TaskRecurrence, interval: number): Date {
  const d = new Date(base);
  if (recurrence === "daily") d.setDate(d.getDate() + interval);
  else if (recurrence === "weekly") d.setDate(d.getDate() + interval * 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + interval);
  return d;
}

function fmtDateTimeBR(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateISO(d);
}

function profileLabel(p: Profile | undefined): string {
  if (!p) return "—";
  return p.full_name || p.email || "—";
}

type FilterTab = "abertas" | "todas" | "concluidas";

function TarefasPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("abertas");
  const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteTaskId, setNoteTaskId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const noteTask = useMemo(
    () => tasks.find((t) => t.id === noteTaskId) ?? null,
    [tasks, noteTaskId],
  );

  // Atualizações (follow-ups) agrupadas por tarefa, mais recente primeiro.
  const updatesByTask = useMemo(() => {
    const m = new Map<string, TaskUpdate[]>();
    for (const u of updates) {
      const list = m.get(u.task_id) ?? [];
      list.push(u);
      m.set(u.task_id, list);
    }
    return m;
  }, [updates]);

  const load = async () => {
    setLoading(true);
    const [tasksRes, profilesRes, updatesRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .order("next_followup_at", { ascending: true, nullsFirst: false }),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("task_updates").select("*").order("created_at", { ascending: false }),
    ]);
    setTasks((tasksRes.data ?? []) as TaskRow[]);
    setProfiles((profilesRes.data ?? []) as Profile[]);
    setUpdates((updatesRes.data ?? []) as TaskUpdate[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = tasks;
    if (tab === "abertas")
      list = list.filter((t) => t.status === "pendente" || t.status === "em_andamento");
    else if (tab === "concluidas")
      list = list.filter((t) => t.status === "concluida" || t.status === "cancelada");
    if (onlyMine && user) list = list.filter((t) => t.assigned_to === user.id);
    return list;
  }, [tasks, tab, onlyMine, user]);

  const todayISO = dateISO(new Date());

  const completeTask = async (t: TaskRow) => {
    if (!user) return;
    setBusyId(t.id);
    const { error } = await supabase
      .from("tasks")
      .update({ status: "concluida", completed_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      setBusyId(null);
      return;
    }
    if (t.recurrence !== "none") {
      const base = t.next_followup_at ? new Date(`${t.next_followup_at}T00:00:00`) : new Date();
      const next = addRecurrence(base, t.recurrence, t.recurrence_interval);
      const { error: insErr } = await supabase.from("tasks").insert({
        title: t.title,
        description: t.description,
        assigned_to: t.assigned_to,
        created_by: user.id,
        priority: t.priority,
        recurrence: t.recurrence,
        recurrence_interval: t.recurrence_interval,
        next_followup_at: dateISO(next),
        parent_task_id: t.parent_task_id ?? t.id,
        status: "pendente",
      });
      if (insErr) {
        toast.error(
          `Tarefa concluída, mas não consegui criar a próxima ocorrência: ${insErr.message}`,
        );
      } else {
        toast.success(`Tarefa concluída — próxima ocorrência em ${fmtDateBR(dateISO(next))}`);
      }
    } else {
      toast.success("Tarefa concluída");
    }
    setBusyId(null);
    load();
  };

  const reopenTask = async (t: TaskRow) => {
    setBusyId(t.id);
    const { error } = await supabase
      .from("tasks")
      .update({ status: "pendente", completed_at: null })
      .eq("id", t.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tarefa reaberta");
    load();
  };

  const cancelTask = async (t: TaskRow) => {
    if (!(await confirm(`Cancelar a tarefa "${t.title}"?`))) return;
    setBusyId(t.id);
    const { error } = await supabase.from("tasks").update({ status: "cancelada" }).eq("id", t.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tarefa cancelada");
    load();
  };

  const deleteTask = async (t: TaskRow) => {
    if (!(await confirm(`Excluir a tarefa "${t.title}"? Essa ação não pode ser desfeita.`))) return;
    setBusyId(t.id);
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tarefa excluída");
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão</h1>
          <p className="text-muted-foreground">Tarefas internas, recorrentes ou pontuais</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4 mr-2" /> Nova tarefa
            </Button>
          </DialogTrigger>
          <TaskDialog
            open={open}
            editing={editing}
            profiles={profiles}
            currentUserId={user?.id ?? ""}
            onSaved={load}
            onClose={() => setOpen(false)}
          />
        </Dialog>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="abertas">Abertas</TabsTrigger>
            <TabsTrigger value="todas">Todas</TabsTrigger>
            <TabsTrigger value="concluidas">Concluídas/canceladas</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={onlyMine} onCheckedChange={setOnlyMine} />
          Só minhas tarefas
        </label>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">Nenhuma tarefa por aqui.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarefa</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => {
                  const overdue =
                    !!t.next_followup_at &&
                    t.next_followup_at < todayISO &&
                    (t.status === "pendente" || t.status === "em_andamento");
                  const recSummary = recurrenceSummary(t.recurrence, t.recurrence_interval);
                  const taskUpdates = updatesByTask.get(t.id) ?? [];
                  const lastUpdate = taskUpdates[0];
                  return (
                    <TableRow key={t.id}>
                      <TableCell
                        className="cursor-pointer hover:bg-muted/60"
                        title="Clique para ler, editar e registrar acompanhamento"
                        onClick={() => setNoteTaskId(t.id)}
                      >
                        <div className="font-medium flex items-center gap-2">
                          {t.title}
                          {recSummary && (
                            <span title={recSummary}>
                              <Repeat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            </span>
                          )}
                        </div>
                        {t.description && (
                          <div className="text-sm text-muted-foreground line-clamp-2">
                            {t.description}
                          </div>
                        )}
                        {lastUpdate && (
                          <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                            <span className="line-clamp-1">
                              <span className="font-medium">
                                {new Date(lastUpdate.created_at).toLocaleDateString("pt-BR")}
                              </span>{" "}
                              — {lastUpdate.content}
                              {taskUpdates.length > 1 && ` (+${taskUpdates.length - 1})`}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {profileLabel(profileById.get(t.assigned_to))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={t.priority === "alta" ? "destructive" : "outline"}
                          className={
                            t.priority === "media" ? "border-amber-500 text-amber-600" : undefined
                          }
                        >
                          {PRIORITY_LABELS[t.priority]}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn("text-sm", overdue && "text-destructive font-semibold")}
                      >
                        {t.next_followup_at ? fmtDateBR(t.next_followup_at) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            t.status === "concluida"
                              ? "secondary"
                              : overdue
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {STATUS_LABELS[t.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          {(t.status === "pendente" || t.status === "em_andamento") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Concluir"
                              disabled={busyId === t.id}
                              onClick={() => completeTask(t)}
                            >
                              <Check className="h-4 w-4 text-emerald-600" />
                            </Button>
                          )}
                          {(t.status === "concluida" || t.status === "cancelada") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Reabrir"
                              disabled={busyId === t.id}
                              onClick={() => reopenTask(t)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {(t.status === "pendente" || t.status === "em_andamento") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancelar"
                              disabled={busyId === t.id}
                              onClick={() => cancelTask(t)}
                            >
                              <X className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Editar"
                            onClick={() => {
                              setEditing(t);
                              setOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Excluir"
                            disabled={busyId === t.id}
                            onClick={() => deleteTask(t)}
                          >
                            {busyId === t.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NoteDialog
        task={noteTask}
        updates={noteTask ? (updatesByTask.get(noteTask.id) ?? []) : []}
        profileById={profileById}
        currentUserId={user?.id ?? ""}
        onClose={() => setNoteTaskId(null)}
        onSaved={load}
      />
    </div>
  );
}

function NoteDialog({
  task,
  updates,
  profileById,
  currentUserId,
  onClose,
  onSaved,
}: {
  task: TaskRow | null;
  updates: TaskUpdate[];
  profileById: Map<string, Profile>;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updateText, setUpdateText] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [posting, setPosting] = useState(false);
  const taskId = task?.id;

  // Só reinicia o formulário quando abre outra tarefa — o reload depois de
  // registrar um acompanhamento não pode apagar o texto que ainda não foi salvo.
  useEffect(() => {
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setUpdateText("");
    setNextDate(task?.next_followup_at ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const dirty = !!task && (title !== task.title || description !== (task.description ?? ""));
  const updateDirty = updateText.trim() !== "";

  const requestClose = async () => {
    if ((dirty || updateDirty) && !(await confirm("Descartar as alterações não salvas?"))) return;
    onClose();
  };

  const postUpdate = async () => {
    if (!task || !currentUserId) return;
    const text = updateText.trim();
    if (!text) {
      toast.error("Escreva o que aconteceu antes de registrar");
      return;
    }
    const prevDate = task.next_followup_at ?? "";
    const dateChanged = nextDate !== prevDate;
    // A mudança de data fica gravada no próprio registro, pra dar pra ver
    // quantas vezes o acompanhamento já foi empurrado pra frente.
    const content = dateChanged
      ? `${text}\n↪ Próximo acompanhamento: ${prevDate ? fmtDateBR(prevDate) : "sem data"} → ${
          nextDate ? fmtDateBR(nextDate) : "sem data"
        }`
      : text;
    setPosting(true);
    const { error } = await supabase
      .from("task_updates")
      .insert({ task_id: task.id, author_id: currentUserId, content });
    if (error) {
      setPosting(false);
      toast.error(error.message);
      return;
    }
    if (dateChanged) {
      const { error: dateErr } = await supabase
        .from("tasks")
        .update({ next_followup_at: nextDate || null })
        .eq("id", task.id);
      if (dateErr) {
        setPosting(false);
        toast.error(`Acompanhamento registrado, mas a data não foi alterada: ${dateErr.message}`);
        onSaved();
        return;
      }
    }
    setPosting(false);
    setUpdateText("");
    toast.success("Acompanhamento registrado");
    onSaved();
  };

  const deleteUpdate = async (u: TaskUpdate) => {
    if (!(await confirm("Excluir este registro de acompanhamento?"))) return;
    const { error } = await supabase.from("task_updates").delete().eq("id", u.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onSaved();
  };

  const save = async () => {
    if (!task) return;
    if (!title.trim()) {
      toast.error("O título não pode ficar vazio");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("tasks")
      .update({ title, description: description || null })
      .eq("id", task.id);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Salvo!");
    onSaved();
    onClose();
  };

  return (
    <Dialog
      open={!!task}
      onOpenChange={(v) => {
        if (!v) requestClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Texto da tarefa</DialogTitle>
        </DialogHeader>
        <Input
          aria-label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg font-semibold border-0 shadow-none px-0 focus-visible:ring-0"
        />
        <Textarea
          aria-label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Escreva aqui..."
          className="min-h-[20vh] text-base leading-relaxed resize-y"
        />
        <DialogFooter className="items-center gap-2">
          <span className="text-xs text-muted-foreground mr-auto">
            {dirty ? "Alterações não salvas · Ctrl/⌘ + Enter para salvar" : "Sem alterações"}
          </span>
          <Button type="button" onClick={save} disabled={submitting || !dirty}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Acompanhamento</h3>
            {updates.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {updates.length} registro{updates.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <Textarea
            aria-label="Nova atualização"
            value={updateText}
            onChange={(e) => setUpdateText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                postUpdate();
              }
            }}
            placeholder="Ex.: hoje falei com o Alex, ainda sem notícia."
            rows={2}
          />
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="next-followup" className="text-xs">
                Próximo acompanhamento
              </Label>
              <Input
                id="next-followup"
                type="date"
                className="w-40"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </div>
            {[
              { label: "+1 dia", days: 1 },
              { label: "+3 dias", days: 3 },
              { label: "+1 semana", days: 7 },
            ].map((o) => (
              <Button
                key={o.days}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNextDate(addDaysISO(o.days))}
              >
                {o.label}
              </Button>
            ))}
            <Button
              type="button"
              className="ml-auto"
              onClick={postUpdate}
              disabled={posting || !updateDirty}
            >
              {posting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar
            </Button>
          </div>

          {updates.length > 0 && (
            <ul className="space-y-2">
              {updates.map((u) => (
                <li key={u.id} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {profileLabel(profileById.get(u.author_id))}
                    </span>
                    <span>{fmtDateTimeBR(u.created_at)}</span>
                    {u.author_id === currentUserId && (
                      <button
                        type="button"
                        className="ml-auto hover:text-destructive"
                        title="Excluir registro"
                        onClick={() => deleteUpdate(u)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{u.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({
  open,
  editing,
  profiles,
  currentUserId,
  onSaved,
  onClose,
}: {
  open: boolean;
  editing: TaskRow | null;
  profiles: Profile[];
  currentUserId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("media");
  const [nextFollowupAt, setNextFollowupAt] = useState("");
  const [recurrence, setRecurrence] = useState<TaskRecurrence>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  // Recarrega o formulário toda vez que o diálogo abre, para "Nova tarefa"
  // não herdar os dados da tarefa criada/editada anteriormente.
  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setDescription(editing?.description ?? "");
    setAssignedTo(editing?.assigned_to ?? currentUserId);
    setPriority(editing?.priority ?? "media");
    setNextFollowupAt(editing?.next_followup_at ?? "");
    setRecurrence(editing?.recurrence ?? "none");
    setRecurrenceInterval(String(editing?.recurrence_interval ?? 1));
  }, [open, editing, currentUserId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedTo) {
      toast.error("Escolha um responsável");
      return;
    }
    setSubmitting(true);
    const payload = {
      title,
      description: description || null,
      assigned_to: assignedTo,
      priority,
      next_followup_at: nextFollowupAt || null,
      recurrence,
      recurrence_interval: recurrence === "none" ? 1 : Math.max(1, Number(recurrenceInterval) || 1),
    };
    const { error } = editing
      ? await supabase.from("tasks").update(payload).eq("id", editing.id)
      : await supabase
          .from("tasks")
          .insert({ ...payload, created_by: currentUserId, status: "pendente" });
    setSubmitting(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Salvo!");
      onSaved();
      onClose();
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Título</Label>
          <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">Descrição</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Responsável</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha um responsável" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {profileLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {PRIORITY_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="due">Prazo / próximo acompanhamento</Label>
          <Input
            id="due"
            type="date"
            value={nextFollowupAt}
            onChange={(e) => setNextFollowupAt(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 items-end">
          <div className="space-y-2">
            <Label>Recorrência</Label>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v as TaskRecurrence)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não repete</SelectItem>
                <SelectItem value="daily">Diária</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {recurrence !== "none" && (
            <div className="space-y-2">
              <Label htmlFor="interval">A cada</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="interval"
                  type="number"
                  min="1"
                  className="w-20"
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  {RECURRENCE_LABELS[recurrence]}
                </span>
              </div>
            </div>
          )}
        </div>
        {recurrence !== "none" && (
          <p className="text-xs text-muted-foreground">
            Ao concluir essa tarefa, a próxima ocorrência é criada automaticamente com o prazo
            recalculado.
          </p>
        )}
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

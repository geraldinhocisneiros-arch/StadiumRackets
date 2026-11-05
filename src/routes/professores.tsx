import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Plus, Pencil, Trash2, Loader2, KeyRound, Copy, Check, MessageCircle, CalendarDays } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { createTeacherSignupToken } from "@/lib/teachers.functions";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { sendTeacherHolidayConfirmationRequest } from "@/lib/whatsapp";
import { findHoliday, getUpcomingHolidays, type Holiday } from "@/lib/holidays";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/professores")({
  component: ProfessoresRouteComponent,
});

function ProfessoresRouteComponent() {
  const { pathname } = useLocation();
  const isRoot = pathname === "/professores" || pathname === "/professores/";
  if (!isRoot) return <Outlet />;
  return (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <ProfessoresPage />
    </RequireAuth>
  );
}


interface Teacher {
  id: string;
  name: string;
  active: boolean;
  user_id: string | null;
  phone: string | null;
}

function ProfessoresPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [accessTarget, setAccessTarget] = useState<Teacher | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Teacher | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("teachers").select("*").order("name");
    setItems((data ?? []) as Teacher[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (t: Teacher) => {
    const extra = t.user_id
      ? "\n\nEsse professor tem login ativo no portal — o acesso não é removido automaticamente."
      : "";
    if (
      !(await confirm(
        `Excluir o professor "${t.name}"? Aulas, horários fixos e reservas já registrados continuam no histórico, só perdem o vínculo com este professor.${extra}`,
      ))
    ) {
      return;
    }
    setDeletingId(t.id);
    const { error } = await supabase.from("teachers").delete().eq("id", t.id);
    setDeletingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Professor excluído.");
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Professores</h1>
          <p className="text-muted-foreground">
            Cadastro dos professores para vincular aos horários dos mensalistas.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4 mr-2" /> Novo professor
            </Button>
          </DialogTrigger>
          <TeacherDialog editing={editing} onSaved={load} onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Carregando...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">Nenhum professor cadastrado.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.active ? "Ativo" : "Inativo"}</TableCell>
                    <TableCell>
                      {t.user_id ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          Login ativo
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAccessTarget(t)}
                        >
                          <KeyRound className="h-3.5 w-3.5 mr-2" /> Convidar
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmTarget(t)}
                          title="Solicitar confirmação de aulas por WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5 mr-1" /> Confirmar aulas
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(t); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={deletingId === t.id}
                            onClick={() => void handleDelete(t)}
                            title="Excluir professor"
                          >
                            {deletingId === t.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TeacherAccessDialog
        teacher={accessTarget}
        onClose={() => setAccessTarget(null)}
        onSaved={load}
      />

      <TeacherHolidayConfirmationDialog
        teacher={confirmTarget}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}

function TeacherDialog({
  editing,
  onSaved,
  onClose,
}: {
  editing: Teacher | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(editing?.name ?? "");
    setPhone(editing?.phone ?? "");
    setActive(editing?.active ?? true);
  }, [editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const payload = { name: name.trim(), phone: phone.trim() || null, active };
    const { error } = editing
      ? await supabase.from("teachers").update(payload).eq("id", editing.id)
      : await supabase.from("teachers").insert(payload);
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
        <DialogTitle>{editing ? "Editar professor" : "Novo professor"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tname">Nome</Label>
          <Input id="tname" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tphone">Telefone / WhatsApp</Label>
          <Input
            id="tphone"
            placeholder="(81) 9XXXX-XXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <Label htmlFor="tactive" className="cursor-pointer">Ativo</Label>
          <Switch id="tactive" checked={active} onCheckedChange={setActive} />
        </div>
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

function TeacherHolidayConfirmationDialog({
  teacher,
  onClose,
}: {
  teacher: Teacher | null;
  onClose: () => void;
}) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (teacher) setDate(undefined);
  }, [teacher]);

  const today = new Date();
  const todayISO = format(today, "yyyy-MM-dd");
  const upcoming: Holiday[] = getUpcomingHolidays(todayISO, 6);
  const selectedISO = date ? format(date, "yyyy-MM-dd") : null;
  const matchedHoliday = selectedISO ? findHoliday(selectedISO) : null;

  const handleSend = () => {
    if (!teacher || !date) return;
    void sendTeacherHolidayConfirmationRequest({
      teacherName: teacher.name,
      phone: teacher.phone,
      date: format(date, "yyyy-MM-dd"),
    });
    onClose();
  };

  return (
    <Dialog open={!!teacher} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar aulas — {teacher?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {teacher && !teacher.phone && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200">
              Este professor ainda não tem telefone cadastrado. Edite o cadastro
              para incluir o WhatsApp antes de enviar a mensagem.
            </div>
          )}

          <div className="space-y-2">
            <Label>Data das aulas a confirmar</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {date
                    ? format(date, "EEEE, dd/MM/yyyy", { locale: ptBR })
                    : "Selecione uma data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d ?? undefined);
                    setPickerOpen(false);
                  }}
                  locale={ptBR}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            {matchedHoliday && (
              <div className="rounded-md bg-primary/10 text-primary text-xs p-2">
                📌 Feriado detectado: <strong>{matchedHoliday.name}</strong> — o motivo será
                incluído automaticamente na mensagem.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Próximos feriados (toque para selecionar)</Label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {upcoming.length === 0 && (
                <span className="text-xs text-muted-foreground">Nenhum feriado nos próximos meses.</span>
              )}
              {upcoming.map((h) => {
                const [yy, mm, dd] = h.date.split("-").map(Number);
                const isSelected = selectedISO === h.date;
                return (
                  <Badge
                    key={h.date + h.name}
                    variant={isSelected ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setDate(new Date(yy!, (mm ?? 1) - 1, dd ?? 1))}
                  >
                    {String(dd).padStart(2, "0")}/{String(mm).padStart(2, "0")} · {h.name}
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSend} disabled={!teacher?.phone || !date}>
            <MessageCircle className="h-4 w-4 mr-2" /> Enviar WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeacherAccessDialog({
  teacher,
  onClose,
  onSaved,
}: {
  teacher: Teacher | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createToken = useServerFn(createTeacherSignupToken);

  useEffect(() => {
    setLink(null);
    setExpiresAt(null);
    setCopied(false);
  }, [teacher]);

  const generate = async () => {
    if (!teacher) return;
    setGenerating(true);
    try {
      const r = await createToken({ data: { teacherId: teacher.id } });
      const url = `${window.location.origin}/professor/cadastro/${r.token}`;
      setLink(url);
      setExpiresAt(r.expiresAt);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao gerar convite");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const shareWhatsapp = () => {
    if (!teacher || !link) return;
    const msg =
      `Olá ${teacher.name}! Use este link para criar seu acesso ao Stadium Rackets ` +
      `e gerenciar as aulas dos seus alunos: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  return (
    <Dialog open={!!teacher} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar {teacher?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Gere um link de convite para o professor criar o próprio login e senha.
            Ao concluir o cadastro, ele terá acesso ao painel do professor para
            gerenciar e cancelar as aulas dos alunos vinculados a ele — as mesmas
            permissões dos demais professores.
          </div>

          {!link ? (
            <Button onClick={generate} disabled={generating} className="w-full">
              {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Gerar link de convite
            </Button>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Link do convite</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input readOnly value={link} className="text-xs" />
                  <Button type="button" variant="outline" size="icon" onClick={copyLink} title="Copiar">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {expiryLabel && (
                <p className="text-xs text-muted-foreground">Válido até {expiryLabel}.</p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={shareWhatsapp}>
                  Enviar por WhatsApp
                </Button>
                <Button type="button" variant="ghost" onClick={generate} disabled={generating}>
                  {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Gerar novo
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Loader2, Pencil, PlaneTakeoff, Plus, Trash2 } from "lucide-react";
import { WEEKDAY_LABELS } from "@/lib/pricing";
import { VacationCancelDialog } from "./VacationCancelDialog";
import { offerBookingReservedNotification } from "@/lib/whatsapp";
import { timeToHours, courtShort } from "@/lib/court-map";
import { dateISOInRecife } from "@/lib/format";

interface Teacher {
  id: string;
  name: string;
  active: boolean;
}

interface Schedule {
  id: string;
  client_id: string;
  teacher_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
  notes: string | null;
  teachers?: { id: string; name: string } | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

const fmtBR = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const MENSALISTA_CATEGORY_NAMES = new Set(["mensalista", "tenis de mesa (mensalista)"]);

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const timeShort = (t: string) => t.slice(0, 5);

export function ClientSchedulesCard({
  clientId,
  categoryId,
  canManage,
}: {
  clientId: string;
  categoryId: string | null;
  canManage: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [vacOpen, setVacOpen] = useState(false);
  const confirm = useConfirm();
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => {
    (async () => {
      if (!categoryId) {
        setVisible(false);
        setLoading(false);
        return;
      }
      const { data: cat } = await supabase
        .from("client_categories")
        .select("name")
        .eq("id", categoryId)
        .maybeSingle();
      setVisible(MENSALISTA_CATEGORY_NAMES.has(norm(cat?.name)));
    })();
  }, [categoryId]);

  const load = async () => {
    setLoading(true);
    const [schedRes, teachersRes] = await Promise.all([
      supabase
        .from("client_schedules")
        .select("*, teachers(id, name)")
        .eq("client_id", clientId)
        .order("weekday")
        .order("start_time"),
      supabase.from("teachers").select("id, name, active").order("name"),
    ]);
    setSchedules((schedRes.data ?? []) as Schedule[]);
    setTeachers((teachersRes.data ?? []) as Teacher[]);
    setLoading(false);
  };

  useEffect(() => {
    if (visible) load();
  }, [visible, clientId]);

  const remove = async (id: string) => {
    if (!(await confirm("Remover este horário?"))) return;
    const { error } = await supabase.from("client_schedules").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Removido");
      load();
    }
  };

  if (!visible) return null;

  // Fixo removido pelo mapa "a partir de" uma data não é apagado: ganha
  // valid_until (véspera) pra guardar as semanas anteriores. Aqui ele sai
  // da lista principal e fica em "Encerrados", só como histórico.
  const today = dateISOInRecife(new Date());
  const active = schedules.filter((s) => !s.valid_until || s.valid_until >= today);
  const ended = schedules.filter((s) => s.valid_until && s.valid_until < today);

  const renderRow = (s: Schedule, isEnded: boolean) => (
    <TableRow key={s.id} className={isEnded ? "text-muted-foreground" : undefined}>
      <TableCell>{WEEKDAY_LABELS[s.weekday]}</TableCell>
      <TableCell>
        {timeShort(s.start_time)}–{timeShort(s.end_time)}
      </TableCell>
      <TableCell>{s.court ? `${courtShort(s.court)}` : "—"}</TableCell>
      <TableCell>{s.teachers?.name ?? "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {isEnded
          ? `Encerrado em ${fmtBR(s.valid_until)}`
          : s.valid_from || s.valid_until
            ? `${fmtBR(s.valid_from) ?? "…"} → ${fmtBR(s.valid_until) ?? "sem fim"}`
            : "Permanente"}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{s.notes ?? "—"}</TableCell>
      {canManage && (
        <TableCell className="text-right">
          {!isEnded && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditing(s);
                setOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </TableCell>
      )}
    </TableRow>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Horários fixos & professor</CardTitle>
        {canManage && (
          <div className="flex items-center gap-2">
            {active.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVacOpen(true)}
              >
                <PlaneTakeoff className="h-4 w-4 mr-2" /> Cancelar férias/viagem
              </Button>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Adicionar horário
              </Button>
              <ScheduleDialog
                clientId={clientId}
                editing={editing}
                teachers={teachers.filter((t) => t.active || t.id === editing?.teacher_id)}
                onSaved={load}
                onClose={() => setOpen(false)}
              />
            </Dialog>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : schedules.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-sm">
            Nenhum horário fixo cadastrado.
          </div>
        ) : (
          <>
          {active.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              Nenhum horário fixo ativo.
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Quadra</TableHead>
                <TableHead>Professor</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Obs.</TableHead>
                {canManage && <TableHead className="w-24"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>{active.map((s) => renderRow(s, false))}</TableBody>
          </Table>
          )}
          {ended.length > 0 && (
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowEnded((v) => !v)}
              >
                {showEnded ? "Ocultar" : "Ver"} encerrados ({ended.length})
              </Button>
              {showEnded && (
                <Table>
                  <TableBody>{ended.map((s) => renderRow(s, true))}</TableBody>
                </Table>
              )}
            </div>
          )}
          </>
        )}
      </CardContent>
      <VacationCancelDialog
        clientId={clientId}
        schedules={active}
        open={vacOpen}
        onOpenChange={setVacOpen}
        onSaved={load}
      />
    </Card>
  );
}

function ScheduleDialog({
  clientId,
  editing,
  teachers,
  onSaved,
  onClose,
}: {
  clientId: string;
  editing: Schedule | null;
  teachers: Teacher[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [weekday, setWeekday] = useState<string>("2");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [court, setCourt] = useState<string>("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [validFrom, setValidFrom] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [shareConflict, setShareConflict] = useState<{
    groupIds: string[];
    names: string[];
  } | null>(null);

  useEffect(() => {
    setWeekday(editing ? String(editing.weekday) : "2");
    setStartTime(editing ? timeShort(editing.start_time) : "09:00");
    setEndTime(editing ? timeShort(editing.end_time) : "10:00");
    setCourt(editing?.court ? String(editing.court) : "");
    setTeacherId(editing?.teacher_id ?? "");
    setNotes(editing?.notes ?? "");
    setValidFrom(editing?.valid_from ?? "");
    setValidUntil(editing?.valid_until ?? "");
    setShareConflict(null);
  }, [editing]);

  // Quem já ocupa essa quadra/dia/horário — usado tanto pra oferecer
  // "dividir a quadra" quando dá conflito quanto pra saber quais ids
  // excluir da checagem de conflito ao confirmar a divisão (mesmo critério
  // de sobreposição usado pela RPC: mesma quadra/dia, horário sobreposto,
  // ainda dentro da vigência).
  const findCourtOccupants = async (weekdayNum: number, courtNum: number) => {
    const { data } = await supabase
      .from("client_schedules")
      .select("id, start_time, end_time, valid_until, clients!client_id(full_name)")
      .eq("weekday", weekdayNum)
      .eq("court", courtNum);
    type Row = {
      id: string;
      start_time: string;
      end_time: string;
      valid_until: string | null;
      clients: { full_name: string } | { full_name: string }[] | null;
    };
    const todayIso = new Date().toISOString().slice(0, 10);
    const newStart = timeToHours(startTime);
    const newEnd = timeToHours(endTime);
    return ((data ?? []) as Row[])
      .filter((r) => r.id !== editing?.id)
      .filter((r) => !r.valid_until || r.valid_until >= todayIso)
      // Comparação numérica, não de string: start_time/end_time vêm do banco
      // como "HH:MM:SS" e startTime/endTime do formulário como "HH:MM" —
      // comparar as strings direto tratava "18:00:00" como maior que
      // "18:00" (sufixo mais longo = "maior" na ordenação lexicográfica),
      // fazendo um horário adjacente (17h–18h) aparecer como se sobrepusesse
      // um novo horário começando às 18h.
      .filter((r) => timeToHours(r.start_time) < newEnd && timeToHours(r.end_time) > newStart)
      .map((r) => ({
        id: r.id,
        name: Array.isArray(r.clients) ? (r.clients[0]?.full_name ?? "cliente") : (r.clients?.full_name ?? "cliente"),
      }));
  };

  const save = async (groupIds?: string[], replaceIds?: string[]) => {
    setSubmitting(true);
    // Passa pela RPC (não INSERT/UPDATE cru) porque ela valida conflito
    // contra outros horários fixos na mesma quadra/dia/horário antes de
    // salvar — mudar a quadra de um cliente pra uma já ocupada por outro
    // horário fixo não pode mais passar em silêncio.
    const { data, error } = await supabase.rpc("admin_save_client_schedule", {
      _id: editing?.id ?? null,
      _client_id: clientId,
      _weekday: Number(weekday),
      _start_time: startTime,
      _end_time: endTime,
      _court: court ? Number(court) : null,
      _teacher_id: teacherId || null,
      _notes: notes.trim() || null,
      _valid_from: validFrom || null,
      _valid_until: validUntil || null,
      ...(groupIds && groupIds.length > 0 ? { _group_ids: groupIds } : {}),
      ...(replaceIds && replaceIds.length > 0 ? { _replace_ids: replaceIds } : {}),
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as {
      ok: boolean;
      error?: string;
      conflict_type?: string;
      conflict_id?: string;
    } | null;
    if (!res?.ok) {
      // Conflito com outro horário fixo já cadastrado: em vez de barrar de
      // cara, oferece dividir a quadra com quem já está lá — é o caso comum
      // de dois clientes compartilhando o mesmo fixo (custo/horário
      // rateado), não necessariamente um erro de cadastro.
      if (res?.conflict_type === "fixed_schedule" && court) {
        const occupants = await findCourtOccupants(Number(weekday), Number(court));
        if (occupants.length > 0) {
          setShareConflict({ groupIds: occupants.map((o) => o.id), names: occupants.map((o) => o.name) });
          return;
        }
      }
      toast.error(res?.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success("Salvo!");
    if (!editing) {
      // Calcula próxima ocorrência do weekday
      const wd = Number(weekday);
      const today = new Date();
      const diff = (wd - today.getDay() + 7) % 7 || 7;
      const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
      const bookingDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      void offerBookingReservedNotification({
        clientId,
        court: court ? Number(court) : 0,
        bookingDate,
        startTime: `${startTime}:00`,
        endTime: `${endTime}:00`,
        isFixed: true,
      });
    }
    onSaved();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (endTime <= startTime) {
      toast.error("Hora final deve ser maior que a inicial");
      return;
    }
    if (validFrom && validUntil && validUntil < validFrom) {
      toast.error("Vigência: data final deve ser maior que a inicial");
      return;
    }
    setShareConflict(null);
    await save();
  };

  const confirmShare = async () => {
    if (!shareConflict) return;
    await save(shareConflict.groupIds);
  };

  // Ocupa o horário só durante a vigência: o fixo de quem já está lá fica
  // liberado nesse período e volta sozinho depois (nada é dividido).
  const confirmReplace = async () => {
    if (!shareConflict) return;
    await save(undefined, shareConflict.groupIds);
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? "Editar horário" : "Novo horário"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {shareConflict && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm space-y-2 dark:border-amber-900 dark:bg-amber-950">
            <p>
              Esse horário já é de {shareConflict.names.join(" e ")}. Deseja dividir a quadra
              com {shareConflict.names.length > 1 ? "eles" : "essa pessoa"} (os dois ficam com o
              mesmo horário fixo)?
            </p>
            {validUntil && (
              <p>
                Ou, se {shareConflict.names.length > 1 ? "eles estão ausentes" : "essa pessoa está ausente"},
                ocupar o horário só de {fmtBR(validFrom) ?? "hoje"} até {fmtBR(validUntil)}:
                o fixo de {shareConflict.names.join(" e ")} fica liberado nesse período e volta
                normalmente depois.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={confirmShare} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Dividir quadra
              </Button>
              {validUntil && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={confirmReplace}
                  disabled={submitting}
                >
                  Substituir só no período
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => setShareConflict(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2 col-span-2">
            <Label>Dia da semana</Label>
            <Select value={weekday} onValueChange={(v) => { setWeekday(v); setShareConflict(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAY_LABELS.map((label, i) => (
                  <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Início</Label>
            <Input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setShareConflict(null); }} required />
          </div>
          <div className="space-y-2">
            <Label>Fim</Label>
            <Input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setShareConflict(null); }} required />
          </div>
          <div className="space-y-2">
            <Label>Quadra (opcional)</Label>
            <Input type="number" min={1} max={9} value={court} onChange={(e) => { setCourt(e.target.value); setShareConflict(null); }} placeholder="1 a 9" />
          </div>
          <div className="space-y-2">
            <Label>Professor</Label>
            <Select value={teacherId || "__none"} onValueChange={(v) => setTeacherId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Nenhum —</SelectItem>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 col-span-2 rounded-md border p-3 bg-muted/30">
            <Label className="text-sm">Vigência (opcional)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-normal">A partir de</Label>
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-normal">Até</Label>
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Deixe em branco para plano permanente. Use estas datas quando o plano fixo tiver duração limitada (ex.: só em julho) ou para cadastrar um substituto por um período determinado.
            </p>
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
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

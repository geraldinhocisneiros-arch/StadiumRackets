import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Loader2, Plus, Trash2, Settings, Pencil } from "lucide-react";
import { WEEKDAY_LABELS } from "@/lib/pricing";
import { courtShort } from "@/lib/court-map";

interface CourtSetting {
  court: number;
  opens_on: string;
  closes_on: string;
  active: boolean;
}

interface CourtHour {
  id: string;
  court: number;
  weekday: number;
  open_time: string;
  close_time: string;
}

/**
 * Painel diretoria-only pra configurar, sem deploy, quais quadras têm fila
 * de horário fixo aberta (e em qual janela de datas) e a grade de horários
 * válidos por quadra+dia da semana — é o que torna a fila reutilizável pra
 * quadras futuras com grids diferentes do padrão de hora cheia.
 */
export function FixedWaitlistCourtSettings() {
  const [settings, setSettings] = useState<CourtSetting[]>([]);
  const [hours, setHours] = useState<CourtHour[]>([]);
  const [loading, setLoading] = useState(false);

  const [settingOpen, setSettingOpen] = useState(false);
  const [settingIsEdit, setSettingIsEdit] = useState(false);
  const [settingCourt, setSettingCourt] = useState("10");
  const [settingOpensOn, setSettingOpensOn] = useState("");
  const [settingClosesOn, setSettingClosesOn] = useState("");
  const [settingActive, setSettingActive] = useState(true);
  const [savingSetting, setSavingSetting] = useState(false);

  const [hourOpen, setHourOpen] = useState(false);
  const [hourCourt, setHourCourt] = useState("10");
  const [hourWeekday, setHourWeekday] = useState("1");
  const [hourOpenTime, setHourOpenTime] = useState("05:30");
  const [hourCloseTime, setHourCloseTime] = useState("22:30");
  const [savingHour, setSavingHour] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: s, error: sErr }, { data: h, error: hErr }] = await Promise.all([
      supabase.from("fixed_waitlist_court_settings").select("*").order("court"),
      supabase
        .from("fixed_waitlist_court_hours")
        .select("*")
        .order("court")
        .order("weekday"),
    ]);
    if (sErr) toast.error(sErr.message);
    if (hErr) toast.error(hErr.message);
    setSettings((s as CourtSetting[]) ?? []);
    setHours((h as CourtHour[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAddSetting = () => {
    setSettingIsEdit(false);
    setSettingCourt("10");
    setSettingOpensOn("");
    setSettingClosesOn("");
    setSettingActive(true);
    setSettingOpen(true);
  };

  const openEditSetting = (s: CourtSetting) => {
    setSettingIsEdit(true);
    setSettingCourt(String(s.court));
    setSettingOpensOn(s.opens_on);
    setSettingClosesOn(s.closes_on);
    setSettingActive(s.active);
    setSettingOpen(true);
  };

  const saveSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingOpensOn || !settingClosesOn) {
      toast.error("Informe as duas datas.");
      return;
    }
    setSavingSetting(true);
    const { error } = await supabase.from("fixed_waitlist_court_settings").upsert({
      court: Number(settingCourt),
      opens_on: settingOpensOn,
      closes_on: settingClosesOn,
      active: settingActive,
    });
    setSavingSetting(false);
    if (error) return toast.error(error.message);
    toast.success("Configuração salva.");
    setSettingOpen(false);
    void load();
  };

  const toggleActive = async (court: number, active: boolean) => {
    const { error } = await supabase
      .from("fixed_waitlist_court_settings")
      .update({ active })
      .eq("court", court);
    if (error) return toast.error(error.message);
    void load();
  };

  const removeSetting = async (court: number) => {
    if (!(await confirm(`Remover a configuração da fila da Quadra ${court}?`))) return;
    const { error } = await supabase.from("fixed_waitlist_court_settings").delete().eq("court", court);
    if (error) return toast.error(error.message);
    toast.success("Removido.");
    void load();
  };

  const openAddHour = () => {
    setHourCourt("10");
    setHourWeekday("1");
    setHourOpenTime("05:30");
    setHourCloseTime("22:30");
    setHourOpen(true);
  };

  const saveHour = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hourOpenTime >= hourCloseTime) {
      toast.error("Horário final deve ser depois do inicial.");
      return;
    }
    setSavingHour(true);
    const { error } = await supabase.from("fixed_waitlist_court_hours").upsert(
      {
        court: Number(hourCourt),
        weekday: Number(hourWeekday),
        open_time: hourOpenTime,
        close_time: hourCloseTime,
      },
      { onConflict: "court,weekday" },
    );
    setSavingHour(false);
    if (error) return toast.error(error.message);
    toast.success("Horário salvo.");
    setHourOpen(false);
    void load();
  };

  const removeHour = async (id: string) => {
    if (!(await confirm("Remover este horário da grade?"))) return;
    const { error } = await supabase.from("fixed_waitlist_court_hours").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido.");
    void load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" /> Configurações da fila fixa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Quadras com fila aberta</div>
                <Button size="sm" variant="outline" onClick={openAddSetting}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Nova quadra
                </Button>
              </div>
              {settings.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhuma quadra configurada.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quadra</TableHead>
                      <TableHead>Abre em</TableHead>
                      <TableHead>Fecha em</TableHead>
                      <TableHead>Ativa</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settings.map((s) => (
                      <TableRow key={s.court}>
                        <TableCell>{courtShort(s.court)}</TableCell>
                        <TableCell>{new Date(`${s.opens_on}T00:00:00`).toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell>{new Date(`${s.closes_on}T00:00:00`).toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell>
                          <Switch
                            checked={s.active}
                            onCheckedChange={(v) => void toggleActive(s.court, v)}
                          />
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => openEditSetting(s)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void removeSetting(s.court)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Grade de horários por quadra/dia</div>
                <Button size="sm" variant="outline" onClick={openAddHour}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Novo horário
                </Button>
              </div>
              {hours.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum horário configurado.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quadra</TableHead>
                      <TableHead>Dia da semana</TableHead>
                      <TableHead>Abre às</TableHead>
                      <TableHead>Fecha às</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hours.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{courtShort(h.court)}</TableCell>
                        <TableCell>{WEEKDAY_LABELS[h.weekday]}</TableCell>
                        <TableCell>{h.open_time.slice(0, 5)}</TableCell>
                        <TableCell>{h.close_time.slice(0, 5)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => void removeHour(h.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={settingOpen} onOpenChange={setSettingOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{settingIsEdit ? `Editar Quadra ${settingCourt}` : "Nova quadra"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveSetting} className="space-y-3">
            <div>
              <Label>Quadra</Label>
              <Input
                type="number"
                min={1}
                value={settingCourt}
                onChange={(e) => setSettingCourt(e.target.value)}
                disabled={settingIsEdit}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Abre em</Label>
                <Input
                  type="date"
                  value={settingOpensOn}
                  onChange={(e) => setSettingOpensOn(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Fecha em</Label>
                <Input
                  type="date"
                  value={settingClosesOn}
                  onChange={(e) => setSettingClosesOn(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSettingOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={savingSetting}>
                {savingSetting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={hourOpen} onOpenChange={setHourOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Configurar horário</DialogTitle></DialogHeader>
          <form onSubmit={saveHour} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Quadra</Label>
                <Input
                  type="number"
                  min={1}
                  value={hourCourt}
                  onChange={(e) => setHourCourt(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Dia da semana</Label>
                <Select value={hourWeekday} onValueChange={setHourWeekday}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_LABELS.map((label, idx) => (
                      <SelectItem key={idx} value={String(idx)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Abre às</Label>
                <Input
                  type="time"
                  value={hourOpenTime}
                  onChange={(e) => setHourOpenTime(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Fecha às</Label>
                <Input
                  type="time"
                  value={hourCloseTime}
                  onChange={(e) => setHourCloseTime(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setHourOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={savingHour}>
                {savingHour && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

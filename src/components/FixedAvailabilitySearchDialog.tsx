import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Repeat, MessageCircle, X } from "lucide-react";
import {
  COURTS,
  TENNIS_COURT,
  courtShort,
  isPickleballCourt,
  HOUR_SLOTS,
  courtLabel,
  dateISO,
  hourLabel,
  hourEndLabel,
  timeToHours,
  weekdayShort,
} from "@/lib/court-map";

interface ScheduleRow {
  weekday: number;
  court: number | null;
  start_time: string;
  end_time: string;
  valid_until: string | null;
}

interface WeekdayGroup {
  weekdays: number[];
}

const MAX_GROUPS = 4;
// Domingo/sábado ficam disponíveis mas fora da ordem "útil" padrão, que é
// como a maioria dos pedidos chega ("segunda e quarta", "terça e quinta").
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function FixedAvailabilitySearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [groups, setGroups] = useState<WeekdayGroup[]>([{ weekdays: [] }]);
  const [hours, setHours] = useState<number[]>([]);
  const [courtFilter, setCourtFilter] = useState<"any" | "tenis" | "pickleball">("any");
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);

  useEffect(() => {
    if (open) {
      setGroups([{ weekdays: [] }]);
      setHours([]);
      setCourtFilter("any");
      setSchedules([]);
    }
  }, [open]);

  const allWeekdays = useMemo(
    () => Array.from(new Set(groups.flatMap((g) => g.weekdays))).sort(),
    [groups],
  );

  const load = useCallback(async () => {
    if (allWeekdays.length === 0) {
      setSchedules([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("client_schedules")
      .select("weekday, court, start_time, end_time, valid_until")
      .in("weekday", allWeekdays);
    setSchedules((data ?? []) as ScheduleRow[]);
    setLoading(false);
  }, [allWeekdays]);

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allWeekdays.join(","), load]);

  // Livre = nenhum horário fixo ATIVO (ignora exceções de férias/viagem —
  // aquilo é uma liberação pontual de uma data específica, o compromisso
  // semanal continua existindo e o cliente volta a ocupar a quadra) cobre
  // esse dia/hora, considerando só vigência (valid_until vencido = expirou
  // de verdade e não bloqueia mais).
  const freeCourtsFor = useCallback(
    (weekday: number, hour: number): number[] => {
      const today = dateISO(new Date());
      const courtsToCheck =
        courtFilter === "any"
          ? [...COURTS]
          : courtFilter === "tenis"
            ? [TENNIS_COURT]
            : COURTS.filter((c) => isPickleballCourt(c));
      return courtsToCheck.filter((c) => {
        const occupied = schedules.some((s) => {
          if (s.weekday !== weekday) return false;
          if (!s.court || s.court !== c) return false;
          if (s.valid_until && s.valid_until < today) return false;
          const start = timeToHours(s.start_time);
          const end = timeToHours(s.end_time);
          return start < hour + 1 && end > hour;
        });
        return !occupied;
      });
    },
    [schedules, courtFilter],
  );

  interface GroupHourResult {
    group: WeekdayGroup;
    hour: number;
    perWeekday: { weekday: number; freeCourts: number[] }[];
    commonCourts: number[];
  }

  const results = useMemo<GroupHourResult[]>(() => {
    const rows: GroupHourResult[] = [];
    for (const g of groups) {
      if (g.weekdays.length === 0) continue;
      const orderedWeekdays = [...g.weekdays].sort(
        (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b),
      );
      for (const h of [...hours].sort((a, b) => a - b)) {
        const perWeekday = orderedWeekdays.map((wd) => ({
          weekday: wd,
          freeCourts: freeCourtsFor(wd, h),
        }));
        const commonCourts = perWeekday.reduce<number[]>(
          (acc, p, i) => (i === 0 ? p.freeCourts : acc.filter((c) => p.freeCourts.includes(c))),
          [],
        );
        rows.push({ group: { weekdays: orderedWeekdays }, hour: h, perWeekday, commonCourts });
      }
    }
    return rows;
  }, [groups, hours, freeCourtsFor]);

  const groupLabel = (weekdays: number[]) => weekdays.map((wd) => weekdayShort[wd]).join(" + ");

  const toggleGroupWeekday = (idx: number, wd: number) => {
    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== idx) return g;
        const has = g.weekdays.includes(wd);
        return { weekdays: has ? g.weekdays.filter((w) => w !== wd) : [...g.weekdays, wd] };
      }),
    );
  };
  const addGroup = () => {
    setGroups((prev) => (prev.length >= MAX_GROUPS ? prev : [...prev, { weekdays: [] }]));
  };
  const removeGroup = (idx: number) => {
    setGroups((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };
  const toggleHour = (h: number) => {
    setHours((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]));
  };

  const hasSelection = allWeekdays.length > 0 && hours.length > 0;

  const buildMessage = (): string => {
    if (!hasSelection) return "Stadium Rackets — disponibilidade de horário fixo";
    const sections = groups
      .filter((g) => g.weekdays.length > 0)
      .map((g) => {
        const rowsForGroup = results.filter(
          (r) =>
            r.group.weekdays.join(",") ===
            [...g.weekdays]
              .sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))
              .join(","),
        );
        const label = groupLabel(
          [...g.weekdays].sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b)),
        );
        const lines = rowsForGroup.map((r) => {
          const range = `${hourLabel(r.hour)}–${hourEndLabel(r.hour)}`;
          const someoneFull = r.perWeekday.some((p) => p.freeCourts.length === 0);
          if (r.commonCourts.length > 0) {
            const cs = r.commonCourts.map((c) => courtShort(c)).join(", ");
            return `• ${range} → mesma quadra todo dia: ${cs}`;
          }
          if (someoneFull) {
            const closed = r.perWeekday
              .filter((p) => p.freeCourts.length === 0)
              .map((p) => weekdayShort[p.weekday])
              .join(", ");
            return `• ${range} → sem vaga em ${closed}`;
          }
          const breakdown = r.perWeekday
            .map(
              (p) =>
                `${weekdayShort[p.weekday]}: ${p.freeCourts.map((c) => courtShort(c)).join("/")}`,
            )
            .join(" · ");
          return `• ${range} → sem quadra comum nos dois dias (${breakdown})`;
        });
        return `*${label}:*\n${lines.join("\n")}`;
      });
    return `Stadium Rackets — disponibilidade de horário fixo\n\n${sections.join("\n\n")}`;
  };

  const copyMessage = async () => {
    const msg = buildMessage();
    try {
      await navigator.clipboard.writeText(msg);
      toast.success("Mensagem copiada!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const openWhatsAppBlank = () => {
    const msg = buildMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            Disponibilidade de horário fixo
          </DialogTitle>
          <DialogDescription>
            Compara dias da semana pra achar quadra livre toda semana (ex.: "segunda e quarta 16h,
            ou terça e quinta") — ignora férias/viagens pontuais, que liberam a quadra só naquele
            dia e não valem como vaga permanente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            {groups.map((g, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_ORDER.map((wd) => (
                    <Badge
                      key={wd}
                      variant={g.weekdays.includes(wd) ? "default" : "outline"}
                      className="cursor-pointer select-none"
                      onClick={() => toggleGroupWeekday(idx, wd)}
                    >
                      {weekdayShort[wd]}
                    </Badge>
                  ))}
                </div>
                {groups.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeGroup(idx)}
                    aria-label="Remover grupo de dias"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {groups.length < MAX_GROUPS && (
              <Button variant="outline" size="sm" onClick={addGroup}>
                <Plus className="h-4 w-4 mr-2" /> Comparar outro grupo de dias
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Horários candidatos</Label>
            <div className="flex flex-wrap gap-1">
              {HOUR_SLOTS.map((h) => (
                <Badge
                  key={h}
                  variant={hours.includes(h) ? "default" : "outline"}
                  className="cursor-pointer select-none"
                  onClick={() => toggleHour(h)}
                >
                  {hourLabel(h)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-1 w-40">
            <Label className="text-xs">Quadra</Label>
            <Select
              value={courtFilter}
              onValueChange={(v) => setCourtFilter(v as "any" | "tenis" | "pickleball")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer</SelectItem>
                <SelectItem value="tenis">Tênis (saibro)</SelectItem>
                <SelectItem value="pickleball">Pickleball (qualquer)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="h-72 rounded-md border p-3">
            {!hasSelection ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Selecione ao menos um grupo de dias e um horário pra comparar.
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Calculando...
              </div>
            ) : (
              <div className="space-y-4">
                {groups
                  .filter((g) => g.weekdays.length > 0)
                  .map((g, gi) => {
                    const sortedWd = [...g.weekdays].sort(
                      (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b),
                    );
                    const rowsForGroup = results.filter(
                      (r) => r.group.weekdays.join(",") === sortedWd.join(","),
                    );
                    return (
                      <div key={gi}>
                        <div className="text-sm font-medium mb-1">{groupLabel(sortedWd)}</div>
                        <ul className="space-y-2">
                          {rowsForGroup.map((r) => {
                            const someoneFull = r.perWeekday.some((p) => p.freeCourts.length === 0);
                            return (
                              <li key={r.hour} className="text-sm">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium w-24">
                                    {hourLabel(r.hour)}–{hourEndLabel(r.hour)}
                                  </span>
                                  {r.commonCourts.length > 0 ? (
                                    <>
                                      <span className="text-xs text-muted-foreground">
                                        mesma quadra:
                                      </span>
                                      {r.commonCourts.map((c) => (
                                        <Badge key={c} variant="secondary">
                                          {courtLabel(c)}
                                        </Badge>
                                      ))}
                                    </>
                                  ) : someoneFull ? (
                                    <span className="text-xs text-muted-foreground">
                                      sem vaga em{" "}
                                      {r.perWeekday
                                        .filter((p) => p.freeCourts.length === 0)
                                        .map((p) => weekdayShort[p.weekday])
                                        .join(", ")}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      sem quadra comum —{" "}
                                      {r.perWeekday
                                        .map(
                                          (p) =>
                                            `${weekdayShort[p.weekday]}: ${p.freeCourts
                                              .map((c) => courtLabel(c))
                                              .join("/")}`,
                                        )
                                        .join(" · ")}
                                    </span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            )}
          </ScrollArea>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={copyMessage} disabled={loading || !hasSelection}>
              <Copy className="h-4 w-4 mr-2" /> Copiar mensagem
            </Button>
            <Button onClick={openWhatsAppBlank} disabled={loading || !hasSelection}>
              <MessageCircle className="h-4 w-4 mr-2" /> Abrir no WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

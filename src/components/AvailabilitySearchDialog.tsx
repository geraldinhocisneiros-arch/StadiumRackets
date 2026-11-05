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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Copy, Loader2, Plus, Search, MessageCircle, X } from "lucide-react";
import {
  COURTS,
  HOUR_SLOTS,
  courtLabel,
  courtShort,
  isPickleballCourt,
  isTennisCourt,
  dateISO,
  addDaysISO,
  fmtDateBR,
  hourLabel,
  hourEndLabel,
  timeToHours,
  weekdayOfISO,
  weekdayShort,
  findFixedExceptionForHour,
  type Booking,
  type FixedSchedule,
} from "@/lib/court-map";
import { isFullHourOnline } from "@/lib/operating-hours";

interface HourAvailability {
  hour: number;
  freeCourts: number[];
}

interface RankingPair {
  hour: number;
  commonCourts: number[];
  anyCourts: number[];
}

interface DateQuery {
  date: string;
  hour: number | "";
}

type RowResult =
  | { query: DateQuery; mode: "ranking"; pairs: RankingPair[] }
  | { query: DateQuery; mode: "hour"; hour: HourAvailability | null }
  | { query: DateQuery; mode: "day"; dayRows: HourAvailability[]; fromHour?: number };

const MAX_QUERIES = 5;

// Aplica os mesmos critérios de sempre (janela oficial de funcionamento e,
// se for hoje, só a partir da hora atual quando futureOnly) sobre a tabela
// bruta de disponibilidade de UM dia.
function filterRowsForDate(
  raw: HourAvailability[],
  date: string,
  futureOnly: boolean,
): HourAvailability[] {
  const isToday = date === dateISO(new Date());
  const nowHour = new Date().getHours();
  let rows = raw.filter((r) => r.freeCourts.length > 0 && isFullHourOnline(date, r.hour));
  if (isToday && futureOnly) {
    rows = rows.filter((r) => r.hour >= nowHour);
  }
  return rows;
}

export function AvailabilitySearchDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultDate?: string;
}) {
  const [queries, setQueries] = useState<DateQuery[]>([
    { date: defaultDate ?? dateISO(new Date()), hour: "" },
  ]);
  const [rankingOnly, setRankingOnly] = useState(false);
  const [futureOnly, setFutureOnly] = useState(true);
  // "A partir do horário escolhido": com hora escolhida, lista daquela hora
  // em diante (qualquer dia) em vez de só aquela hora.
  const [fromSelectedHour, setFromSelectedHour] = useState(false);
  const [loading, setLoading] = useState(false);
  // Tabela bruta (sem filtro) de disponibilidade por dia, indexada pela data
  // — várias linhas de busca na mesma data reaproveitam a mesma consulta.
  const [rawByDate, setRawByDate] = useState<Record<string, HourAvailability[]>>({});

  useEffect(() => {
    if (open) {
      setQueries([{ date: defaultDate ?? dateISO(new Date()), hour: "" }]);
    }
  }, [open, defaultDate]);

  const loadDate = useCallback(async (date: string): Promise<HourAvailability[]> => {
    const weekday = weekdayOfISO(date);
    const [bRes, sRes] = await Promise.all([
      supabase
        .from("court_bookings")
        .select("id, court, booking_date, start_time, end_time, cancelled_at")
        .eq("booking_date", date),
      supabase
        .from("client_schedules")
        .select("id, weekday, court, start_time, end_time")
        .eq("weekday", weekday)
        .or(`valid_from.is.null,valid_from.lte.${date}`)
        .or(`valid_until.is.null,valid_until.gte.${date}`),
    ]);
    const scheds = (sRes.data ?? []) as unknown as FixedSchedule[];
    const scheduleIds = scheds.map((s) => s.id);
    let exceptions: {
      client_schedule_id: string;
      start_time: string | null;
      end_time: string | null;
      reason: string | null;
    }[] = [];
    if (scheduleIds.length) {
      const eRes = await supabase
        .from("client_schedule_exceptions")
        .select("client_schedule_id, start_time, end_time, reason")
        .eq("exception_date", date)
        .in("client_schedule_id", scheduleIds);
      exceptions = eRes.data ?? [];
    }
    const excMap = new Map<string, typeof exceptions>();
    for (const e of exceptions) {
      const arr = excMap.get(e.client_schedule_id) ?? [];
      arr.push(e);
      excMap.set(e.client_schedule_id, arr);
    }
    const schedsMerged = scheds.map((s) => ({
      ...s,
      exceptions: (excMap.get(s.id) ?? []).map((e) => ({
        id: "",
        start_time: e.start_time,
        end_time: e.end_time,
        reason: e.reason,
      })),
    })) as FixedSchedule[];

    const bookings = ((bRes.data ?? []) as unknown as Booking[]).filter((b) => !b.cancelled_at);

    return HOUR_SLOTS.map((h) => {
      const freeCourts: number[] = [];
      for (const c of COURTS) {
        const hasBooking = bookings.some((b) => {
          if (b.court !== c) return false;
          const s = timeToHours(b.start_time);
          const en = timeToHours(b.end_time);
          return s < h + 1 && en > h;
        });
        if (hasBooking) continue;

        const hasFixed = schedsMerged.some((s) => {
          if (s.court !== c) return false;
          const start = timeToHours(s.start_time);
          const end = timeToHours(s.end_time);
          if (!(start < h + 1 && end > h)) return false;
          const covered = findFixedExceptionForHour(s.exceptions, h);
          return !covered;
        });
        if (hasFixed) continue;

        freeCourts.push(c);
      }
      return { hour: h, freeCourts };
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const uniqueDates = Array.from(new Set(queries.map((q) => q.date)));
    const results = await Promise.all(uniqueDates.map((d) => loadDate(d)));
    const next: Record<string, HourAvailability[]> = {};
    uniqueDates.forEach((d, i) => {
      next[d] = results[i];
    });
    setRawByDate(next);
    setLoading(false);
  }, [queries, loadDate]);

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queries.map((q) => q.date).join(","), loadDate]);

  const anyToday = queries.some((q) => q.date === dateISO(new Date()));
  const anyHour = queries.some((q) => q.hour !== "");

  // Resultado por linha de busca. Cada linha vira uma lista do dia inteiro
  // (sem hora escolhida), uma única hora (hora escolhida) ou uma lista de
  // janelas de 2h seguidas (ranking) — o modo "ranking" funciona pra
  // qualquer quantidade de dias comparados, já que é justamente pra jogo
  // de ranking (2h) que a maioria pergunta, inclusive comparando dias.
  const rowResults = useMemo<RowResult[]>(
    () =>
      queries.map((q): RowResult => {
        const raw = rawByDate[q.date] ?? [];
        const rows = filterRowsForDate(raw, q.date, futureOnly);
        // Hora escolhida + "a partir do horário escolhido": mostra da hora
        // escolhida EM DIANTE, não só aquela hora (ex.: "sábado, 15h pra frente").
        const fromHour = q.hour !== "" && fromSelectedHour ? q.hour : null;
        if (rankingOnly) {
          const rawMap = new Map<number, number[]>();
          for (const r of raw) rawMap.set(r.hour, r.freeCourts);
          const candidates =
            fromHour !== null
              ? rows.filter((r) => r.hour >= fromHour)
              : q.hour !== ""
                ? rows.filter((r) => r.hour === q.hour)
                : rows;
          const pairs: RankingPair[] = candidates.map((r) => {
            const h1 = r.freeCourts;
            const h2 = rawMap.get(r.hour + 1) ?? [];
            const commonCourts = h1.filter((c) => h2.includes(c));
            const anyCourts = Array.from(new Set([...h1, ...h2])).sort((a, b) => a - b);
            return { hour: r.hour, commonCourts, anyCourts };
          });
          return { query: q, mode: "ranking", pairs };
        }
        if (fromHour !== null) {
          return {
            query: q,
            mode: "day",
            dayRows: rows.filter((r) => r.hour >= fromHour),
            fromHour,
          };
        }
        if (q.hour !== "") {
          const row = rows.find((r) => r.hour === q.hour) ?? null;
          return { query: q, mode: "hour", hour: row };
        }
        return { query: q, mode: "day", dayRows: rows };
      }),
    [queries, rawByDate, futureOnly, rankingOnly, fromSelectedHour],
  );

  const setQueryDate = (idx: number, date: string) => {
    setQueries((prev) => prev.map((q, i) => (i === idx ? { ...q, date } : q)));
  };
  const setQueryHour = (idx: number, hour: number | "") => {
    setQueries((prev) => prev.map((q, i) => (i === idx ? { ...q, hour } : q)));
  };
  const addQuery = () => {
    setQueries((prev) => {
      if (prev.length >= MAX_QUERIES) return prev;
      const last = prev[prev.length - 1];
      return [...prev, { date: addDaysISO(last.date, 1), hour: last.hour }];
    });
  };
  const removeQuery = (idx: number) => {
    setQueries((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const hourPhrase = (q: DateQuery) =>
    fromSelectedHour
      ? `a partir das ${hourLabel(q.hour as number)}`
      : `às ${hourLabel(q.hour as number)}`;

  const dayHeader = (date: string) => `${weekdayShort[weekdayOfISO(date)]}, ${fmtDateBR(date)}`;

  // Separa tênis e pickleball na mesma linha: "Tênis | Pickleball: PB1, PB3".
  const courtsBySurface = (courts: number[]): string => {
    const pickle = courts.filter(isPickleballCourt);
    const parts: string[] = [];
    if (courts.some(isTennisCourt)) parts.push("Tênis (saibro)");
    if (pickle.length > 0) parts.push(`Pickleball: ${pickle.map(courtShort).join(", ")}`);
    return parts.join(" | ");
  };

  const buildMessage = (): string => {
    const sections = rowResults.map((r) => {
      const header = dayHeader(r.query.date);
      if (r.mode === "ranking") {
        if (r.pairs.length === 0) {
          const suffix = r.query.hour !== "" ? ` ${hourPhrase(r.query)}` : "";
          return `*${header}:*\nSem 2 horas seguidas disponíveis${suffix}.`;
        }
        const lines = r.pairs.map((p) => {
          const range = `${hourLabel(p.hour)}–${hourEndLabel(p.hour + 1)}`;
          if (p.commonCourts.length > 0) {
            return `• ${range} → mesma quadra: ${courtsBySurface(p.commonCourts)}`;
          }
          return `• ${range} → precisa trocar de quadra (livres na 1ª hora: ${courtsBySurface(p.anyCourts)})`;
        });
        return `*${header} (2h seguidas):*\n${lines.join("\n")}`;
      }
      if (r.mode === "hour") {
        if (!r.hour || r.hour.freeCourts.length === 0) {
          return `*${header}:*\nSem vaga às ${hourLabel(r.query.hour as number)}.`;
        }
        return `*${header}:*\n${hourLabel(r.hour.hour)}–${hourEndLabel(r.hour.hour)} → ${courtsBySurface(r.hour.freeCourts)}`;
      }
      const fromSuffix = r.fromHour !== undefined ? ` (a partir das ${hourLabel(r.fromHour)})` : "";
      if (r.dayRows.length === 0) return `*${header}:*\nSem horários disponíveis${fromSuffix}.`;
      const lines = r.dayRows.map((row) => {
        return `• ${hourLabel(row.hour)}–${hourEndLabel(row.hour)} → ${courtsBySurface(row.freeCourts)}`;
      });
      return `*${header}${fromSuffix}:*\n${lines.join("\n")}`;
    });
    return `Stadium Rackets — disponibilidade\n\n${sections.join("\n\n")}`;
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
            <Search className="h-5 w-5" />
            Disponibilidade de quadras
          </DialogTitle>
          <DialogDescription>
            Consulte rapidamente os horários livres para responder ao cliente — inclusive comparando
            dias diferentes (ex.: "sábado ou domingo às 11h", ou 2h seguidas pra ranking em qualquer
            um dos dias).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            {queries.map((q, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  {idx === 0 && <Label className="text-xs">Data</Label>}
                  <Input
                    type="date"
                    value={q.date}
                    onChange={(e) => setQueryDate(idx, e.target.value)}
                    className="w-auto"
                  />
                </div>
                <div className="space-y-1">
                  {idx === 0 && <Label className="text-xs">Horário</Label>}
                  <Select
                    value={q.hour === "" ? "any" : String(q.hour)}
                    onValueChange={(v) => setQueryHour(idx, v === "any" ? "" : Number(v))}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Qualquer horário</SelectItem>
                      {HOUR_SLOTS.map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {hourLabel(h)}–{hourEndLabel(h)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {idx === 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setQueryDate(0, dateISO(new Date()))}
                  >
                    Hoje
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeQuery(idx)}
                    aria-label="Remover dia"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {queries.length < MAX_QUERIES && (
              <Button variant="outline" size="sm" onClick={addQuery}>
                <Plus className="h-4 w-4 mr-2" /> Comparar outro dia
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="ranking-switch" checked={rankingOnly} onCheckedChange={setRankingOnly} />
              <Label htmlFor="ranking-switch" className="text-sm cursor-pointer">
                Só 2h seguidas
              </Label>
            </div>
            {anyToday && (
              <div className="flex items-center gap-2">
                <Switch id="future-switch" checked={futureOnly} onCheckedChange={setFutureOnly} />
                <Label htmlFor="future-switch" className="text-sm cursor-pointer">
                  Esconder horários que já passaram (hoje)
                </Label>
              </div>
            )}
            {anyHour && (
              <div className="flex items-center gap-2">
                <Switch
                  id="from-hour-switch"
                  checked={fromSelectedHour}
                  onCheckedChange={setFromSelectedHour}
                />
                <Label htmlFor="from-hour-switch" className="text-sm cursor-pointer">
                  A partir do horário escolhido
                </Label>
              </div>
            )}
          </div>

          {queries.length === 1 &&
            (() => {
              const r0 = rowResults[0];
              const summary =
                r0.mode === "ranking"
                  ? `${r0.pairs.length} janela(s) de 2h`
                  : r0.mode === "hour"
                    ? r0.hour && r0.hour.freeCourts.length > 0
                      ? `${r0.hour.freeCourts.length} quadra(s) livre(s) às ${hourLabel(queries[0].hour as number)}`
                      : `Sem vaga às ${hourLabel(queries[0].hour as number)}`
                    : `${r0.dayRows.length} horário(s)${r0.fromHour !== undefined ? ` a partir das ${hourLabel(r0.fromHour)}` : ""} com ${r0.dayRows.reduce((acc, row) => acc + row.freeCourts.length, 0)} vaga(s) livre(s)`;
              return (
                <div className="text-sm text-muted-foreground">
                  {dayHeader(queries[0].date)} · {summary}
                </div>
              );
            })()}

          <ScrollArea className="h-80 rounded-md border p-3">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Calculando...
              </div>
            ) : (
              <ul className="space-y-4">
                {rowResults.map((r, idx) => (
                  <li key={idx}>
                    {queries.length > 1 && (
                      <div className="text-sm font-medium mb-1">{dayHeader(r.query.date)}</div>
                    )}
                    {r.mode === "ranking" ? (
                      r.pairs.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          Sem 2 horas seguidas disponíveis
                          {r.query.hour !== "" ? ` ${hourPhrase(r.query)}` : ""}.
                        </div>
                      ) : (
                        <ul className="space-y-3">
                          {r.pairs.map((p) => (
                            <li key={p.hour} className="text-sm">
                              <div className="font-medium">
                                {hourLabel(p.hour)}–{hourEndLabel(p.hour + 1)}
                              </div>
                              {p.commonCourts.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <span className="text-xs text-muted-foreground mr-1">
                                    Mesma quadra:
                                  </span>
                                  {p.commonCourts.map((c) => (
                                    <Badge key={c} variant="secondary">
                                      {courtLabel(c)}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Precisa trocar de quadra entre as horas.
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )
                    ) : r.mode === "hour" ? (
                      !r.hour || r.hour.freeCourts.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          Sem vaga às {hourLabel(r.query.hour as number)}.
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <span className="font-medium w-24">
                            {hourLabel(r.hour.hour)}–{hourEndLabel(r.hour.hour)}
                          </span>
                          {r.hour.freeCourts.map((c) => (
                            <Badge key={c} variant="secondary">
                              {courtLabel(c)}
                            </Badge>
                          ))}
                        </div>
                      )
                    ) : r.dayRows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {r.fromHour !== undefined
                          ? `Sem horários disponíveis a partir das ${hourLabel(r.fromHour)}.`
                          : "Sem horários disponíveis nesse dia."}
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {r.dayRows.map((row) => (
                          <li key={row.hour} className="text-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium w-20">
                                {hourLabel(row.hour)}–{hourEndLabel(row.hour)}
                              </span>
                              {row.freeCourts.map((c) => (
                                <Badge key={c} variant="secondary">
                                  {courtLabel(c)}
                                </Badge>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={copyMessage} disabled={loading}>
              <Copy className="h-4 w-4 mr-2" /> Copiar mensagem
            </Button>
            <Button onClick={openWhatsAppBlank} disabled={loading}>
              <MessageCircle className="h-4 w-4 mr-2" /> Abrir no WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2, MessageCircle, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEEKDAY_LABELS } from "@/lib/pricing";
import { getOperatingHours } from "@/lib/operating-hours";
import {
  COURTS,
  ANY_PICKLEBALL,
  TENNIS_COURT,
  courtShort,
  isPickleballCourt,
  isTennisCourt,
  HOUR_SLOTS,
  addDaysISO,
  courtLabel,
  dateISO,
  fixedWaitlistCourtLabel,
  fmtDateBR,
  hourLabel,
  hourEndLabel,
  timeToHours,
  weekdayOfISO,
  weekdayShort,
} from "@/lib/court-map";

export const Route = createFileRoute("/vagas-fixas")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Vagas para fixo • Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <VagasFixasPage />
    </RequireAuth>
  ),
});

// Ordem "comercial" da semana: segunda primeiro, domingo por último.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Fixo que acaba nos próximos dias aparece como "libera em dd/mm" — ainda não
// é vaga, mas já dá pra oferecer pra quem pode esperar.
const ENDING_SOON_DAYS = 60;

type Surface = "any" | "tenis" | "pickleball";
type Period = "all" | "manha" | "tarde" | "noite";

const PERIODS: Record<Period, { label: string; from: number; to: number }> = {
  all: { label: "Dia todo", from: 0, to: 24 },
  manha: { label: "Manhã (até 12h)", from: 0, to: 12 },
  tarde: { label: "Tarde (12h–18h)", from: 12, to: 18 },
  noite: { label: "Noite (a partir de 18h)", from: 18, to: 24 },
};

interface ScheduleRow {
  weekday: number;
  court: number | null;
  start_time: string;
  end_time: string;
  valid_until: string | null;
}

interface WaitlistRow {
  id: string;
  desired_weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
  guest_name: string | null;
  created_at: string;
  clients: { full_name: string } | null;
}

interface Cell {
  weekday: number;
  hour: number;
  open: boolean;
  freeCourts: number[];
  endingSoon: { court: number; until: string }[];
  waitlist: WaitlistRow[];
}

const cellKey = (weekday: number, hour: number) => `${weekday}-${hour}`;

const courtsForSurface = (s: Surface): number[] =>
  s === "any"
    ? [...COURTS]
    : s === "tenis"
      ? [TENNIS_COURT]
      : COURTS.filter((c) => isPickleballCourt(c));

// Quadra que a entrada da fila fixa aceita: null = qualquer,
// 0 = qualquer quadra de pickleball, demais = aquela quadra.
const waitlistAccepts = (pref: number | null, court: number) =>
  pref === null || (pref === ANY_PICKLEBALL ? isPickleballCourt(court) : pref === court);

const overlapsHour = (start: string, end: string, hour: number) =>
  timeToHours(start) < hour + 1 && timeToHours(end) > hour;

const surfaceOf = (courts: number[]): string => {
  const pickle = courts.some((c) => isPickleballCourt(c));
  const tenis = courts.some((c) => isTennisCourt(c));
  return pickle && tenis ? "tênis ou pickleball" : tenis ? "tênis" : "pickleball";
};

function VagasFixasPage() {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [surface, setSurface] = useState<Surface>("any");
  const [period, setPeriod] = useState<Period>("all");
  const [showCourtNumbers, setShowCourtNumbers] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const today = dateISO(new Date());
    const [sRes, wRes] = await Promise.all([
      // Fixo de demonstração não ocupa quadra de verdade; fixo vencido
      // (valid_until no passado) também não. Fixo que começa no futuro
      // (valid_from) já conta como ocupado: a vaga não é permanente.
      supabase
        .from("client_schedules")
        .select("weekday, court, start_time, end_time, valid_until")
        .eq("is_demo", false)
        .or(`valid_until.is.null,valid_until.gte.${today}`),
      supabase
        .from("fixed_court_waitlist")
        .select(
          "id, desired_weekday, start_time, end_time, court, guest_name, created_at, clients:client_id(full_name)",
        )
        .in("status", ["waiting", "notified", "contacted"])
        .order("created_at", { ascending: true }),
    ]);
    if (sRes.error) toast.error(sRes.error.message);
    if (wRes.error) toast.error(wRes.error.message);
    setSchedules((sRes.data ?? []) as ScheduleRow[]);
    setWaitlist((wRes.data ?? []) as unknown as WaitlistRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Janela de funcionamento de cada dia da semana (seg–qui 5–23, sex 5–22,
  // sáb/dom 7–19), a mesma usada no portal.
  const openWindow = useMemo(() => {
    const today = dateISO(new Date());
    const out: Record<number, { start: number; end: number }> = {};
    for (let i = 0; i < 7; i++) {
      const iso = addDaysISO(today, i);
      out[weekdayOfISO(iso)] = getOperatingHours(iso);
    }
    return out;
  }, []);

  const hours = useMemo(() => {
    const p = PERIODS[period];
    return HOUR_SLOTS.filter((h) => h >= p.from && h < p.to);
  }, [period]);

  const cells = useMemo(() => {
    const today = dateISO(new Date());
    const soonLimit = addDaysISO(today, ENDING_SOON_DAYS);
    const courts = courtsForSurface(surface);
    const map = new Map<string, Cell>();
    for (const wd of WEEKDAY_ORDER) {
      const win = openWindow[wd];
      for (const h of HOUR_SLOTS) {
        const open = h >= win.start && h + 1 <= win.end;
        const freeCourts: number[] = [];
        const endingSoon: Cell["endingSoon"] = [];
        if (open) {
          for (const c of courts) {
            const blocking = schedules.filter(
              (s) => s.weekday === wd && s.court === c && overlapsHour(s.start_time, s.end_time, h),
            );
            if (blocking.length === 0) {
              freeCourts.push(c);
              continue;
            }
            // Só "libera" se TODOS os fixos dessa quadra/hora acabam em breve.
            if (blocking.every((s) => s.valid_until && s.valid_until <= soonLimit)) {
              const until = blocking
                .map((s) => s.valid_until as string)
                .sort()
                .at(-1) as string;
              endingSoon.push({ court: c, until });
            }
          }
        }
        const wl = open
          ? waitlist.filter(
              (w) =>
                w.desired_weekday === wd &&
                overlapsHour(w.start_time, w.end_time, h) &&
                freeCourts.some((c) => waitlistAccepts(w.court, c)),
            )
          : [];
        map.set(cellKey(wd, h), {
          weekday: wd,
          hour: h,
          open,
          freeCourts,
          endingSoon,
          waitlist: wl,
        });
      }
    }
    return map;
  }, [schedules, waitlist, surface, openWindow]);

  // Seleção some quando o filtro esconde a célula ou ela deixa de ter vaga.
  useEffect(() => {
    setSelected((prev) =>
      prev.filter((k) => {
        const c = cells.get(k);
        return c && c.freeCourts.length > 0 && hours.includes(c.hour);
      }),
    );
  }, [cells, hours]);

  const visibleCells = useMemo(
    () =>
      WEEKDAY_ORDER.flatMap((wd) =>
        hours.map((h) => cells.get(cellKey(wd, h))).filter((c): c is Cell => !!c),
      ),
    [cells, hours],
  );

  const totals = useMemo(() => {
    let courtHours = 0;
    let slots = 0;
    let withQueue = 0;
    for (const c of visibleCells) {
      if (c.freeCourts.length === 0) continue;
      slots++;
      courtHours += c.freeCourts.length;
      if (c.waitlist.length > 0) withQueue++;
    }
    return { courtHours, slots, withQueue };
  }, [visibleCells]);

  const maxFree = courtsForSurface(surface).length;

  const toggle = (c: Cell) => {
    if (c.freeCourts.length === 0) return;
    const k = cellKey(c.weekday, c.hour);
    setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  const selectedCells = useMemo(
    () => visibleCells.filter((c) => selected.includes(cellKey(c.weekday, c.hour))),
    [visibleCells, selected],
  );

  // Mensagem: com seleção, só os horários marcados; sem seleção, todos os
  // horários livres do filtro. Horas seguidas com as mesmas quadras livres
  // (ou o mesmo piso, sem número de quadra) viram uma faixa ("07h às 10h")
  // pra mensagem não ficar enorme.
  const message = useMemo(() => {
    const source = selectedCells.length > 0 ? selectedCells : visibleCells;
    const free = source.filter((c) => c.freeCourts.length > 0);
    if (free.length === 0) return "";
    // Quadras separadas por modalidade: "Tênis | Pickleball: PB1, PB3".
    const fmtCourts = (cs: number[]) => {
      const pickle = cs.filter((c) => isPickleballCourt(c));
      const parts: string[] = [];
      if (cs.some((c) => isTennisCourt(c))) parts.push("Tênis (saibro)");
      if (pickle.length > 0) parts.push(`Pickleball: ${pickle.map(courtShort).join(", ")}`);
      return parts.join(" | ");
    };
    const describe = (c: Cell) =>
      showCourtNumbers ? fmtCourts(c.freeCourts) : surfaceOf(c.freeCourts);
    const sections: string[] = [];
    for (const wd of WEEKDAY_ORDER) {
      const dayCells = free.filter((c) => c.weekday === wd).sort((a, b) => a.hour - b.hour);
      if (dayCells.length === 0) continue;
      const lines: string[] = [];
      let i = 0;
      while (i < dayCells.length) {
        const first = dayCells[i];
        const desc = describe(first);
        let j = i;
        while (
          j + 1 < dayCells.length &&
          dayCells[j + 1].hour === dayCells[j].hour + 1 &&
          describe(dayCells[j + 1]) === desc
        )
          j++;
        const range =
          i === j && !showCourtNumbers
            ? `${hourLabel(first.hour)}`
            : `${hourLabel(first.hour)} às ${hourEndLabel(dayCells[j].hour)}`;
        if (showCourtNumbers) lines.push(`• ${range} — ${desc}`);
        else lines.push(surface === "any" ? `• ${range} (${desc})` : `• ${range}`);
        i = j + 1;
      }
      sections.push(`*${WEEKDAY_LABELS[wd]}*\n${lines.join("\n")}`);
    }
    const surfTitle =
      surface === "tenis" ? " na quadra de tênis" : surface === "pickleball" ? " no pickleball" : "";
    return [
      `🎾 *Stadium Rackets*`,
      `Horários disponíveis para fixo semanal${surfTitle}:`,
      "",
      sections.join("\n\n"),
      "",
      "Horário fixo é seu toda semana, sem precisar reservar. Quer garantir o seu? É só responder esta mensagem 😉",
    ].join("\n");
  }, [selectedCells, visibleCells, showCourtNumbers, surface]);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Mensagem copiada!");
    } catch {
      toast.error("Não foi possível copiar — selecione o texto e copie manualmente.");
    }
  };

  const openWhatsApp = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const cellClass = (c: Cell, isSelected: boolean) => {
    if (!c.open) return "bg-muted/40 text-muted-foreground/40";
    if (c.freeCourts.length === 0)
      return c.endingSoon.length > 0
        ? "bg-amber-400/20 text-amber-900 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
    if (isSelected) return "bg-primary text-primary-foreground ring-2 ring-primary";
    const ratio = c.freeCourts.length / maxFree;
    return ratio >= 0.5
      ? "bg-green-500/40 text-green-950 dark:text-green-50 hover:bg-green-500/55"
      : "bg-green-500/20 text-green-950 dark:text-green-100 hover:bg-green-500/35";
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Vagas para fixo</h1>
          <p className="text-sm text-muted-foreground">
            Quadras sem horário fixo, toda semana. Toque nos horários pra montar a mensagem do
            WhatsApp — sem seleção, a mensagem leva todos os livres do filtro.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 w-44">
          <Label className="text-xs">Piso</Label>
          <Select value={surface} onValueChange={(v) => setSurface(v as Surface)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Todas as quadras</SelectItem>
              <SelectItem value="tenis">Tênis (saibro)</SelectItem>
              <SelectItem value="pickleball">Pickleball (PB1 a PB3)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 w-52">
          <Label className="text-xs">Período</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIODS) as Period[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PERIODS[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id="court-numbers"
            checked={showCourtNumbers}
            onCheckedChange={setShowCourtNumbers}
          />
          <Label htmlFor="court-numbers" className="text-sm">
            Nº da quadra na mensagem
          </Label>
        </div>
      </div>

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold">{totals.slots}</div>
              <div className="text-xs text-muted-foreground">dia+horário com vaga</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold">{totals.courtHours}</div>
              <div className="text-xs text-muted-foreground">
                horas de quadra/semana pra vender como fixo
              </div>
            </CardContent>
          </Card>
          <Card className={cn(totals.withQueue > 0 && "border-amber-500/60")}>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold">{totals.withQueue}</div>
              <div className="text-xs text-muted-foreground">
                vagas que já têm gente na fila fixa — ofereça a eles primeiro
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-2 sm:p-4">
          {loading ? (
            <div className="py-16 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : (
            <>
              <table className="w-full table-fixed border-separate border-spacing-0.5 text-xs sm:text-sm">
                <thead>
                  <tr>
                    <th className="w-12 sm:w-16" />
                    {WEEKDAY_ORDER.map((wd) => (
                      <th key={wd} className="font-medium py-1">
                        {weekdayShort[wd]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => (
                    <tr key={h}>
                      <td className="text-right pr-1 text-muted-foreground tabular-nums">
                        {hourLabel(h)}
                      </td>
                      {WEEKDAY_ORDER.map((wd) => {
                        const c = cells.get(cellKey(wd, h)) as Cell;
                        const isSelected = selected.includes(cellKey(wd, h));
                        const title = !c.open
                          ? "Fechado"
                          : c.freeCourts.length === 0
                            ? c.endingSoon.length > 0
                              ? `Lotado — libera: ${c.endingSoon.map((e) => `${courtShort(e.court)} em ${fmtDateBR(e.until)}`).join(", ")}`
                              : "Lotado"
                            : `${c.freeCourts.map(courtLabel).join(", ")}${c.waitlist.length ? ` — ${c.waitlist.length} na fila` : ""}`;
                        return (
                          <td key={wd} className="p-0">
                            <button
                              type="button"
                              title={title}
                              disabled={c.freeCourts.length === 0}
                              onClick={() => toggle(c)}
                              className={cn(
                                "relative w-full h-8 sm:h-9 rounded tabular-nums font-medium transition-colors",
                                c.freeCourts.length > 0 ? "cursor-pointer" : "cursor-default",
                                cellClass(c, isSelected),
                              )}
                            >
                              {!c.open
                                ? ""
                                : c.freeCourts.length > 0
                                  ? c.freeCourts.length
                                  : c.endingSoon.length > 0
                                    ? "⏳"
                                    : "–"}
                              {c.waitlist.length > 0 && (
                                <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-amber-500" />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded bg-green-500/40" /> nº = quadras
                  livres
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> tem gente na
                  fila fixa
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded bg-amber-400/30" /> ⏳ lotado, mas
                  um fixo vence nos próximos {ENDING_SOON_DAYS} dias
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded bg-muted" /> lotado / fechado
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {selectedCells.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Selecionados ({selectedCells.length})</div>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                <X className="h-4 w-4 mr-1" /> Limpar
              </Button>
            </div>
            <ul className="space-y-2">
              {selectedCells.map((c) => (
                <li key={cellKey(c.weekday, c.hour)} className="text-sm">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium w-36">
                      {WEEKDAY_LABELS[c.weekday]} {hourLabel(c.hour)}
                    </span>
                    {c.freeCourts.map((q) => (
                      <Badge key={q} variant="secondary">
                        {courtLabel(q)}
                      </Badge>
                    ))}
                  </div>
                  {c.waitlist.length > 0 && (
                    <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      Na fila fixa:{" "}
                      {c.waitlist
                        .map(
                          (w) =>
                            `${w.clients?.full_name ?? w.guest_name ?? "—"} (${fixedWaitlistCourtLabel(w.court)}, desde ${fmtDateBR(w.created_at.slice(0, 10))})`,
                        )
                        .join("; ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">
            Mensagem para WhatsApp{" "}
            <span className="text-muted-foreground font-normal">
              ({selectedCells.length > 0 ? "só os selecionados" : "todos os livres do filtro"})
            </span>
          </div>
          {message ? (
            <Textarea value={message} readOnly rows={10} className="font-mono text-xs" />
          ) : (
            <div className="text-sm text-muted-foreground">Nenhum horário livre nesse filtro.</div>
          )}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={() => void copyMessage()} disabled={!message}>
              <Copy className="h-4 w-4 mr-2" /> Copiar mensagem
            </Button>
            <Button onClick={openWhatsApp} disabled={!message}>
              <MessageCircle className="h-4 w-4 mr-2" /> Abrir no WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

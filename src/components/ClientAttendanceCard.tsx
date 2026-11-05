import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { weekdayShort } from "@/lib/court-map";

type Range = "30d" | "90d" | "year" | "all";

interface Props {
  clientId: string;
}

interface Booking {
  id: string;
  booking_date: string; // YYYY-MM-DD
  start_time: string;
  end_time: string;
  cancelled_at: string | null;
  source: string;
}

interface Schedule {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  created_at: string;
  valid_from: string | null;
  valid_until: string | null;
}

interface Exception {
  id: string;
  client_schedule_id: string;
  exception_date: string;
  start_time: string | null;
  end_time: string | null;
}

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDaysISO = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, (d ?? 1) + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// Ocorrências de um dia da semana entre duas datas (inclusive).
function countWeekdayOccurrences(startISO: string, endISO: string, weekday: number): number {
  if (endISO < startISO) return 0;
  const [ys, ms, ds] = startISO.split("-").map(Number);
  const [ye, me, de] = endISO.split("-").map(Number);
  const start = new Date(ys!, (ms ?? 1) - 1, ds ?? 1);
  const end = new Date(ye!, (me ?? 1) - 1, de ?? 1);
  const diff = Math.floor((end.getTime() - start.getTime()) / 86400000);
  const daysUntilFirst = (weekday - start.getDay() + 7) % 7;
  if (daysUntilFirst > diff) return 0;
  return Math.floor((diff - daysUntilFirst) / 7) + 1;
}

const parseHour = (t: string) => Number(t.slice(0, 2));
const durationHours = (start: string, end: string) => {
  const s = parseHour(start);
  const eRaw = parseHour(end);
  const e = eRaw === 23 && end.startsWith("23:59") ? 24 : eRaw;
  return Math.max(0, e - s);
};

export function ClientAttendanceCard({ clientId }: Props) {
  const [range, setRange] = useState<Range>("90d");
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);

  const today = todayISO();
  const fromISO = useMemo(() => {
    if (range === "30d") return addDaysISO(today, -30);
    if (range === "90d") return addDaysISO(today, -90);
    if (range === "year") return addDaysISO(today, -365);
    return "1970-01-01";
  }, [range, today]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [bRes, sRes] = await Promise.all([
        supabase
          .from("court_bookings")
          .select("id, booking_date, start_time, end_time, cancelled_at, source")
          .eq("client_id", clientId)
          .gte("booking_date", fromISO)
          .lte("booking_date", today),
        supabase
          .from("client_schedules")
          .select("id, weekday, start_time, end_time, created_at, valid_from, valid_until")
          .eq("client_id", clientId),
      ]);
      const scheds = (sRes.data ?? []) as Schedule[];
      let excs: Exception[] = [];
      if (scheds.length) {
        const eRes = await supabase
          .from("client_schedule_exceptions")
          .select("id, client_schedule_id, exception_date, start_time, end_time")
          .in(
            "client_schedule_id",
            scheds.map((s) => s.id),
          )
          .gte("exception_date", fromISO)
          .lte("exception_date", today);
        excs = (eRes.data ?? []) as Exception[];
      }
      if (!alive) return;
      setBookings((bRes.data ?? []) as Booking[]);
      setSchedules(scheds);
      setExceptions(excs);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [clientId, fromISO, today]);

  const stats = useMemo(() => {
    // Locações avulsas (court_bookings)
    const avAttended = bookings.filter((b) => !b.cancelled_at);
    const avCancelled = bookings.filter((b) => b.cancelled_at);
    const avAttendedHours = avAttended.reduce(
      (acc, b) => acc + durationHours(b.start_time, b.end_time),
      0,
    );

    // Aulas fixas: contar ocorrências de cada schedule no período
    let fixedTotal = 0;
    let fixedHoursTotal = 0;
    for (const s of schedules) {
      // Conta só dentro da vigência do fixo (valid_from/valid_until).
      let startISO = s.created_at.slice(0, 10);
      if (s.valid_from && s.valid_from > startISO) startISO = s.valid_from;
      if (fromISO > startISO) startISO = fromISO;
      const endISO = s.valid_until && s.valid_until < today ? s.valid_until : today;
      const occ = countWeekdayOccurrences(startISO, endISO, s.weekday);
      fixedTotal += occ;
      fixedHoursTotal += occ * durationHours(s.start_time, s.end_time);
    }

    // Cancelamentos de aulas fixas: full-day = 1 ocorrência; parcial conta
    // como fração da duração da aula.
    const schedById = new Map(schedules.map((s) => [s.id, s]));
    let fixedCancelledOcc = 0;
    let fixedCancelledHours = 0;
    for (const e of exceptions) {
      const s = schedById.get(e.client_schedule_id);
      if (!s) continue;
      const schedHours = durationHours(s.start_time, s.end_time);
      if (!e.start_time || !e.end_time) {
        fixedCancelledOcc += 1;
        fixedCancelledHours += schedHours;
      } else {
        const partial = durationHours(e.start_time, e.end_time);
        // parcial conta como fração de ocorrência
        fixedCancelledOcc += schedHours > 0 ? partial / schedHours : 0;
        fixedCancelledHours += partial;
      }
    }
    const fixedAttendedOcc = Math.max(0, fixedTotal - fixedCancelledOcc);
    const fixedAttendedHours = Math.max(0, fixedHoursTotal - fixedCancelledHours);

    const totalAttended = avAttended.length + fixedAttendedOcc;
    const totalCancelled = avCancelled.length + fixedCancelledOcc;
    const totalScheduled = totalAttended + totalCancelled;
    const rate = totalScheduled > 0 ? (totalAttended / totalScheduled) * 100 : 0;

    return {
      avAttended: avAttended.length,
      avCancelled: avCancelled.length,
      avAttendedHours,
      fixedTotal,
      fixedAttendedOcc,
      fixedCancelledOcc,
      fixedAttendedHours,
      fixedCancelledHours,
      totalAttended,
      totalCancelled,
      rate,
    };
  }, [bookings, schedules, exceptions, fromISO, today]);

  const rangeLabel: Record<Range, string> = {
    "30d": "Últimos 30 dias",
    "90d": "Últimos 90 dias",
    year: "Último ano",
    all: "Desde o início",
  };

  const fmtHours = (h: number) =>
    h === 0 ? "0h" : h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
  const fmtNum = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base">Frequência nas quadras</CardTitle>
        <div className="flex gap-1 flex-wrap">
          {(["30d", "90d", "year", "all"] as Range[]).map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "default" : "outline"}
              onClick={() => setRange(r)}
            >
              {rangeLabel[r]}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Compareceu"
                value={fmtNum(stats.totalAttended)}
                sub={`${fmtHours(stats.avAttendedHours + stats.fixedAttendedHours)} em quadra`}
                tone="positive"
              />
              <Metric
                label="Cancelou"
                value={fmtNum(stats.totalCancelled)}
                sub={`${fmtHours(stats.fixedCancelledHours)} de aulas fixas`}
                tone="negative"
              />
              <Metric
                label="Taxa de comparecimento"
                value={`${stats.rate.toFixed(0)}%`}
                sub={`${fmtNum(stats.totalAttended + stats.totalCancelled)} agendadas no período`}
                tone={stats.rate >= 80 ? "positive" : stats.rate >= 50 ? "neutral" : "negative"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <Breakdown
                title="Locações avulsas"
                rows={[
                  { label: "Realizadas", value: fmtNum(stats.avAttended) },
                  { label: "Canceladas", value: fmtNum(stats.avCancelled) },
                ]}
              />
              <Breakdown
                title="Aulas fixas"
                rows={[
                  {
                    label: "Previstas no período",
                    value: fmtNum(stats.fixedTotal),
                  },
                  {
                    label: "Realizadas",
                    value: fmtNum(stats.fixedAttendedOcc),
                  },
                  {
                    label: "Canceladas (dias/trechos)",
                    value: fmtNum(stats.fixedCancelledOcc),
                  },
                ]}
                empty={schedules.length === 0 ? "Sem horário fixo cadastrado" : undefined}
              />
            </div>

            {schedules.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Horários fixos:{" "}
                {schedules
                  .map(
                    (s) =>
                      `${weekdayShort[s.weekday]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
                  )
                  .join(" • ")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
      ? "text-rose-600 dark:text-rose-400"
      : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: string }[];
  empty?: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">{title}</div>
      {empty ? (
        <div className="text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-medium tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

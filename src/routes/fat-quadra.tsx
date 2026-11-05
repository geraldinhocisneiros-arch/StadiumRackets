import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fmtBRL, monthStartISO, monthEndISO, dayStartISO, dayEndExclusiveISO, todayISO } from "@/lib/format";
import { useUrlState } from "@/hooks/useUrlState";
import { GraduationCap, LandPlot } from "lucide-react";
import { STAFF_COURTS, courtLabel, isPickleballCourt, isTennisCourt } from "@/lib/court-map";

export const Route = createFileRoute("/fat-quadra")({
  component: () => (
    <RequireAuth rolesAllowed={["diretoria"]}>
      <FatQuadraPage />
    </RequireAuth>
  ),
});

type Mode = "dia" | "mes";


function FatQuadraPage() {
  const [mode, setMode] = useUrlState<Mode>("mode", "mes");
  const [day, setDay] = useUrlState<string>("day", todayISO());
  const [from, setFrom] = useUrlState<string>("from", monthStartISO());
  const [to, setTo] = useUrlState<string>("to", monthEndISO());
  type Row = {
    court: number | null;
    amount: number;
    category_id: string | null;
    booking_id: string | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  // Professor responsável por cada locação (court_bookings.teacher_id), pra
  // somar quanto cada professor — fixo ou que aluga a quadra — deixa.
  const [teacherByBooking, setTeacherByBooking] = useState<Record<string, string | null>>({});
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (mode === "dia") {
      return { start: dayStartISO(day), end: dayEndExclusiveISO(day) };
    }
    return { start: dayStartISO(from), end: dayEndExclusiveISO(to) };
  }, [mode, day, from, to]);

  const fetchData = async () => {
    const pageSize = 1000;
    const all: Row[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("payments")
        .select("amount, court, category_id, booking_id")
        .not("court", "is", null)
        .gte("paid_at", range.start)
        .lt("paid_at", range.end)
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const chunk = (data ?? []) as Row[];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      offset += pageSize;
    }
    setRows(all);
    const bookingIds = Array.from(new Set(all.map((r) => r.booking_id).filter(Boolean))) as string[];
    const tMap: Record<string, string | null> = {};
    for (let i = 0; i < bookingIds.length; i += 200) {
      const { data: bks } = await supabase
        .from("court_bookings")
        .select("id, teacher_id")
        .in("id", bookingIds.slice(i, i + 200));
      for (const b of (bks ?? []) as Array<{ id: string; teacher_id: string | null }>) {
        tMap[b.id] = b.teacher_id;
      }
    }
    setTeacherByBooking(tMap);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("client_categories").select("id, name");
      const map: Record<string, string> = {};
      (data ?? []).forEach((c: { id: string; name: string }) => { map[c.id] = c.name; });
      setCategories(map);
      const { data: ts } = await supabase.from("teachers").select("id, name");
      const tmap: Record<string, string> = {};
      (ts ?? []).forEach((t: { id: string; name: string }) => { tmap[t.id] = t.name; });
      setTeachers(tmap);
    })();
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await fetchData();
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  useEffect(() => {
    const channel = supabase
      .channel("fat-quadra-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        fetchData();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  const byCourt = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of STAFF_COURTS) map.set(c, 0);
    rows.forEach((r) => {
      if (r.court == null) return;
      map.set(r.court, (map.get(r.court) ?? 0) + Number(r.amount));
    });
    return Array.from(map.entries()).map(([court, amount]) => ({ court, amount }));
  }, [rows]);

  const total = useMemo(() => byCourt.reduce((s, c) => s + c.amount, 0), [byCourt]);

  // Totais por modalidade: a quadra de tênis é uma só e as de pickleball são
  // três — compare também a média por quadra, não só o total.
  const byModality = useMemo(() => {
    const tennis = byCourt.filter((c) => isTennisCourt(c.court)).reduce((s, c) => s + c.amount, 0);
    const pickle = byCourt.filter((c) => isPickleballCourt(c.court)).reduce((s, c) => s + c.amount, 0);
    const pickleCount = byCourt.filter((c) => isPickleballCourt(c.court)).length || 1;
    return { tennis, pickle, pickleAvg: pickle / pickleCount };
  }, [byCourt]);

  // Por professor: soma dos lançamentos ligados a locações com professor.
  const byTeacher = useMemo(() => {
    const map = new Map<string, number>();
    let withoutTeacher = 0;
    rows.forEach((r) => {
      const tid = r.booking_id ? teacherByBooking[r.booking_id] : null;
      if (!tid) {
        withoutTeacher += Number(r.amount);
        return;
      }
      map.set(tid, (map.get(tid) ?? 0) + Number(r.amount));
    });
    const list = Array.from(map.entries())
      .map(([id, amount]) => ({ id, name: teachers[id] ?? "Professor", amount }))
      .sort((a, b) => b.amount - a.amount);
    return { list, withoutTeacher };
  }, [rows, teacherByBooking, teachers]);

  const breakdownByCourt = useMemo(() => {
    const map = new Map<number, Map<string, number>>();
    for (const c of STAFF_COURTS) map.set(c, new Map());
    rows.forEach((r) => {
      if (r.court == null) return;
      const key = r.category_id ? (categories[r.category_id] ?? "Sem categoria") : "Sem categoria";
      let inner = map.get(r.court);
      if (!inner) {
        inner = new Map();
        map.set(r.court, inner);
      }
      inner.set(key, (inner.get(key) ?? 0) + Number(r.amount));
    });
    return Array.from(map.entries()).map(([court, inner]) => {
      const items = Array.from(inner.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);
      const courtTotal = items.reduce((s, x) => s + x.amount, 0);
      return { court, items, total: courtTotal };
    });
  }, [rows, categories]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Faturamento por quadra</h1>
        <p className="text-muted-foreground">
          Soma de todos os lançamentos com quadra informada, inclusive conta corrente
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "dia" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("dia")}
            >
              Por dia
            </Button>
            <Button
              variant={mode === "mes" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("mes")}
            >
              Por período
            </Button>
          </div>

          {mode === "dia" ? (
            <div className="space-y-1 max-w-xs">
              <Label>Dia</Label>
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
          ) : (
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-1">
                <Label>Início</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Fim</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total no período
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-primary">{loading ? "..." : fmtBRL(total)}</div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tênis (saibro) — 1 quadra
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : fmtBRL(byModality.tennis)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {total > 0 ? `${((byModality.tennis / total) * 100).toFixed(1)}% do total` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pickleball — 3 quadras
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : fmtBRL(byModality.pickle)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {total > 0 ? `${((byModality.pickle / total) * 100).toFixed(1)}% do total` : "—"} ·
              média de {fmtBRL(byModality.pickleAvg)} por quadra
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {byCourt.map((c) => (
          <Card key={c.court}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <LandPlot className="h-4 w-4" /> {courtLabel(c.court)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? "..." : fmtBRL(c.amount)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {total > 0 ? `${((c.amount / total) * 100).toFixed(1)}% do total` : "—"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>


      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Por professor</h2>
        <p className="text-sm text-muted-foreground">
          Quanto cada professor (fixo ou que aluga a quadra) gerou no período — soma dos lançamentos
          das locações em que ele foi selecionado como responsável.
        </p>
        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <div className="text-sm text-muted-foreground">...</div>
            ) : byTeacher.list.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Nenhum lançamento de locação com professor no período.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {byTeacher.list.map((t) => (
                  <li key={t.id} className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 truncate">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" /> {t.name}
                    </span>
                    <span className="tabular-nums whitespace-nowrap font-medium">
                      {fmtBRL(t.amount)}{" "}
                      <span className="text-muted-foreground font-normal">
                        ({total > 0 ? ((t.amount / total) * 100).toFixed(1) : "0"}%)
                      </span>
                    </span>
                  </li>
                ))}
                <li className="text-sm flex items-center justify-between gap-2 border-t pt-1.5 text-muted-foreground">
                  <span>Sem professor (locação avulsa / lançamento sem locação)</span>
                  <span className="tabular-nums">{fmtBRL(byTeacher.withoutTeacher)}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Composição por categoria</h2>
        <p className="text-sm text-muted-foreground">Participação de cada categoria no faturamento de cada quadra no período.</p>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {breakdownByCourt.map((c) => (
            <Card key={c.court}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <LandPlot className="h-4 w-4" /> {courtLabel(c.court)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-sm text-muted-foreground">...</div>
                ) : c.total <= 0 ? (
                  <div className="text-sm text-muted-foreground">Sem lançamentos</div>
                ) : (
                  <ul className="space-y-1.5">
                    {c.items.map((it) => {
                      const pct = (it.amount / c.total) * 100;
                      return (
                        <li key={it.name} className="text-sm flex items-center justify-between gap-2">
                          <span className="truncate">{it.name}</span>
                          <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                            {fmtBRL(it.amount)} <span className="font-medium text-foreground">({pct.toFixed(1)}%)</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

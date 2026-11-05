import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUrlState } from "@/hooks/useUrlState";
import { dateISOInRecife, fmtBRL, fmtDateTime, todayISO } from "@/lib/format";
import { addDaysISO, weekdayOfISO } from "@/lib/court-map";

export const Route = createFileRoute("/relatorio-cobranca")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Relatório de cobrança • Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria"]} debtInfo>
      <RelatorioCobrancaPage />
    </RequireAuth>
  ),
});

interface SendRow {
  id: string;
  client_id: string;
  client_name: string | null;
  context: string;
  sent_at: string;
  sent_by: string | null;
  sent_by_name: string | null;
  debt_at_send: number;
  recovered_1d: number;
  recovered_3d: number;
  recovered_7d: number;
}

interface ActionRow {
  user_id: string | null;
  user_name: string | null;
  sent: number;
  skipped: number;
}

interface TogetherRow {
  user_id: string | null;
  user_name: string | null;
  count: number;
  total: number;
}

interface Report {
  sends: SendRow[];
  actions: ActionRow[];
  together: TogetherRow[];
}

const CONTEXT_LABEL: Record<string, string> = {
  open_debt_d1: "Véspera (pop-up)",
  overdue: "Inadimplentes",
};

const DAY_MS = 24 * 3600 * 1000;
const WINDOWS = [
  { days: 1, key: "recovered_1d" },
  { days: 3, key: "recovered_3d" },
  { days: 7, key: "recovered_7d" },
] as const;

/** A janela de N dias depois do envio já terminou? (senão o número ainda pode crescer) */
function matured(s: SendRow, days: number, now: number): boolean {
  return new Date(s.sent_at).getTime() + days * DAY_MS <= now;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

/** Segunda-feira (Recife) da semana do envio. */
function weekStartOf(iso: string): string {
  const day = dateISOInRecife(new Date(iso));
  const wd = weekdayOfISO(day); // 0 = domingo
  return addDaysISO(day, wd === 0 ? -6 : 1 - wd);
}

function ddmm(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function RelatorioCobrancaPage() {
  const [from, setFrom] = useUrlState<string>("from", addDaysISO(todayISO(), -29));
  const [to, setTo] = useUrlState<string>("to", todayISO());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("open_debt_report", { _from: from, _to: to });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReport(data as unknown as Report);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const sends = useMemo(() => report?.sends ?? [], [report]);

  const totals = useMemo(() => {
    const d1 = sends.filter((s) => s.context === "open_debt_d1").length;
    const debt = sends.reduce((a, s) => a + Number(s.debt_at_send), 0);
    const windows = WINDOWS.map((w) => {
      const done = sends.filter((s) => matured(s, w.days, now));
      return {
        days: w.days,
        recovered: done.reduce((a, s) => a + Number(s[w.key]), 0),
        debt: done.reduce((a, s) => a + Number(s.debt_at_send), 0),
        count: done.length,
        pending: sends.length - done.length,
      };
    });
    const together = (report?.together ?? []).reduce(
      (a, t) => ({ count: a.count + Number(t.count), total: a.total + Number(t.total) }),
      { count: 0, total: 0 },
    );
    return { d1, overdue: sends.length - d1, debt, windows, together };
  }, [sends, report, now]);

  /** Só as mensagens que já fecharam 7 dias: o mesmo grupo nas três janelas, então os % comparam. */
  const cohort = useMemo(() => {
    const done = sends.filter((s) => matured(s, 7, now));
    return {
      count: done.length,
      debt: done.reduce((a, s) => a + Number(s.debt_at_send), 0),
      windows: WINDOWS.map((w) => ({
        days: w.days,
        recovered: done.reduce((a, s) => a + Number(s[w.key]), 0),
      })),
    };
  }, [sends, now]);

  const byUser = useMemo(() => {
    type U = {
      name: string;
      popupSent: number;
      popupSkipped: number;
      messages: number;
      recovered7: number;
      debt7: number;
      togetherTotal: number;
      togetherCount: number;
    };
    const map = new Map<string, U>();
    const get = (id: string | null, name: string | null) => {
      const key = id ?? "—";
      let u = map.get(key);
      if (!u) {
        u = {
          name: name ?? "Sem usuário",
          popupSent: 0,
          popupSkipped: 0,
          messages: 0,
          recovered7: 0,
          debt7: 0,
          togetherTotal: 0,
          togetherCount: 0,
        };
        map.set(key, u);
      }
      if (name && u.name === "Sem usuário") u.name = name;
      return u;
    };
    for (const a of report?.actions ?? []) {
      const u = get(a.user_id, a.user_name);
      u.popupSent += Number(a.sent);
      u.popupSkipped += Number(a.skipped);
    }
    for (const s of sends) {
      const u = get(s.sent_by, s.sent_by_name);
      u.messages += 1;
      if (matured(s, 7, now)) {
        u.recovered7 += Number(s.recovered_7d);
        u.debt7 += Number(s.debt_at_send);
      }
    }
    for (const t of report?.together ?? []) {
      const u = get(t.user_id, t.user_name);
      u.togetherTotal += Number(t.total);
      u.togetherCount += Number(t.count);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [report, sends, now]);

  const byWeek = useMemo(() => {
    const map = new Map<
      string,
      { messages: number; debt: number; recovered7: number; debt7: number; pending: number }
    >();
    for (const s of sends) {
      const wk = weekStartOf(s.sent_at);
      const w = map.get(wk) ?? { messages: 0, debt: 0, recovered7: 0, debt7: 0, pending: 0 };
      w.messages += 1;
      w.debt += Number(s.debt_at_send);
      if (matured(s, 7, now)) {
        w.recovered7 += Number(s.recovered_7d);
        w.debt7 += Number(s.debt_at_send);
      } else {
        w.pending += 1;
      }
      map.set(wk, w);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sends, now]);

  return (
    // Na impressão somem os botões e as tabelas largas não ficam cortadas.
    <div className="space-y-6 print:[&_.overflow-x-auto]:overflow-visible print:[&_button]:hidden">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Relatório de cobrança</h1>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
        </div>
        <p className="text-muted-foreground">
          Mensagens de cobrança (aviso de véspera e aba Inadimplentes), quanto o cliente devia no
          envio e quanto entrou na conta dele em até 1, 3 e 7 dias. Também mostra o que entrou pelo
          &quot;receber junto&quot; e o que cada recepcionista fez no pop-up. É uma tendência, não
          prova: o cliente pode ter pago por outro motivo.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {loading && <Loader2 className="mb-2 h-5 w-5 animate-spin text-muted-foreground" />}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Mensagens de cobrança"
          value={String(sends.length)}
          sub={`${totals.d1} de véspera · ${totals.overdue} pela aba Inadimplentes`}
        />
        <KpiCard
          label="Em aberto no envio"
          value={fmtBRL(totals.debt)}
          sub="soma do que os clientes deviam quando receberam a mensagem"
        />
        <KpiCard
          label="Recebido junto"
          value={fmtBRL(totals.together.total)}
          sub={`${totals.together.count} quitação(ões) pelo mapa/Caixa`}
        />
        {totals.windows.map((w) => (
          <KpiCard
            key={w.days}
            label={`Recuperado em até ${w.days} dia${w.days > 1 ? "s" : ""}`}
            value={fmtBRL(w.recovered)}
            sub={
              w.count === 0
                ? `nenhuma das ${sends.length} mensagens completou ${w.days} dia${w.days > 1 ? "s" : ""} ainda`
                : `${pct(w.recovered, w.debt)} de ${fmtBRL(w.debt)} · conta ${w.count} de ${sends.length} mensagens` +
                  (w.pending > 0
                    ? ` (${w.pending} enviada${w.pending > 1 ? "s" : ""} há menos de ${w.days} dia${w.days > 1 ? "s" : ""} ainda não ${w.pending > 1 ? "entram" : "entra"})`
                    : "")
            }
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Curva de recuperação (mesmo grupo)</CardTitle>
          <CardDescription>
            Os cards acima comparam grupos diferentes: cada janela só conta as mensagens que já
            completaram aquele prazo. Aqui entram apenas as mensagens que já completaram 7 dias, e o
            mesmo grupo é medido em 1, 3 e 7 dias. Assim dá para ver quanto esperar mais rende de
            verdade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cohort.count === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma mensagem do período completou 7 dias ainda.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {cohort.count} mensage{cohort.count > 1 ? "ns" : "m"} · deviam {fmtBRL(cohort.debt)}{" "}
                no envio
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {cohort.windows.map((w) => (
                  <div key={w.days} className="rounded-md border p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Em até {w.days} dia{w.days > 1 ? "s" : ""}
                    </p>
                    <p className="mt-1 text-xl font-bold">{fmtBRL(w.recovered)}</p>
                    <p className="text-xs text-muted-foreground">
                      {pct(w.recovered, cohort.debt)} do que deviam
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Por recepcionista</CardTitle>
          <CardDescription>
            Pop-up: quantos clientes cada uma enviou ou pulou. &quot;Pulados&quot; alto demais é
            sinal de que o lembrete está sendo fechado sem cobrar.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead className="text-right">Pop-up enviados</TableHead>
                <TableHead className="text-right">Pulados</TableHead>
                <TableHead className="text-right">% pulados</TableHead>
                <TableHead className="text-right">Mensagens</TableHead>
                <TableHead className="text-right">Recuperado 7 dias</TableHead>
                <TableHead className="text-right">Recebido junto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byUser.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Nada no período.
                  </TableCell>
                </TableRow>
              )}
              {byUser.map((u) => (
                <TableRow key={u.name}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-right">{u.popupSent}</TableCell>
                  <TableCell className="text-right">{u.popupSkipped}</TableCell>
                  <TableCell className="text-right">
                    {pct(u.popupSkipped, u.popupSent + u.popupSkipped)}
                  </TableCell>
                  <TableCell className="text-right">{u.messages}</TableCell>
                  <TableCell className="text-right">
                    {fmtBRL(u.recovered7)}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({pct(u.recovered7, u.debt7)})
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtBRL(u.togetherTotal)}{" "}
                    <span className="text-xs text-muted-foreground">({u.togetherCount})</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Por semana</CardTitle>
          <CardDescription>Semana começando na segunda-feira.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Mensagens</TableHead>
                <TableHead className="text-right">Em aberto no envio</TableHead>
                <TableHead className="text-right">Recuperado 7 dias</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byWeek.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhuma mensagem no período.
                  </TableCell>
                </TableRow>
              )}
              {byWeek.map(([wk, w]) => (
                <TableRow key={wk}>
                  <TableCell>
                    {ddmm(wk)} a {ddmm(addDaysISO(wk, 6))}
                  </TableCell>
                  <TableCell className="text-right">{w.messages}</TableCell>
                  <TableCell className="text-right">{fmtBRL(w.debt)}</TableCell>
                  <TableCell className="text-right">
                    {fmtBRL(w.recovered7)}
                    {w.pending > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {w.pending} ainda contando
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{pct(w.recovered7, w.debt7)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mensagens enviadas</CardTitle>
          <CardDescription>
            &quot;—&quot; = a janela ainda não terminou (o valor pode aumentar).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enviada em</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Por</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead className="text-right">1 dia</TableHead>
                <TableHead className="text-right">3 dias</TableHead>
                <TableHead className="text-right">7 dias</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sends.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Nenhuma mensagem no período.
                  </TableCell>
                </TableRow>
              )}
              {sends.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(s.sent_at)}</TableCell>
                  <TableCell>{s.client_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{CONTEXT_LABEL[s.context] ?? s.context}</Badge>
                  </TableCell>
                  <TableCell>{s.sent_by_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtBRL(Number(s.debt_at_send))}</TableCell>
                  {WINDOWS.map((w) => (
                    <TableCell key={w.days} className="text-right">
                      {matured(s, w.days, now) ? fmtBRL(Number(s[w.key])) : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

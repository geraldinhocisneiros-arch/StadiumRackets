import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUrlState } from "@/hooks/useUrlState";
import { toast } from "sonner";
import { FileDown, Loader2, MessageCircle } from "lucide-react";
import { normalizeText } from "@/lib/format";
import { normalizePhoneForWhatsApp, buildWhatsAppUrl } from "@/lib/whatsapp";
import {
  courtLabel,
  findFixedExceptionForHour,
  timeToHours,
  hoursToLabel,
  weekdayOfISO,
  weekdayShort,
  addDaysISO,
  fmtDateBR,
  isManutencaoClientName,
} from "@/lib/court-map";

export const Route = createFileRoute("/liberacao-quadras")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <LiberacaoQuadrasPage />
    </RequireAuth>
  ),
});

interface ReportRow {
  date: string;
  weekday: number;
  court: number;
  start_time: string;
  end_time: string;
  clientId: string | null;
  clientName: string;
  phone: string | null;
  kind: "Avulsa" | "Fixo (mensalista)" | "Pré-reserva";
}

interface ClientGroup {
  key: string;
  clientName: string;
  phone: string | null;
  occurrences: ReportRow[];
}

type ClientRef = { full_name: string; phone: string | null } | null;

interface BookingRow {
  id: string;
  court: number;
  booking_date: string;
  start_time: string;
  end_time: string;
  client_id: string | null;
  guest_name: string | null;
  cancelled_at: string | null;
  hold_expires_at: string | null;
  clients: ClientRef;
}

interface ScheduleRow {
  id: string;
  client_id: string;
  court: number | null;
  weekday: number;
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_until: string | null;
  clients: ClientRef;
}

interface ExceptionRow {
  client_schedule_id: string;
  start_time: string | null;
  end_time: string | null;
  exception_date: string;
  range_end: string | null;
}

function datesBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  let cur = fromISO;
  let guard = 0;
  while (cur <= toISO && guard++ < 400) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

// Uma exceção de horário fixo (falta avisada, cancelamento pontual) cobre
// um único dia (exception_date, sem range_end) ou um intervalo de dias
// (exception_date até range_end, inclusive).
const exceptionAppliesToDate = (e: ExceptionRow, date: string): boolean =>
  date >= e.exception_date && date <= (e.range_end ?? e.exception_date);

// Ocupação do período inteiro, numa única leva de consultas (em vez de uma
// por dia): combina locações avulsas (court_bookings) com horários fixos de
// mensalista (client_schedules), respeitando exceções
// (client_schedule_exceptions) e evitando listar duas vezes quando uma
// locação avulsa é só a materialização do próprio fixo no dia (mesmo
// padrão usado no mapa de quadras, ver src/lib/court-map.ts). Buscar tudo de
// uma vez evita disparar dezenas de requisições (uma por dia x tabela) contra
// o pool de conexões do Supabase — ver o comentário em
// src/integrations/supabase/client.ts sobre o plano Nano.
//
// hourFrom/hourTo ("HH:MM", opcionais): quando informados, substituem a
// janela padrão (segunda a sexta a partir das 17h, fim de semana o dia
// inteiro) por um intervalo fixo aplicado a todos os dias do período.
async function loadRangeOccupancy(
  from: string,
  to: string,
  hourFrom: string,
  hourTo: string,
): Promise<ReportRow[]> {
  const dates = datesBetween(from, to);
  const weekdaysInRange = Array.from(new Set(dates.map(weekdayOfISO)));

  const [bRes, sRes] = await Promise.all([
    supabase
      .from("court_bookings")
      .select(
        "id, court, booking_date, start_time, end_time, client_id, guest_name, cancelled_at, hold_expires_at, clients!client_id(full_name, phone)",
      )
      .gte("booking_date", from)
      .lte("booking_date", to),
    supabase
      .from("client_schedules")
      .select(
        "id, client_id, court, weekday, start_time, end_time, valid_from, valid_until, clients!client_id(full_name, phone)",
      )
      .in("weekday", weekdaysInRange)
      .or(`valid_from.is.null,valid_from.lte.${to}`)
      .or(`valid_until.is.null,valid_until.gte.${from}`),
  ]);
  if (bRes.error) throw bRes.error;
  if (sRes.error) throw sRes.error;

  const scheds = (sRes.data ?? []) as unknown as ScheduleRow[];
  const scheduleIds = scheds.map((s) => s.id);

  const excRes = scheduleIds.length
    ? await supabase
        .from("client_schedule_exceptions")
        .select("client_schedule_id, start_time, end_time, exception_date, range_end")
        .lte("exception_date", to)
        .or(`range_end.gte.${from},and(range_end.is.null,exception_date.gte.${from})`)
        .in("client_schedule_id", scheduleIds)
    : { data: [] as ExceptionRow[], error: null };
  if (excRes.error) throw excRes.error;

  const excByScheduleId = new Map<string, ExceptionRow[]>();
  for (const e of (excRes.data ?? []) as ExceptionRow[]) {
    const arr = excByScheduleId.get(e.client_schedule_id) ?? [];
    arr.push(e);
    excByScheduleId.set(e.client_schedule_id, arr);
  }

  const bookingsByDate = new Map<string, BookingRow[]>();
  for (const b of (bRes.data ?? []) as unknown as BookingRow[]) {
    const arr = bookingsByDate.get(b.booking_date) ?? [];
    arr.push(b);
    bookingsByDate.set(b.booking_date, arr);
  }

  const rows: ReportRow[] = [];

  for (const date of dates) {
    const weekday = weekdayOfISO(date);
    const isWeekend = weekday === 0 || weekday === 6;
    const windowStartHour = hourFrom ? timeToHours(hourFrom) : isWeekend ? 0 : 17;
    const windowEndHour = hourTo ? timeToHours(hourTo) : 24;
    const overlapsWindow = (startTime: string, endTime: string) =>
      timeToHours(endTime) > windowStartHour && timeToHours(startTime) < windowEndHour;

    const activeFixed = scheds.filter((s) => {
      if (s.court == null || s.weekday !== weekday) return false;
      if (s.valid_from != null && s.valid_from > date) return false;
      if (s.valid_until != null && s.valid_until < date) return false;
      if (!overlapsWindow(s.start_time, s.end_time)) return false;
      const exs = (excByScheduleId.get(s.id) ?? []).filter((e) => exceptionAppliesToDate(e, date));
      const startHour = Math.floor(timeToHours(s.start_time));
      return !findFixedExceptionForHour(
        exs.map((e) => ({ id: "", start_time: e.start_time, end_time: e.end_time, reason: null })),
        startHour,
      );
    });

    const isSameAsFixed = (b: BookingRow) =>
      b.client_id != null &&
      activeFixed.some(
        (f) =>
          f.court === b.court &&
          f.client_id === b.client_id &&
          f.start_time === b.start_time &&
          f.end_time === b.end_time,
      );

    for (const b of bookingsByDate.get(date) ?? []) {
      if (b.cancelled_at) continue;
      if (!overlapsWindow(b.start_time, b.end_time)) continue;
      if (isSameAsFixed(b)) continue;
      const clientName = b.clients?.full_name ?? b.guest_name ?? "Sem nome";
      if (isManutencaoClientName(clientName)) continue;
      rows.push({
        date,
        weekday,
        court: b.court,
        start_time: b.start_time,
        end_time: b.end_time,
        clientId: b.client_id,
        clientName,
        phone: b.clients?.phone ?? null,
        kind: b.hold_expires_at ? "Pré-reserva" : "Avulsa",
      });
    }

    for (const f of activeFixed) {
      const clientName = f.clients?.full_name ?? "Sem nome";
      if (isManutencaoClientName(clientName)) continue;
      rows.push({
        date,
        weekday,
        court: f.court!,
        start_time: f.start_time,
        end_time: f.end_time,
        clientId: f.client_id,
        clientName,
        phone: f.clients?.phone ?? null,
        kind: "Fixo (mensalista)",
      });
    }
  }

  return rows;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const occurrenceLabel = (o: ReportRow) =>
  `${weekdayShort[o.weekday]}, ${fmtDateBR(o.date)}, ${hoursToLabel(timeToHours(o.start_time))}–${hoursToLabel(timeToHours(o.end_time))} (${courtLabel(o.court)})`;

// Mensagem de WhatsApp já citando todos os dias/horários que precisamos
// que o cliente libere — mesmo quando ele tem mais de uma reserva no
// período, é uma mensagem só. Texto fixo definido pelo clube.
function buildReleaseMessage(group: ClientGroup, from: string, to: string): string {
  const lines = group.occurrences.map((o) => `• ${occurrenceLabel(o)}`).join("\n");
  return (
    `Olá ${group.clientName}! Vamos realizar um evento na Stadium Rackets no período de ${fmtDateBR(from)} a ${fmtDateBR(to)} e precisaremos utilizar as quadras. Contamos com a sua compreensão para liberar a quadra marcada em seu nome no(s) seguinte(s) dia(s) e horário(s):\n` +
    `${lines}\n\n` +
    `Agradecemos a compreensão e a gentileza. Ficamos à disposição caso queira jogar em outro dia e horário a combinar previamente. Att, Stadium Rackets`
  );
}

function buildWordDoc(
  groups: ClientGroup[],
  from: string,
  to: string,
  excludeName: string,
): string {
  let body = `<h1 style="font-family:Calibri,Arial,sans-serif;">Liberação de quadras — Torneio</h1>`;
  body += `<p style="font-family:Calibri,Arial,sans-serif;">Período: ${fmtDateBR(from)} a ${fmtDateBR(to)}. Não inclui reservas de "${escapeHtml(excludeName)}".</p>`;
  if (groups.length === 0) {
    body += `<p style="font-family:Calibri,Arial,sans-serif;">Nenhuma quadra ocupada no período e horário informados.</p>`;
  } else {
    body +=
      `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%;font-family:Calibri,Arial,sans-serif;font-size:11pt;">` +
      `<thead><tr style="background:#eee;"><th>Cliente</th><th>Telefone</th><th>Dias/horários a liberar</th></tr></thead><tbody>`;
    for (const g of groups) {
      const occText = g.occurrences.map((o) => escapeHtml(occurrenceLabel(o))).join("<br/>");
      body += `<tr><td>${escapeHtml(g.clientName)}</td><td>${escapeHtml(g.phone ?? "—")}</td><td>${occText}</td></tr>`;
    }
    body += `</tbody></table>`;
  }
  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>Liberação de quadras</title></head><body>${body}</body></html>`
  );
}

function downloadWordDoc(html: string, filename: string) {
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function LiberacaoQuadrasPage() {
  const [from, setFrom] = useUrlState<string>("from", "2026-09-17");
  const [to, setTo] = useUrlState<string>("to", "2026-09-27");
  const [hourFrom, setHourFrom] = useUrlState<string>("hora_inicio", "");
  const [hourTo, setHourTo] = useUrlState<string>("hora_fim", "");
  const [excludeName, setExcludeName] = useUrlState<string>(
    "excluir",
    "Aberto Pernambucano de Tênis",
  );
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (!from || !to || from > to) {
      toast.error("Período inválido");
      return;
    }
    if (hourFrom && hourTo && hourFrom >= hourTo) {
      toast.error("Horário inicial precisa ser antes do horário final");
      return;
    }
    setLoading(true);
    try {
      const result = await loadRangeOccupancy(from, to, hourFrom, hourTo);
      setRows(result);
      setLoaded(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar reservas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const excludeNorm = normalizeText(excludeName);
  const filteredRows = useMemo(
    () => rows.filter((r) => !excludeNorm || !normalizeText(r.clientName).includes(excludeNorm)),
    [rows, excludeNorm],
  );

  // Um cliente com mais de uma reserva no período aparece uma vez só,
  // listando todas as ocorrências — tanto na tela quanto na mensagem.
  const groupedClients = useMemo(() => {
    const byClient = new Map<string, ClientGroup>();
    for (const r of filteredRows) {
      const key = r.clientId ?? `convidado:${normalizeText(r.clientName)}`;
      const existing = byClient.get(key);
      if (existing) {
        existing.occurrences.push(r);
        if (!existing.phone && r.phone) existing.phone = r.phone;
      } else {
        byClient.set(key, { key, clientName: r.clientName, phone: r.phone, occurrences: [r] });
      }
    }
    const groups = Array.from(byClient.values());
    for (const g of groups) {
      g.occurrences.sort(
        (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time),
      );
    }
    groups.sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
    return groups;
  }, [filteredRows]);

  const handleDownload = () => {
    const html = buildWordDoc(groupedClients, from, to, excludeName);
    downloadWordDoc(html, `liberacao-quadras-${from}-a-${to}.doc`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Liberação de quadras</h1>
        <p className="text-muted-foreground">
          Por padrão, mostra de segunda a sexta a partir das 17h e nos finais de semana o dia
          inteiro — dá pra escolher outro intervalo de horário abaixo. Cada cliente aparece uma vez,
          com todos os dias/horários que precisamos que ele libere.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label>Início</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fim</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Hora início (opcional)</Label>
              <Input type="time" value={hourFrom} onChange={(e) => setHourFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Hora fim (opcional)</Label>
              <Input type="time" value={hourTo} onChange={(e) => setHourTo(e.target.value)} />
            </div>
            <div className="space-y-1 min-w-[260px]">
              <Label>Excluir cliente (ex.: o próprio torneio)</Label>
              <Input value={excludeName} onChange={(e) => setExcludeName(e.target.value)} />
            </div>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Gerar lista
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={loading || !loaded}>
              <FileDown className="h-4 w-4 mr-2" /> Baixar em Word
            </Button>
            <div className="ml-auto text-right">
              <p className="text-sm text-muted-foreground">Total de clientes para contatar</p>
              <p className="text-2xl font-bold text-primary">{groupedClients.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Carregando reservas...
        </div>
      )}

      {!loading && loaded && groupedClients.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-muted-foreground">
            Nenhuma quadra ocupada no período e horário informados.
          </CardContent>
        </Card>
      )}

      {!loading && groupedClients.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Dias/horários a liberar</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedClients.map((g) => {
                  const wa = normalizePhoneForWhatsApp(g.phone);
                  const message = buildReleaseMessage(g, from, to);
                  return (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium align-top">{g.clientName}</TableCell>
                      <TableCell className="align-top">{g.phone ?? "—"}</TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-0.5">
                          {g.occurrences.map((o, i) => (
                            <div key={i} className="text-sm">
                              {occurrenceLabel(o)}{" "}
                              <span className="text-muted-foreground">({o.kind})</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {wa && (
                          <a
                            href={buildWhatsAppUrl(wa, message)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap"
                          >
                            <MessageCircle className="h-4 w-4" /> WhatsApp
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

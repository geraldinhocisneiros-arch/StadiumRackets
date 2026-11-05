// "Quadra dividida" (dois+ fixos no mesmo dia da semana/quadra/horário) e o
// "Mover só hoje" de horário fixo. O movimento em si mora no banco
// (move_fixed_today / move_booking_today — ver moveFixedToday abaixo), numa
// transação só, e é chamado por todas as telas que movem fixo; aqui fica
// só a consulta de quem ocupa um horário fixo hoje, usada pra decidir o
// caminho antes de chamar o banco.
import { supabase } from "@/integrations/supabase/client";
import { timeToHours } from "./court-map";

export interface FixedGroupMember {
  id: string;
  client_id: string;
  teacher_id: string | null;
  start_time: string;
  end_time: string;
  clientName: string;
}

// Quem ainda está de fato ocupando uma quadra/horário fixo hoje: mesmo dia
// da semana/quadra, faixa de horário sobreposta à de referência (mesmo
// critério de "dividido"), dentro da vigência (valid_from/valid_until), e
// SEM nenhuma exceção pra esta data cobrindo o próprio horário — nem de
// dia inteiro (já movido/cancelado o dia todo), nem só da(s) hora(s)
// (cancelamento de presença via "Cancelou a tempo"/"tarde", que libera a
// quadra sem mover o fixo). Ignorar exceções parciais aqui foi o bug que já
// aconteceu: um cliente com presença cancelada (badge "C" no mapa) era
// encontrado como "ocupante" e acabava sendo movido/trocado de quadra
// mesmo cancelado.
export async function fetchUnmovedFixedGroup(
  bookingDate: string,
  weekday: number,
  court: number,
  refStart: string,
  refEnd: string,
): Promise<FixedGroupMember[]> {
  const { data } = await supabase
    .from("client_schedules")
    .select(
      "id, client_id, teacher_id, start_time, end_time, valid_from, valid_until, clients!client_id(full_name)",
    )
    .eq("weekday", weekday)
    .eq("court", court)
    .or(`valid_from.is.null,valid_from.lte.${bookingDate}`)
    .or(`valid_until.is.null,valid_until.gte.${bookingDate}`);
  type Row = {
    id: string;
    client_id: string;
    teacher_id: string | null;
    start_time: string;
    end_time: string;
    clients: { full_name: string } | null;
  };
  const refS = timeToHours(refStart);
  const refE = timeToHours(refEnd);
  const rows = ((data as unknown as Row[]) ?? []).filter((r) => {
    const rs = timeToHours(r.start_time);
    const re = timeToHours(r.end_time);
    return rs < refE && re > refS;
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { data: excRows } = await supabase
    .from("client_schedule_exceptions")
    .select("client_schedule_id, start_time, end_time")
    .in("client_schedule_id", ids)
    .eq("exception_date", bookingDate);
  const excByScheduleId = new Map<
    string,
    { start_time: string | null; end_time: string | null }[]
  >();
  for (const e of excRows ?? []) {
    const list = excByScheduleId.get(e.client_schedule_id as string) ?? [];
    list.push({ start_time: e.start_time as string | null, end_time: e.end_time as string | null });
    excByScheduleId.set(e.client_schedule_id as string, list);
  }
  return rows
    .filter((r) => {
      const exs = excByScheduleId.get(r.id) ?? [];
      const rs = timeToHours(r.start_time);
      const re = timeToHours(r.end_time);
      return !exs.some((e) => {
        if (!e.start_time || !e.end_time) return true; // dia inteiro
        const es = timeToHours(e.start_time);
        const ee = timeToHours(e.end_time);
        return es < re && ee > rs; // sobrepõe o próprio horário do fixo
      });
    })
    .map((r) => ({
      id: r.id,
      client_id: r.client_id,
      teacher_id: r.teacher_id,
      start_time: r.start_time,
      end_time: r.end_time,
      clientName: r.clients?.full_name ?? "cliente",
    }));
}

// ---------------------------------------------------------------------
// "Mover só hoje" atômico (migration 20261007120000_move_fixed_today_atomic)
// ---------------------------------------------------------------------
// O movimento inteiro — exceção do fixo de cada um que divide a quadra,
// locação no destino, participantes, troca com quem estava lá (locação ou
// fixo) e a volta pro horário original — acontece numa transação só no
// banco: ou tudo é gravado, ou nada muda. Antes cada tela fazia isso em
// vários passos separados e uma falha no meio deixava estado pela metade
// (ex.: o cliente no destino e na quadra original ao mesmo tempo, e o
// parceiro da dupla esquecido pra trás).

export interface MovedPerson {
  client_id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_lead?: boolean;
}

export interface MoveFixedTodayResult {
  restored: boolean;
  from_court: number;
  to_court: number;
  booking_id?: string | null;
  moved: MovedPerson[];
  swapped_booking: {
    client_id: string | null;
    name: string | null;
    start_time: string;
    end_time: string;
  } | null;
  swapped_fixed: MovedPerson[];
}

export async function moveFixedToday(params: {
  scheduleId: string;
  date: string;
  court: number;
  startTime: string;
  endTime: string;
  // Locação "movida do fixo" da célula clicada, quando o fixo já tinha
  // sido movido hoje.
  bookingId?: string | null;
}): Promise<{ data: MoveFixedTodayResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("move_fixed_today", {
    _schedule_id: params.scheduleId,
    _date: params.date,
    _court: params.court,
    _start_time: params.startTime,
    _end_time: params.endTime,
    _booking_id: params.bookingId ?? undefined,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as unknown as MoveFixedTodayResult, error: null };
}

export interface MoveBookingTodayResult {
  from_court: number;
  to_court: number;
  swapped_fixed: MovedPerson[];
}

// Locação avulsa indo pra cima de horário(s) fixo(s) do destino.
export async function moveBookingOntoFixed(params: {
  bookingId: string;
  court: number;
  startTime: string;
  endTime: string;
}): Promise<{ data: MoveBookingTodayResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("move_booking_today", {
    _booking_id: params.bookingId,
    _court: params.court,
    _start_time: params.startTime,
    _end_time: params.endTime,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as unknown as MoveBookingTodayResult, error: null };
}

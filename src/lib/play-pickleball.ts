// Play Pickleball: pacote de plays do mês para alunos da Escolinha
// Pickleball. Regras e tabelas: supabase/migrations/20261118180000_play_pickleball.sql

import { supabase } from "@/integrations/supabase/client";

export const PLAYS_PER_MONTH = 4;

export interface PlayBalance {
  total: number;
  used: number;
}

/** Mês do play = mês da locação ("2026-11-18" → "2026-11-01"). */
export const playMonthOf = (ymd: string): string => `${ymd.slice(0, 7)}-01`;

/** Recebe o nome da categoria já normalizado (sem acento, minúsculo). */
export const isPlayPickleballCategory = (catNorm: string): boolean => catNorm === "play pickleball";

export async function fetchPlayBalances(
  clientIds: string[],
  month: string,
): Promise<Record<string, PlayBalance>> {
  if (clientIds.length === 0) return {};
  const { data, error } = await supabase.rpc("pickleball_play_balance", {
    _client_ids: clientIds,
    _month: month,
  });
  if (error) {
    console.error("[play] pickleball_play_balance", error);
    return {};
  }
  const out: Record<string, PlayBalance> = {};
  for (const r of data ?? []) {
    out[r.client_id] = { total: Number(r.plays_total) || 0, used: Number(r.plays_used) || 0 };
  }
  return out;
}

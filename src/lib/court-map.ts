// Constantes e helpers do mapa de quadras.

// Stadium Rackets: 1 quadra de tênis (saibro) + 3 quadras de pickleball.
// Numeração interna (coluna `court` no banco):
//   1 = Tênis (saibro)
//   2 = Pickleball 1, 3 = Pickleball 2, 4 = Pickleball 3
export const TENNIS_COURT = 1;
export const PICKLEBALL_COURTS = [2, 3, 4] as const;
export const COURTS = [1, 2, 3, 4] as const;
// Mantido por compatibilidade com telas de operação: no Stadium não existe
// quadra exclusiva da equipe, então é igual a COURTS.
export const STAFF_COURTS = COURTS;

export const isTennisCourt = (c: number | null | undefined): boolean => c === TENNIS_COURT;
export const isPickleballCourt = (c: number | null | undefined): boolean =>
  typeof c === "number" && c >= 2 && c <= 4;

// Slots de hora em hora: 05:00 até 23:00 (último = 23:00–00:00).
export const HOUR_SLOTS: number[] = Array.from({ length: 19 }, (_, i) => 5 + i);

// Slots de meia em meia hora: 05:00, 05:30, 06:00, ..., 23:30.
export const HALF_SLOTS: number[] = Array.from({ length: 38 }, (_, i) => 5 + i * 0.5);

/** Rótulo curto (cabeçalho do mapa, listas): "Tênis", "PB1", "PB2", "PB3". */
export const courtShort = (c: number): string =>
  c === TENNIS_COURT ? "Tênis" : isPickleballCourt(c) ? `PB${c - 1}` : `Q${c}`;

/** Rótulo completo: "Tênis (saibro)", "Pickleball 1"... */
export const courtLabel = (c: number): string =>
  c === TENNIS_COURT
    ? "Tênis (saibro)"
    : isPickleballCourt(c)
      ? `Pickleball ${c - 1}`
      : `Quadra ${c}`;

/**
 * Rótulo "de máquina" usado em observações geradas pelo sistema (ex.: "Movido
 * do fixo (Q2 (PB1) 07:00–08:00)") — o prefixo Q<n> é parseado de
 * volta (MOVED_FROM_FIXED_NOTES_RE e a função _court_label do banco).
 */
export const courtNoteLabel = (c: number): string => `Q${c} (${courtShort(c)})`;

/** Rótulo para mensagens ao cliente: "Quadra de tênis (saibro)", "Quadra de pickleball 1". */
export const courtLongLabel = (c: number): string =>
  c === TENNIS_COURT
    ? "Quadra de tênis (saibro)"
    : isPickleballCourt(c)
      ? `Quadra de pickleball ${c - 1}`
      : `Quadra ${c}`;

// Preferência de quadra nas filas de espera (avulsa e fixa):
//   null = "Qualquer" (tênis ou pickleball)
//   0    = "Pickleball" (qualquer uma das 3 quadras de pickleball)
//   1    = Tênis; 2–4 = uma quadra de pickleball específica
export const ANY_PICKLEBALL = 0;
export const avulsaCourtLabel = (court: number | null): string =>
  court === null ? "Qualquer" : court === ANY_PICKLEBALL ? "Pickleball" : courtShort(court);
export const fixedWaitlistCourtLabel = (court: number | null): string =>
  court === null ? "Qualquer" : court === ANY_PICKLEBALL ? "Pickleball" : courtLabel(court);

export const hourLabel = (h: number) =>
  `${String(h).padStart(2, "0")}:00`;

export const hourEndLabel = (h: number) =>
  `${String((h + 1) % 24).padStart(2, "0")}:00`;

export const weekdayShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const parseTimeHour = (t: string): number => Number(t.slice(0, 2));

// Converte "HH:MM[:SS]" em número fracionário de horas.
// "23:59[:59]" é tratado como 24 (fim de dia).
export const timeToHours = (t: string): number => {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr ?? 0);
  const m = Number(mStr ?? 0);
  if (h === 23 && m >= 59) return 24;
  return h + m / 60;
};

// Converte horas fracionárias em "HH:MM:SS" (arredondando para o minuto).
export const hoursToTime = (n: number): string => {
  if (n >= 24) return "23:59:59";
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  if (m === 60) return `${String(h + 1).padStart(2, "0")}:00:00`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
};

// Rótulo curto "HH:MM" a partir de horas fracionárias.
export const hoursToLabel = (n: number): string => {
  if (n >= 24) return "00:00";
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  if (m === 60) return `${String((h + 1) % 24).padStart(2, "0")}:00`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export const SOURCE_LABEL: Record<string, string> = {
  avulsa: "Avulsa",
  professor: "Professor",
};

export const SOURCE_COLOR: Record<string, string> = {
  avulsa:
    "bg-green-300/30 border-green-400/40 text-green-900 dark:text-green-100",
  professor:
    "bg-sky-300/30 border-sky-400/40 text-sky-900 dark:text-sky-100",
};

export const FIXED_COLOR =
  "bg-green-800/20 border-green-900/30 text-green-950 dark:text-green-100";

export interface BookingParticipant {
  client_id: string;
  full_name: string;
}

export interface Booking {
  id: string;
  court: number;
  booking_date: string;
  start_time: string;
  end_time: string;
  source: "avulsa" | "professor";
  client_id: string | null;
  teacher_id: string | null;
  guest_type: "convidado" | "batedor" | null;
  guest_name: string | null;
  notes: string | null;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  cancelled_at: string | null;
  clients?: { id: string; full_name: string } | null;
  // map_color_as_avulsa: professor cujas reservas aparecem com a cor
  // verde de avulsa no mapa em vez do azul padrão de professor.
  teachers?: { id: string; name: string; map_color_as_avulsa?: boolean | null } | null;
  cancel_reason?: string | null;
  created_by?: string | null;
  cancelled_by?: string | null;
  // Participantes adicionais (multi-cliente por locação)
  participants?: BookingParticipant[];
  // Portal professor: marcado como próprio quando o cliente é vinculado ao professor
  is_own?: boolean;
  // Pré-reserva (7 min) criada ao solicitar reserva pelo WhatsApp — ver
  // request_court_booking_hold. Null/ausente = reserva de verdade.
  hold_expires_at?: string | null;
}

// Locação criada a partir de um fixo (mudança de quadra/horário só no dia).
// Segue a convenção `notes` iniciada com "Movido do fixo".
export const isMovedFromFixedBooking = (b: Booking): boolean =>
  !!b.client_id &&
  typeof b.notes === "string" &&
  b.notes.startsWith("Movido do fixo");

// Marcador deixado numa importação em massa de outra planilha/sistema
// (ex.: "Importado planilha 04/07/2026") — não é uma observação de
// verdade, só metadado da migração, então não deve ser tratado/exibido
// como observação (destaque na tela de detalhes, ícone no mapa etc.).
export const isImportedPlaceholderNote = (notes: string | null | undefined): boolean =>
  typeof notes === "string" && /^\s*importado\s+planilha\b/i.test(notes);

export const RANKING_CATEGORY_NAMES = ["ranking masculino", "ranking feminino"];
const normalizeCategory = (name: string | null | undefined): string =>
  (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export const isRankingCategoryName = (name: string | null | undefined): boolean => {
  const norm = normalizeCategory(name);
  return !!norm && RANKING_CATEGORY_NAMES.includes(norm);
};
export const isRankingMasculinoName = (name: string | null | undefined): boolean =>
  normalizeCategory(name) === "ranking masculino";
export const isRankingFemininoName = (name: string | null | undefined): boolean =>
  normalizeCategory(name) === "ranking feminino";
export const isManutencaoName = (name: string | null | undefined): boolean =>
  normalizeCategory(name) === "manutencao";

// Cliente placeholder "Manutenção" (bloqueio de quadra lançado como reserva
// em nome desse cliente) — nome exato, não substring.
export const isManutencaoClientName = (name: string | null | undefined): boolean =>
  /^manuten[cç][aã]o$/i.test((name ?? "").trim());

// Cor de célula por categoria (sobrepõe SOURCE_COLOR quando aplicável).
// Ranking masculino → marrom; Ranking feminino → rosa;
// Manutenção → vermelho (quadra bloqueada, não é uma reserva de verdade).
export const RANKING_MASC_COLOR =
  "bg-amber-900/25 border-amber-900/50 text-amber-950 dark:text-amber-100";
export const RANKING_FEM_COLOR =
  "bg-pink-400/25 border-pink-500/50 text-pink-950 dark:text-pink-100";
export const MANUTENCAO_COLOR =
  "bg-red-500/20 border-red-600/60 text-red-950 dark:bg-red-500/15 dark:text-red-100";

// Paleta de cores que o usuário pode escolher livremente por categoria
// (tela Categorias). A chave é o que fica salvo em `client_categories.color`.
export interface CategoryColorPreset {
  key: string;
  label: string;
  // Botão sólido usado no seletor de cores.
  swatchClass: string;
  // Classe aplicada na célula do mapa (fundo/borda/texto, com variante dark).
  cellClass: string;
}
export const CATEGORY_COLOR_PRESETS: CategoryColorPreset[] = [
  { key: "red", label: "Vermelho", swatchClass: "bg-red-500", cellClass: "bg-red-500/15 border-red-500/40 text-red-900 dark:text-red-100" },
  { key: "orange", label: "Laranja", swatchClass: "bg-orange-500", cellClass: "bg-orange-500/15 border-orange-500/40 text-orange-900 dark:text-orange-100" },
  { key: "amber", label: "Âmbar", swatchClass: "bg-amber-500", cellClass: "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100" },
  { key: "emerald", label: "Verde", swatchClass: "bg-emerald-500", cellClass: "bg-emerald-500/15 border-emerald-500/40 text-emerald-900 dark:text-emerald-100" },
  { key: "teal", label: "Verde-azulado", swatchClass: "bg-teal-500", cellClass: "bg-teal-500/15 border-teal-500/40 text-teal-900 dark:text-teal-100" },
  { key: "sky", label: "Azul-claro", swatchClass: "bg-sky-500", cellClass: "bg-sky-500/15 border-sky-500/40 text-sky-900 dark:text-sky-100" },
  { key: "blue", label: "Azul", swatchClass: "bg-blue-500", cellClass: "bg-blue-500/15 border-blue-500/40 text-blue-900 dark:text-blue-100" },
  { key: "indigo", label: "Índigo", swatchClass: "bg-indigo-500", cellClass: "bg-indigo-500/15 border-indigo-500/40 text-indigo-900 dark:text-indigo-100" },
  { key: "violet", label: "Violeta", swatchClass: "bg-violet-500", cellClass: "bg-violet-500/15 border-violet-500/40 text-violet-900 dark:text-violet-100" },
  { key: "fuchsia", label: "Magenta", swatchClass: "bg-fuchsia-500", cellClass: "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-900 dark:text-fuchsia-100" },
  { key: "pink", label: "Rosa", swatchClass: "bg-pink-500", cellClass: "bg-pink-500/15 border-pink-500/40 text-pink-900 dark:text-pink-100" },
  { key: "slate", label: "Cinza", swatchClass: "bg-slate-500", cellClass: "bg-slate-500/15 border-slate-500/40 text-slate-900 dark:text-slate-100" },
];
export const categoryColorPreset = (key: string | null | undefined): CategoryColorPreset | null =>
  CATEGORY_COLOR_PRESETS.find((p) => p.key === key) ?? null;

export const bookingCellColorClass = (
  categoryName: string | null | undefined,
  fallback: string,
  categoryColor?: string | null,
  clientFullName?: string | null,
): string => {
  const custom = categoryColorPreset(categoryColor);
  if (custom) return custom.cellClass;
  if (isManutencaoName(categoryName)) return MANUTENCAO_COLOR;
  if (isRankingMasculinoName(categoryName)) return RANKING_MASC_COLOR;
  if (isRankingFemininoName(categoryName)) return RANKING_FEM_COLOR;
  return fallback;
};

export interface FixedException {
  id: string;
  start_time: string | null; // null = dia inteiro
  end_time: string | null;
  reason: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface FixedSchedule {
  id: string;
  client_id: string;
  teacher_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
  notes: string | null;
  clients?: { id: string; full_name: string } | null;
  teachers?: { id: string; name: string } | null;
  // preenchido no cliente: exceções aplicáveis à data corrente
  exceptions?: FixedException[];
  created_by?: string | null;
  created_at?: string | null;
  // Vigência (null = sem limite): o fixo só vale de valid_from até valid_until.
  valid_from?: string | null;
  valid_until?: string | null;
  // Observação que vale só para a data exibida (client_schedule_day_notes).
  day_note?: string | null;
  // Portal professor: marcado como próprio quando o cliente é vinculado ao professor
  is_own?: boolean;
}

// Retorna a exceção que cobre a hora informada (ou null se não houver).
export function findFixedExceptionForHour(
  exs: FixedException[] | undefined,
  hour: number,
): FixedException | null {
  if (!exs?.length) return null;
  for (const e of exs) {
    if (!e.start_time || !e.end_time) return e; // dia inteiro
    const s = timeToHours(e.start_time);
    const en = timeToHours(e.end_time);
    // slot da hora "hour" cobre [hour, hour+1); há sobreposição se s<hour+1 e en>hour
    if (s < hour + 1 && en > hour) return e;
  }
  return null;
}

export function dateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  return dateISO(dt);
}

export function weekdayOfISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}

export function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

// Fuso horário fixo do sistema: Recife/Brasil (America/Recife = UTC-3 sem horário de verão).
// Todas as conversões de data/hora exibidas e os filtros por intervalo de datas
// usam este fuso para evitar deslocamentos causados pelo fuso do navegador.
export const APP_TZ = "America/Recife";

export const normalizeText = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Filtro para o componente Command (cmdk): substitui o fuzzy-match padrão
// por uma busca que ignora acentuação e, com múltiplas palavras (ex.: nome
// + sobrenome), encontra o item mesmo que as palavras não fiquem juntas —
// cada palavra digitada só precisa aparecer em algum lugar do valor.
export const accentInsensitiveFilter = (value: string, search: string) => {
  const terms = normalizeText(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  const normalizedValue = normalizeText(value);
  return terms.every((term) => normalizedValue.includes(term)) ? 1 : 0;
};

export const toTitleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|-|')([\p{L}])/gu, (_, sep, ch) => sep + ch.toUpperCase());

export const fmtBRL = (v: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TZ }).format(date);
};

export const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TZ,
  }).format(date);
};

// Retorna { year, month, day } correspondentes ao instante "date" no fuso de Recife.
const partsInRecife = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
};

// "YYYY-MM-DD" correspondente ao instante "date" no fuso de Recife.
export const dateISOInRecife = (date: Date) => {
  const { year, month, day } = partsInRecife(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

// "YYYY-MM-DD" do dia atual em Recife.
export const todayISO = () => dateISOInRecife(new Date());

// Constrói um instante ISO (UTC) correspondente a um "YYYY-MM-DD" + horário em Recife (UTC-3 fixo).
// Se o dia for hoje em Recife, usa o instante atual (preserva o horário real do lançamento).
export const recifeDateToISO = (ymd: string, hour = 12) => {
  if (ymd === todayISO()) return new Date().toISOString();
  const [y, m, d] = ymd.split("-").map(Number);
  // UTC = Recife + 3h
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, hour + 3, 0, 0, 0)).toISOString();
};

// "YYYY-MM-DD" do primeiro dia do mês de "date" em Recife.
export const monthStartISO = (date = new Date()) => {
  const { year, month } = partsInRecife(date);
  return `${year}-${String(month).padStart(2, "0")}-01`;
};

// "YYYY-MM-DD" do último dia do mês de "date" em Recife.
export const monthEndISO = (date = new Date()) => {
  const { year, month } = partsInRecife(date);
  // dia 0 do mês seguinte = último dia do mês atual (independe de fuso pois é só aritmética de calendário)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
};

// Converte "YYYY-MM-DD" no instante UTC correspondente a 00:00 em Recife (UTC-3 fixo).
// Usado para filtros .gte("paid_at", dayStartISO(ymd)).
export const dayStartISO = (ymd: string) => `${ymd}T03:00:00.000Z`;

// Instante UTC correspondente a 00:00 do dia SEGUINTE em Recife (limite exclusivo).
export const dayEndExclusiveISO = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}T03:00:00.000Z`;
};

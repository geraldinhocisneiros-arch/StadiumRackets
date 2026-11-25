import { normalizeText } from "@/lib/format";
import { fetchAll } from "@/lib/fetchAll";

/**
 * Detecção de cadastro de cliente possivelmente duplicado.
 *
 * Antes só nome IDÊNTICO (sem acento/caixa) era pego — "cibele azevedo"
 * passou batido por "Cibelle Azevedo" e virou um segundo cadastro com
 * reservas e débitos próprios. Aqui a comparação tolera os erros de
 * digitação mais comuns na recepção:
 *  - letra dobrada/simples (Cibelle × Cibele, Vanessa × Vanesa);
 *  - uma letra trocada/faltando/sobrando por palavra (Rafael × Rafaél, Luis × Luiz);
 *  - nome do meio a mais ou a menos (Maria Souza × Maria Santos Souza);
 *  - conectivos (de/da/do/dos/das/e) ignorados.
 * É só um AVISO — a recepção pode confirmar e cadastrar mesmo assim.
 */

const CONNECTORS = new Set(["de", "da", "do", "dos", "das", "e"]);

function tokens(name: string): string[] {
  return (
    normalizeText(name)
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t && !CONNECTORS.has(t))
      // colapsa letras repetidas: "cibelle" -> "cibele", "vanessa" -> "vanesa"
      .map((t) => t.replace(/(.)\1+/g, "$1"))
  );
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false; // palavras curtas: só iguais (evita Ana × Ane)
  return levenshtein(a, b) <= (min >= 8 ? 2 : 1);
}

/** true se os dois nomes provavelmente são a mesma pessoa. */
export function namesLookAlike(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  // Só um nome digitado (ex.: "Cibele"): compara com o primeiro nome do outro
  // apenas se o outro também tiver um nome só — senão daria aviso demais.
  if (ta.length === 1 || tb.length === 1) {
    return ta.length === tb.length && tokenMatch(ta[0], tb[0]);
  }
  // Primeiro nome e último sobrenome batem (nomes do meio podem variar).
  return tokenMatch(ta[0], tb[0]) && tokenMatch(ta[ta.length - 1], tb[tb.length - 1]);
}

export interface DuplicateCandidate {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
}

/**
 * Lista mensagens legíveis de cadastros parecidos com (nome, telefone).
 * `ignoreId` = o próprio cliente em edição.
 */
export function findSimilarClients(
  existing: DuplicateCandidate[],
  name: string,
  phone: string | null | undefined,
  ignoreId?: string | null,
): string[] {
  const phoneDigits = (phone ?? "").replace(/\D/g, "");
  const out: string[] = [];
  for (const c of existing) {
    if (ignoreId && c.id === ignoreId) continue;
    const tag = c.active ? "" : " (inativo)";
    if (name.trim() && namesLookAlike(name, c.full_name)) {
      const same = normalizeText(name) === normalizeText(c.full_name);
      out.push(`${same ? "Nome igual" : "Nome parecido"}: "${c.full_name}"${tag}`);
      continue;
    }
    const otherDigits = (c.phone ?? "").replace(/\D/g, "");
    // compara pelos últimos 8 dígitos: ignora DDD/9º dígito/+55 digitados de jeitos diferentes
    if (
      phoneDigits.length >= 8 &&
      otherDigits.length >= 8 &&
      phoneDigits.slice(-8) === otherDigits.slice(-8)
    ) {
      out.push(`Telefone igual ao de "${c.full_name}" (${c.phone})${tag}`);
    }
  }
  return out;
}

export async function fetchDuplicateCandidates(): Promise<DuplicateCandidate[]> {
  return fetchAll<DuplicateCandidate>("clients", "id, full_name, phone, active");
}

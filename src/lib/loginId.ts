/**
 * Utilitário para identificar/normalizar credenciais de login que podem ser
 * e-mail ou telefone (BR). Ver docs no README interno.
 */
export type LoginKind = "email" | "phone" | "invalid";

export interface LoginId {
  kind: LoginKind;
  /** valor normalizado (email lowercase ou telefone em E.164). */
  value: string;
  /** valor bruto original digitado pelo usuário. */
  raw: string;
}

/**
 * Normaliza um telefone brasileiro para E.164 (+55DDDNUMERO).
 * Aceita entradas com máscara, com ou sem +55.
 * Retorna null se não for possível reconhecer um telefone BR válido.
 */
export function normalizeBRPhone(input: string): string | null {
  const digits = (input || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Já vem com 55 no início? (ex.: 5581999999999)
  let local = digits;
  if (digits.length >= 12 && digits.startsWith("55")) {
    local = digits.slice(2);
  }
  // Local deve ter 10 (fixo) ou 11 (celular com 9) dígitos
  if (local.length !== 10 && local.length !== 11) return null;
  return `+55${local}`;
}

export function parseLoginId(raw: string): LoginId {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { kind: "invalid", value: "", raw };
  if (trimmed.includes("@")) {
    return { kind: "email", value: trimmed.toLowerCase(), raw };
  }
  const phone = normalizeBRPhone(trimmed);
  if (phone) return { kind: "phone", value: phone, raw };
  return { kind: "invalid", value: trimmed, raw };
}

/** Formata E.164 BR para exibição amigável: +55 (81) 99999-9999 */
export function formatBRPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

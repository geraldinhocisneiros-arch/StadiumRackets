// Central helper that remembers which "portal" URL the user entered from
// so login/logout can return them to the same door.

export const PORTAL_PATHS = [
  "/cliente",
  "/professor",
  "/recepcao",
  "/gestao",
] as const;
export type PortalOrigin = (typeof PORTAL_PATHS)[number];

const KEY = "sr:portal_origin";

export function setPortalOrigin(p: PortalOrigin) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
}

export function clearPortalOrigin() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Returns the saved portal origin path, or `/login` as fallback. */
export function getLogoutReturnPath(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (PORTAL_PATHS as readonly string[]).includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "/login";
}

/**
 * Given the user's roles, returns the destination path for their real profile.
 * URL is only a suggestion — the roles determine where they actually land.
 */
export function resolveDestinationForRoles(roles: string[]): string {
  if (roles.includes("admin") || roles.includes("diretoria")) return "/";
  if (roles.includes("recepcionista")) return "/mapa";
  if (roles.includes("professor")) return "/mapa";
  if (roles.includes("visualizador")) return "/mapa";
  // Sem papéis internos → cliente
  return "/portal/perfil";
}

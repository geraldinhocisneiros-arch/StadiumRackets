import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseLoginId } from "@/lib/loginId";

type Role =
  "admin" | "recepcionista" | "diretoria" | "professor" | "limpeza" | "visualizador";

export type PageKey =
  | "mapa"
  | "painel"
  | "caixa"
  | "financas"
  | "clientes"
  | "categorias"
  | "usuarios"
  | "obras"
  | "estoque"
  | "inadimplencia";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: Role[];
  isAdmin: boolean;
  isRecepcionista: boolean;
  isDiretoria: boolean;
  isProfessor: boolean;
  isLimpeza: boolean;
  isVisualizador: boolean;
  isPendingSignup: boolean;
  loading: boolean;
  permissions: Record<string, boolean>;
  hasPageAccess: (key: PageKey | string) => boolean;
  /**
   * Pode ver informação de inadimplência (aba Inadimplentes, cobrança,
   * totais no Painel/Relatórios, selo 💰 no mapa, pop-up de débitos,
   * sugestões de cobrança nas Reuniões). Liberado por padrão; bloqueado só
   * com user_permissions.inadimplencia = false — vale até para admin.
   */
  canSeeDebt: boolean;
  signIn: (login: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [isPendingSignup, setIsPendingSignup] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) {
      setRoles([]);
      return;
    }
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles((data ?? []).map((r) => r.role as Role));
  };

  // Professor autocadastrado pelo portal público que ainda não foi
  // revisado pela recepção/diretoria — ver pending-signups.functions.ts.
  const loadPendingSignup = async (uid: string | undefined) => {
    if (!uid) {
      setIsPendingSignup(false);
      return;
    }
    const { data } = await supabase
      .from("pending_signups")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();
    setIsPendingSignup(!!data);
  };

  const loadPermissions = async (uid: string | undefined) => {
    if (!uid) {
      setPermissions({});
      return;
    }
    const { data } = await supabase
      .from("user_permissions")
      .select("page_key, granted")
      .eq("user_id", uid);
    const map: Record<string, boolean> = {};
    (data ?? []).forEach((p) => {
      map[p.page_key] = p.granted;
    });
    setPermissions(map);
  };

  useEffect(() => {
    let lastUserId: string | null | undefined = undefined;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const newUserId = newSession?.user?.id ?? null;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      // Só recarrega papéis/permissões (e liga o loading) quando o usuário muda de fato.
      // Eventos como TOKEN_REFRESHED / SIGNED_IN em foco não devem remontar a árvore,
      // pois isso resetaria estado local (ex.: data selecionada no mapa).
      if (lastUserId !== undefined && newUserId === lastUserId) return;
      lastUserId = newUserId;
      setLoading(true);
      setTimeout(() => {
        Promise.all([
          loadRoles(newSession?.user?.id),
          loadPermissions(newSession?.user?.id),
          loadPendingSignup(newSession?.user?.id),
        ]).finally(() => setLoading(false));
      }, 0);
    });

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        lastUserId = s?.user?.id ?? null;
        setSession(s);
        setUser(s?.user ?? null);
        return Promise.all([
          loadRoles(s?.user?.id),
          loadPermissions(s?.user?.id),
          loadPendingSignup(s?.user?.id),
        ]);
      })
      .catch((err) => {
        // Se isto falhar (ex.: fetch abortado por pool do banco saturado),
        // sem o catch a tela ficava presa no spinner pra sempre, pois o
        // setLoading(false) do finally abaixo nunca era alcançado.
        console.error("[Auth] Falha ao obter sessão inicial:", err);
      })
      .finally(() => setLoading(false));

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (login: string, password: string) => {
    const parsed = parseLoginId(login);
    if (parsed.kind === "invalid") {
      return { error: "Informe um e-mail válido ou um telefone com DDD." };
    }
    // Login por telefone não usa o provedor de telefone do Supabase (exigiria
    // um provedor de SMS pago configurado só pra habilitar) — em vez disso,
    // resolve o telefone pro e-mail vinculado e loga por e-mail por trás dos
    // panos.
    let email = parsed.value;
    if (parsed.kind === "phone") {
      const { data: resolvedEmail } = await supabase.rpc("resolve_portal_email_by_phone", {
        _phone: parsed.value,
      } as never);
      if (!resolvedEmail) {
        return { error: "Telefone não encontrado. Verifique o número ou entre com seu e-mail." };
      }
      email = resolvedEmail as unknown as string;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
    setPermissions({});
    setIsPendingSignup(false);
  };

  const refreshRoles = async () => loadRoles(user?.id);
  const refreshPermissions = async () => loadPermissions(user?.id);

  const isAdmin = roles.includes("admin");
  const isDiretoria = roles.includes("diretoria");
  const isProfessor = roles.includes("professor");
  const isLimpeza = roles.includes("limpeza");
  const isVisualizador = roles.includes("visualizador");
  const isStaff = isAdmin || isDiretoria || roles.includes("recepcionista");
  const hasPageAccess = (key: PageKey | string) => {
    if (isAdmin) return true;
    // Não-staff (cliente, professor, visualizador): sem acesso a
    // módulos administrativos. Apenas 'mapa' pode ser liberado — automático
    // para professor/visualizador (visualizador só enxerga, nunca
    // opera nada — ver VisualizadorMapPage em routes/mapa.tsx).
    if (!isStaff) {
      if (key !== "mapa") return false;
      if (isProfessor) return !isPendingSignup;
      if (isVisualizador) return true;
      return permissions["mapa"] === true;
    }
    // Staff (diretoria/recepcionista): 'mapa' é automático; demais páginas
    // permitidas se não houver bloqueio explícito.
    if (key === "mapa") return true;
    return permissions[key] !== false;
  };

  const canSeeDebt = permissions["inadimplencia"] !== false;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        roles,
        isAdmin,
        isRecepcionista: roles.includes("recepcionista"),
        isDiretoria,
        isProfessor,
        isLimpeza,
        isVisualizador,
        isPendingSignup,
        loading,
        permissions,
        hasPageAccess,
        canSeeDebt,
        signIn,
        signOut,
        refreshRoles,
        refreshPermissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

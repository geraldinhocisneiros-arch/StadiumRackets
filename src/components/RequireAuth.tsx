import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth, type PageKey } from "@/hooks/useAuth";
import { AppLayout } from "./AppLayout";
import { Loader2 } from "lucide-react";
import { resolveDestinationForRoles, getLogoutReturnPath } from "@/lib/portal-origin";

type RoleName = "admin" | "recepcionista" | "diretoria" | "professor" | "limpeza";

interface Props {
  children: ReactNode;
  adminOnly?: boolean;
  pageKey?: PageKey;
  rolesAllowed?: RoleName[];
  /** Página com informação de inadimplência — exige canSeeDebt. */
  debtInfo?: boolean;
  // Em vez de mostrar "Acesso restrito" pra quem não tem permissão, manda
  // pro destino certo do perfil (resolveDestinationForRoles). Usado na "/"
  // porque o iOS sempre abre o ícone do PWA em "/" (start_url do manifest),
  // mesmo quando o cliente/professor salvou a partir de /cliente, /portal
  // etc. — sem isso, o ícone deles cai direto num muro de acesso negado.
  fallbackRedirect?: boolean;
}

export function RequireAuth({
  children,
  adminOnly,
  pageKey,
  rolesAllowed,
  debtInfo,
  fallbackRedirect,
}: Props) {
  const {
    user,
    loading,
    isAdmin,
    hasPageAccess,
    canSeeDebt,
    roles,
    isProfessor,
    isPendingSignup,
  } = useAuth();
  const navigate = useNavigate();

  const roleAllowed = !rolesAllowed || rolesAllowed.some((r) => roles.includes(r));

  const blocked =
    (isProfessor && !rolesAllowed?.includes("professor")) ||
    (adminOnly && !isAdmin) ||
    (pageKey && !hasPageAccess(pageKey)) ||
    (debtInfo && !canSeeDebt) ||
    !roleAllowed;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Manda pra porta certa (Portal do Professor etc.) quando o
      // dispositivo já visitou uma delas antes — em vez de sempre cair na
      // tela de login genérica da equipe. Sem sessão nenhuma registrada,
      // getLogoutReturnPath cai em "/login" mesmo (comportamento anterior).
      navigate({ to: getLogoutReturnPath() });
      return;
    }
    // Professores só têm acesso ao mapa de quadras.
    if (isProfessor && !rolesAllowed?.includes("professor")) {
      navigate({ to: "/mapa" });
      return;
    }
    // Só redireciona se o destino for de fato outra página — evita loop
    // quando resolveDestinationForRoles aponta pra própria página atual
    // (ex.: admin sem papel "diretoria" numa página exclusiva de diretoria).
    if (
      fallbackRedirect &&
      blocked &&
      typeof window !== "undefined" &&
      resolveDestinationForRoles(roles) !== window.location.pathname
    ) {
      navigate({ to: resolveDestinationForRoles(roles) });
    }
  }, [loading, user, isProfessor, rolesAllowed, navigate, fallbackRedirect, blocked, roles]);

  const willFallbackRedirect =
    fallbackRedirect &&
    blocked &&
    (typeof window === "undefined" || resolveDestinationForRoles(roles) !== window.location.pathname);

  if (loading || !user || willFallbackRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (blocked) {
    const pendingApproval = isPendingSignup && isProfessor && pageKey === "mapa";
    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-16">
          <h2 className="text-2xl font-semibold mb-2">
            {pendingApproval ? "Cadastro em análise" : "Acesso restrito"}
          </h2>
          <p className="text-muted-foreground">
            {pendingApproval
              ? "Seu cadastro foi recebido e está aguardando aprovação da recepção/diretoria. Assim que for aprovado, o acesso libera automaticamente."
              : "Você não tem permissão para acessar esta página. Contate um administrador."}
          </p>
        </div>
      </AppLayout>
    );
  }

  return <AppLayout>{children}</AppLayout>;
}

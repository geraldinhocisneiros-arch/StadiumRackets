import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, Users } from "lucide-react";
import { PortalAccountsProvider, usePortalAccounts } from "@/hooks/usePortalClientId";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NotificationAckModal } from "@/components/NotificationAckModal";
import { NotificationsBell } from "@/components/NotificationsBell";
import { NotificationsProvider } from "@/hooks/useNotifications";
import { getLogoutReturnPath, clearPortalOrigin, resolveDestinationForRoles } from "@/lib/portal-origin";

async function signOutAndReturn(navigate: ReturnType<typeof useNavigate>) {
  const target = getLogoutReturnPath();
  await supabase.auth.signOut();
  clearPortalOrigin();
  navigate({ to: target === "/login" ? "/portal/login" : target });
}

export const Route = createFileRoute("/portal")({
  ssr: false,
  component: PortalLayoutWrapper,
});

function PortalLayoutWrapper() {
  return (
    <PortalAccountsProvider>
      <PortalLayout />
    </PortalAccountsProvider>
  );
}

function PortalLayout() {
  const navigate = useNavigate();
  const [sessionState, setSessionState] = useState<"loading" | "anon" | "ok">("loading");
  // Destino "de verdade" pra quem tem papel interno (admin/diretoria/
  // recepcionista/professor) — null pra cliente puro. Um professor que também tem cadastro de
  // cliente (comum — muitos jogam/reservam quadra) ficava preso no portal
  // do cliente (nomes ocultos) se caísse em /portal por qualquer caminho
  // (sessão restaurada, link salvo etc.), já que só RequireAuth/
  // PortalLoginScreen chamavam resolveDestinationForRoles — o layout do
  // /portal em si nunca redirecionava esses papéis pra fora.
  const [internalDestination, setInternalDestination] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pendingSignup, setPendingSignup] = useState(false);
  const { accounts, activeClientId, setActiveClientId, loading: accountsLoading } = usePortalAccounts();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        setInternalDestination(null);
        setUserId(null);
        setSessionState("anon");
        return;
      }
      setUserId(session.user.id);
      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      const roles = (rolesData ?? []).map((r) => r.role as string);
      const dest = resolveDestinationForRoles(roles);
      if (!active) return;
      setInternalDestination(dest === "/portal/perfil" ? null : dest);
      setSessionState("ok");
    };
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      refresh();
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const isLogin = path.startsWith("/portal/login");
  const isSignup = path.startsWith("/portal/cadastro");

  useEffect(() => {
    if (sessionState === "anon" && !isLogin && !isSignup) {
      navigate({ to: "/portal/login" });
    }
    if (sessionState === "ok" && internalDestination) {
      navigate({ to: internalDestination });
    }
    if (sessionState === "ok" && !internalDestination && isLogin) {
      navigate({ to: "/portal" });
    }
  }, [internalDestination, isLogin, isSignup, navigate, sessionState]);

  useEffect(() => {
    if (sessionState !== "ok" || internalDestination || accountsLoading || accounts.length > 0 || !userId) {
      return;
    }
    let active = true;
    supabase
      .from("pending_client_signups")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle()
      .then(({ data }) => {
        if (active) setPendingSignup(!!data);
      });
    return () => { active = false; };
  }, [sessionState, internalDestination, accountsLoading, accounts.length, userId]);

  if (sessionState === "loading" || (sessionState === "ok" && !internalDestination && accountsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (sessionState === "anon") {
    if (isLogin || isSignup) return <Outlet />;
    return null;
  }

  // Quem tem papel interno (admin/diretoria/recepcionista/professor)
  // não fica no portal do cliente — mesmo que também tenha
  // cadastro de cliente vinculado.
  if (internalDestination) {
    return null;
  }

  if (accounts.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-4">
        <h1 className="text-xl font-semibold">
          {pendingSignup ? "Cadastro em análise" : "Acesso não vinculado"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {pendingSignup
            ? "Sua conta foi criada e já está com a recepção — assim que vincularem ao seu cadastro, seu acesso é liberado. Pode voltar aqui em alguns instantes."
            : "Sua conta não está vinculada a nenhum cliente do Stadium Rackets. Procure a recepção."}
        </p>
        <Button
          variant="outline"
          onClick={() => signOutAndReturn(navigate)}
        >
          <LogOut className="h-4 w-4 mr-2" /> Sair
        </Button>
      </div>
    );
  }

  if (isLogin) {
    return null;
  }

  const active = accounts.find((a) => a.clientId === activeClientId);

  return (
    <NotificationsProvider userId={userId}>
      <div className="min-h-screen bg-background">
        <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
          <div className="max-w-3xl lg:max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link to="/portal" className="flex items-center gap-2 font-semibold">
              <img src="/logo-black.png" alt="Stadium Rackets" className="h-8 w-auto dark:invert" />
            </Link>
            <div className="flex-1 flex justify-center min-w-0">
              {accounts.length > 1 ? (
                <Select value={activeClientId ?? undefined} onValueChange={(v) => setActiveClientId(v)}>
                  <SelectTrigger className="max-w-[260px] truncate">
                    <Users className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="Selecione a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.clientId} value={a.clientId}>
                        {a.fullName}{a.isDependent ? " (dependente)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm text-muted-foreground truncate hidden md:block">
                  {active?.fullName ?? ""}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <NotificationsBell />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOutAndReturn(navigate)}
              >
                <LogOut className="h-4 w-4 mr-2" /> Sair
              </Button>
            </div>
          </div>
          <nav className="max-w-3xl lg:max-w-6xl mx-auto px-4 pb-2 flex gap-1 text-sm overflow-x-auto">
            <PortalTab to="/portal/perfil">Perfil</PortalTab>
            <PortalTab to="/portal/reservar">Mapa de quadras</PortalTab>
            <PortalTab to="/portal/lista-espera">Lista de espera</PortalTab>
            <PortalTab to="/portal/extrato">Extrato</PortalTab>
          </nav>
        </header>
        <main className="max-w-3xl lg:max-w-6xl mx-auto px-4 py-6">
          {active?.isDependent && (
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              Você está vendo a conta de <strong>{active.fullName}</strong> (dependente).
            </div>
          )}
          <Outlet />
        </main>
        <NotificationAckModal />
      </div>
    </NotificationsProvider>
  );
}

function PortalTab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      className="px-3 py-1.5 rounded-md hover:bg-accent"
      activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent font-medium" }}
    >
      {children}
    </Link>
  );
}

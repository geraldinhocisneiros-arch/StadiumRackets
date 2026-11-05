import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PasswordInput } from "@/components/PasswordInput";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseLoginId } from "@/lib/loginId";
import {
  setPortalOrigin,
  resolveDestinationForRoles,
  type PortalOrigin,
} from "@/lib/portal-origin";
import { PortalSignUpDialog } from "@/components/PortalSignUpDialog";
import type { PortalKind } from "@/lib/portal-signup.functions";

interface Props {
  origin: PortalOrigin;
  portalTitle: string;
  portalSubtitle?: string;
}

/** Mapa: rota de portal → papel público autocadastrável. */
const SIGNUP_KIND: Partial<Record<PortalOrigin, PortalKind>> = {
  "/cliente": "cliente",
  "/professor": "professor",
};

const REMEMBER_KEY_PREFIX = "sr:remember:portal-origin:";

export function PortalLoginScreen({ origin, portalTitle, portalSubtitle }: Props) {
  const navigate = useNavigate();
  const rememberKey = `${REMEMBER_KEY_PREFIX}${origin}`;
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [signUpOpen, setSignUpOpen] = useState(false);
  const signUpKind = SIGNUP_KIND[origin];

  const goByRole = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (data ?? []).map((r) => r.role as string);
    setPortalOrigin(origin);
    navigate({ to: resolveDestinationForRoles(roles), replace: true });
  };

  useEffect(() => {
    // Lembra a porta assim que a pessoa visita a tela de login — não só
    // depois de logar com sucesso. Sem isso, quem salva o ícone do app na
    // tela de início ANTES de logar (ou nunca chega a logar de novo depois,
    // ex.: sessão expirou) sempre caía na tela de login genérica da equipe
    // ao abrir o ícone, em vez da porta certa (Portal do Professor etc.) —
    // ver resolveDestinationForRoles/getLogoutReturnPath em portal-origin.ts.
    setPortalOrigin(origin);
    // Se já estiver autenticado, direciona pelo perfil real.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        void goByRole(data.session.user.id);
        return;
      }
      if (typeof window === "undefined") return;
      try {
        const raw = localStorage.getItem(rememberKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { login?: string };
        if (parsed?.login) {
          setLogin(parsed.login);
          setRemember(true);
        }
      } catch {
        localStorage.removeItem(rememberKey);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseLoginId(login);
    if (parsed.kind === "invalid") {
      toast.error("Informe um e-mail válido ou telefone com DDD.");
      return;
    }
    setBusy(true);
    // Login por telefone não usa o provedor de telefone do Supabase (exigiria
    // um provedor de SMS pago configurado só pra habilitar) — em vez disso,
    // resolve o telefone pro e-mail vinculado e loga por e-mail por trás dos
    // panos.
    let email = parsed.value;
    if (parsed.kind === "phone") {
      const { data: resolvedEmail } = await supabase.rpc(
        "resolve_portal_email_by_phone",
        { _phone: parsed.value } as never,
      );
      if (!resolvedEmail) {
        setBusy(false);
        toast.error("Telefone não encontrado. Verifique o número ou entre com seu e-mail.");
        return;
      }
      email = resolvedEmail as unknown as string;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (typeof window !== "undefined") {
      if (remember) {
        localStorage.setItem(rememberKey, JSON.stringify({ login }));
      } else {
        localStorage.removeItem(rememberKey);
      }
    }
    setPortalOrigin(origin);
    if (data.user) await goByRole(data.user.id);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background via-secondary to-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/logo-black.png" alt="Stadium Rackets" className="mx-auto h-20 w-auto mb-3 dark:invert" />
          <h1 className="sr-only">Stadium Rackets</h1>
          <p className="text-sm font-medium text-primary mt-1">{portalTitle}</p>
          {portalSubtitle && (
            <p className="text-xs text-muted-foreground">{portalSubtitle}</p>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>
              Acesse com seu e-mail ou telefone (WhatsApp) e sua senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login">E-mail ou número de WhatsApp</Label>
                <Input
                  id="login"
                  type="text"
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  placeholder="voce@exemplo.com  ou  (81) 99999-9999"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Senha</Label>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <PasswordInput
                  id="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                />
                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">
                  Manter-me conectado
                </Label>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Entrar
              </Button>
            </form>
            {signUpKind && (
              <div className="mt-4 text-center text-sm">
                <button
                  type="button"
                  onClick={() => setSignUpOpen(true)}
                  className="text-primary font-medium hover:underline"
                >
                  Criar nova conta
                </button>
              </div>
            )}
            <ForgotPasswordDialog
              open={forgotOpen}
              onOpenChange={setForgotOpen}
              defaultLogin={login}
              redirectTo={`${typeof window !== "undefined" ? window.location.origin : ""}/reset-password`}
            />
            {signUpKind && (
              <PortalSignUpDialog
                open={signUpOpen}
                onOpenChange={setSignUpOpen}
                portal={signUpKind}
                portalTitle={portalTitle}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

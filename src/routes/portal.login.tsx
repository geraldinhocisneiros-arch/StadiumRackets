import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { parseLoginId } from "@/lib/loginId";

const REMEMBER_KEY = "sr:remember:portal";

export const Route = createFileRoute("/portal/login")({
  component: PortalLogin,
});

function PortalLogin() {
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [remember, setRemember] = useState(true);

  const redirectByRole = async (_userId: string) => {
    navigate({ to: "/portal" });
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        void redirectByRole(data.session.user.id);
        return;
      }
      if (typeof window === "undefined") return;
      try {
        const raw = localStorage.getItem(REMEMBER_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { login?: string };
        if (parsed?.login) {
          setLogin(parsed.login);
          setRemember(true);
        }
      } catch {
        localStorage.removeItem(REMEMBER_KEY);
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
    const creds =
      parsed.kind === "email"
        ? { email: parsed.value, password }
        : { phone: parsed.value, password };
    const { data, error } = await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (typeof window !== "undefined") {
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ login }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    }
    if (data.user) await redirectByRole(data.user.id);
    else navigate({ to: "/portal" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background via-secondary to-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/logo-black.png" alt="Stadium Rackets" className="mx-auto h-20 w-auto mb-3 dark:invert" />
          <h1 className="text-2xl font-bold">Portal do Cliente</h1>
          <p className="text-sm text-muted-foreground">Stadium Rackets</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Entre com seu e-mail ou telefone (WhatsApp) e a senha que você criou. Se a recepção criou seu acesso, use os dados que recebeu.</CardDescription>
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
                <PasswordInput id="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
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
            <ForgotPasswordDialog
              open={forgotOpen}
              onOpenChange={setForgotOpen}
              defaultLogin={login}
              redirectTo={`${typeof window !== "undefined" ? window.location.origin : ""}/reset-password`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

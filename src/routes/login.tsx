import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const REMEMBER_KEY = "sr:remember:admin";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, signIn, loading, isProfessor } = useAuth();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!loading && user) navigate({ to: isProfessor ? "/mapa" : "/" });
  }, [user, loading, isProfessor, navigate]);

  // Recupera apenas o identificador salvo (nunca a senha).
  useEffect(() => {
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
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(login, password);
    setSubmitting(false);
    if (error) {
      toast.error(error);
      return;
    }
    if (typeof window !== "undefined") {
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ login }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background via-secondary to-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/logo-black.png" alt="Stadium Rackets" className="mx-auto h-20 w-auto mb-3 dark:invert" />
          <h1 className="sr-only">Stadium Rackets</h1>
          <p className="text-sm text-muted-foreground">Sistema de gestão</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesse com seu e-mail ou telefone e sua senha</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Entrar
              </Button>
            </form>
            <ForgotPasswordDialog
              open={forgotOpen}
              onOpenChange={setForgotOpen}
              defaultLogin={login}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPortalSignupTokenInfo, redeemPortalSignupToken } from "@/lib/portal.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/cadastro/$token")({
  component: SignupPage,
  errorComponent: () => (
    <div className="p-6 text-center text-sm text-muted-foreground">Ocorreu um erro. Tente novamente.</div>
  ),
  notFoundComponent: () => <div className="p-6 text-center">Link não encontrado</div>,
  head: () => ({ meta: [{ title: "Cadastro no Portal | Stadium Rackets" }] }),
});

function SignupPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const info = useServerFn(getPortalSignupTokenInfo);
  const redeem = useServerFn(redeemPortalSignupToken);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<{ valid: boolean; clientName?: string; reason?: string }>({ valid: false });
  const [loginInput, setLoginInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await info({ data: { token } });
        setState(r);
      } catch (e: any) {
        setState({ valid: false, reason: e?.message ?? "Erro ao validar link" });
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setBusy(true);
    try {
      await redeem({ data: { token, login: loginInput, password } });
      setDone(true);
      toast.success("Cadastro concluído");
      setTimeout(() => navigate({ to: "/portal/login" }), 1500);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no cadastro");
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Cadastro no portal
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !state.valid ? (
            <div className="space-y-3 text-sm">
              <p className="text-destructive">{state.reason ?? "Link inválido"}</p>
              <p className="text-muted-foreground">Entre em contato com a secretaria para gerar um novo link.</p>
            </div>
          ) : done ? (
            <div className="space-y-3 text-sm">
              <p>Cadastro concluído! Redirecionando para o login…</p>
              <Link to="/portal/login" className="text-primary underline">Ir agora</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Olá <span className="font-medium text-foreground">{state.clientName}</span>! Crie seu acesso para
                acompanhar seu extrato e mensalidades em tempo real.
              </p>
              <div className="space-y-2">
                <Label htmlFor="login">E-mail ou número de WhatsApp</Label>
                <Input
                  id="login"
                  type="text"
                  required
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  placeholder="voce@exemplo.com  ou  (81) 99999-9999"
                />
                <p className="text-xs text-muted-foreground">
                  Você pode entrar depois com o e-mail ou o telefone informado aqui.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha (mín. 6 caracteres)</Label>
                <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar senha</Label>
                <Input id="confirm" type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Criar acesso
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

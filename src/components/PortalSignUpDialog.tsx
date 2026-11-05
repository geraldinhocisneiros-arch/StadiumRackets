import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { signUpFromPortal, type PortalKind } from "@/lib/portal-signup.functions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portal: PortalKind;
  portalTitle: string;
  onSuccess?: () => void;
}

const HINTS: Record<PortalKind, string> = {
  cliente:
    "Se seu e-mail ou telefone já estiver no seu cadastro, o acesso é liberado na hora. Senão, a recepção confirma seu cadastro em breve.",
  professor:
    "Sua conta será criada, mas o acesso completo depende de aprovação da recepção.",
};

export function PortalSignUpDialog({
  open,
  onOpenChange,
  portal,
  portalTitle,
  onSuccess,
}: Props) {
  const signUp = useServerFn(signUpFromPortal);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setBusy(true);
    try {
      const result = await signUp({
        data: { portal, email, password, fullName, phone },
      });
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr) {
        toast.success("Conta criada! Faça login para continuar.");
        onOpenChange(false);
        return;
      }
      if (result.pending) {
        toast.success("Conta criada! Assim que a recepção vincular seu cadastro, seu acesso libera.");
      } else {
        toast.success("Cadastro concluído!");
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cadastrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Criar nova conta — {portalTitle}</DialogTitle>
          <DialogDescription>{HINTS[portal]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="su-name">Nome completo</Label>
            <Input
              id="su-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-phone">Telefone (WhatsApp)</Label>
            <Input
              id="su-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 90000-0000"
              autoComplete="tel"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-email">E-mail</Label>
            <Input
              id="su-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-pwd">Senha (mín. 6 caracteres)</Label>
            <PasswordInput
              id="su-pwd"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-pwd2">Confirmar senha</Label>
            <PasswordInput
              id="su-pwd2"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar conta
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

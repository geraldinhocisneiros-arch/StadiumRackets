import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { openWhatsApp } from "@/lib/whatsapp";
import { parseLoginId } from "@/lib/loginId";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** identificador (email ou telefone) já digitado no formulário de login. */
  defaultLogin?: string;
  redirectTo?: string;
}

export function ForgotPasswordDialog({
  open,
  onOpenChange,
  defaultLogin = "",
  redirectTo,
}: Props) {
  const parsedDefault = parseLoginId(defaultLogin);
  const [email, setEmail] = useState(parsedDefault.kind === "email" ? parsedDefault.value : "");
  const [phone, setPhone] = useState(parsedDefault.kind === "phone" ? defaultLogin : "");
  const [sending, setSending] = useState(false);
  // Se o usuário chegou aqui a partir de um login por telefone, começamos na aba telefone.
  const initialTab = parsedDefault.kind === "phone" ? "phone" : "email";

  // Sincroniza quando o dialog reabrir com novo valor
  useEffect(() => {
    if (!open) return;
    const p = parseLoginId(defaultLogin);
    if (p.kind === "email") setEmail(p.value);
    else if (p.kind === "phone") setPhone(defaultLogin);
  }, [open, defaultLogin]);

  const sendEmail = async () => {
    if (!email) {
      toast.error("Informe o e-mail.");
      return;
    }
    setSending(true);
    const target = redirectTo ?? `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: target,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      "Enviamos um link de redefinição para o seu e-mail. Verifique a caixa de entrada e o spam.",
    );
    onOpenChange(false);
  };

  const requestByWhatsApp = () => {
    const normalized = (phone || "").replace(/\D/g, "");
    if (normalized.length < 10) {
      toast.error("Informe seu telefone com DDD.");
      return;
    }
    const message =
      "Olá! Sou cliente/usuário do Stadium Rackets e esqueci minha senha. Podem me ajudar a redefinir? Meu telefone: " +
      phone;
    const url = `https://wa.me/55${normalized}?text=${encodeURIComponent(message)}`;
    openWhatsApp(url);
    toast.success(
      "Abrimos o WhatsApp com uma mensagem pronta. A recepção fará a redefinição.",
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Esqueci minha senha</DialogTitle>
          <DialogDescription>
            Escolha como deseja redefinir sua senha. Para contas sem e-mail, use
            a opção Telefone — a recepção fará a redefinição pelo WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email">
              <Mail className="h-4 w-4 mr-2" /> E-mail
            </TabsTrigger>
            <TabsTrigger value="phone">
              <Phone className="h-4 w-4 mr-2" /> Telefone
            </TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Enviaremos um link para você criar uma nova senha.
            </p>
            <div className="space-y-2">
              <Label htmlFor="fp-email">E-mail cadastrado</Label>
              <Input
                id="fp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
              />
            </div>
            <DialogFooter>
              <Button onClick={sendEmail} disabled={sending} className="w-full">
                {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enviar link por e-mail
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="phone" className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Para redefinir sua senha, entre em contato com a recepção do
              Stadium Rackets pelo WhatsApp. Vamos abrir uma mensagem
              pronta com o seu telefone.
            </p>
            <div className="space-y-2">
              <Label htmlFor="fp-phone">Seu telefone (com DDD)</Label>
              <Input
                id="fp-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(21) 99999-9999"
              />
            </div>
            <DialogFooter>
              <Button onClick={requestByWhatsApp} className="w-full">
                Abrir WhatsApp para a recepção
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Copy, KeyRound, Loader2, MessageCircle, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
import {
  createPortalUser,
  revokePortalUser,
  resetPortalPassword,
  createPortalSignupToken,
} from "@/lib/portal.functions";
import { Link2 } from "lucide-react";

import {
  buildWhatsAppUrl,
  logWhatsAppSent,
  normalizePhoneForWhatsApp,
  openWhatsApp,
} from "@/lib/whatsapp";

interface Props {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone?: string | null;
  canManage: boolean;
}

export function ClientPortalAccess({ clientId, clientName, clientEmail, clientPhone, canManage }: Props) {
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailInput, setEmailInput] = useState(clientEmail ?? "");
  const confirm = useConfirm();
  const [credentials, setCredentials] = useState<{ email: string; password: string | null; reused?: boolean } | null>(null);

  const create = useServerFn(createPortalUser);
  const revoke = useServerFn(revokePortalUser);
  const reset = useServerFn(resetPortalPassword);
  const createToken = useServerFn(createPortalSignupToken);
  const [signupLink, setSignupLink] = useState<string | null>(null);


  const refresh = async () => {
    const { data } = await (supabase as any)
      .from("client_portal_users")
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();
    setHasAccess(!!data);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, [clientId]);

  const portalUrl = typeof window !== "undefined" ? `${window.location.origin}/portal/login` : "/portal/login";

  const waMessage = (email: string, password: string) =>
    `Olá ${clientName}! Liberamos seu acesso ao portal do Stadium Rackets, onde você acompanha em tempo real seu extrato e mensalidades.\n\n` +
    `Acesse: ${portalUrl}\n` +
    `E-mail: ${email}\n` +
    `Senha temporária: ${password}\n\n` +
    `Recomendamos alterar a senha após o primeiro acesso.`;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado");
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const res = await create({ data: { clientId, email: emailInput || undefined } });
      setCredentials(res);
      setHasAccess(true);
      toast.success("Acesso criado");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao criar acesso");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!(await confirm("Revogar o acesso do cliente ao portal?"))) return;
    setBusy(true);
    try {
      await revoke({ data: { clientId } });
      setHasAccess(false);
      setCredentials(null);
      toast.success("Acesso revogado");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao revogar");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      const res = await reset({ data: { clientId } });
      setCredentials(res);
      toast.success("Nova senha gerada");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao redefinir");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Portal do cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Acesso para o cliente acompanhar em tempo real o extrato e as mensalidades dele no portal{" "}
          <code className="text-xs">/portal</code>.
        </p>

        {hasAccess ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1 text-sm text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" /> Acesso ativo
            </span>
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
                  Redefinir senha
                </Button>
                <Button variant="destructive" size="sm" onClick={handleRevoke} disabled={busy}>
                  <ShieldOff className="h-4 w-4 mr-2" /> Revogar
                </Button>
              </>
            )}
          </div>
        ) : (
          canManage && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`portal-email-${clientId}`}>E-mail do cliente</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={`portal-email-${clientId}`}
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="email@exemplo.com"
                    className="max-w-xs"
                  />
                  <Button onClick={handleCreate} disabled={busy || !emailInput}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                    Criar acesso
                  </Button>
                </div>
              </div>
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Sem e-mail do cliente? Gere um link para ele mesmo se cadastrar (válido por 7 dias).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await createToken({ data: { clientId } });
                      const url = `${window.location.origin}/portal/cadastro/${r.token}`;
                      setSignupLink(url);
                      toast.success("Link gerado");
                    } catch (e: any) {
                      toast.error(e?.message ?? "Falha ao gerar link");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Link2 className="h-4 w-4 mr-2" /> Gerar link de cadastro
                </Button>
                {signupLink && (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                    <div className="break-all"><span className="text-muted-foreground">Link:</span> {signupLink}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => copy(signupLink)}>
                        <Copy className="h-4 w-4 mr-2" /> Copiar link
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          const phone = normalizePhoneForWhatsApp(clientPhone ?? null);
                          if (!phone) {
                            toast.error("Cliente sem telefone cadastrado");
                            return;
                          }
                          const msg =
                            `Olá ${clientName}! Crie seu acesso ao portal do Stadium Rackets para acompanhar em tempo real seu extrato e mensalidades.\n\n` +
                            `Acesse o link abaixo e cadastre seu e-mail e senha (válido por 7 dias):\n${signupLink}`;
                          openWhatsApp(buildWhatsAppUrl(phone, msg));
                          logWhatsAppSent(clientId, "portal_signup_link");
                        }}
                      >
                        <MessageCircle className="h-4 w-4 mr-2" /> Enviar pelo WhatsApp
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        )}


        {credentials && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <div className="text-sm font-medium">
              {credentials.reused ? "Vinculado à conta existente" : "Credenciais (mostradas apenas uma vez)"}
            </div>
            <div className="grid gap-1 text-sm">
              <div><span className="text-muted-foreground">URL:</span> {portalUrl}</div>
              <div><span className="text-muted-foreground">E-mail:</span> {credentials.email}</div>
              {credentials.password ? (
                <div><span className="text-muted-foreground">Senha:</span> <code>{credentials.password}</code></div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Esta conta já existia. O cliente entra com a senha que já usa para acessar o portal.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {credentials.password && (
                <Button size="sm" variant="outline" onClick={() => copy(`${credentials.email} / ${credentials.password}`)}>
                  <Copy className="h-4 w-4 mr-2" /> Copiar credenciais
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  const phone = normalizePhoneForWhatsApp(clientPhone ?? null);
                  if (!phone) {
                    toast.error("Cliente sem telefone cadastrado");
                    return;
                  }
                  const msg = credentials.password
                    ? waMessage(credentials.email, credentials.password)
                    : `Olá ${clientName}! Vinculamos mais uma conta ao seu acesso no portal do Stadium Rackets.\n\nAcesse com seu e-mail e senha de sempre: ${portalUrl}`;
                  openWhatsApp(buildWhatsAppUrl(phone, msg));
                  logWhatsAppSent(clientId, "portal_access");
                }}
              >
                <MessageCircle className="h-4 w-4 mr-2" /> Enviar pelo WhatsApp
              </Button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}

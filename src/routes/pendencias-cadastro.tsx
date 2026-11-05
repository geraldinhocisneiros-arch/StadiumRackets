import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, UserPlus, Search, Link2, UserCheck } from "lucide-react";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/pendencias-cadastro")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Cadastros pendentes | Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <PendenciasCadastroPage />
    </RequireAuth>
  ),
});

interface PendingRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
}

interface ClientMatch {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
}

function PendenciasCadastroPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<PendingRow | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pending_client_signups")
      .select("id, full_name, email, phone, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setRows((data ?? []) as PendingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!linking) {
      setQuery("");
      setMatches([]);
      return;
    }
    setQuery(linking.full_name);
  }, [linking]);

  useEffect(() => {
    if (!linking) return;
    const term = query.trim();
    if (term.length < 2) {
      setMatches([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("staff_search_clients_for_signup_match", {
        _query: term,
      });
      setSearching(false);
      if (error) return;
      setMatches((data ?? []) as ClientMatch[]);
    }, 300);
    return () => clearTimeout(t);
  }, [query, linking]);

  const linkTo = async (clientId: string) => {
    if (!linking) return;
    setBusy(linking.id);
    const { data, error } = await supabase.rpc("staff_link_pending_client_signup", {
      _pending_id: linking.id,
      _client_id: clientId,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao vincular.");
    toast.success("Vinculado com sucesso.");
    setLinking(null);
    load();
  };

  const createNew = async (row: PendingRow) => {
    setBusy(row.id);
    const { data, error } = await supabase.rpc("staff_create_client_for_pending_signup", {
      _pending_id: row.id,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) return toast.error(res?.error ?? "Falha ao criar cliente.");
    toast.success("Cliente novo criado e vinculado.");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cadastros pendentes</h1>
        <p className="text-muted-foreground">
          Pessoas que fizeram "primeiro acesso" pelo portal sem que o sistema conseguisse
          identificar automaticamente (e-mail/telefone diferentes do cadastro). Busque o cadastro
          certo pra vincular, ou confirme que é gente nova.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aguardando vínculo</CardTitle>
          <CardDescription>
            {rows.length === 0 ? "Nada pendente por aqui." : `${rows.length} pendência(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum cadastro pendente. Boa notícia!
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {r.email}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Cadastrou-se em {fmtDateTime(r.created_at)}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLinking(r)}
                      disabled={busy === r.id}
                    >
                      <Link2 className="h-4 w-4 mr-1" /> Vincular a cliente existente
                    </Button>
                    <Button size="sm" onClick={() => createNew(r)} disabled={busy === r.id}>
                      {busy === r.id ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4 mr-1" />
                      )}
                      É cliente novo
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!linking} onOpenChange={(v) => !v && setLinking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular cadastro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {linking && (
              <p className="text-sm text-muted-foreground">
                Buscando cliente já cadastrado pra <strong>{linking.full_name}</strong> (
                {linking.email}
                {linking.phone ? `, ${linking.phone}` : ""}).
              </p>
            )}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar pelo nome do cliente..."
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {searching && (
                <div className="text-sm text-muted-foreground py-2">Buscando...</div>
              )}
              {!searching && query.trim().length >= 2 && matches.length === 0 && (
                <div className="text-sm text-muted-foreground py-2">Nenhum cliente encontrado.</div>
              )}
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => linkTo(m.id)}
                  disabled={busy === linking?.id}
                  className="w-full text-left rounded-md border p-2 hover:bg-accent flex items-center justify-between gap-2 disabled:opacity-50"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {m.full_name}
                      {!m.active && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.email ?? "sem e-mail"}
                      {m.phone ? ` · ${m.phone}` : ""}
                    </div>
                  </div>
                  <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinking(null)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Loader2, ShieldCheck, UserMinus, Plus, Printer } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";
import { fetchAll } from "@/lib/fetchAll";

// A rota continua em /clientes/limite-debito para não quebrar links salvos;
// o conceito de limite de débito foi aposentado e a aba virou só "Exceções".
export const Route = createFileRoute("/clientes/limite-debito")({
  head: () => ({ meta: [{ title: "Exceções — Stadium Rackets" }] }),
  component: ExceptionsPage,
});

interface ExceptionRow {
  id: string;
  client_id: string;
  reason: string | null;
  created_by: string | null;
  created_at: string | null;
  client_name?: string;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function ExceptionsPage() {
  const { isDiretoria } = useAuth();

  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loadingExceptions, setLoadingExceptions] = useState(true);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [addExceptionOpen, setAddExceptionOpen] = useState(false);
  const [exceptionClientId, setExceptionClientId] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [savingException, setSavingException] = useState(false);
  const confirm = useConfirm();

  const loadExceptions = useCallback(async () => {
    setLoadingExceptions(true);
    let rows: ExceptionRow[] = [];
    if (isDiretoria) {
      const { data, error } = await supabase
        .from("debt_limit_exceptions")
        .select("id, client_id, reason, created_by, created_at")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) {
        setLoadingExceptions(false);
        toast.error(error.message);
        return;
      }
      rows = (data ?? []) as ExceptionRow[];
    } else {
      // Recepção não lê a tabela (RLS); vê só os nomes, pela mesma função
      // que a aba Inadimplentes já usa.
      const { data, error } = await supabase.rpc("debt_limit_excepted_client_ids" as never);
      if (error) {
        setLoadingExceptions(false);
        toast.error(error.message);
        return;
      }
      rows = ((data ?? []) as string[]).map((id) => ({
        id,
        client_id: id,
        reason: null,
        created_by: null,
        created_at: null,
      }));
    }
    if (rows.length > 0) {
      const ids = Array.from(new Set(rows.map((r) => r.client_id)));
      const { data: cs } = await supabase.from("clients").select("id, full_name").in("id", ids);
      const names: Record<string, string> = {};
      for (const c of (cs ?? []) as { id: string; full_name: string }[]) names[c.id] = c.full_name;
      const named = rows.map((r) => ({ ...r, client_name: names[r.client_id] }));
      if (!isDiretoria) {
        named.sort((a, b) => (a.client_name ?? "").localeCompare(b.client_name ?? "", "pt-BR"));
      }
      setExceptions(named);
    } else {
      setExceptions([]);
    }
    setLoadingExceptions(false);
  }, [isDiretoria]);

  const loadClients = useCallback(async () => {
    if (!isDiretoria) return;
    const data = await fetchAll<ClientOption & { active: boolean }>(
      "clients",
      "id, full_name, category_id, active",
    );
    setClients(
      data.filter((c) => c.active).sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
    );
  }, [isDiretoria]);

  useEffect(() => {
    void loadExceptions();
    void loadClients();
  }, [loadExceptions, loadClients]);

  const submitAddException = async () => {
    if (!exceptionClientId) {
      toast.error("Selecione um cliente.");
      return;
    }
    setSavingException(true);
    const { error } = await supabase.rpc("debt_limit_add_exception", {
      _client_id: exceptionClientId,
      _reason: exceptionReason.trim() || null,
    } as never);
    setSavingException(false);
    if (error) return toast.error(error.message);
    toast.success("Exceção adicionada.");
    setAddExceptionOpen(false);
    setExceptionClientId("");
    setExceptionReason("");
    void loadExceptions();
  };

  const removeException = async (id: string) => {
    if (!(await confirm("Remover este cliente da lista de exceções?"))) {
      return;
    }
    const { error } = await supabase.rpc("debt_limit_remove_exception", {
      _exception_id: id,
    } as never);
    if (error) return toast.error(error.message);
    toast.success("Exceção removida.");
    void loadExceptions();
  };

  const handlePrintExceptions = () => {
    const now = new Date().toLocaleString("pt-BR");
    const rows = exceptions
      .map(
        (e) => `<tr>
        <td>${escapeHtml(e.client_name ?? "—")}</td>
        ${isDiretoria ? `<td>${escapeHtml(e.reason ?? "—")}</td><td>${fmtDate(e.created_at)}</td>` : ""}
      </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Exceções - ${now}</title>
<style>
  body{font-family:Arial,sans-serif;padding:20px;color:#111;}
  h1{margin:0 0 4px;font-size:20px;}
  .meta{color:#555;font-size:12px;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;}
  th{background:#f3f4f6;}
  @media print{ button{display:none;} }
</style></head><body>
  <h1>Exceções</h1>
  <div class="meta">Gerado em ${now} • ${exceptions.length} ${exceptions.length === 1 ? "cliente" : "clientes"}</div>
  <table>
    <thead><tr><th>Cliente</th>${isDiretoria ? "<th>Motivo</th><th>Incluído em</th>" : ""}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload=()=>{window.print();}</script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Permita pop-ups para imprimir.");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" /> Exceções
        </h1>
        <p className="text-sm text-muted-foreground">
          Clientes que não precisam ser cobrados. Só a diretoria adiciona ou remove nomes desta
          lista.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Clientes em exceção{" "}
            {!loadingExceptions && (
              <span className="text-muted-foreground font-normal">({exceptions.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrintExceptions}
              disabled={exceptions.length === 0}
            >
              <Printer className="h-3.5 w-3.5 mr-2" /> Imprimir
            </Button>
            {isDiretoria && (
              <Button size="sm" onClick={() => setAddExceptionOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-2" /> Adicionar exceção
              </Button>
            )}
          </div>
          {loadingExceptions ? (
            <div className="py-6 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
            </div>
          ) : exceptions.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhum cliente em exceção no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    {isDiretoria && (
                      <>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Incluído em</TableHead>
                        <TableHead></TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.client_name ?? "—"}</TableCell>
                      {isDiretoria && (
                        <>
                          <TableCell className="text-sm text-muted-foreground">
                            {e.reason ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDate(e.created_at)}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void removeException(e.id)}
                            >
                              <UserMinus className="h-3.5 w-3.5 mr-2" /> Remover
                            </Button>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addExceptionOpen} onOpenChange={setAddExceptionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar exceção</DialogTitle>
            <DialogDescription>
              O cliente passa a constar como alguém que não precisa ser cobrado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Cliente</Label>
              <ClientCombobox
                clients={clients}
                value={exceptionClientId}
                onChange={setExceptionClientId}
                placeholder="Pesquisar cliente"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Motivo (opcional)</Label>
              <Textarea
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddExceptionOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitAddException} disabled={savingException}>
              {savingException && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

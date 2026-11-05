import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface TeacherClientLinkRequestTarget {
  action: "vincular" | "desvincular";
  teacherId: string;
  teacherName: string;
  // Pré-preenchido quando a ação é "desvincular" (cliente já é o alvo).
  clientId?: string;
  clientName?: string;
}

interface Props {
  target: TeacherClientLinkRequestTarget | null;
  onClose: () => void;
  onSubmitted: () => void;
}

interface SearchResult {
  id: string;
  full_name: string;
}

export function TeacherClientLinkRequestDialog({ target, onClose, onSubmitted }: Props) {
  const isVincular = target?.action === "vincular";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) {
      setQuery("");
      setPicked(null);
      setResults([]);
    }
  }, [target]);

  // Busca no servidor por termo digitado (RPC restrita ao papel professor,
  // com mínimo de caracteres e resultado limitado) — nunca carrega a lista
  // completa de clientes no navegador, só o que bate com o que foi digitado.
  useEffect(() => {
    if (!target || !isVincular) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("professor_search_clients_for_link", {
        _query: q,
      });
      if (cancelled) return;
      setSearching(false);
      if (error) {
        setResults([]);
        return;
      }
      setResults((data ?? []) as SearchResult[]);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, target, isVincular]);

  const submit = async () => {
    if (!target) return;
    const clientId = isVincular ? picked?.id : target.clientId;
    const clientName = isVincular ? picked?.full_name : target.clientName;
    if (!clientId) {
      toast.error("Selecione um cliente cadastrado.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("client_teacher_link_requests").insert({
      teacher_id: target.teacherId,
      client_id: clientId,
      action: target.action,
      requested_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      target.action === "vincular"
        ? `Solicitação de vínculo com ${clientName} enviada.`
        : `Solicitação de desvínculo de ${clientName} enviada.`,
    );
    onSubmitted();
    onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isVincular ? "Solicitar vínculo com um cliente" : "Solicitar desvínculo de cliente"}
          </DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-4 text-sm">
            {isVincular ? (
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPicked(null);
                    }}
                    placeholder="Digite o nome do cliente"
                    className="pl-8"
                    autoFocus
                  />
                </div>
                {picked ? (
                  <div className="text-xs text-emerald-600 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Selecionado: <strong>{picked.full_name}</strong>
                    <button
                      type="button"
                      className="ml-2 underline text-muted-foreground"
                      onClick={() => setPicked(null)}
                    >
                      trocar
                    </button>
                  </div>
                ) : query.trim().length >= 2 ? (
                  <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                    {searching ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                      </div>
                    ) : results.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Nenhum cadastro encontrado.
                      </div>
                    ) : (
                      results.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setPicked(r);
                            setQuery(r.full_name);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-muted"
                        >
                          {r.full_name}
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Digite ao menos 2 letras para buscar.</p>
                )}
              </div>
            ) : (
              <div className="rounded-md border p-3">
                <span className="text-muted-foreground">Cliente:</span>{" "}
                <strong>{target.clientName}</strong>
              </div>
            )}

            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-500/40 p-3 text-xs text-amber-900 dark:text-amber-200">
              A recepção/diretoria precisa aprovar esta solicitação antes do vínculo
              {isVincular ? " ser criado." : " ser removido."}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Voltar
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || (isVincular && !picked)}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar solicitação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

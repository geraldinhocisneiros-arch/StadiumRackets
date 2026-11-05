import { useEffect, useMemo, useState } from "react";
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
import {
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
  openWhatsApp,
} from "@/lib/whatsapp";
import { fmtDateBR, courtShort } from "@/lib/court-map";
import { toast } from "sonner";
import { fetchAll } from "@/lib/fetchAll";

export interface TeacherClientChangeTarget {
  kind: "fixed" | "booking";
  scheduleId?: string | null;
  bookingId?: string | null;
  occurrenceDate: string; // yyyy-mm-dd
  court: number;
  startTime: string; // HH:MM[:SS]
  endTime: string;
  currentClientId: string | null;
  currentClientName: string;
  teacherId: string;
  teacherName: string;
}

interface Props {
  target: TeacherClientChangeTarget | null;
  onClose: () => void;
  /** Chamado quando a troca foi aplicada na hora (aprovação automática). */
  onApplied?: () => void;
}

interface SearchResult {
  id: string;
  full_name: string;
  active?: boolean;
}

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function TeacherClientChangeDialog({ target, onClose, onApplied }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [allClients, setAllClients] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) {
      setQuery("");
      setResults([]);
      setPicked(null);
      setAllClients([]);
      return;
    }
    let cancelled = false;
    fetchAll<SearchResult>("clients", "id, full_name, active")
      .then((data) => {
        if (cancelled) return;
        setAllClients(
          data
            .filter((c) => c.active)
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
        );
      })
      .catch(() => {
        if (!cancelled) setAllClients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const terms = normalizeText(q).split(/\s+/).filter(Boolean);
      setResults(
        allClients.filter((client) => {
          const name = normalizeText(client.full_name);
          return terms.every((term) => name.includes(term));
        }),
      );
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, target, allClients]);

  const finalName = useMemo(
    () => (picked ? picked.full_name : query.trim()),
    [picked, query],
  );

  const submit = async () => {
    if (!target) return;
    const name = finalName;
    if (!name) {
      toast.error("Informe o novo cliente.");
      return;
    }
    // Sem seleção explícita, mas o nome digitado bate exatamente com um
    // único cadastro: usa esse cadastro (senão vira "nome livre" e a troca
    // nunca é automática).
    const exactMatches = picked
      ? []
      : allClients.filter((c) => normalizeText(c.full_name) === normalizeText(name));
    const chosen = picked ?? (exactMatches.length === 1 ? exactMatches[0] : null);
    setSubmitting(true);

    // 1) Registro interno da solicitação. Se os dois clientes forem do
    // professor, o banco já aplica a troca e devolve status "aprovada".
    const { data: created, error } = await supabase
      .from("teacher_client_change_requests")
      .insert({
        teacher_id: target.teacherId,
        booking_id: target.kind === "booking" ? target.bookingId ?? null : null,
        schedule_id: target.kind === "fixed" ? target.scheduleId ?? null : null,
        occurrence_date: target.occurrenceDate,
        court: target.court,
        start_time: target.startTime,
        end_time: target.endTime,
        current_client_id: target.currentClientId,
        current_client_name: target.currentClientName,
        new_client_id: chosen?.id ?? null,
        new_client_name: name,
        // requested_by preenchido por trigger/RLS? garantimos aqui
        requested_by: (await supabase.auth.getUser()).data.user?.id ?? "",
      })
      .select("status")
      .single();

    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }

    if (created?.status === "aprovada") {
      toast.success(`Troca feita: ${name} assume o horário.`);
      setSubmitting(false);
      onApplied?.();
      onClose();
      return;
    }

    // 2) WhatsApp para a recepção
    const { data: cfg } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "whatsapp_reservations_number")
      .maybeSingle();
    const phone = normalizePhoneForWhatsApp(cfg?.value ?? null);

    const message =
      `Olá! Gostaria de solicitar a alteração do cliente de uma aula.\n\n` +
      `Professor: ${target.teacherName}\n` +
      `Cliente atual: ${target.currentClientName}\n` +
      `Novo cliente solicitado: ${name}\n` +
      `Quadra: ${courtShort(target.court)}\n` +
      `Data: ${fmtDateBR(target.occurrenceDate)}\n` +
      `Horário: ${target.startTime.slice(0, 5)} às ${target.endTime.slice(0, 5)}\n\n` +
      `Cliente localizado no cadastro: ${chosen ? "sim" : "não"}\n\n` +
      `Solicito apenas a substituição do cliente. A quadra, a data e o horário permanecem os mesmos.`;

    if (phone) {
      openWhatsApp(buildWhatsAppUrl(phone, message));
    } else {
      toast.warning(
        "Solicitação registrada. WhatsApp oficial não configurado — a recepção verá o pedido no painel.",
      );
    }
    toast.success("Solicitação enviada à recepção.");
    setSubmitting(false);
    onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar alteração de cliente</DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-4 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div>
                <span className="text-muted-foreground">Cliente atual:</span>{" "}
                <strong>{target.currentClientName}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Quadra:</span> {courtShort(target.court)}
              </div>
              <div>
                <span className="text-muted-foreground">Data:</span>{" "}
                {fmtDateBR(target.occurrenceDate)}
              </div>
              <div>
                <span className="text-muted-foreground">Horário:</span>{" "}
                {target.startTime.slice(0, 5)}–{target.endTime.slice(0, 5)}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Novo cliente *</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQuery(v);
                    // Teclado do Android dispara um "input" com o mesmo texto
                    // ao perder o foco (ex.: ao tocar em "Confirmar troca") —
                    // não pode descartar o cadastro já selecionado por isso.
                    setPicked((p) =>
                      p && normalizeText(p.full_name) === normalizeText(v) ? p : null,
                    );
                  }}
                  placeholder="Digite o nome do cliente"
                  className="pl-8"
                  autoFocus
                />
              </div>
              {picked ? (
                <div className="text-xs text-emerald-600 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Cadastro selecionado:{" "}
                  <strong>{picked.full_name}</strong>
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
                      Nenhum cadastro encontrado — usaremos o nome digitado.
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
                <p className="text-xs text-muted-foreground">
                  Digite ao menos 2 letras para buscar. Se não encontrar,
                  enviaremos como nome livre.
                </p>
              )}
            </div>

            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-500/40 p-3 text-xs text-amber-900 dark:text-amber-200">
              A quadra, data e horário <strong>não serão alterados</strong>. Se
              o novo cliente também for seu, a troca é feita na hora; caso
              contrário, a recepção confirma a substituição.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Voltar
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !finalName}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Confirmar troca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

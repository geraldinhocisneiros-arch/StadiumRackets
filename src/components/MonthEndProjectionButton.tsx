import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Calculator, Loader2, MessageCircle } from "lucide-react";
import { fmtBRL } from "@/lib/format";
import { sendMonthEndCreditWhatsApp } from "@/lib/whatsapp";

interface MonthEndProjection {
  current_balance: number;
  remaining_sessions: number;
  remaining_sessions_amount: number;
  projected_balance: number;
  amount_needed: number;
}

interface NextMonthProjection {
  starting_balance: number;
  remaining_sessions: number;
  remaining_sessions_amount: number;
  projected_balance: number;
  amount_needed: number;
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Nome do mês seguinte ao atual, capitalizado (ex.: "Setembro"). */
function nextMonthLabel() {
  const d = new Date();
  const next = (d.getMonth() + 1) % 12;
  const name = MONTH_NAMES[next];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface Props {
  clientId: string;
  /** Compacto (só o ícone, sem texto) — usado em linhas de tabela densas. */
  iconOnly?: boolean;
}

type Tab = "current" | "next";

/**
 * Botão + diálogo "Calcular crédito necessário": projeta o saldo do
 * cliente no fim do mês atual (ou do mês seguinte, aba "Próximo mês")
 * descontando as locações do horário fixo, e oferece enviar o valor
 * faltante por WhatsApp. Componente compartilhado entre o cadastro do
 * cliente e a listagem de clientes.
 */

export function MonthEndProjectionButton({ clientId, iconOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("current");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<MonthEndProjection | null>(null);
  const [next, setNext] = useState<NextMonthProjection | null>(null);
  const nextLabel = nextMonthLabel();

  const loadCurrent = async () => {
    setLoading(true);
    const { data: rows, error } = await supabase.rpc("client_month_end_projection", {
      _client_id: clientId,
    } as never);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = (rows as MonthEndProjection[] | null)?.[0];
    if (row) setCurrent(row);
  };

  const loadNext = async () => {
    setLoading(true);
    const { data: rows, error } = await supabase.rpc("client_next_month_projection", {
      _client_id: clientId,
    } as never);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = (rows as NextMonthProjection[] | null)?.[0];
    if (row) setNext(row);
  };

  const handleOpen = async () => {
    setOpen(true);
    setTab("current");
    setCurrent(null);
    setNext(null);
    await loadCurrent();
  };

  const handleTabChange = async (t: Tab) => {
    setTab(t);
    if (t === "next" && !next) await loadNext();
    else if (t === "current" && !current) await loadCurrent();
  };

  const data = tab === "current" ? current : next;

  return (
    <>
      <Button
        variant="outline"
        size={iconOnly ? "icon" : "sm"}
        onClick={handleOpen}
        title="Calcular crédito necessário até o fim do mês"
      >
        <Calculator className="h-4 w-4" />
        {!iconOnly && <span className="ml-2">Calcular crédito necessário até o fim do mês</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crédito necessário</DialogTitle>
          </DialogHeader>

          <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => handleTabChange("current")}
              className={`flex-1 rounded px-2 py-1 transition-colors ${
                tab === "current" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
              }`}
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("next")}
              className={`flex-1 rounded px-2 py-1 transition-colors ${
                tab === "next" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
              }`}
            >
              {nextLabel}
            </button>
          </div>

          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...
            </div>
          ) : data ? (
            <div className="space-y-3">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {tab === "current" ? "Saldo atual" : "Saldo projetado no fim deste mês"}
                  </span>
                  <span
                    className={
                      (tab === "current" ? current!.current_balance : next!.starting_balance) < 0
                        ? "text-destructive font-medium"
                        : "text-success font-medium"
                    }
                  >
                    {fmtBRL(tab === "current" ? current!.current_balance : next!.starting_balance)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {tab === "current"
                      ? `Locações restantes no mês (${data.remaining_sessions})`
                      : `Locações do horário fixo em ${nextLabel.toLowerCase()} (${data.remaining_sessions})`}
                  </span>
                  <span>{fmtBRL(data.remaining_sessions_amount)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="text-muted-foreground">
                    {tab === "current"
                      ? "Saldo projetado no fim do mês"
                      : `Saldo projetado no fim de ${nextLabel.toLowerCase()}`}
                  </span>
                  <span
                    className={
                      data.projected_balance < 0
                        ? "text-destructive font-semibold"
                        : "text-success font-semibold"
                    }
                  >
                    {fmtBRL(data.projected_balance)}
                  </span>
                </div>
              </div>
              {data.amount_needed > 0 ? (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Precisa adicionar </span>
                  <span className="font-semibold text-destructive">
                    {fmtBRL(data.amount_needed)}
                  </span>
                  <span className="text-muted-foreground">
                    {tab === "current"
                      ? " pra terminar o mês em dia."
                      : ` pra terminar ${nextLabel.toLowerCase()} em dia (considerando o saldo já projetado pro fim deste mês).`}
                  </span>
                </div>
              ) : (
                <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2 text-sm text-muted-foreground">
                  {tab === "current"
                    ? "Saldo suficiente — o cliente termina o mês em dia ou com crédito."
                    : `Saldo suficiente — o cliente termina ${nextLabel.toLowerCase()} em dia ou com crédito, considerando só o horário fixo.`}
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Não foi possível calcular.
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            {tab === "current" && current && current.amount_needed > 0 && (
              <Button onClick={() => sendMonthEndCreditWhatsApp({ clientId })}>
                <MessageCircle className="h-4 w-4 mr-2" /> Enviar WhatsApp
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

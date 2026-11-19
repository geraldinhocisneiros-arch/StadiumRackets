import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Pergunta feita toda vez que a recepção marca "Creditar na conta corrente".
// O erro comum: mensalista joga, paga na hora, e a recepcionista credita —
// o dinheiro entra no caixa E vira saldo a favor (saldo que não existe).
// Crédito só é certo quando paga algo que já está na conta (débito em
// aberto) ou quando o cliente quer mesmo deixar dinheiro adiantado.

export interface CreditConfirmRequest {
  clientIds: string[];
  amount: number;
  /** Confirmou: vai para a conta corrente. */
  onAddToAccount: () => void;
  /** Jogou e pagou na hora: só "Pagamento recebido", sem conta corrente. */
  onPaidNow: () => void;
}

interface Props {
  request: CreditConfirmRequest | null;
  onClose: () => void;
}

interface ClientBalance {
  id: string;
  name: string;
  balance: number;
}

export function CreditConfirmDialog({ request, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState<ClientBalance[]>([]);

  useEffect(() => {
    if (!request) return;
    const ids = request.clientIds.filter(Boolean);
    setBalances([]);
    if (ids.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: cls }, ...bals] = await Promise.all([
        supabase.from("clients").select("id, full_name").in("id", ids),
        ...ids.map((id) => supabase.rpc("client_account_balance", { _client_id: id })),
      ]);
      if (cancelled) return;
      const names = new Map((cls ?? []).map((c) => [c.id, c.full_name as string]));
      setBalances(
        ids.map((id, i) => ({
          id,
          name: names.get(id) ?? "Cliente",
          balance: Number(bals[i]?.data ?? 0),
        })),
      );
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!request) return null;

  // Saldo negativo = cliente deve. Se ninguém deve, o crédito vira saldo a favor.
  const someoneOwes = balances.some((b) => b.balance < -0.005);
  const noDebt = !loading && balances.length > 0 && !someoneOwes;

  const paidNow = () => {
    request.onPaidNow();
    onClose();
  };
  const addToAccount = () => {
    request.onAddToAccount();
    onClose();
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Esse valor vai para a conta corrente?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                <strong>Jogou e pagou na hora?</strong> Então não é conta corrente: é só{" "}
                <strong>Pagamento recebido</strong>.
              </p>
              <p>
                Conta corrente é só para <strong>pagar o que ele já deve</strong> na conta ou para{" "}
                <strong>deixar dinheiro adiantado</strong>.
              </p>
              <div className="rounded-md border p-2">
                {loading ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Consultando a conta…
                  </span>
                ) : balances.length === 0 ? (
                  <span className="text-muted-foreground">
                    Selecione o cliente para ver a conta.
                  </span>
                ) : (
                  <ul className="space-y-1">
                    {balances.map((b) => (
                      <li key={b.id} className="flex justify-between gap-3">
                        <span className="truncate">{b.name}</span>
                        <span
                          className={
                            b.balance < -0.005
                              ? "font-medium text-red-600"
                              : "font-medium text-green-700 dark:text-green-500"
                          }
                        >
                          {b.balance < -0.005
                            ? `deve ${fmtBRL(-b.balance)}`
                            : b.balance > 0.005
                              ? `saldo a favor ${fmtBRL(b.balance)}`
                              : "não deve nada"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {noDebt && (
                <p className="rounded-md bg-amber-500/15 p-2 text-amber-800 dark:text-amber-300">
                  Esse cliente <strong>não tem débito em aberto</strong>. Se você creditar
                  {request.amount > 0 ? ` ${fmtBRL(request.amount)}` : ""}, vira{" "}
                  <strong>saldo a favor</strong> para ele jogar depois.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant={noDebt ? "default" : "outline"} onClick={paidNow}>
            Jogou e pagou na hora
          </Button>
          <Button
            type="button"
            variant={noDebt ? "outline" : "default"}
            onClick={addToAccount}
            disabled={loading}
          >
            {someoneOwes ? "Sim, abater da conta" : "Sim, deixar como saldo"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

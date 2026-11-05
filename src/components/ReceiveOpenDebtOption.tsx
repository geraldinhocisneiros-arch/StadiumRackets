import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtBRL } from "@/lib/format";
import {
  EMPTY_RECEIVE_OPEN_DEBT,
  fetchClientOpenDebt,
  type OpenDebt,
  type ReceiveOpenDebtValue,
} from "@/lib/open-debt";

/**
 * "Pagar junto": quando o cliente do lançamento está negativo (e não está
 * na lista de exceções), oferece receber o débito em aberto no mesmo
 * momento em que a recepção lança a quadra do dia — o cliente paga o jogo
 * e não sai sem quitar o saldo.
 */
export function ReceiveOpenDebtOption({
  clientId,
  value,
  onChange,
}: {
  clientId: string | null | undefined;
  value: ReceiveOpenDebtValue;
  onChange: (v: ReceiveOpenDebtValue) => void;
}) {
  const [openDebt, setOpenDebt] = useState<OpenDebt | null>(null);

  useEffect(() => {
    setOpenDebt(null);
    onChange(EMPTY_RECEIVE_OPEN_DEBT);
    if (!clientId) return;
    let cancelled = false;
    void fetchClientOpenDebt(clientId).then((d) => {
      if (!cancelled) setOpenDebt(d);
    });
    return () => {
      cancelled = true;
    };
    // onChange fica de fora de propósito: só reinicia ao trocar de cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!openDebt || openDebt.geralDebt <= 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-rose-600/40 bg-rose-500/10 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-rose-900 dark:text-rose-100">
        <Checkbox
          checked={value.checked}
          onCheckedChange={(v) =>
            onChange({
              checked: v === true,
              amount: value.amount || openDebt.geralDebt.toFixed(2),
            })
          }
        />
        💰 Receber também o débito em aberto ({fmtBRL(openDebt.geralDebt)})
      </label>
      {!value.checked && (
        <p className="text-xs text-rose-900/80 dark:text-rose-100/80">
          Cliente está negativo — aproveite pra cobrar o saldo junto com este lançamento.
        </p>
      )}
      {value.checked && (
        <div className="space-y-1">
          <Label className="text-xs">Valor do débito a receber (R$)</Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Entra como lançamento separado (crédito na conta corrente), com a mesma forma de
            pagamento. Pode ser parcial.
          </p>
        </div>
      )}
    </div>
  );
}

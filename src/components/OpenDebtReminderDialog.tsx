import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtBRL } from "@/lib/format";
import { useOpenDebtReminder } from "@/hooks/useOpenDebtReminder";
import {
  OPEN_DEBT_D1_CONTEXT,
  formatReminderSlots,
  recordOpenDebtReminderAction,
  type OpenDebtReminderRow,
} from "@/lib/open-debt-reminder";
import { logWhatsAppSent, openWhatsApp } from "@/lib/whatsapp";

/**
 * Pop-up das 11h: clientes negativos com locação amanhã, pra recepção
 * mandar o WhatsApp de cobrança (valor, débitos em aberto e Pix). Cada
 * linha só sai da lista com "Enviar WhatsApp" ou "Pular hoje" — e sai pra
 * todas as recepcionistas. Não fecha clicando fora; "Lembrar em 15 min"
 * adia. Ver useOpenDebtReminder.
 */
export function OpenDebtReminderDialog({ enabled }: { enabled: boolean }) {
  const { rows, removeRow, snooze, today } = useOpenDebtReminder(enabled);
  const [busyId, setBusyId] = useState<string | null>(null);

  const resolve = async (row: OpenDebtReminderRow, action: "sent" | "skipped") => {
    setBusyId(row.clientId);
    if (action === "sent" && row.whatsappUrl) {
      // Abre antes de qualquer await pro navegador não bloquear a janela.
      openWhatsApp(row.whatsappUrl);
      void logWhatsAppSent(row.clientId, OPEN_DEBT_D1_CONTEXT);
    }
    const err = await recordOpenDebtReminderAction(row.clientId, today, action);
    setBusyId(null);
    if (err) {
      toast.error(`Não consegui registrar: ${err}`);
      return;
    }
    removeRow(row.clientId);
  };

  return (
    <Dialog open={rows.length > 0}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto [&>button.absolute]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-rose-600" />
            Débito em aberto — locações de amanhã
          </DialogTitle>
          <DialogDescription>
            Estes clientes estão negativos e jogam amanhã. Mande o lembrete com o valor e o Pix pra
            eles se organizarem.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.clientId} className="space-y-2 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{r.fullName}</span>
                <span className="font-semibold text-rose-600">{fmtBRL(r.debt)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Amanhã: {formatReminderSlots(r.slots)}
                {r.whatsappUrl && r.recipientName !== r.fullName.split(" ")[0] && (
                  <> · mensagem vai para {r.recipientName} (responsável)</>
                )}
                {!r.whatsappUrl && <> · sem telefone cadastrado — cobrar no balcão</>}
              </div>
              <div className="flex flex-wrap gap-2">
                {r.whatsappUrl && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={busyId === r.clientId}
                    onClick={() => void resolve(r, "sent")}
                  >
                    <MessageCircle className="mr-1 h-4 w-4" />
                    Enviar WhatsApp
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === r.clientId}
                  onClick={() => void resolve(r, "skipped")}
                >
                  Pular hoje
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={snooze}>
            Lembrar em 15 min
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

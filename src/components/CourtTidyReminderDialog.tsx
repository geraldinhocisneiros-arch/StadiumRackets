import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HardHat, Wrench } from "lucide-react";
import { useCourtTidyReminder } from "@/hooks/useCourtTidyReminder";
import { courtLabel, hourLabel } from "@/lib/court-map";

/**
 * Pop-up bloqueante (10 min antes de cada hora cheia, exceto 06h) avisando
 * quais quadras precisam ser arrumadas e quais vão entrar em manutenção.
 * As prioritárias já têm cliente entrando na mesma hora (arrumar antes de
 * mais nada); as "em seguida" só ficam livres agora, mas já têm locação
 * marcada pra próxima hora (arrumar depois das prioritárias, com folga); as
 * "entrando em manutenção" não precisam ser arrumadas pela recepção (a
 * própria manutenção mexe na quadra), só avisadas. Só monta a busca quando
 * `enabled` (papéis de recepção/direção) — ver AppLayout.
 */
export function CourtTidyReminderDialog({ enabled }: { enabled: boolean }) {
  const { pending, dismiss } = useCourtTidyReminder(enabled);
  const nextHourLabel = pending ? hourLabel((pending.hour + 1) % 24) : null;

  return (
    <Dialog open={!!pending}>
      <DialogContent
        className="sm:max-w-md [&>button.absolute]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-amber-500" />
            Avisos de quadra
          </DialogTitle>
        </DialogHeader>
        {pending && (
          <div className="space-y-4 text-sm text-muted-foreground">
            {pending.priorityCourts.length > 0 && (
              <div>
                Antes das {hourLabel(pending.hour)}, avisar a manutenção para arrumar primeiro:
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  {pending.priorityCourts.map((c) => (
                    <li key={c} className="font-medium text-foreground">
                      {courtLabel(c)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pending.laterCourts.length > 0 && (
              <div>
                Ficam livres agora — arrumar em seguida, já deixando prontas para o horário das{" "}
                {nextHourLabel}.
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  {pending.laterCourts.map((c) => (
                    <li key={c} className="font-medium text-foreground">
                      {courtLabel(c)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pending.maintenanceCourts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-foreground font-medium">
                  <Wrench className="h-4 w-4" />
                  Entrando em manutenção às {hourLabel(pending.hour)}
                </div>
                <div className="mt-0.5">Não precisa arrumar — só avisar a equipe:</div>
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  {pending.maintenanceCourts.map((c) => (
                    <li key={c} className="font-medium text-foreground">
                      {courtLabel(c)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={dismiss}>Ciente</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

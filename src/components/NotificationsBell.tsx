import { useState } from "react";
import { Bell, Check, CheckCheck, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useNotificationsContext, type AppNotification } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { respondBookingConfirmation } from "@/lib/booking-confirmations.functions";

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return `${days}d`;
}

interface NotificationsBellProps {
  /**
   * Torna clicáveis as notificações que a tela sabe abrir. canOpen diz quais
   * itens viram botão; ao clicar, onOpen é chamado, a notificação é
   * marcada como lida e o popover fecha.
   */
  canOpen?: (n: AppNotification) => boolean;
  onOpen?: (n: AppNotification) => void;
}

export function NotificationsBell({ canOpen, onOpen }: NotificationsBellProps = {}) {
  const { items, unreadCount, markRead, markAllRead, reload } = useNotificationsContext();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const respondFn = useServerFn(respondBookingConfirmation);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative text-sidebar-foreground hover:bg-sidebar-accent",
            // Com notificação não lida, destaca o sino com um fundo/anel
            // chamativo — sem isso a única pista era o numerozinho vermelho,
            // fácil de passar batido (motivou o pedido do usuário).
            unreadCount > 0 &&
              "bg-amber-400/25 text-amber-500 ring-2 ring-amber-400/60 hover:bg-amber-400/35 hover:text-amber-500",
          )}
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">Notificações</div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Marcar todas
            </Button>
          )}
        </div>
        {/* Rolagem nativa: o ScrollArea do Radix com max-h não rola (o
            viewport interno é h-full e não resolve contra max-height), então
            as notificações antigas ficavam cortadas. A altura também respeita
            o espaço disponível na tela (celular). */}
        <div className="max-h-[min(24rem,calc(var(--radix-popover-content-available-height)-3rem))] overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Nenhuma notificação
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const clickable = !!(onOpen && canOpen?.(n));
                const handleOpen = () => {
                  if (!clickable) return;
                  setOpen(false);
                  onOpen!(n);
                  if (!n.read_at) void markRead(n.id);
                };
                return (
                <li
                  key={n.id}
                  className={cn(
                    "p-3 text-sm flex items-start gap-2",
                    !n.read_at && "bg-accent/40",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    {clickable ? (
                      <button
                        type="button"
                        onClick={handleOpen}
                        className="w-full text-left rounded -m-1 p-1 hover:bg-accent/60"
                      >
                        <div className="font-medium truncate">{n.title}</div>
                        {n.body && (
                          <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
                        )}
                        <div className="text-xs font-medium text-primary mt-1">Abrir jogo →</div>
                      </button>
                    ) : (
                      <>
                        <div className="font-medium truncate">{n.title}</div>
                        {n.body && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {n.body}
                          </div>
                        )}
                      </>
                    )}
                    {n.kind === "booking_confirm_4h" && !n.read_at && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={applyingId === n.id}
                          onClick={async () => {
                            setApplyingId(n.id);
                            try {
                              await respondFn({ data: { notificationId: n.id, action: "cancel" } });
                              toast.success("Cancelamento registrado — quadra liberada");
                              await reload();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Erro");
                            } finally {
                              setApplyingId(null);
                            }
                          }}
                        >
                          <X className="h-3.5 w-3.5 mr-1" /> Não vou
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={applyingId === n.id}
                          onClick={async () => {
                            setApplyingId(n.id);
                            try {
                              await respondFn({ data: { notificationId: n.id, action: "confirm" } });
                              toast.success("Presença confirmada");
                              await reload();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Erro");
                            } finally {
                              setApplyingId(null);
                            }
                          }}
                        >
                          {applyingId === n.id && (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          )}
                          <Check className="h-3.5 w-3.5 mr-1" /> Confirmar
                        </Button>
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                  {!n.read_at && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => void markRead(n.id)}
                      aria-label="Marcar como lida"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

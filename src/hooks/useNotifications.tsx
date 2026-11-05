import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface AppNotification {
  id: string;
  kind: string;
  client_id: string | null;
  user_id?: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  requires_ack?: boolean;
  metadata?: Record<string, unknown> | null;
}

interface NotificationContext {
  roles: string[];
  myClientId: string | null;
  myTeacherId: string | null;
}

// Módulo-level: compartilhado entre TODAS as instâncias de useNotifications
// (NotificationsBell móvel + desktop + NotificationAckModal). Sem isso,
// cada instância exibia seu próprio toast → 3 pop-ups para o mesmo evento.
const globalShownToastIds = new Set<string>();

export function useNotifications(userId: string | null | undefined) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const rolesRef = useRef<string[]>([]);
  const myClientIdRef = useRef<string | null>(null);
  const myTeacherIdRef = useRef<string | null>(null);
  const shownToastIds = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  // Avisos marcados como lidos localmente cujo UPDATE ainda não voltou do
  // servidor. Um load() disparado nesse meio-tempo (realtime de outro
  // aviso) traria o aviso de volta como não lido e reabriria o modal.
  const pendingReadRef = useRef<Map<string, string>>(new Map());

  const filterFor = useCallback(
    (
      data: AppNotification[],
      opts: {
        roles: string[];
        myClientId: string | null;
        myTeacherId: string | null;
      },
    ) => {
      const { roles: userRoles, myClientId, myTeacherId } = opts;
      return data.filter((n) => {
        // Confirmação de presença é ação exclusiva do cliente pelo portal.
        // Nunca mostrar para diretoria/recepção/professor/admin.
        if (n.kind === "booking_confirm_4h") {
          return !!myClientId && n.client_id === myClientId;
        }
        if (n.kind === "schedule_changed_teacher") {
          const target = (n.metadata as { teacher_id?: string } | null)?.teacher_id ?? null;
          return !!myTeacherId && target === myTeacherId;
        }
        if (n.kind === "booking_cancelled_by_client") {
          const target = (n.metadata as { teacher_id?: string } | null)?.teacher_id ?? null;
          return !!myTeacherId && target === myTeacherId;
        }
        if (n.kind === "booking_cancelled_by_client_staff") {
          const staffRoles = ["admin", "diretoria", "recepcionista"];
          return userRoles.some((r) => staffRoles.includes(r));
        }
        if (
          n.kind === "court_cancel_by_teacher" ||
          n.kind === "court_reactivate_by_teacher" ||
          n.kind === "court_swap_by_teacher"
        ) {
          // Sem esse caso, caía no fallback genérico (visível pra todo
          // mundo) — cliente e outros professores viam um pop-up bloqueante
          // sobre a aula de outra pessoa. É só pra equipe.
          const staffRoles = ["admin", "diretoria", "recepcionista"];
          return userRoles.some((r) => staffRoles.includes(r));
        }
        if (n.kind === "booking_reactivated_by_staff") {
          return !!myClientId && n.client_id === myClientId;
        }
        if (n.kind === "online_payment_conflict") {
          // Pagamento online recebido pra um horário que virou conflito —
          // resolução manual (reembolso/realocação) é sempre da equipe.
          const staffRoles = ["admin", "diretoria", "recepcionista"];
          return userRoles.some((r) => staffRoles.includes(r));
        }

        if (n.kind === "waitlist_slot_available") {
          const meta = (n.metadata ?? {}) as {
            for_staff?: boolean;
            for_first?: boolean;
            teacher_id?: string | null;
          };
          const isStaff =
            userRoles.includes("admin") ||
            userRoles.includes("diretoria") ||
            userRoles.includes("recepcionista");
          // Notificações for_staff são inseridas uma linha POR usuário da
          // equipe (uma pra cada admin/diretoria/recepcionista), cada uma
          // já direcionada via n.user_id — checar só o cargo (isStaff) faz
          // cada membro da equipe ver as linhas de TODOS os outros também,
          // empilhando N pop-ups idênticos pro mesmo evento (N = número de
          // usuários com esses cargos, ex.: 9 avisos pra um evento só).
          if (meta.for_staff) return isStaff && !!userId && n.user_id === userId;
          if (meta.for_first) {
            if (n.client_id && myClientId && n.client_id === myClientId) return true;
            if (meta.teacher_id && myTeacherId && meta.teacher_id === myTeacherId) return true;
            return false;
          }
          // Legado: mantém para staff.
          return isStaff;
        }
        if (n.kind === "waitlist_slot_filled") {
          return !!myClientId && n.client_id === myClientId;
        }
        if (n.kind === "waitlist_declined") {
          const meta = (n.metadata ?? {}) as { teacher_id?: string | null };
          if (n.client_id && myClientId && n.client_id === myClientId) return true;
          if (meta.teacher_id && myTeacherId && meta.teacher_id === myTeacherId) return true;
          return false;
        }
        if (n.kind === "court_waitlist_joined" || n.kind === "court_waitlist_left") {
          // Row targeted to a specific staff user via user_id.
          return !!userId && n.user_id === userId;
        }
        if (n.kind === "cleaning_low_stock") {
          // Uma linha por usuário diretoria/limpeza, direcionada via
          // user_id — mesmo padrão de court_waitlist_joined.
          return !!userId && n.user_id === userId;
        }
        if (n.kind === "debt_limit_alert_created" || n.kind === "debt_limit_booking_tomorrow") {
          // Conceito de limite de débito aposentado (a aba virou só a lista de
          // Exceções): esses avisos não aparecem mais no sino nem como pop-up.
          return false;
        }
        if (n.kind === "professor_late_cancel") {
          // Uma linha por recepcionista, direcionada via user_id. Tem
          // client_id preenchido, então sem esse caso o próprio cliente
          // veria o aviso no portal.
          return !!userId && n.user_id === userId;
        }
        if (
          n.kind === "fixed_waitlist_joined" ||
          n.kind === "fixed_waitlist_assigned" ||
          n.kind === "fixed_waitlist_position_changed" ||
          n.kind === "fixed_schedule_expiring" ||
          n.kind === "fixed_waitlist_free_slot"
        ) {
          // Mesmo padrão "direcionado por user_id": staff (joined/expiring)
          // ou o próprio solicitante (assigned/position_changed) — cada
          // linha já sai da RPC/trigger com o user_id certo.
          return !!userId && n.user_id === userId;
        }
        return true;
      });
    },
    [userId],
  );

  const loadIdentity = useCallback(async (): Promise<NotificationContext | null> => {
    if (!userId) {
      myClientIdRef.current = null;
      myTeacherIdRef.current = null;
      rolesRef.current = [];
      setRoles([]);
      return null;
    }
    const [{ data: portal }, { data: teacher }, { data: userRoles }] = await Promise.all([
      supabase.from("client_portal_users").select("client_id").eq("user_id", userId).maybeSingle(),
      supabase.from("teachers").select("id").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const myClientId = (portal as { client_id: string } | null)?.client_id ?? null;
    const myTeacherId = (teacher as { id: string } | null)?.id ?? null;
    const rolesList = ((userRoles ?? []) as { role: string }[]).map((r) => r.role);
    myClientIdRef.current = myClientId;
    myTeacherIdRef.current = myTeacherId;
    rolesRef.current = rolesList;
    setRoles(rolesList);
    return { roles: rolesList, myClientId, myTeacherId };
  }, [userId]);

  const load = useCallback(
    async (contextOverride?: NotificationContext) => {
      if (!userId) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const context = contextOverride ?? {
        roles: rolesRef.current,
        myClientId: myClientIdRef.current,
        myTeacherId: myTeacherIdRef.current,
      };
      const { data } = await supabase
        .from("app_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      const list = ((data ?? []) as AppNotification[]).map((n) => {
        const readAt = pendingReadRef.current.get(n.id);
        return readAt && !n.read_at ? { ...n, read_at: readAt } : n;
      });
      const visible = filterFor(list, context);
      setItems(visible);
      // Marca as notificações existentes para não disparar toast retroativo.
      if (!initializedRef.current) {
        visible.forEach((n) => globalShownToastIds.add(n.id));
        initializedRef.current = true;
      }
      setLoading(false);
    },
    [userId, filterFor],
  );

  useEffect(() => {
    initializedRef.current = false;
    if (!userId) {
      void load();
      return;
    }
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const context = await loadIdentity();
      if (cancelled || !context) return;

      channel = supabase
        .channel(`app_notifications_${userId}_${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          // Somente INSERT — UPDATE (ex: read_at) NÃO deve refazer toast.
          { event: "INSERT", schema: "public", table: "app_notifications" },
          (payload) => {
            const n = payload.new as AppNotification;
            const belongs =
              filterFor([n], {
                roles: rolesRef.current,
                myClientId: myClientIdRef.current,
                myTeacherId: myTeacherIdRef.current,
              }).length > 0;
            // Dedup GLOBAL por notification.id — impede múltiplos toasts
            // quando várias instâncias do hook estão montadas.
            const alreadyShown = globalShownToastIds.has(n.id);
            if (belongs && !alreadyShown) {
              if (n.kind === "court_waitlist_joined" || n.kind === "court_waitlist_left") {              } else if (n.kind === "court_waitlist_joined" || n.kind === "court_waitlist_left") {
                globalShownToastIds.add(n.id);
                const meta = (n.metadata ?? {}) as {
                  waitlist_date?: string;
                  date?: string;
                };
                const icon = n.kind === "court_waitlist_left" ? "🚪" : "⏳";
                const fallback =
                  n.kind === "court_waitlist_left"
                    ? "Saída da lista de espera"
                    : "Nova entrada na lista de espera";
                toast(`${icon} ${n.title ?? fallback}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                  action: {
                    label: "Ver fila",
                    onClick: () => {
                      const params = new URLSearchParams();
                      const date = meta.waitlist_date ?? meta.date;
                      if (date) params.set("date", date);
                      const query = params.toString();
                      window.location.href = query ? `/mapa?${query}` : "/mapa";
                    },
                  },
                });
              } else if (n.kind === "booking_cancelled_by_client_staff") {
                globalShownToastIds.add(n.id);
                toast(`❌ ${n.title ?? "Reserva cancelada pelo cliente"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                  action: {
                    label: "Ver no mapa",
                    onClick: () => {
                      const meta = (n.metadata ?? {}) as { date?: string };
                      const params = new URLSearchParams();
                      if (meta.date) params.set("date", meta.date);
                      const query = params.toString();
                      window.location.href = query ? `/mapa?${query}` : "/mapa";
                    },
                  },
                });
              } else if (n.kind === "booking_reactivated_by_staff") {
                globalShownToastIds.add(n.id);
                toast(`✅ ${n.title ?? "Reserva reativada"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                });
              } else if (n.kind === "waitlist_declined") {
                globalShownToastIds.add(n.id);
                toast(`⏳ ${n.title ?? "Lista de espera"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                });
              } else if (n.kind === "debt_limit_alert_created") {
                globalShownToastIds.add(n.id);
                toast(`⚠️ ${n.title ?? "Limite de débito atingido"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                  action: {
                    label: "Ver alertas",
                    onClick: () => {
                      window.location.href = "/clientes/limite-debito";
                    },
                  },
                });
              } else if (n.kind === "debt_limit_booking_tomorrow") {
                globalShownToastIds.add(n.id);
                toast(`📅 ${n.title ?? "Locação amanhã — cliente acima do limite"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                  action: {
                    label: "Ver alertas",
                    onClick: () => {
                      window.location.href = "/clientes/limite-debito";
                    },
                  },
                });
              } else if (n.kind === "fixed_waitlist_joined") {
                globalShownToastIds.add(n.id);
                toast(`🎾 ${n.title ?? "Nova inscrição na fila fixa"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                  action: {
                    label: "Ver fila",
                    onClick: () => {
                      window.location.href = "/espera";
                    },
                  },
                });
              } else if (n.kind === "fixed_waitlist_assigned") {
                globalShownToastIds.add(n.id);
                toast(`🎾 ${n.title ?? "Horário fixo atribuído!"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                });
              } else if (n.kind === "fixed_waitlist_position_changed") {
                globalShownToastIds.add(n.id);
                toast(`⏳ ${n.title ?? "Sua posição na fila mudou"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                });
              } else if (n.kind === "fixed_waitlist_free_slot") {
                globalShownToastIds.add(n.id);
                toast(`🟢 ${n.title ?? "Quadra livre para a fila fixa"}`, {
                  description: n.body ?? undefined,
                  duration: 20000,
                  action: {
                    label: "Ver fila",
                    onClick: () => {
                      window.location.href = "/espera";
                    },
                  },
                });
              } else if (n.kind === "fixed_schedule_expiring") {
                globalShownToastIds.add(n.id);
                toast(`📅 ${n.title ?? "Horário fixo vencendo"}`, {
                  description: n.body ?? undefined,
                  duration: 15000,
                  action: {
                    label: "Ver fila",
                    onClick: () => {
                      window.location.href = "/espera";
                    },
                  },
                });
              }
            }

            void load();
          },
        )
        .subscribe((status, error) => {
          if (status === "SUBSCRIBED") {
            console.info("Notification realtime status: SUBSCRIBED");
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.warn("Notification realtime status:", status, error ?? "");
          }
        });

      await load(context);
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, load, filterFor, loadIdentity]);

  // Otimista: some da tela na hora e grava em segundo plano. Antes o modal
  // "OK, ciente" esperava a ida e volta ao servidor para fechar — lento em
  // rede ruim e, se a requisição falhasse ou ficasse pendurada, o botão
  // ficava desabilitado para sempre.
  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    pendingReadRef.current.set(id, now);
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)));
    try {
      const { error } = await supabase
        .from("app_notifications")
        .update({ read_at: now })
        .eq("id", id);
      if (error) throw error;
    } catch (e) {
      setItems((prev) =>
        prev.map((n) => (n.id === id && n.read_at === now ? { ...n, read_at: null } : n)),
      );
      toast.error(
        `Não foi possível registrar a ciência: ${e instanceof Error ? e.message : "erro de conexão"}`,
      );
    } finally {
      pendingReadRef.current.delete(id);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    await supabase.from("app_notifications").update({ read_at: now }).is("read_at", null);
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
  }, []);

  const unreadCount = items.filter((n) => !n.read_at).length;

  return { items, unreadCount, loading, roles, markRead, markAllRead, reload: load };
}

type NotificationsValue = ReturnType<typeof useNotifications>;

const NotificationsContext = createContext<NotificationsValue | null>(null);

/**
 * NotificationsBell (mobile + desktop) e NotificationAckModal antes chamavam
 * useNotifications() cada um por conta própria — 3 instâncias na mesma
 * página, cada uma abrindo seu próprio canal realtime e refazendo as
 * mesmas consultas de identidade (client_portal_users/teachers/user_roles)
 * a cada carregamento. Este provider busca uma vez só e compartilha.
 */
export function NotificationsProvider({
  userId,
  children,
}: {
  userId: string | null | undefined;
  children: ReactNode;
}) {
  const value = useNotifications(userId);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsContext(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotificationsContext must be used within NotificationsProvider");
  return ctx;
}

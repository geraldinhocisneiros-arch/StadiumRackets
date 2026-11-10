import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Tags,
  Receipt,
  BarChart3,
  UserCog,
  LogOut,
  Menu,
  AlertCircle,
  Wallet,
  LandPlot,
  AlertOctagon,
  ShieldCheck,
  CheckSquare,
  Lightbulb,
  HardHat,
  Sparkles,
  DollarSign,
  Package,
  FileText,
  GraduationCap,
  ArrowUp,
  ArrowDown,
  Check,
  Pencil,
  Map as MapIcon,
  GripVertical,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  Repeat,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { NotificationsBell } from "@/components/NotificationsBell";
import { NotificationAckModal } from "@/components/NotificationAckModal";
import { CourtTidyReminderDialog } from "@/components/CourtTidyReminderDialog";
import { OpenDebtReminderDialog } from "@/components/OpenDebtReminderDialog";
import { NotificationsProvider } from "@/hooks/useNotifications";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  rolesAllowed?: Array<"admin" | "recepcionista" | "diretoria" | "limpeza">;
  pageKey?: string;
  /** Item com informação de inadimplência — some para quem não pode ver. */
  debtInfo?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Painel", icon: LayoutDashboard, rolesAllowed: ["diretoria"] },
  { to: "/caixa", label: "Caixa", icon: Receipt, pageKey: "caixa" },
  { to: "/mapa", label: "Mapa de quadras", icon: MapIcon, pageKey: "mapa" },
  {
    to: "/vagas-fixas",
    label: "Vagas para fixo",
    icon: Repeat,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  { to: "/financas", label: "Finanças", icon: Wallet, pageKey: "financas" },
  {
    to: "/fechamentos",
    label: "Fechamentos",
    icon: FileText,
    rolesAllowed: ["admin", "diretoria"],
  },
  {
    to: "/tarefas",
    label: "Gestão",
    icon: CheckSquare,
    rolesAllowed: ["admin", "diretoria"],
  },
  {
    to: "/inadimplentes",
    label: "Inadimplentes",
    icon: AlertOctagon,
    rolesAllowed: ["diretoria", "recepcionista"],
    debtInfo: true,
  },
  {
    to: "/relatorio-cobranca",
    label: "Relatório de cobrança",
    icon: BarChart3,
    rolesAllowed: ["admin", "diretoria"],
    debtInfo: true,
  },
  {
    to: "/pendencias-cadastro",
    label: "Cadastros pendentes",
    icon: UserPlus,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  {
    to: "/clientes/limite-debito",
    label: "Exceções",
    icon: ShieldCheck,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  { to: "/clientes", label: "Clientes", icon: Users, pageKey: "clientes" },
  { to: "/fat-quadra", label: "Fat. quadra", icon: LandPlot, rolesAllowed: ["diretoria"] },
  { to: "/categorias", label: "Categorias", icon: Tags, pageKey: "categorias" },
  {
    to: "/precos",
    label: "Tabela de preços",
    icon: DollarSign,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3, rolesAllowed: ["diretoria"] },
  { to: "/inteligencia", label: "Inteligência", icon: Lightbulb, rolesAllowed: ["diretoria"] },
  { to: "/usuarios", label: "Usuários", icon: UserCog, pageKey: "usuarios" },
  { to: "/estoque", label: "Estoque", icon: Package, pageKey: "estoque" },
  { to: "/limpeza", label: "Limpeza", icon: Sparkles, rolesAllowed: ["diretoria", "limpeza"] },
  {
    to: "/professores",
    label: "Professores",
    icon: GraduationCap,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  {
    to: "/professores/relatorio",
    label: "Relatório professor",
    icon: GraduationCap,
    rolesAllowed: ["diretoria", "recepcionista"],
  },
  {
    to: "/comissao-johny",
    label: "Comissão Johny",
    icon: GraduationCap,
    rolesAllowed: ["admin", "diretoria"],
  },
  {
    to: "/professores/vinculos",
    label: "Auditoria de vínculos",
    icon: GraduationCap,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  {
    to: "/espera",
    label: "Lista de espera",
    icon: Users,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  {
    to: "/trocas-cliente",
    label: "Trocas de cliente",
    icon: UserCog,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
  {
    to: "/vinculos-professor",
    label: "Vínculos de professor",
    icon: GraduationCap,
    rolesAllowed: ["admin", "diretoria", "recepcionista"],
  },
];

// Submenus do menu lateral: cada grupo aparece uma vez (na posição do
// primeiro item dele) e abre/fecha com a seta. As páginas continuam com as
// mesmas rotas e permissões — o grupo só mostra os itens que a pessoa já
// podia ver. Na edição de ordem do menu os itens aparecem soltos, como antes.
const NAV_GROUPS: Array<{
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  children: string[];
  /** Nome do item dentro do submenu, quando diferente do nome solto. */
  childLabels?: Record<string, string>;
}> = [
  {
    key: "clientes",
    label: "Clientes",
    icon: Users,
    children: [
      "/clientes",
      "/espera",
      "/clientes/limite-debito",
    ],
    childLabels: { "/clientes": "Nomes" },
  },
  {
    key: "professores",
    label: "Professores",
    icon: GraduationCap,
    children: [
      "/professores",
      "/professores/relatorio",
      "/comissao-johny",
      "/professores/vinculos",
      "/vinculos-professor",
      "/trocas-cliente",
    ],
    childLabels: { "/professores": "Nomes" },
  },
  {
    key: "financeiro",
    label: "Financeiro",
    icon: DollarSign,
    children: [
      "/inadimplentes",
      "/fechamentos",
      "/financas",
    ],
  },
  {
    key: "relatorios",
    label: "Relatórios",
    icon: BarChart3,
    children: ["/relatorios", "/inteligencia", "/fat-quadra", "/relatorio-cobranca"],
  },
  {
    key: "configuracoes",
    label: "Configurações",
    icon: Settings,
    children: ["/categorias", "/precos", "/pendencias-cadastro", "/usuarios"],
  },
];

const ORDER_STORAGE_KEY = "sr.nav.order.v1";
const SIDEBAR_COLLAPSED_KEY = "sr.sidebar.collapsed.v1";

function dueDismissedKey(): string {
  return `sr.due-clients-dismissed.${new Date().toISOString().slice(0, 10)}`;
}

function loadSavedOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function applyOrder(items: NavItem[], order: string[]): NavItem[] {
  if (!order.length) return items;
  const byTo = new Map(items.map((i) => [i.to, i]));
  const ordered: NavItem[] = [];
  order.forEach((to) => {
    const it = byTo.get(to);
    if (it) {
      ordered.push(it);
      byTo.delete(to);
    }
  });
  byTo.forEach((it) => ordered.push(it));
  return ordered;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const {
    user,
    isAdmin,
    signOut,
    roles,
    hasPageAccess,
    canSeeDebt,
    isProfessor,
    isLimpeza,
  } = useAuth();
  // Lembrete de arrumar quadra é assunto de quem opera a recepção — não
  // interessa professor/limpeza vendo o próprio mapa.
  const isFrontDeskStaff =
    isAdmin || roles.includes("diretoria") || roles.includes("recepcionista");
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Recolher o menu lateral (só desktop) pra dar mais espaço pro conteúdo,
  // ex.: o mapa de quadras — lembrado entre sessões/telas.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };
  const [dueClients, setDueClients] = useState<Array<{ id: string; full_name: string }>>([]);
  const [dueDismissed, setDueDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(dueDismissedKey()) === "1";
    } catch {
      return false;
    }
  });
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const navContainerRef = useRef<HTMLElement | null>(null);
  const draggingToRef = useRef<string | null>(null);
  const [draggingTo, setDraggingTo] = useState<string | null>(null);

  useEffect(() => {
    setSavedOrder(loadSavedOrder());
  }, []);

  // Ordem salva no cadastro (profiles.nav_menu_order) — sincroniza entre
  // dispositivos. O localStorage acima só evita o "flash" antes de carregar.
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("nav_menu_order")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data?.nav_menu_order) return;
        const remote = data.nav_menu_order;
        if (Array.isArray(remote) && remote.every((x): x is string => typeof x === "string")) {
          setSavedOrder(remote);
          try {
            window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(remote));
          } catch {
            // ignore quota errors
          }
        }
      });
  }, [user?.id]);

  // Limpeza pura (sem outros papéis) só enxerga a aba Limpeza.
  const isLimpezaOnly =
    isLimpeza &&
    !isAdmin &&
    !isProfessor &&
    !roles.includes("diretoria") &&
    !roles.includes("recepcionista");

  const allowedItems = useMemo(
    () =>
      NAV.filter((n) => {
        if (isLimpezaOnly) return n.to === "/limpeza";
        if (isProfessor) return n.to === "/mapa";
        if (n.debtInfo && !canSeeDebt) return false;
        if (n.adminOnly) return isAdmin;
        if (n.rolesAllowed) return n.rolesAllowed.some((r) => roles.includes(r));
        if (n.pageKey) return hasPageAccess(n.pageKey);
        return true;
      }),
    [isAdmin, roles, hasPageAccess, canSeeDebt, isProfessor, isLimpezaOnly],
  );

  const items = useMemo(() => applyOrder(allowedItems, savedOrder), [allowedItems, savedOrder]);

  // Reordena só em memória (usado durante o arrasto, pra não gravar a cada
  // pixel movido — a gravação de verdade acontece em persistOrder, no fim).
  const reorderLocally = (next: NavItem[]) => {
    setSavedOrder(next.map((i) => i.to));
  };

  const persistOrder = (next: NavItem[]) => {
    const order = next.map((i) => i.to);
    setSavedOrder(order);
    try {
      window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
    } catch {
      // ignore quota errors
    }
    if (user?.id) {
      void supabase
        .from("profiles")
        .update({ nav_menu_order: order })
        .eq("id", user.id)
        .then(({ error }) => {
          if (error) {
            toast.error("Ordem salva neste aparelho, mas não sincronizou com os outros.");
          }
        });
    }
  };

  const moveItem = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    persistOrder(next);
  };

  const resetOrder = () => {
    setSavedOrder([]);
    try {
      window.localStorage.removeItem(ORDER_STORAGE_KEY);
    } catch {
      // ignore
    }
    if (user?.id) {
      void supabase.from("profiles").update({ nav_menu_order: null }).eq("id", user.id);
    }
    toast.success("Ordem do menu restaurada");
  };

  // Arrastar pra reordenar — Pointer Events funciona igual com mouse e
  // toque, ao contrário do drag-and-drop nativo do HTML5 (que não
  // dispara em telas de celular).
  const startDrag = (e: React.PointerEvent, to: string) => {
    e.preventDefault();
    draggingToRef.current = to;
    setDraggingTo(to);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    const dragTo = draggingToRef.current;
    if (!dragTo || !navContainerRef.current) return;
    const children = Array.from(
      navContainerRef.current.querySelectorAll<HTMLElement>("[data-nav-to]"),
    );
    const y = e.clientY;
    let targetIdx = children.length - 1;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        targetIdx = i;
        break;
      }
    }
    const fromIdx = items.findIndex((it) => it.to === dragTo);
    if (fromIdx === -1 || fromIdx === targetIdx) return;
    const next = items.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(targetIdx, 0, moved);
    reorderLocally(next);
  };

  const endDrag = () => {
    if (!draggingToRef.current) return;
    draggingToRef.current = null;
    setDraggingTo(null);
    persistOrder(items);
  };

  useEffect(() => {
    if (!user) return;
    const loadDueClients = async () => {
      const today = new Date().getDate();
      const { data } = await supabase
        .from("clients")
        .select("id, full_name")
        .eq("active", true)
        .eq("due_day", today)
        .order("full_name");
      setDueClients((data ?? []) as Array<{ id: string; full_name: string }>);
    };
    loadDueClients();
    window.addEventListener("clients:updated", loadDueClients);
    return () => window.removeEventListener("clients:updated", loadDueClients);
    // Usa o id (não o objeto `user`, que ganha nova referência a cada refresh
    // de token) para não recarregar/reexibir o aviso sem o usuário mudar de fato.
  }, [user?.id]);

  const dismissDueClients = () => {
    setDueDismissed(true);
    try {
      window.localStorage.setItem(dueDismissedKey(), "1");
    } catch {
      // ignore quota errors
    }
  };

  const handleSignOut = async () => {
    const { getLogoutReturnPath, clearPortalOrigin } = await import("@/lib/portal-origin");
    const target = getLogoutReturnPath();
    await signOut();
    clearPortalOrigin();
    navigate({ to: target });
  };

  // Limpeza pura: se cair em qualquer outra rota, redireciona pra Limpeza.
  useEffect(() => {
    if (isLimpezaOnly && location.pathname !== "/limpeza" && location.pathname !== "/login") {
      navigate({ to: "/limpeza" });
    }
  }, [isLimpezaOnly, location.pathname, navigate]);

  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});

  const renderNavLink = (
    item: NavItem,
    onNavigate?: () => void,
    nested = false,
    labelOverride?: string,
  ) => {
    const Icon = item.icon;
    const active = location.pathname === item.to;
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
          nested && "pl-9",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {!nested && <Icon className="h-4 w-4" />}
        {labelOverride ?? item.label}
      </Link>
    );
  };

  const renderGroupedNavItems = (onNavigate?: () => void) => {
    const groupOf = new Map<string, (typeof NAV_GROUPS)[number]>();
    for (const g of NAV_GROUPS) for (const to of g.children) groupOf.set(to, g);
    const rendered = new Set<string>();
    const out: ReactNode[] = [];
    for (const item of items) {
      const g = groupOf.get(item.to);
      if (!g) {
        out.push(renderNavLink(item, onNavigate));
        continue;
      }
      if (rendered.has(g.key)) continue;
      rendered.add(g.key);
      const children = g.children
        .map((to) => items.find((i) => i.to === to))
        .filter((i): i is NavItem => !!i);
      const hasActive = children.some((c) => c.to === location.pathname);
      const isOpen = groupOpen[g.key] ?? hasActive;
      const GroupIcon = g.icon;
      out.push(
        <div key={`group:${g.key}`}>
          <button
            type="button"
            onClick={() => setGroupOpen((prev) => ({ ...prev, [g.key]: !isOpen }))}
            aria-expanded={isOpen}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              hasActive && !isOpen
                ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <GroupIcon className="h-4 w-4" />
            <span className="flex-1 text-left">{g.label}</span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-0" : "-rotate-90")}
            />
          </button>
          {isOpen && (
            <div className="mt-1 space-y-1">
              {children.map((c) => renderNavLink(c, onNavigate, true, g.childLabels?.[c.to]))}
            </div>
          )}
        </div>,
      );
    }
    return out;
  };

  const renderNavItems = (onNavigate?: () => void) =>
    !editMode
      ? renderGroupedNavItems(onNavigate)
      : items.map((item, idx) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          if (editMode) {
            return (
              <div
                key={item.to}
                data-nav-to={item.to}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm bg-sidebar-accent/40 transition-opacity",
                  draggingTo === item.to && "opacity-40",
                )}
              >
                <button
                  type="button"
                  aria-label="Arrastar para reordenar"
                  onPointerDown={(e) => startDrag(e, item.to)}
                  onPointerMove={handleDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  style={{ touchAction: "none" }}
                  className="h-6 w-6 flex items-center justify-center rounded shrink-0 cursor-grab active:cursor-grabbing hover:bg-sidebar-accent"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                <Icon className="h-4 w-4 shrink-0 opacity-80" />
                <span className="flex-1 truncate">{item.label}</span>
                <button
                  type="button"
                  aria-label="Mover para cima"
                  disabled={idx === 0}
                  onClick={() => moveItem(idx, -1)}
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-sidebar-accent disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Mover para baixo"
                  disabled={idx === items.length - 1}
                  onClick={() => moveItem(idx, 1)}
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-sidebar-accent disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        });

  const renderEditControls = () => (
    <div className="px-3 pb-2 flex items-center gap-2">
      {editMode ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1 h-8"
            onClick={() => {
              setEditMode(false);
              toast.success("Ordem do menu salva");
            }}
          >
            <Check className="h-3.5 w-3.5 mr-1" /> Concluir
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={resetOrder}
          >
            Restaurar
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="w-full h-8 justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => setEditMode(true)}
        >
          <Pencil className="h-3.5 w-3.5 mr-2" /> Reordenar menu
        </Button>
      )}
    </div>
  );

  return (
    <NotificationsProvider userId={user?.id}>
      <div className="flex min-h-screen bg-background">
        {/* Sidebar desktop */}
        <aside
          className={cn(
            "hidden md:flex print:hidden flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200",
            sidebarCollapsed ? "w-14" : "w-64",
          )}
        >
          <div
            className={cn(
              "flex items-center border-b border-sidebar-border",
              sidebarCollapsed ? "flex-col gap-2 px-2 py-3" : "gap-2 px-6 py-6",
            )}
          >
            {!sidebarCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <img
                    src="/logo-white.png"
                    alt="Stadium Rackets"
                    className="h-10 w-auto max-w-full object-contain"
                  />
                  <div className="text-xs opacity-70 mt-0.5">Sistema de gestão</div>
                </div>
                <NotificationsBell />
              </>
            )}
            <Button
              onClick={toggleSidebarCollapsed}
              variant="ghost"
              size="icon"
              aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              className="h-8 w-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </div>
          {!sidebarCollapsed && (
            <>
              <nav
                ref={(el) => {
                  navContainerRef.current = el;
                }}
                className="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
              >
                {renderNavItems()}
              </nav>
              {renderEditControls()}
              <div className="p-3 border-t border-sidebar-border">
                <div className="px-3 py-2 text-xs opacity-70 truncate">
                  {user?.email}
                  <div className="mt-0.5 uppercase tracking-wide">
                    {roles.join(", ") || "sem papel"}
                  </div>
                </div>
                <Button
                  onClick={handleSignOut}
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <LogOut className="h-4 w-4 mr-2" /> Sair
                </Button>
              </div>
            </>
          )}
        </aside>

        {/* Mobile top bar */}
        <div className="md:hidden print:hidden fixed top-0 inset-x-0 z-40 bg-sidebar text-sidebar-foreground border-b border-sidebar-border flex items-center justify-between px-4 h-14">
          <img src="/logo-white.png" alt="Stadium Rackets" className="h-8 w-auto object-contain" />
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen((o) => !o)}
              className="text-sidebar-foreground"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {open && (
          <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={() => setOpen(false)}>
            <aside
              className="absolute top-14 left-0 w-64 h-[calc(100%-3.5rem)] bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <nav
                ref={(el) => {
                  navContainerRef.current = el;
                }}
                className="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
              >
                {renderNavItems(() => !editMode && setOpen(false))}
              </nav>
              {renderEditControls()}
              <div className="p-3 border-t border-sidebar-border">
                <Button
                  onClick={handleSignOut}
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <LogOut className="h-4 w-4 mr-2" /> Sair
                </Button>
              </div>
            </aside>
          </div>
        )}

        <main className="flex-1 md:ml-0 mt-14 md:mt-0 print:mt-0 px-3 sm:px-4 md:px-8 py-4 md:py-8 min-w-0 max-w-full overflow-x-hidden">
          {dueClients.length > 0 && !dueDismissed && (
            <div className="mb-4 flex items-start gap-3 rounded-md border border-warning/30 print:hidden bg-warning/15 px-4 py-3 text-warning-foreground">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="flex-1 text-sm">
                <div className="font-medium">Hoje é dia de vencimento</div>
                <div className="mt-1 text-warning-foreground/90">
                  {dueClients.map((client) => client.full_name).join(", ")}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={dismissDueClients}
                className="shrink-0 border-warning/40"
              >
                OK
              </Button>
            </div>
          )}
          {children}
        </main>
        <NotificationAckModal
          excludeKinds={[
            "booking_created",
            "fixed_schedule_created",
            "booking_confirm_4h",
            // No Caixa o aviso de cancelamento tardio cobriria o formulário
            // de lançamento que ele mesmo abriu; volta nas outras telas.
            ...(location.pathname === "/caixa" ? ["professor_late_cancel"] : []),
          ]}
        />
        <CourtTidyReminderDialog enabled={isFrontDeskStaff} />
        <OpenDebtReminderDialog enabled={isFrontDeskStaff && canSeeDebt} />
      </div>
    </NotificationsProvider>
  );
}

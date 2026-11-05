import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PortalAccount {
  clientId: string;
  fullName: string;
  isDependent: boolean;
  responsibleName?: string;
}

interface Ctx {
  accounts: PortalAccount[];
  activeClientId: string | null;
  setActiveClientId: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const PortalAccountsContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "portal:active-client-id";

export function PortalAccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [activeClientId, setActiveClientIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setActiveClientId = (id: string) => {
    setActiveClientIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAccounts([]);
        setActiveClientIdState(null);
        return;
      }
      // 1. Linked clients
      const linkedRes = await (supabase as any)
        .from("client_portal_users")
        .select("client_id, clients(id, full_name)")
        .eq("user_id", session.user.id);
      const linked: PortalAccount[] = (linkedRes.data ?? [])
        .filter((r: any) => r.clients)
        .map((r: any) => ({
          clientId: r.clients.id as string,
          fullName: r.clients.full_name as string,
          isDependent: false,
        }));

      // 2. Dependents: clients whose responsible_client_id points to a linked client (ID-based, secure)
      let dependents: PortalAccount[] = [];
      const linkedIds = linked.map((a) => a.clientId);
      if (linkedIds.length > 0) {
        try {
          const depsRes = await (supabase as any)
            .from("clients")
            .select("id, full_name, responsible_client_id, responsible:responsible_client_id(full_name)")
            .in("responsible_client_id", linkedIds);
          const linkedIdSet = new Set(linkedIds);
          dependents = (depsRes.data ?? [])
            .filter((c: any) => !linkedIdSet.has(c.id))
            .map((c: any) => ({
              clientId: c.id as string,
              fullName: c.full_name as string,
              isDependent: true,
              responsibleName: c.responsible?.full_name as string | undefined,
            }));
        } catch (e) {
          console.error("portal dependents lookup failed", e);
        }
      }

      const all = [...linked, ...dependents].sort((a, b) => {
        if (a.isDependent !== b.isDependent) return a.isDependent ? 1 : -1;
        return a.fullName.localeCompare(b.fullName);
      });

      setAccounts(all);

      // Pick active client
      let saved: string | null = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
      const valid = saved && all.some((a) => a.clientId === saved) ? saved : all[0]?.clientId ?? null;
      setActiveClientIdState(valid);
    } catch (e) {
      console.error("portal accounts refresh failed", e);
      setAccounts([]);
      setActiveClientIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  return (
    <PortalAccountsContext.Provider value={{ accounts, activeClientId, setActiveClientId, loading, refresh }}>
      {children}
    </PortalAccountsContext.Provider>
  );
}

export function usePortalAccounts(): Ctx {
  const ctx = useContext(PortalAccountsContext);
  if (!ctx) throw new Error("usePortalAccounts must be used inside PortalAccountsProvider");
  return ctx;
}

// Back-compat: pages still call this. Now returns the active client from context.
export function usePortalClientId() {
  const ctx = useContext(PortalAccountsContext);
  if (!ctx) {
    // Fallback to legacy single-link query if used outside provider
    const [clientId, setClientId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await (supabase as any)
          .from("client_portal_users")
          .select("client_id")
          .eq("user_id", session.user.id)
          .limit(1)
          .maybeSingle();
        setClientId(data?.client_id ?? null);
        setLoading(false);
      })();
    }, []);
    return { clientId, loading };
  }
  return { clientId: ctx.activeClientId, loading: ctx.loading };
}

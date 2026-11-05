import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCategoryName } from "@/lib/category";
import { usePortalAccounts } from "@/hooks/usePortalClientId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { accentInsensitiveFilter } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Loader2,
} from "lucide-react";
import { CourtMap } from "@/components/CourtMap";
import { RequestReservationDialog } from "@/components/RequestReservationDialog";
import { RequestBookingTimeChangeButton } from "@/components/RequestBookingTimeChangeButton";
import {
  dateISO,
  addDaysISO,
  weekdayOfISO,
  weekdayShort,
  fmtDateBR,
  hourLabel,
  hourEndLabel,
  courtLabel,
  type Booking,
  type FixedSchedule,
} from "@/lib/court-map";
import { AvulsaWaitlistJoinDialog } from "@/components/AvulsaWaitlistJoinDialog";
import { useWaitlistCounts } from "@/hooks/useWaitlistCounts";
import type { PriceBand } from "@/lib/pricing";
import { logPortalBookingFailure } from "@/lib/booking-failure-log";

export const Route = createFileRoute("/portal/reservar")({
  component: PortalReservar,
});

// O client do Supabase só deixa 2 requisições em voo por aba e enfileira
// o resto (ver integrations/supabase/client.ts), com limite de 15s por
// requisição a partir do momento em que ela sai da fila. Estes prazos
// contam também o tempo esperando na fila — ao abrir a tela saem ~10
// consultas juntas (contas, notificações, categoria, 4 do mapa, semana,
// lista de espera). Com prazos curtos (5s/10s/8s), em rede de celular
// mais lenta as consultas estouravam ainda na fila, antes mesmo de chegar
// ao servidor: a categoria dava erro e o mapa não carregava.
const CATEGORY_TIMEOUT_MS = 20_000;
const MAP_TIMEOUT_MS = 40_000;
const MONTH_TIMEOUT_MS = 40_000;

const withTimeout = async <T,>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

function PortalReservar() {
  const { activeClientId, accounts, loading: accountsLoading } = usePortalAccounts();
  const activeAccountName =
    accounts.find((a) => a.clientId === activeClientId)?.fullName ?? "Cliente";

  // Retorno do checkout do Mercado Pago (back_urls) — a confirmação de
  // verdade vem do webhook, isso aqui é só feedback visual imediato pro
  // cliente enquanto a atualização em tempo real do mapa chega.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (!payment) return;
    if (payment === "success") {
      toast.success("Pagamento recebido! Confirmando sua reserva...");
    } else if (payment === "pending") {
      toast.info("Pagamento em processamento. Assim que confirmar, a reserva aparece aqui.");
    } else if (payment === "failure") {
      toast.error("Pagamento não foi concluído. O horário fica livre em alguns minutos.");
    }
    params.delete("payment");
    const rest = params.toString();
    window.history.replaceState({}, "", rest ? `?${rest}` : window.location.pathname);
  }, []);
  const [waDialog, setWaDialog] = useState<{ open: boolean; court: number; hour: number }>({
    open: false,
    court: 1,
    hour: 5,
  });
  const [date, setDate] = useState<string>(dateISO(new Date()));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Preço promocional no mapa: só o cliente cadastrado como AVULSO (ou
  // ainda sem categoria) vê. Mensalista e demais categorias veem
  // o valor normal. O portal não lê client_categories direto (RLS
  // staff-only), então o nome sai da RPC portal_get_category_names — junto
  // com o id da categoria "Avulso", achado entre as categorias das faixas
  // de preço, usado pra precificar quem ainda não tem categoria.
  const [isAvulso, setIsAvulso] = useState(false);
  const [avulsoCategoryId, setAvulsoCategoryId] = useState<string | null>(null);
  // Enquanto a categoria não carregou, o preço mostrado ainda não é o da
  // categoria do cliente — o clique espera a consulta terminar.
  const [categoryLoading, setCategoryLoading] = useState(true);
  // Falha (timeout/erro) ao carregar a categoria é diferente de "ainda
  // carregando": precisa bloquear o clique igual, mas com mensagem própria
  // e opção de tentar de novo.
  const [categoryError, setCategoryError] = useState(false);
  const [priceBands, setPriceBands] = useState<PriceBand[]>([]);
  useEffect(() => {
    const ids = new Set<string>();
    if (categoryId) ids.add(categoryId);
    for (const b of priceBands) for (const id of b.categories ?? []) ids.add(id);
    if (ids.size === 0) {
      setIsAvulso(false);
      setAvulsoCategoryId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("portal_get_category_names", {
        _ids: Array.from(ids),
      });
      if (cancelled) return;
      if (error) {
        console.error("portal category names load failed", error);
        setIsAvulso(false);
        setAvulsoCategoryId(null);
        return;
      }
      const rows = (data ?? []) as Array<{ id: string; name: string }>;
      const avulso = rows.find((c) => normalizeCategoryName(c.name) === "avulso");
      setAvulsoCategoryId(avulso?.id ?? null);
      setIsAvulso(!!categoryId && avulso?.id === categoryId);
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId, priceBands]);
  const [loading, setLoading] = useState(true);
  const [mapStatus, setMapStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [mapError, setMapError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelFixed, setCancelFixed] = useState<{ scheduleId: string; date: string } | null>(null);
  const { forInterval: waitlistLookup } = useWaitlistCounts(date);

  // Reservas da semana do cliente ativo (avulsas + fixas expandidas)
  const [weekStart, setWeekStart] = useState<string>(() => {
    const d = new Date();
    const dow = d.getDay(); // 0=Dom
    d.setDate(d.getDate() - dow);
    return dateISO(d);
  });
  type WeekItem = {
    key: string;
    kind: "booking" | "fixed";
    id: string; // booking id or schedule id
    court: number;
    booking_date: string;
    start_time: string;
    end_time: string;
    guest_name: string | null;
    guest_type: string | null;
    hold_expires_at?: string | null;
  };
  const [weekItems, setWeekItems] = useState<WeekItem[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);

  // Carrega categoria do cliente ativo (define o preço mostrado). Erro/timeout
  // fica marcado em `categoryError` e o clique continua bloqueado até o
  // cliente tentar de novo.
  const loadCategory = useCallback(async (clientId: string, signal: { cancelled: boolean }) => {
    setCategoryLoading(true);
    setCategoryError(false);
    // Uma tentativa extra antes de mostrar erro: no celular, a primeira
    // costuma perder a corrida com as outras consultas da abertura da tela.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { data, error } = await withTimeout(
          supabase
            .from("clients")
            .select("category_id, client_categories(name)")
            .eq("id", clientId)
            .maybeSingle(),
          CATEGORY_TIMEOUT_MS,
          "Tempo esgotado ao carregar a categoria do cliente.",
        );
        if (signal.cancelled) return;
        if (error) throw error;
        setCategoryId(data?.category_id ?? null);
        setCategoryLoading(false);
        return;
      } catch (e) {
        if (signal.cancelled) return;
        console.error(`portal category load failed (tentativa ${attempt})`, e);
      }
    }
    setCategoryId(null);
    setCategoryError(true);
    setCategoryLoading(false);
  }, []);

  useEffect(() => {
    if (!activeClientId) {
      setCategoryId(null);
      setCategoryLoading(false);
      setCategoryError(false);
      return;
    }
    const signal = { cancelled: false };
    loadCategory(activeClientId, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [activeClientId, loadCategory]);

  const load = useCallback(async () => {
    if (!activeClientId) {
      setLoading(false);
      setMapStatus("idle");
      return;
    }
    setLoading(true);
    setMapStatus("loading");
    setMapError(null);
    try {
      const weekday = weekdayOfISO(date);
      const [bRes, sRes, eRes, pRes] = await withTimeout(
        Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc("portal_map_bookings", { _date: date }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc("portal_map_schedules", { _weekday: weekday, _date: date }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc("portal_map_schedule_exceptions", { _date: date, _weekday: weekday }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc("portal_map_price_bands", { _weekday: weekday }),
        ]),
        MAP_TIMEOUT_MS,
        "Tempo esgotado ao carregar o mapa de quadras.",
      );
      const firstError = bRes.error ?? sRes.error ?? eRes.error ?? pRes.error ?? null;
      if (bRes.error) console.error("portal_map_bookings error", bRes.error);
      if (sRes.error) console.error("portal_map_schedules error", sRes.error);
      if (eRes.error) console.error("portal_map_schedule_exceptions error", eRes.error);
      if (pRes.error) console.error("price_table error", pRes.error);
      if (firstError) throw firstError;
      setPriceBands((pRes.data ?? []) as unknown as PriceBand[]);
      const scheds = ((sRes.data as FixedSchedule[] | null) ?? []) as FixedSchedule[];
      const exceptions = ((eRes.data as unknown as {
        id: string;
        client_schedule_id: string;
        reason: string | null;
        start_time: string | null;
        end_time: string | null;
      }[] | null) ?? []);
      const excBy = new Map<string, typeof exceptions>();
      for (const e of exceptions) {
        const arr = excBy.get(e.client_schedule_id) ?? [];
        arr.push(e);
        excBy.set(e.client_schedule_id, arr);
      }
      const merged = scheds.map((s) => ({
        ...s,
        exceptions: (excBy.get(s.id) ?? []).map((e) => ({
          id: e.id,
          start_time: e.start_time,
          end_time: e.end_time,
          reason: e.reason,
        })),
      }));
      const rawBookings = ((bRes.data as unknown as (Booking & { category_name?: string | null })[] | null) ?? []);
      setBookings(rawBookings.map((b) => ({ ...b, category_name: b.category_name ?? null })));
      setFixed(merged);
      setMapStatus("success");
    } catch (e) {
      console.error("portal reservar load failed", e);
      logPortalBookingFailure({
        clientId: activeClientId,
        bookingDate: date,
        stage: "carregamento",
        message: e instanceof Error ? e.message : "Não foi possível carregar o mapa de quadras.",
      });
      setMapStatus("error");
      setMapError(e instanceof Error ? e.message : "Não foi possível carregar o mapa de quadras.");
      toast.error("Não foi possível carregar o mapa de quadras.");
    } finally {
      setLoading(false);
    }
  }, [date, activeClientId]);

  useEffect(() => {
    load();
  }, [load]);

  // Lista de espera do próprio usuário agora vem de useWaitlistCounts (`mine`).


  const cancelBooking = async () => {
    if (!cancelId) return;
    const { error } = await (supabase as any).rpc("portal_cancel_booking", {
      _booking_id: cancelId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reserva cancelada");
    setCancelId(null);
    load();
    loadMonth();
  };

  const loadMonth = useCallback(async () => {
    if (!activeClientId) return;
    setMonthLoading(true);
    try {
      const weekEnd = addDaysISO(weekStart, 6);
      const [bRes, sRes, eRes] = await withTimeout(
        Promise.all([
          supabase
            .from("court_bookings")
            .select("id, court, booking_date, start_time, end_time, guest_name, guest_type, cancelled_at, client_id, hold_expires_at")
            .eq("client_id", activeClientId)
            .is("cancelled_at", null)
            .gte("booking_date", weekStart)
            .lte("booking_date", weekEnd)
            .order("booking_date", { ascending: true })
            .order("start_time", { ascending: true }),
          supabase
            .from("client_schedules")
            .select("id, court, weekday, start_time, end_time, valid_from, valid_until")
            .eq("client_id", activeClientId),
          supabase
            .from("client_schedule_exceptions")
            .select("client_schedule_id, exception_date, range_end, start_time, end_time")
            .lte("exception_date", addDaysISO(weekStart, 6))
            .or(`range_end.gte.${weekStart},and(range_end.is.null,exception_date.gte.${weekStart})`),
        ]),
        MONTH_TIMEOUT_MS,
        "Tempo esgotado ao carregar suas reservas.",
      );
      if (bRes.error) throw bRes.error;
      if (sRes.error) throw sRes.error;
      if (eRes.error) throw eRes.error;
      const items: WeekItem[] = [];
      for (const b of ((bRes.data ?? []) as unknown as WeekItem[])) {
        items.push({ ...b, key: `b-${b.id}`, kind: "booking", id: b.id });
      }
      type ExRow = {
        client_schedule_id: string;
        exception_date: string;
        range_end: string | null;
        start_time: string | null;
        end_time: string | null;
      };
      const excRows = ((eRes.data ?? []) as ExRow[]);
      const isFullDayCancelledOn = (schedId: string, iso: string) =>
        excRows.some(
          (e) =>
            e.client_schedule_id === schedId &&
            e.start_time === null &&
            e.end_time === null &&
            e.exception_date <= iso &&
            (e.range_end ?? e.exception_date) >= iso,
        );
      type Sched = { id: string; court: number; weekday: number; start_time: string; end_time: string; valid_from: string | null; valid_until: string | null };
      const scheds = ((sRes.data ?? []) as Sched[]);
      for (let i = 0; i < 7; i++) {
        const d = addDaysISO(weekStart, i);
        const wd = weekdayOfISO(d);
        for (const s of scheds) {
          if (s.weekday !== wd) continue;
          if (s.valid_from && d < s.valid_from) continue;
          if (s.valid_until && d > s.valid_until) continue;
          if (isFullDayCancelledOn(s.id, d)) continue;
          items.push({
            key: `s-${s.id}-${d}`,
            kind: "fixed",
            id: s.id,
            court: s.court,
            booking_date: d,
            start_time: s.start_time,
            end_time: s.end_time,
            guest_name: null,
            guest_type: null,
          });
        }
      }
      items.sort((a, b) =>
        a.booking_date === b.booking_date
          ? a.start_time.localeCompare(b.start_time)
          : a.booking_date.localeCompare(b.booking_date),
      );
      setWeekItems(items);
    } catch (e) {
      console.error("portal month load failed", e);
      setWeekItems([]);
    } finally {
      setMonthLoading(false);
    }
  }, [activeClientId, weekStart]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  // Realtime: refletir mudanças feitas por staff (cancelamento, troca de quadra, novas reservas)
  useEffect(() => {
    if (!activeClientId) return;
    const channel = supabase
      .channel(`portal-my-bookings-${activeClientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "court_bookings", filter: `client_id=eq.${activeClientId}` },
        () => {
          loadMonth();
          load();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "client_schedule_exceptions" },
        () => {
          loadMonth();
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeClientId, loadMonth, load]);

  const weekLabel = (() => {
    const end = addDaysISO(weekStart, 6);
    const [, sm, sd] = weekStart.split("-");
    const [, em, ed] = end.split("-");
    return `${sd}/${sm} — ${ed}/${em}`;
  })();

  const shiftWeek = (delta: number) => {
    setWeekStart(addDaysISO(weekStart, delta * 7));
  };


  if (accountsLoading) {
    return (
      <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando contas...
      </div>
    );
  }

  if (!activeClientId) {
    return (
      <div className="py-8 flex flex-col items-center justify-center gap-3 text-center text-sm">
        {accounts.length > 0 ? (
          <>
            <div className="font-medium">Não foi possível identificar o cadastro vinculado a esta conta.</div>
            <Button variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button>
          </>
        ) : (
          <div className="text-muted-foreground">Nenhuma conta de cliente vinculada ao seu usuário.</div>
        )}
      </div>
    );
  }

  return (

    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
        <Card className="order-1 lg:order-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Minhas reservas</CardTitle>
            <div className="flex items-center gap-1 pt-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftWeek(-1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="flex-1 text-center text-xs font-medium">{weekLabel}</div>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftWeek(1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[560px] overflow-y-auto">
            {monthLoading ? (
              <div className="py-4 flex items-center justify-center text-muted-foreground text-xs">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
              </div>
            ) : weekItems.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Sem reservas nesta semana
              </div>
            ) : (
              weekItems.map((b) => {
                const h = Number(b.start_time.slice(0, 2));
                const hEnd = Number(b.end_time.slice(0, 2));
                const wd = weekdayOfISO(b.booking_date);
                const [, mm, dd] = b.booking_date.split("-");
                return (
                  <div
                    key={b.key}
                    className="rounded-md border p-2 text-xs space-y-0.5"
                  >
                    <div className="font-medium capitalize flex items-center gap-1">
                      <span>{weekdayShort[wd]}, {dd}/{mm}</span>
                      {b.kind === "fixed" && (
                        <span className="text-[10px] px-1 rounded bg-primary/10 text-primary">fixa</span>
                      )}
                    </div>
                    {b.kind === "booking" && b.hold_expires_at && (
                      <div className="inline-flex items-center gap-1 rounded-full border-2 border-amber-700 bg-amber-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-950 dark:border-amber-400 dark:bg-amber-600 dark:text-amber-50">
                        ⏳ Aguardando pagamento — a quadra ainda pode ser liberada se não confirmar
                      </div>
                    )}
                    <div className="text-muted-foreground">
                      {hourLabel(h)}–{hourLabel(hEnd)} • {courtLabel(b.court)}
                    </div>
                    {b.guest_name && (
                      <div className="text-muted-foreground truncate">
                        com {b.guest_name}
                        {b.guest_type ? ` (${b.guest_type})` : ""}
                      </div>
                    )}
                    {b.kind === "booking" && b.booking_date >= dateISO(new Date()) && (
                      <div className="pt-1">
                        <RequestBookingTimeChangeButton
                          bookingId={b.id}
                          bookingDate={b.booking_date}
                          court={b.court}
                          startTime={b.start_time}
                          endTime={b.end_time}
                          size="sm"
                          className="h-6 px-2 text-[11px] w-full"
                          onRequested={() => loadMonth()}
                        />
                      </div>
                    )}
                    <div className="pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] w-full"
                        onClick={() =>
                          b.kind === "fixed"
                            ? setCancelFixed({ scheduleId: b.id, date: b.booking_date })
                            : setCancelId(b.id)
                        }
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>Disponibilidade de quadras</CardTitle>
            <AvulsaWaitlistJoinDialog
              variant="client"
              clientId={activeClientId ?? undefined}
              buttonLabel="Lista de espera"
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {categoryError && !categoryLoading && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-center justify-between gap-2 flex-wrap">
                <span>
                  Não foi possível confirmar sua categoria de cliente. Enquanto isso, a
                  reserva fica bloqueada.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (activeClientId) loadCategory(activeClientId, { cancelled: false });
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            )}
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {categoryLoading ? (
                <>Carregando dados da sua conta...</>
              ) : categoryError ? (
                <>
                  Assim que sua categoria for confirmada, as instruções de
                  reserva aparecem aqui.
                </>
              ) : (
                <>
                  Clique em um horário <strong>Disponível</strong> para
                  solicitar a reserva pelo WhatsApp oficial da Stadium
                  Rackets. A reserva só é confirmada após a secretaria
                  responder. Horário ocupado? Use o botão{" "}
                  <strong>Lista de espera</strong> acima.
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="icon" onClick={() => setDate(addDaysISO(date, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-auto"
              />
              <Button variant="outline" size="icon" onClick={() => setDate(addDaysISO(date, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDate(dateISO(new Date()))}>
                <CalendarDays className="h-4 w-4 mr-2" /> Hoje
              </Button>
              <div className="ml-auto text-sm text-muted-foreground">
                {weekdayShort[weekdayOfISO(date)]}, {fmtDateBR(date)}
              </div>
            </div>

            {loading || mapStatus === "loading" ? (
              <div className="py-8 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
              </div>
            ) : mapStatus === "error" ? (
              <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
                <div>
                  <div className="font-medium">Não foi possível carregar o mapa de quadras.</div>
                  {mapError && <div className="text-sm text-muted-foreground mt-1">{mapError}</div>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => load()}>Tentar novamente</Button>
                  <Button variant="ghost" onClick={() => window.location.assign("/portal/perfil")}>Voltar ao Perfil</Button>
                </div>
              </div>
            ) : (
              <div>
              <CourtMap
                bookings={bookings}
                fixedSchedules={fixed}
                highlightAvailability
                enforceOnlineHours
                hideOccupantDetails
                ownClientId={activeClientId}
                priceBands={priceBands}
                priceCategoryId={categoryId}
                date={date}
                includePromo={
                  !!activeClientId && !categoryLoading && !categoryError && (isAvulso || categoryId == null)
                }
                onlinePromoCategoryId={avulsoCategoryId}
                stickyHeader={false}
                waitlistLookup={waitlistLookup}
                onCellClick={(court, hour, cell) => {
                  if (
                    cell.kind === "booking" &&
                    cell.booking &&
                    !cell.booking.cancelled_at &&
                    cell.booking.client_id === activeClientId
                  ) {
                    setCancelId(cell.booking.id);
                    return;
                  }
                  const isAvailable =
                    cell.kind === "empty" ||
                    (cell.kind === "fixed" && !!cell.cancelledException) ||
                    (cell.kind === "booking" && !!cell.booking?.cancelled_at);
                  if (!isAvailable) {
                    // Célula ocupada — clicar não abre mais a lista de espera
                    // (fluxo antigo). Use o botão "Lista de espera" acima.
                    toast.info('Horário ocupado. Use o botão "Lista de espera" para entrar na fila.');
                    return;
                  }
                  if (categoryLoading) {
                    toast.info("Carregando dados da sua conta, aguarde um instante e tente de novo.");
                    return;
                  }
                  if (categoryError) {
                    // Consulta de categoria falhou (timeout/erro).
                    logPortalBookingFailure({
                      clientId: activeClientId,
                      bookingDate: date,
                      court,
                      startHour: hour,
                      stage: "categoria",
                      message: "Não foi possível confirmar a categoria do cliente.",
                    });
                    toast.error(
                      "Não foi possível confirmar sua categoria de cliente. Toque em \"Tentar novamente\" acima e refaça a reserva.",
                    );
                    return;
                  }
                  // Reserva pelo portal: solicitação via WhatsApp / pagamento online.
                  setWaDialog({ open: true, court, hour });
                }}
              />

              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RequestReservationDialog
        open={waDialog.open}
        onClose={() => setWaDialog((d) => ({ ...d, open: false }))}
        court={waDialog.court}
        hour={waDialog.hour}
        date={date}
        userName={activeAccountName}
        userRole="Cliente"
        clientId={activeClientId}
      />

      <Dialog open={!!cancelId} onOpenChange={(v) => !v && setCancelId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar reserva?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Esta ação libera a quadra para outros clientes. Na quadra de tênis, cancelamentos com menos de 24h de antecedência são cobrados.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelId(null)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={cancelBooking}>
              Cancelar reserva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelFixed} onOpenChange={(v) => !v && setCancelFixed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar aula fixa deste dia?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            O cancelamento vale apenas para esta data. Sua aula fixa continua nas próximas semanas.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelFixed(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!cancelFixed) return;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any).rpc("portal_cancel_fixed_schedule", {
                  _schedule_id: cancelFixed.scheduleId,
                  _date: cancelFixed.date,
                  _reason: "Cancelado pelo cliente",
                });
                if (error) {
                  toast.error(error.message);
                  return;
                }
                toast.success("Aula cancelada para este dia");
                setCancelFixed(null);
                loadMonth();
                load();
              }}
            >
              Cancelar aula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

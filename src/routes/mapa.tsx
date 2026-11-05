import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/hooks/useAuth";
import { normalizeCategoryName } from "@/lib/category";
import { NotificationsProvider } from "@/hooks/useNotifications";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Loader2,
  Tv,
  LogOut,
  AlertTriangle,
  Search,
  RefreshCw,
  Repeat,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { offerBookingCancelledNotification } from "@/lib/whatsapp";
import { CourtMap, type CourtCell } from "@/components/CourtMap";
import { MapaTVStandalone } from "@/components/MapaTVStandalone";
import { CourtBookingDialog } from "@/components/CourtBookingDialog";
import {
  ScheduleAttendanceDialog,
  type AttendanceRow,
  type ClientAttendanceInfo,
} from "@/components/ScheduleAttendanceDialog";
import { AvailabilitySearchDialog } from "@/components/AvailabilitySearchDialog";
import { FixedAvailabilitySearchDialog } from "@/components/FixedAvailabilitySearchDialog";
import { AvailabilityOverrideDialog, type AvailabilityOverride } from "@/components/AvailabilityOverrideDialog";
import { RacketLoansPanel } from "@/components/RacketLoansPanel";
import { StaffWaitlistAddDialog } from "@/components/StaffWaitlistAddDialog";
import { RequestReservationDialog } from "@/components/RequestReservationDialog";
import { TeacherDirectBookingDialog } from "@/components/TeacherDirectBookingDialog";
import {
  TeacherClientChangeDialog,
  type TeacherClientChangeTarget,
} from "@/components/TeacherClientChangeDialog";
import { ConflictResolveDialog, type ConflictEntry as ResolveEntry } from "@/components/ConflictResolveDialog";
import { WaitlistQueueDialog, type WaitlistQueueTarget } from "@/components/WaitlistQueueDialog";
import { useWaitlistCounts } from "@/hooks/useWaitlistCounts";
import { FixedWaitlistJoinDialog } from "@/components/FixedWaitlistJoinDialog";
import { FixedWaitlistMyEntries } from "@/components/FixedWaitlistMyEntries";
import { AvulsaWaitlistJoinDialog } from "@/components/AvulsaWaitlistJoinDialog";
import { AvulsaWaitlistMyEntries } from "@/components/AvulsaWaitlistMyEntries";
import { TeacherMyClientsTab } from "@/components/TeacherMyClientsTab";
import {
  dateISO,
  addDaysISO,
  weekdayOfISO,
  weekdayShort,
  fmtDateBR,
  courtLabel,
  hourLabel,
  timeToHours,
  hoursToLabel,
  findFixedExceptionForHour,
  isMovedFromFixedBooking,
  type Booking,
  type FixedSchedule,
  type FixedException,
  courtShort,
} from "@/lib/court-map";
import { fetchOpenDebtByClient } from "@/lib/open-debt";
import { useLiveReload } from "@/lib/live-reload";
import type { PriceBand } from "@/lib/pricing";
import {
  COURT_MAP_LIVE_TABLES,
  MOVED_FROM_FIXED_NOTES_RE,
  computeAttendanceByBookingId,
  computeAttendanceByScheduleId,
  computeMovedFixedScheduleByBookingId,
  fetchCourtMapData,
  fetchWaitlistEntries,
  waitlistLookupFor,
} from "@/lib/court-map-data";
import {
  isBillableFixed,
  type AttendanceStatus,
} from "@/lib/attendance-billing";

export const Route = createFileRoute("/mapa")({
  component: MapaRoute,
});

// Guarda a data selecionada no mapa entre reloads da página — sem isso,
// atualizar a página enquanto navegava numa data futura/passada voltava
// sempre pra hoje, perdendo o lugar.
const MAPA_DATE_STORAGE_KEY = "sr_mapa_date";

function getStoredMapDate(): string {
  if (typeof window === "undefined") return dateISO(new Date());
  try {
    const saved = window.localStorage.getItem(MAPA_DATE_STORAGE_KEY);
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
  } catch {
    // localStorage indisponível (modo privado, etc.) — cai no dia de hoje.
  }
  return dateISO(new Date());
}

function MapaRoute() {
  const location = useLocation();
  const { isProfessor, isVisualizador, loading } = useAuth();

  if (location.pathname === "/mapa/tv") {
    return <MapaTVStandalone />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isProfessor) {
    return <MapaProfessorRoute />;
  }

  // Visualizador: só enxerga o mapa (com nomes das locações), sem nenhuma
  // ação — não clica em célula, não solicita nada. Rota própria em vez de
  // reaproveitar MapaPage porque lá toda a interação (handleCell) assume um
  // papel de staff com permissão de escrever.
  if (isVisualizador) {
    return <VisualizadorMapRoute />;
  }

  return (
    <RequireAuth pageKey="mapa">
      <MapaPage />
    </RequireAuth>
  );
}

function VisualizadorMapRoute() {
  const navigate = useNavigate();
  const signOut = async () => {
    const { getLogoutReturnPath, clearPortalOrigin } = await import("@/lib/portal-origin");
    const target = getLogoutReturnPath();
    await supabase.auth.signOut();
    clearPortalOrigin();
    navigate({ to: target });
  };
  return <VisualizadorMapPage onSignOut={signOut} />;
}

// Só leitura: mapa de quadras com nomes das locações, sem nenhum onClick nem
// dialog de operação (CourtMap com readOnly e sem onCellClick já não chama
// nada ao clicar numa célula). Busca só o necessário pra desenhar o mapa —
// sem preço, disponibilidade manual ou fila de espera, que são detalhes
// operacionais que este papel não usa.
function VisualizadorMapPage({ onSignOut }: { onSignOut: () => void }) {
  const [date, setDate] = useState<string>(getStoredMapDate);
  useEffect(() => {
    try {
      window.localStorage.setItem(MAPA_DATE_STORAGE_KEY, date);
    } catch {
      // localStorage indisponível — só não persiste entre reloads.
    }
  }, [date]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    const weekday = weekdayOfISO(d);
    // RPCs SECURITY DEFINER (mesmo padrão já usado pra professor/
    // portal) em vez de select direto nas tabelas: `clients` e
    // `client_categories` são staff-only (cli_select_staff/cat_select_staff),
    // então um embed tipo clients!client_id(...) sempre voltava vazio pra
    // quem não é staff — sumindo nome do cliente e cor de categoria no
    // mapa do visualizador. As RPCs fazem os joins por dentro,
    // com acesso total (SECURITY DEFINER), e devolvem só os campos usados
    // pelo mapa.
    const [bRes, sRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("visualizador_map_bookings", { _date: d }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("visualizador_map_schedules", { _weekday: weekday, _date: d }),
    ]);
    // Sem isso, um erro na RPC (função ainda não existe, permissão negada
    // etc.) fica em silêncio — o mapa só aparece vazio, sem pista nenhuma
    // do motivo. Mostra o erro de verdade em vez de fingir que não tem
    // locação nenhuma no dia.
    if (bRes.error) toast.error(`Falha ao carregar locações: ${bRes.error.message}`);
    if (sRes.error) toast.error(`Falha ao carregar horários fixos: ${sRes.error.message}`);

    const enrichedBookings: Booking[] = (bRes.data ?? []) as unknown as Booking[];

    const scheds = (sRes.data ?? []) as FixedSchedule[];
    const scheduleIds = scheds.map((s) => s.id);
    let exceptions: {
      id: string;
      client_schedule_id: string;
      reason: string | null;
      start_time: string | null;
      end_time: string | null;
      created_by: string | null;
      created_at: string | null;
    }[] = [];
    if (scheduleIds.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eRes = await (supabase as any).rpc("visualizador_map_schedule_exceptions", {
        _date: d,
        _weekday: weekday,
      });
      if (eRes.error) toast.error(`Falha ao carregar cancelamentos: ${eRes.error.message}`);
      exceptions = (eRes.data ?? []) as typeof exceptions;
    }
    const excByScheduleId = new Map<string, typeof exceptions>();
    for (const e of exceptions) {
      const arr = excByScheduleId.get(e.client_schedule_id) ?? [];
      arr.push(e);
      excByScheduleId.set(e.client_schedule_id, arr);
    }
    const merged = scheds.map((s) => {
      return {
        ...s,
        exceptions: (excByScheduleId.get(s.id) ?? []).map((e) => ({
          id: e.id,
          start_time: e.start_time,
          end_time: e.end_time,
          reason: e.reason,
          created_by: e.created_by,
          created_at: e.created_at,
        })),
      };
    });

    setBookings(enrichedBookings);
    setFixed(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
              V
            </div>
            <span>Mapa de quadras</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDate(addDaysISO(date, -1))}
            aria-label="Dia anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDate(addDaysISO(date, 1))}
            aria-label="Próximo dia"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(dateISO(new Date()))}>
            <CalendarDays className="h-4 w-4 mr-2" /> Hoje
          </Button>
          <div className="ml-auto text-sm text-muted-foreground">
            {weekdayShort[weekdayOfISO(date)]}, {fmtDateBR(date)}
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 px-2 sm:px-6">
            {loading ? (
              <div className="py-16 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mapa...
              </div>
            ) : (
              <div className="-mx-2 sm:mx-0 [--map-sticky-top:3.5rem] md:[--map-sticky-top:0px]">
                <CourtMap bookings={bookings} fixedSchedules={fixed} date={date} readOnly />
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function MapaPage() {
  const { user, isAdmin, isDiretoria, isRecepcionista, canSeeDebt } = useAuth();
  const canManageAvailability = isAdmin || isDiretoria || isRecepcionista;
  const [date, setDate] = useState<string>(getStoredMapDate);
  useEffect(() => {
    try {
      window.localStorage.setItem(MAPA_DATE_STORAGE_KEY, date);
    } catch {
      // localStorage indisponível — só não persiste entre reloads.
    }
  }, [date]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  const [priceBands, setPriceBands] = useState<PriceBand[]>([]);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Depois do primeiro carregamento, atualizações (manuais ou via realtime)
  // não trocam o mapa inteiro por um spinner — evita o salto de altura que
  // jogava a rolagem da página de volta para o topo a cada atualização.
  const hasLoadedOnceRef = useRef(false);
  const [dialog, setDialog] = useState<{
    open: boolean;
    court: number;
    hour: number;
    existing: Booking | null;
    existingFixed: FixedSchedule | null;
    previous: {
      clientName: string;
      kind: string;
      cancelledBy?: string;
      reason?: string | null;
      reactivateBookingId?: string | null;
      reactivateExceptionScheduleId?: string | null;
      isHold?: boolean;
    } | null;
  }>({
    open: false,
    court: 1,
    hour: 5,
    existing: null,
    existingFixed: null,
    previous: null,
  });
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  // Ids de court_bookings avulsas com pagamento lançado no caixa — selo "$"
  // no mapa, igual ao "V" que os fixos já têm quando marcados como Veio.
  const [paidBookingIds, setPaidBookingIds] = useState<Set<string>>(new Set());
  const [onlinePaidBookingIds, setOnlinePaidBookingIds] = useState<Set<string>>(new Set());
  const [clientInfo, setClientInfo] = useState<Record<string, ClientAttendanceInfo>>({});
  const [mensalistaCategoryId, setMensalistaCategoryId] = useState<string | null>(null);
  // Categoria "Avulso": base do aviso de preço promocional online no mapa.
  const [avulsoCategoryId, setAvulsoCategoryId] = useState<string | null>(null);
  const [attendanceDialog, setAttendanceDialog] = useState<{
    open: boolean;
    hour: number;
    court: number;
    scheduleId: string | null;
    // Janela real de hoje quando esta presença veio de uma locação "movida
    // do fixo" (ver handleCell) cuja duração foi alterada no "Mover só
    // hoje" (ex.: esticada pra caber 1h a mais) — sobrepõe o horário
    // (start/end) do fixo original só pra esta marcação de presença, sem
    // tocar no client_schedule recorrente.
    movedWindow?: { start: string; end: string } | null;
    // Ids dos client_schedules originais de quem mais dividia a quadra/
    // horário ANTES do "Mover só hoje" (ver movedFixedGroupByBookingId) —
    // sem isso, a presença/cobrança deste horário movido enxergava só o
    // client_schedule líder (quem foi clicado pra mover) como ocupante
    // sozinho da quadra de destino, cobrando o valor cheio dele em vez de
    // dividir com quem também foi movido junto (mesmo grupo, mesma
    // court_booking + participante, por causa do índice único de
    // court_bookings — ver move_fixed_today na migration 20261007120000).
    movedGroupSiblingIds?: string[];
    // Id da court_booking "movida do fixo" por trás desta célula e os
    // client_ids de quem entrou nela como participante extra (não dono),
    // por causa do índice único de court_bookings — ver
    // move_fixed_today (migration 20261007120000). Repassado ao diálogo pra
    // ele saber tirar um participante de court_booking_participants ao
    // cancelar (o participante não tem court_booking própria pra
    // atualizar sozinho).
    movedBookingId?: string | null;
    movedParticipantClientIds?: string[];
  }>({ open: false, hour: 5, court: 1, scheduleId: null, movedWindow: null });
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [fixedAvailabilityOpen, setFixedAvailabilityOpen] = useState(false);
  const [availOverrides, setAvailOverrides] = useState<AvailabilityOverride[]>([]);
  const [overrideDialog, setOverrideDialog] = useState<{ open: boolean; court: number | null; hour: number | null }>({ open: false, court: null, hour: null });
  const [resolveConflict, setResolveConflict] = useState<{ open: boolean; entry: ResolveEntry | null; groupKey: string | null }>({ open: false, entry: null, groupKey: null });
  const [dismissedConflictKeys, setDismissedConflictKeys] = useState<Set<string>>(new Set());
  const [waitlistEntries, setWaitlistEntries] = useState<
    Array<{ court: number; start: string; end: string; cnt: number }>
  >([]);
  const [waitlistTarget, setWaitlistTarget] = useState<WaitlistQueueTarget | null>(null);
  // Selo "💰 R$ X" no mapa: todo cliente negativo (fora as exceções),
  // recarregado junto com o mapa — assim, depois de receber o débito no
  // caixa, o selo some no próximo refresh.
  const [openDebtByClient, setOpenDebtByClient] = useState<Record<string, number>>({});
  // Só recepção e diretoria veem o selo — admin "puro" e demais papéis não.
  // Quem tem a inadimplência bloqueada (user_permissions) também não vê.
  const showOpenDebt = (isRecepcionista || isDiretoria) && canSeeDebt;
  const loadOpenDebt = useCallback(async () => {
    if (!showOpenDebt) {
      setOpenDebtByClient({});
      return;
    }
    const map = await fetchOpenDebtByClient();
    const flat: Record<string, number> = {};
    for (const [id, d] of Object.entries(map)) flat[id] = d.debt;
    setOpenDebtByClient(flat);
  }, [showOpenDebt]);

  const load = useCallback(async () => {
    setLoading(true);
    setDismissedConflictKeys(new Set());
    // Mesma consulta do Modo TV (ver court-map-data.ts) — o que aparece
    // aqui aparece igual lá.
    const [core, catsRes] = await Promise.all([
      fetchCourtMapData(date),
      mensalistaCategoryId == null
        ? supabase.from("client_categories").select("id, name")
        : Promise.resolve(null),
    ]);
    const { exceptions, fixed: merged } = core;
    const scheds = merged;
    const scheduleIds = scheds.map((s) => s.id);
    const cliRes = scheduleIds.length
      ? await supabase
          .from("clients")
          .select("id, full_name, default_discount_percent, client_categories(name)")
          .in("id", Array.from(new Set(scheds.map((s) => s.client_id).filter(Boolean))))
      : { data: [] };
    setAvailOverrides(core.availOverrides);
    setPriceBands(core.priceBands);
    const bs = core.bookings;
    setBookings(bs);
    setFixed(merged);
    setPaidBookingIds(core.paidBookingIds);
    setOnlinePaidBookingIds(core.onlinePaidBookingIds);
    void loadOpenDebt();

    // Se o diálogo de detalhes estiver aberto, atualiza o snapshot que ele
    // guarda (existing/existingFixed) com os dados recém-carregados — sem
    // isso, ações que mantêm o diálogo aberto (trocar jogador, participante,
    // boleiro) atualizam o banco mas a tela só refletia a mudança depois de
    // fechar e reabrir o diálogo.
    setDialog((d) => {
      if (!d.open) return d;
      const freshExisting = d.existing ? (bs.find((b) => b.id === d.existing!.id) ?? d.existing) : d.existing;
      const freshFixed = d.existingFixed
        ? (merged.find((s) => s.id === d.existingFixed!.id) ?? d.existingFixed)
        : d.existingFixed;
      if (freshExisting === d.existing && freshFixed === d.existingFixed) return d;
      return { ...d, existing: freshExisting, existingFixed: freshFixed };
    });

    // Presenças do dia + info dos clientes dos fixos (para desconto).
    if (scheduleIds.length) {
      setAttendanceRows(core.attendanceRows);
      const cinfo: Record<string, ClientAttendanceInfo> = {};
      for (const c of (cliRes.data ?? []) as Array<{
        id: string;
        full_name: string;
        default_discount_percent: number | null;
        client_categories: { name: string } | { name: string }[] | null;
      }>) {
        const cat = Array.isArray(c.client_categories)
          ? c.client_categories[0]
          : c.client_categories;
        cinfo[c.id] = {
          id: c.id,
          full_name: c.full_name,
          default_discount_percent: c.default_discount_percent,
          category_name: cat?.name ?? null,
        };
      }
      setClientInfo(cinfo);
    } else {
      setAttendanceRows([]);
      setClientInfo({});
    }

    // Categoria "Mensalista" no caixa (para inserir o pagamento).
    if (catsRes) {
      const catsList = (catsRes.data ?? []) as { id: string; name: string }[];
      const found = catsList.find(
        (c) =>
          c.name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim() === "mensalista",
      );
      setMensalistaCategoryId(found?.id ?? null);
      setAvulsoCategoryId(catsList.find((c) => normalizeCategoryName(c.name) === "avulso")?.id ?? null);
    }

    // Autor: quem marcou / cancelou.
    const userIds = new Set<string>();
    for (const b of bs) {
      if (b.created_by) userIds.add(b.created_by);
      if (b.cancelled_by) userIds.add(b.cancelled_by);
    }
    for (const e of exceptions) if (e.created_by) userIds.add(e.created_by);
    for (const s of merged) if (s.created_by) userIds.add(s.created_by);
    if (userIds.size) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(userIds));
      const map: Record<string, string> = {};
      for (const p of profs ?? []) {
        map[p.id as string] = (p.full_name as string) || "—";
      }
      setAuthorNames(map);
    } else {
      setAuthorNames({});
    }
    setLoading(false);
    hasLoadedOnceRef.current = true;
  }, [date, mensalistaCategoryId, loadOpenDebt]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: recarrega automaticamente quando bookings ou exceções mudarem
  // (agrupando rajadas de eventos e recuperando eventos perdidos quando a
  // conexão cai — ver lib/live-reload.ts).
  // Também usada depois de salvar no diálogo: assim a recarga do "salvar" e
  // as do realtime (que chegam junto) viram UMA só, em vez de várias
  // recargas completas disputando a fila de requisições.
  const reloadLive = useLiveReload(load, {
    channel: "mapa_live",
    tables: [...COURT_MAP_LIVE_TABLES],
  });

  // Locação recém-criada no diálogo entra no mapa na hora; a recarga
  // completa logo em seguida substitui pelos dados do banco.
  const addCreatedBooking = useCallback((b: Booking) => {
    setBookings((prev) => (prev.some((x) => x.id === b.id) ? prev : [...prev, b]));
  }, []);

  // Contadores da lista de espera do dia (staff) — fila é por HORÁRIO.
  const loadWaitlistCounts = useCallback(async () => {
    setWaitlistEntries((await fetchWaitlistEntries(date)) ?? []);
  }, [date]);

  const waitlistLookup = useMemo(() => waitlistLookupFor(waitlistEntries), [waitlistEntries]);

  useEffect(() => {
    void loadWaitlistCounts();
    const channel = supabase
      .channel(`mapa_waitlist_${date}_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "court_waitlist" },
        () => { void loadWaitlistCounts(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waitlist_acknowledgements" },
        () => { void loadWaitlistCounts(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadWaitlistCounts, date]);




  const attendanceByScheduleId = useMemo(
    () => computeAttendanceByScheduleId(attendanceRows),
    [attendanceRows],
  );

  // Mapeia locações "movidas do fixo" para o schedule original (mesmo cliente/weekday).
  // Se houver múltiplos fixos do cliente no dia, prioriza o que casa com court/horário
  // originais parseados do texto de `notes`.
  const movedFixedScheduleByBookingId = useMemo(
    () => computeMovedFixedScheduleByBookingId(bookings, fixed, date),
    [bookings, fixed, date],
  );

  // Grupo INTEIRO (todos os client_schedules originais, não só o líder) por
  // trás de cada locação "movida do fixo" — usado pra dividir a cobrança
  // corretamente quando uma quadra dividida por 2+ fixos é movida junto.
  // "Mover só hoje" materializa o grupo inteiro numa quadra nova, mas quando
  // dois (ou mais) caem no MESMO horário exato, o índice único de
  // court_bookings só permite UMA linha por (quadra, data, horário) — o
  // resto entra como participante extra da mesma locação, não como uma
  // court_booking própria (ver move_fixed_today na migration 20261007120000).
  // Sem isto, a presença/cobrança dessa locação só enxergava o líder (quem
  // foi clicado pra mover) como client_schedule ocupante, cobrando o valor
  // cheio dele e deixando quem mais dividia a quadra sem cobrança nenhuma —
  // em vez de dividir os dois como sempre foi (reportado: "quando movi pra
  // Q2 só cobrou do Gustavo, mas é pra dividir com o Alexandre"). O grupo é
  // recuperado batendo (dia da semana, quadra/horário ORIGINAIS — os
  // mesmos parseados de `notes` acima) contra todos os fixos de hoje, não só
  // os do cliente da locação: é exatamente o mesmo critério usado ao mover
  // (fetchUnmovedFixedGroup), e todo o grupo compartilhava esse
  // court/horário original antes do movimento.
  const movedFixedGroupByBookingId = useMemo(() => {
    const map: Record<string, FixedSchedule[]> = {};
    const wd = weekdayOfISO(date);
    const notesRe = MOVED_FROM_FIXED_NOTES_RE;
    for (const b of bookings) {
      if (b.cancelled_at) continue;
      if (!isMovedFromFixedBooking(b)) continue;
      const m = typeof b.notes === "string" ? b.notes.match(notesRe) : null;
      if (!m) continue;
      const [, courtStr, startStr, endStr] = m;
      const origCourt = Number(courtStr);
      const group = fixed.filter(
        (s) =>
          s.weekday === wd &&
          s.court === origCourt &&
          s.start_time.slice(0, 5) === startStr &&
          s.end_time.slice(0, 5) === endStr,
      );
      if (group.length > 0) map[b.id] = group;
    }
    return map;
  }, [bookings, fixed, date]);

  const attendanceByBookingId = useMemo(
    () => computeAttendanceByBookingId(attendanceRows, movedFixedScheduleByBookingId),
    [attendanceRows, movedFixedScheduleByBookingId],
  );

  const attendanceForSchedule = (scheduleId: string | null): AttendanceRow | null =>
    scheduleId ? attendanceRows.find((a) => a.client_schedule_id === scheduleId) ?? null : null;

  const siblingsAtSlot = (
    scheduleId: string | null,
    court: number,
    hour: number,
  ): { schedule: FixedSchedule; status: AttendanceStatus | null }[] => {
    if (!scheduleId) return [];
    return fixed
      .filter(
        (s) =>
          s.id !== scheduleId &&
          s.court === court &&
          Number(s.start_time.slice(0, 2)) <= hour &&
          Number(s.end_time.slice(0, 2)) > hour &&
          isBillableFixed(s.clients?.full_name) &&
          !findFixedExceptionForHour(s.exceptions, hour),
      )
      .map((s) => ({
        schedule: s,
        status: (attendanceForSchedule(s.id)?.status as AttendanceStatus | null) ?? null,
      }));
  };

  // --------------------- Detecção de conflitos ---------------------
  // Conflito = mesma quadra + mesma hora com ao menos uma locação (booking)
  // sobreposta a outra locação, ou uma locação sobre um fixo ativo.
  // Fixo × fixo (mensalistas dividindo o horário) NÃO é conflito.
  interface ConflictEntry {
    kind: "booking" | "fixed";
    booking?: Booking;
    fixed?: FixedSchedule;
  }
  interface ConflictGroup {
    key: string;
    court: number;
    startHour: number;
    endHour: number;
    entries: ConflictEntry[];
  }

  const conflicts: ConflictGroup[] = useMemo(() => {
    const activeBookings = bookings.filter((b) => !b.cancelled_at);
    const perHour: Array<{ court: number; hour: number; key: string; entries: ConflictEntry[] }> = [];
    // Dois intervalos só conflitam de verdade se realmente se sobrepõem no
    // tempo (início estrito menor que o fim do outro, nos dois sentidos) —
    // dois horários encostados (ex.: 09:00–10:30 seguido de 10:30–11:30)
    // tocam a mesma hora-bucket sem nunca ocupar o mesmo instante.
    const realOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
      aStart < bEnd && bStart < aEnd;
    for (let court = 1; court <= 9; court++) {
      for (let hour = 5; hour <= 23; hour++) {
        const bs = activeBookings.filter(
          (b) =>
            b.court === court &&
            timeToHours(b.start_time) < hour + 1 &&
            timeToHours(b.end_time) > hour,
        );
        const fs = fixed.filter(
          (f) =>
            f.court === court &&
            timeToHours(f.start_time) < hour + 1 &&
            timeToHours(f.end_time) > hour &&
            !findFixedExceptionForHour(f.exceptions, hour),
        );
        const bIntervals = bs.map((b) => ({
          startH: timeToHours(b.start_time),
          endH: timeToHours(b.end_time),
        }));
        const fIntervals = fs.map((f) => ({
          startH: timeToHours(f.start_time),
          endH: timeToHours(f.end_time),
        }));
        let hasConflict = false;
        for (let i = 0; i < bIntervals.length && !hasConflict; i++) {
          for (let j = i + 1; j < bIntervals.length && !hasConflict; j++) {
            if (realOverlap(bIntervals[i].startH, bIntervals[i].endH, bIntervals[j].startH, bIntervals[j].endH)) {
              hasConflict = true;
            }
          }
        }
        for (let i = 0; i < bIntervals.length && !hasConflict; i++) {
          for (let j = 0; j < fIntervals.length && !hasConflict; j++) {
            if (realOverlap(bIntervals[i].startH, bIntervals[i].endH, fIntervals[j].startH, fIntervals[j].endH)) {
              const b = bs[i];
              const f = fs[j];
              // Não é conflito: mesmo cliente, mesmo horário exato — a
              // locação É a materialização de hoje do próprio fixo (ex.:
              // reativada pelo professor pela agenda/mapa), não uma segunda
              // locação por cima da quadra.
              const sameOccurrence =
                b.client_id != null &&
                b.client_id === f.client_id &&
                b.start_time === f.start_time &&
                b.end_time === f.end_time;
              if (!sameOccurrence) hasConflict = true;
            }
          }
        }
        for (let i = 0; i < fIntervals.length && !hasConflict; i++) {
          for (let j = i + 1; j < fIntervals.length && !hasConflict; j++) {
            if (realOverlap(fIntervals[i].startH, fIntervals[i].endH, fIntervals[j].startH, fIntervals[j].endH)) {
              const f1 = fs[i];
              const f2 = fs[j];
              // Não é conflito: mesmo horário exato (início e fim) — é o
              // compartilhamento intencional do mesmo horário por vários
              // clientes (ex.: aula em dupla), não dois fixos disputando a
              // quadra.
              const sameSlot = f1.start_time === f2.start_time && f1.end_time === f2.end_time;
              if (!sameSlot) hasConflict = true;
            }
          }
        }
        if (!hasConflict) continue;
        const entries: ConflictEntry[] = [
          ...bs.map((b) => ({ kind: "booking" as const, booking: b })),
          ...fs.map((f) => ({ kind: "fixed" as const, fixed: f })),
        ];
        const key = entries
          .map((e) => (e.kind === "booking" ? `b:${e.booking!.id}` : `f:${e.fixed!.id}`))
          .sort()
          .join(",");
        perHour.push({ court, hour, key, entries });
      }
    }
    // Mescla horas contíguas com o mesmo conjunto de entidades.
    const groups: ConflictGroup[] = [];
    for (const p of perHour) {
      const last = groups[groups.length - 1];
      if (
        last &&
        last.court === p.court &&
        last.key === p.key &&
        last.endHour === p.hour
      ) {
        last.endHour = p.hour + 1;
      } else {
        groups.push({
          key: `${p.court}-${p.hour}-${p.key}`,
          court: p.court,
          startHour: p.hour,
          endHour: p.hour + 1,
          entries: p.entries,
        });
      }
    }
    return groups;
  }, [bookings, fixed]);

  const openEntry = (groupKey: string, entry: ConflictEntry) => {
    setResolveConflict({
      open: true,
      groupKey,
      entry:
        entry.kind === "booking"
          ? { kind: "booking", booking: entry.booking! }
          : { kind: "fixed", fixed: entry.fixed! },
    });
  };

  const handleCell = (court: number, hour: number, cell: CourtCell) => {
    // Se o slot é um fixo cancelado neste dia, trate como vazio para
    // permitir criar nova locação, mas guarde o "anterior" para exibir.
    if (cell.kind === "fixed" && cell.cancelledException) {
      const wasBooking = cell.cancelledException.id.startsWith("booking:");
      setDialog({
        open: true,
        court,
        hour,
        existing: null,
        existingFixed: null,
        previous: {
          clientName: cell.fixed?.clients?.full_name ?? "Cliente",
          kind: "fixo mensalista",
          cancelledBy: cell.cancelledException.created_by
            ? authorNames[cell.cancelledException.created_by]
            : undefined,
          reason: cell.cancelledException.reason,
          reactivateExceptionScheduleId:
            !wasBooking && cell.fixed ? cell.fixed.id : null,
          reactivateBookingId: wasBooking
            ? cell.cancelledException.id.replace(/^booking:/, "")
            : null,
        },
      });
      return;
    }
    // Locação avulsa cancelada: também trate como disponível.
    if (cell.kind === "booking" && cell.booking?.cancelled_at) {
      const b = cell.booking;
      setDialog({
        open: true,
        court,
        hour,
        existing: null,
        existingFixed: null,
        previous: {
          clientName:
            b.clients?.full_name ?? b.teachers?.name ?? b.guest_name ?? "Cliente",
          kind: b.source === "professor" ? "professor" : "avulsa",
          cancelledBy: b.cancelled_by ? authorNames[b.cancelled_by] : undefined,
          reason: b.cancel_reason ?? null,
          reactivateBookingId: b.id,
        },
      });
      return;
    }
    // Pré-reserva (7 min, criada ao solicitar pelo WhatsApp) ainda ativa:
    // abre direto o formulário de nova locação (não o de edição) com um
    // botão "Confirmar" — evita ter que cancelar a pré-reserva pra depois
    // criar a locação de verdade. O trigger já cancela a pré-reserva
    // sozinho quando a recepção confirma a reserva de verdade nesse
    // mesmo horário.
    if (cell.kind === "booking" && cell.booking && !cell.booking.cancelled_at && cell.booking.hold_expires_at) {
      const requester = (cell.booking.guest_name ?? "")
        .replace(/^PRÉ-RESERVA — /, "")
        .replace(/ \(aguardando confirmação\)$/, "");
      setDialog({
        open: true,
        court,
        hour,
        existing: null,
        existingFixed: null,
        previous: {
          clientName: requester || "Cliente",
          kind: "avulsa",
          isHold: true,
        },
      });
      return;
    }
    // Fixo ativo (não cancelado) e cobrável → menu de presença.
    if (
      cell.kind === "fixed" &&
      !cell.cancelledException &&
      cell.fixed &&
      isBillableFixed(cell.fixed.clients?.full_name)
    ) {
      setAttendanceDialog({
        open: true,
        court,
        hour,
        scheduleId: cell.fixed.id,
      });
      return;
    }
    // Locação "movida do fixo" (cliente mensalista cobrável) → menu de presença
    // usando o schedule original para preservar histórico/lançamento.
    if (
      cell.kind === "booking" &&
      cell.booking &&
      !cell.booking.cancelled_at &&
      isMovedFromFixedBooking(cell.booking) &&
      isBillableFixed(cell.booking.clients?.full_name)
    ) {
      const schedId = movedFixedScheduleByBookingId[cell.booking.id];
      if (schedId) {
        // Quem mais dividia a quadra/horário original com este fixo (ver
        // movedFixedGroupByBookingId) — sem isto a divisão da cobrança se
        // perde ao mover, porque o grupo inteiro virou uma única
        // court_booking (+ participantes) e só o líder tem client_schedule
        // "visível" pela quadra de destino.
        const group = movedFixedGroupByBookingId[cell.booking.id] ?? [];
        const movedGroupSiblingIds = group.filter((s) => s.id !== schedId).map((s) => s.id);
        // Cobra pela janela REAL da locação movida (cell.booking), não pela
        // duração do horário fixo original — "Mover só hoje" pode esticar
        // o horário (ex.: +1h) além do que o fixo tinha, e a marcação de
        // presença precisa refletir isso, não travar no 1h de sempre.
        setAttendanceDialog({
          open: true,
          court,
          hour: Math.floor(timeToHours(cell.booking.start_time)),
          scheduleId: schedId,
          movedWindow: { start: cell.booking.start_time, end: cell.booking.end_time },
          movedGroupSiblingIds,
          movedBookingId: cell.booking.id,
          movedParticipantClientIds: (cell.booking.participants ?? []).map((p) => p.client_id),
        });
        return;
      }
    }
    setDialog({
      open: true,
      court,
      hour,
      existing: cell.kind === "booking" ? cell.booking! : null,
      existingFixed: cell.kind === "fixed" ? cell.fixed! : null,
      previous: null,
    });
  };


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mapa de quadras</h1>
        <p className="text-muted-foreground">
          Locações fixas de mensalistas e reservas avulsas por dia. Clique em uma célula para agir.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4 px-2 sm:px-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDate(addDaysISO(date, -1))}
              aria-label="Dia anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-auto"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDate(addDaysISO(date, 1))}
              aria-label="Próximo dia"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDate(dateISO(new Date()))}
            >
              <CalendarDays className="h-4 w-4 mr-2" /> Hoje
            </Button>
            {/* No celular, a barra de ações rola na horizontal em vez de ficar cortada. */}
            <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 [&>*]:shrink-0 [-webkit-overflow-scrolling:touch] sm:ml-auto sm:w-auto sm:pb-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAvailabilityOpen(true)}
                title="Ver horários livres para responder ao cliente"
              >
                <Search className="h-4 w-4 mr-2" /> Disponibilidade
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFixedAvailabilityOpen(true)}
                title="Ver dias/horários com quadra livre toda semana, pra oferecer horário fixo"
              >
                <Repeat className="h-4 w-4 mr-2" /> Fixo disponível
              </Button>
              {canManageAvailability && (
                <StaffWaitlistAddDialog
                  defaultDate={date}
                  onAdded={() => void loadWaitlistCounts()}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void load(); }}
                disabled={loading}
                title="Recarregar o mapa"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Atualizar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open("/mapa/tv", "_blank", "noopener,noreferrer")
                }
                title="Abre em uma nova aba e atualiza a cada minuto"
              >
                <Tv className="h-4 w-4 mr-2" /> Modo TV
              </Button>
              <div className="text-sm text-muted-foreground">
                {weekdayShort[weekdayOfISO(date)]}, {fmtDateBR(date)}
              </div>
            </div>
          </div>

          


          {canManageAvailability && <RacketLoansPanel />}

          {canManageAvailability &&
            priceBands.some(
              (b) =>
                (b.starts_on || b.ends_on) &&
                (!b.starts_on || date >= b.starts_on) &&
                (!b.ends_on || date <= b.ends_on),
            ) && (
              <div className="rounded-md border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                <div className="font-semibold">Promoção online ativa neste dia</div>
                <p className="text-xs">
                  O valor do selo <strong>"Site"</strong> vale só para cliente <strong>avulso</strong> que
                  comprar online, direto no site. Lançamento pela recepção/diretoria — inclusive
                  mensalista jogando avulso — segue o valor normal da tabela.
                </p>
              </div>
            )}

          {(() => {
            const visibleConflicts = conflicts.filter((g) => !dismissedConflictKeys.has(g.key));
            if (loading || visibleConflicts.length === 0) return null;
            return (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                <AlertTriangle className="h-4 w-4" />
                {visibleConflicts.length === 1
                  ? "1 conflito de agenda detectado"
                  : `${visibleConflicts.length} conflitos de agenda detectados`}
              </div>
              <p className="text-xs text-muted-foreground">
                Duas ou mais locações se sobrepõem na mesma quadra e horário. Clique em uma delas para alterar a quadra ou cancelar.
              </p>
              <ul className="space-y-2">
                {visibleConflicts.map((g) => {
                  const rangeLbl = `${hoursToLabel(g.startHour)}–${hoursToLabel(g.endHour)}`;
                  return (
                    <li
                      key={g.key}
                      className="rounded border border-destructive/40 bg-background p-2"
                    >
                      <div className="text-xs font-medium text-destructive mb-1">
                        {courtLabel(g.court)} · {rangeLbl}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.entries.map((e, i) => {
                          const label =
                            e.kind === "booking"
                              ? `${e.booking!.clients?.full_name ??
                                  e.booking!.teachers?.name ??
                                  e.booking!.guest_name ??
                                  "Avulsa"} (${hoursToLabel(timeToHours(e.booking!.start_time))}–${hoursToLabel(timeToHours(e.booking!.end_time))})`
                              : `${e.fixed!.clients?.full_name ?? "Fixo"} · fixo (${hoursToLabel(timeToHours(e.fixed!.start_time))}–${hoursToLabel(timeToHours(e.fixed!.end_time))})`;
                          const tag = e.kind === "booking" ? "Locação" : "Fixo";
                          return (
                            <Button
                              key={`${g.key}-${i}`}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-auto py-1 px-2 text-xs"
                              onClick={() => openEntry(g.key, e)}
                              title="Abrir para alterar quadra ou cancelar"
                            >
                              <span className="mr-1.5 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">
                                {tag}
                              </span>
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            );
          })()}


          {loading && !hasLoadedOnceRef.current ? (
            <div className="py-16 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mapa...
            </div>
          ) : (
            <div className="-mx-2 sm:mx-0 [--map-sticky-top:3.5rem] md:[--map-sticky-top:0px]">
              <CourtMap
                bookings={bookings}
                fixedSchedules={fixed}
                onCellClick={handleCell}
                highlightAvailability
                priceBands={priceBands}
                date={date}
                onlinePromoHint={canManageAvailability}
                onlinePromoCategoryId={avulsoCategoryId}
                attendanceByScheduleId={attendanceByScheduleId}
                attendanceByBookingId={attendanceByBookingId}
                paidBookingIds={paidBookingIds}
                onlinePaidBookingIds={onlinePaidBookingIds}
                currentUserId={user?.id ?? null}
                manualAvailabilities={availOverrides.map((o) => ({
                  id: o.id,
                  court: o.court,
                  start_time: o.start_time,
                  end_time: o.end_time,
                  hourly_price: Number(o.hourly_price),
                }))}
                showManualBadge={canManageAvailability}
                onManualAvailabilityClick={
                  canManageAvailability
                    ? (avail, hour) =>
                        setOverrideDialog({ open: true, court: avail.court, hour })
                    : undefined
                }
                waitlistLookup={waitlistLookup}
                onWaitlistBadgeClick={(court, startTime, endTime) =>
                  setWaitlistTarget({ court, bookingDate: date, startTime, endTime })
                }
                openDebtByClient={showOpenDebt ? openDebtByClient : undefined}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <CourtBookingDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
        bookingDate={date}
        court={dialog.court}
        hour={dialog.hour}
        existing={dialog.existing}
        existingFixed={dialog.existingFixed}
        previous={dialog.previous}
        authorNames={authorNames}
        priceBands={priceBands}
        canCancel
        onSaved={reloadLive}
        onCreated={(b) => {
          if (b.booking_date === date) addCreatedBooking(b);
        }}
      />

      <WaitlistQueueDialog
        target={waitlistTarget}
        onClose={() => setWaitlistTarget(null)}
        onChanged={() => void loadWaitlistCounts()}
      />


      <AvailabilityOverrideDialog
        open={overrideDialog.open}
        onOpenChange={(v) => setOverrideDialog((d) => ({ ...d, open: v }))}
        date={date}
        priceBands={priceBands}
        existing={availOverrides}
        initialCourt={overrideDialog.court}
        initialHour={overrideDialog.hour}
        onSaved={() => {
          setOverrideDialog({ open: false, court: null, hour: null });
          void load();
        }}
      />

      {(() => {
        const rawSched = attendanceDialog.scheduleId
          ? fixed.find((s) => s.id === attendanceDialog.scheduleId)
          : null;
        if (!rawSched) return null;
        // "Mover só hoje" pode esticar a duração (movedWindow) além do
        // horário fixo recorrente — sobrepõe start/end só pra esta
        // marcação (mantém as exceções intactas: "Mover só hoje" dentro do
        // diálogo precisa achar a exceção de dia inteiro pra saber que já
        // foi movido; ver ignoreExceptionsForBilling abaixo pra cobrança).
        const sched = attendanceDialog.movedWindow
          ? {
              ...rawSched,
              start_time: attendanceDialog.movedWindow.start,
              end_time: attendanceDialog.movedWindow.end,
            }
          : rawSched;
        const cliInfo = sched.client_id ? clientInfo[sched.client_id] ?? null : null;
        return (
          <ScheduleAttendanceDialog
            open={attendanceDialog.open}
            onOpenChange={(v) =>
              setAttendanceDialog((d) => ({ ...d, open: v }))
            }
            date={date}
            hour={attendanceDialog.hour}
            court={attendanceDialog.court}
            schedule={sched}
            ignoreExceptionsForBilling={!!attendanceDialog.movedWindow}
            siblingsAtSlot={(() => {
              // Une os dois critérios em vez de escolher um: o genérico (por
              // quadra atual — cobre fixos que realmente dividem a quadra de
              // DESTINO) e o do grupo original de quem foi movido junto (ver
              // movedFixedGroupByBookingId — cobre quem virou "participante"
              // da mesma court_booking por causa do índice único). Deduplica
              // por client_schedule.id caso os dois achem a mesma pessoa.
              const fromGroup = (attendanceDialog.movedGroupSiblingIds ?? [])
                .map((id) => fixed.find((s) => s.id === id))
                .filter((s): s is FixedSchedule => !!s && isBillableFixed(s.clients?.full_name))
                .map((s) => ({
                  schedule: s,
                  status: (attendanceForSchedule(s.id)?.status as AttendanceStatus | null) ?? null,
                }));
              const generic = siblingsAtSlot(sched.id, attendanceDialog.court, attendanceDialog.hour);
              const seen = new Set<string>();
              const combined: typeof generic = [];
              for (const entry of [...fromGroup, ...generic]) {
                if (seen.has(entry.schedule.id)) continue;
                seen.add(entry.schedule.id);
                combined.push(entry);
              }
              return combined;
            })()}
            movedBookingId={attendanceDialog.movedBookingId ?? null}
            movedParticipantClientIds={attendanceDialog.movedParticipantClientIds ?? []}
            getAttendance={attendanceForSchedule}
            getClientInfo={(id) => clientInfo[id] ?? null}
            client={cliInfo}
            priceBands={priceBands}
            mensalistaCategoryId={mensalistaCategoryId}
            canMove
            onSaved={load}

            onEditSchedule={() => {
              setAttendanceDialog((d) => ({ ...d, open: false }));
              setDialog({
                open: true,
                court: attendanceDialog.court,
                hour: attendanceDialog.hour,
                existing: null,
                existingFixed: rawSched,
                previous: null,
              });
            }}
            onSwapClient={() => {
              // A quadra já foi liberada só por hoje (ver swapClient no
              // diálogo) — abre direto "Nova locação" na mesma quadra/hora
              // pra colocar quem entrou no lugar.
              setDialog({
                open: true,
                court: attendanceDialog.court,
                hour: attendanceDialog.hour,
                existing: null,
                existingFixed: null,
                previous: null,
              });
            }}
          />
        );
      })()}
      <AvailabilitySearchDialog
        open={availabilityOpen}
        onOpenChange={setAvailabilityOpen}
        defaultDate={date}
      />
      <FixedAvailabilitySearchDialog
        open={fixedAvailabilityOpen}
        onOpenChange={setFixedAvailabilityOpen}
      />
      <ConflictResolveDialog
        open={resolveConflict.open}
        onOpenChange={(v) => setResolveConflict((s) => ({ ...s, open: v }))}
        bookingDate={date}
        entry={resolveConflict.entry}
        onSaved={() => {
          const gk = resolveConflict.groupKey;
          if (gk) {
            setDismissedConflictKeys((prev) => {
              const next = new Set(prev);
              next.add(gk);
              return next;
            });
          }
          load();
        }}
      />
    </div>
  );
}

function Legend() {
  const items = [
    { label: "Disponível", cls: "bg-emerald-500/15 border-emerald-500/40" },
    { label: "Fixo (mensalista)", cls: "bg-muted border-muted-foreground/30" },
    { label: "Avulsa", cls: "bg-sky-500/15 border-sky-500/40" },
    { label: "Professor", cls: "bg-purple-500/15 border-purple-500/40" },
  ];
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm border ${i.cls}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ============================================================
// Professor: mapa somente para desmarcar clientes vinculados a ele.
// ============================================================

interface TeacherInfo {
  id: string;
  name: string;
  can_book_directly?: boolean;
}

function MapaProfessorRoute() {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "not_teacher" | "ok">("loading");
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);

  useEffect(() => {
    const check = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate({ to: "/login" });
        return;
      }
      const { data: t } = await supabase
        .from("teachers")
        .select("id, name, can_book_directly")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!t) {
        setState("not_teacher");
        return;
      }
      setTeacher(t as unknown as TeacherInfo);
      setState("ok");
    };
    check();
  }, [navigate]);

  const signOut = async () => {
    const { getLogoutReturnPath, clearPortalOrigin } = await import("@/lib/portal-origin");
    const target = getLogoutReturnPath();
    await supabase.auth.signOut();
    clearPortalOrigin();
    navigate({ to: target });
  };

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (state === "not_teacher") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-4">
        <h1 className="text-xl font-semibold">Acesso de professor não vinculado</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Sua conta não está vinculada a nenhum professor. Procure a recepção.
        </p>
        <Button variant="outline" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sair
        </Button>
      </div>
    );
  }

  return <MapaProfessorPage teacher={teacher!} onSignOut={signOut} />;
}

interface CancelTarget {
  kind: "booking" | "fixed";
  court: number;
  hour: number;
  clientName: string;
  clientId: string | null;
  bookingId?: string;
  scheduleId?: string;
  startTs: number;
  // Data da ocorrência (yyyy-mm-dd). Fonte da verdade no cancelamento —
  // para itens vindos da barra lateral pode diferir da data do mapa.
  date: string;
  // Fixo: intervalo completo (HH:MM:SS) preservando os minutos originais.
  fixedStart?: string;
  fixedEnd?: string;
  // Fixo dividido (dupla/grupo): demais alunos do professor que
  // compartilham exatamente este horário/quadra — cancelados junto, pra
  // liberar a quadra inteira em vez de deixar o(s) outro(s) ainda ocupando.
  siblings?: { scheduleId: string; clientId: string | null; clientName: string }[];
}

function MapaProfessorPage({
  teacher,
  onSignOut,
}: {
  teacher: TeacherInfo;
  onSignOut: () => void;
}) {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(dateISO(new Date()));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  const [priceBands, setPriceBands] = useState<PriceBand[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [feePreview, setFeePreview] = useState<number>(0);
  const [cancelling, setCancelling] = useState(false);
  const sidebarRef = useRef<TeacherSidebarHandle>(null);
  const [waDialog, setWaDialog] = useState<{ open: boolean; court: number; hour: number }>({
    open: false,
    court: 1,
    hour: 5,
  });
  // Só Davi Barros (teacher.can_book_directly) usa este diálogo — os demais
  // professores continuam pedindo a reserva pela recepção via waDialog.
  const [directBookingDialog, setDirectBookingDialog] = useState<{
    open: boolean;
    court: number;
    hour: number;
  }>({ open: false, court: 1, hour: 5 });
  // Aula própria cancelada: o professor escolhe entre reativar a anterior
  // ou usar o horário (agora livre) para uma locação nova. Antes só havia
  // "Reativar", e quem cancelou pra pôr outra coisa no lugar ficava travado.
  const [cancelledChoice, setCancelledChoice] = useState<{
    description: string;
    resolve: (choice: "reactivate" | "new" | null) => void;
  } | null>(null);
  const askCancelledChoice = (description: string) =>
    new Promise<"reactivate" | "new" | null>((resolve) => {
      setCancelledChoice({ description, resolve });
    });
  const settleCancelledChoice = (choice: "reactivate" | "new" | null) => {
    cancelledChoice?.resolve(choice);
    setCancelledChoice(null);
  };
  const openNewBooking = (court: number, hour: number) => {
    if (teacher.can_book_directly) {
      setDirectBookingDialog({ open: true, court, hour });
    } else {
      setWaDialog({ open: true, court, hour });
    }
  };
  const { forInterval: teacherWaitlistLookup } = useWaitlistCounts(date);

  const load = useCallback(async () => {
    setLoading(true);
    const weekday = weekdayOfISO(date);
    const [bRes, sRes, eRes, pRes] = await Promise.all([
      supabase.rpc("teacher_map_bookings", { _date: date }),
      supabase.rpc("teacher_map_schedules", { _weekday: weekday, _date: date }),
      supabase.rpc("teacher_map_schedule_exceptions", { _date: date, _weekday: weekday }),
      supabase
        .from("price_table")
        .select("id, categories, courts, weekday, start_time, end_time, price_per_hour, starts_on, ends_on")
        .eq("weekday", weekday),
    ]);
    setPriceBands((pRes.data ?? []) as unknown as PriceBand[]);
    const scheds = ((sRes.data ?? []) as unknown as FixedSchedule[]);
    const exceptions = (eRes.data ?? []) as unknown as Array<{
      id: string;
      client_schedule_id: string;
      reason: string | null;
      start_time: string | null;
      end_time: string | null;
    }>;
    const excByScheduleId = new Map<string, typeof exceptions>();
    for (const e of exceptions) {
      const arr = excByScheduleId.get(e.client_schedule_id) ?? [];
      arr.push(e);
      excByScheduleId.set(e.client_schedule_id, arr);
    }
    const merged = scheds.map((s) => ({
      ...s,
      exceptions: (excByScheduleId.get(s.id) ?? []).map((e) => ({
        id: e.id,
        start_time: e.start_time,
        end_time: e.end_time,
        reason: e.reason,
      })),
    }));
    setBookings((bRes.data ?? []) as unknown as Booking[]);
    setFixed(merged);
    setLoading(false);
    hasLoadedOnceRef.current = true;
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: o mapa do professor (grade de quadras) só recarregava depois
  // de uma ação do próprio professor — se a recepção cancelasse/reativasse
  // algo, ou se ele tivesse duas abas abertas, a grade ficava desatualizada
  // até um refresh manual. Mesmo padrão do mapa da equipe (mapa_live).
  useLiveReload(load, {
    channel: "teacher_map_live",
    tables: ["court_bookings", "client_schedule_exceptions"],
  });

  // Lista de espera do professor agora é derivada de useWaitlistCounts (campo `mine`).

  const isMine = useCallback(
    (cell: CourtCell) => {
      if (cell.kind === "booking") return !!cell.booking?.is_own;
      if (cell.kind === "fixed") return !!cell.fixed?.is_own;
      return false;
    },
    [],
  );

  const handleCell = async (court: number, hour: number, cell: CourtCell) => {
    if (!isMine(cell)) {
      // Mapa completo é só visualização — o professor não pode mexer em
      // aulas de outros clientes, só nas suas (destacadas em amarelo).
      // Quadra livre é exceção: continua podendo clicar pra pedir à
      // recepção que reserve, como sempre foi.
      const isAvailable =
        cell.kind === "empty" ||
        (cell.kind === "fixed" && !!cell.cancelledException) ||
        (cell.kind === "booking" && !!cell.booking?.cancelled_at);
      if (isAvailable) {
        openNewBooking(court, hour);
        return;
      }
      toast.info("Você só pode visualizar esta quadra — ela não é sua.");
      return;
    }
    const startTs = new Date(
      `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`,
    ).getTime();

    // Reativação: aula minha já cancelada → oferece reativar.
    if (cell.kind === "booking" && cell.booking?.cancelled_at) {
      const b = cell.booking;
      const choice = await askCancelledChoice(
        `A aula de ${b.clients?.full_name ?? b.guest_name ?? "aluno"} neste horário está cancelada.`,
      );
      if (choice === "new") {
        openNewBooking(court, hour);
        return;
      }
      if (choice !== "reactivate") return;
      // Usa a mesma RPC do "Reativar" da agenda lateral — valida se a
      // quadra continua livre antes de reativar. Reativar direto com um
      // update cru (como antes) pulava essa checagem e podia gerar um
      // conflito de verdade sem nenhum aviso.
      const { data: reactData, error } = await supabase.rpc("professor_reactivate_booking", {
        _booking_id: b.id,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      const reactRes = reactData as { ok: boolean; error?: string } | null;
      if (!reactRes?.ok) {
        toast.error(reactRes?.error ?? "Não foi possível reativar a reserva.");
        return;
      }
      // Limpa marcação de presença cancelada (badge "C") do fixo correspondente, se houver.
      {
        const wd = new Date(`${date}T12:00:00-03:00`).getDay();
        const bStart = Number(b.start_time.slice(0, 2));
        const matchingSchedIds = fixed
          .filter((f) =>
            f.weekday === wd &&
            f.court === b.court &&
            (f.client_id === b.client_id || (b.client_id && f.client_id === b.client_id)) &&
            Number(f.start_time.slice(0, 2)) <= bStart &&
            Number(f.end_time.slice(0, 2)) > bStart,
          )
          .map((f) => f.id);
        if (matchingSchedIds.length) {
          await supabase
            .from("client_schedule_attendance")
            .delete()
            .eq("attendance_date", date)
            .in("client_schedule_id", matchingSchedIds)
            .in("status", ["cancelled_ok", "cancelled_late_charged", "cancelled_late_waived"]);
        }
      }
      toast.success("Aula reativada");
      load();
      return;
    }
    if (cell.kind === "fixed" && cell.cancelledException) {
      const f = cell.fixed!;
      const choice = await askCancelledChoice(
        `A aula fixa de ${f.clients?.full_name ?? "aluno"} está cancelada neste dia. ` +
          `Reativar volta todas as horas da aula fixa.`,
      );
      if (choice === "new") {
        openNewBooking(court, hour);
        return;
      }
      if (choice !== "reactivate") return;
      const fStart = Number(f.start_time.slice(0, 2));
      const fEnd = Math.max(Number(f.end_time.slice(0, 2)), fStart + 1);
      // Mesma RPC do "Reativar" da agenda lateral — valida se a quadra
      // continua livre, remove a exceção do dia e reativa a locação da
      // ocorrência (a mesma linha, não cria uma avulsa nova).
      const { data: reactData, error: reactErr } = await supabase.rpc(
        "professor_reactivate_fixed_occurrence",
        { _schedule_id: f.id, _occurrence_date: date },
      );
      if (reactErr) {
        toast.error(reactErr.message);
        return;
      }
      const reactRes = reactData as { ok: boolean; error?: string } | null;
      if (!reactRes?.ok) {
        toast.error(reactRes?.error ?? "Não foi possível reativar a reserva.");
        return;
      }
      // Limpa marcação de presença cancelada (badge "C") desse fixo na data.
      await supabase
        .from("client_schedule_attendance")
        .delete()
        .eq("client_schedule_id", f.id)
        .eq("attendance_date", date)
        .in("status", ["cancelled_ok", "cancelled_late_charged", "cancelled_late_waived"]);
      // Apaga bookings "fantasma" de histórico (source=professor) que a RPC
      // não remove — servem só pra cobrança de multa, não representam
      // ocupação real.
      const { data: cancelledOwn } = await supabase
        .from("court_bookings")
        .select("id, start_time, teacher_id, source")
        .eq("booking_date", date)
        .eq("court", court)
        .not("cancelled_at", "is", null);
      for (const b of cancelledOwn ?? []) {
        const h = Number(b.start_time.slice(0, 2));
        if (h < fStart || h >= fEnd) continue;
        if (b.source === "professor" && b.teacher_id === teacher.id) {
          await supabase.from("court_bookings").delete().eq("id", b.id);
        }
      }
      toast.success("Aula reativada");
      load();
      return;
    }

    let target: CancelTarget;
    if (cell.kind === "booking") {
      const b = cell.booking!;
      target = {
        kind: "booking",
        court,
        hour,
        clientName: b.clients?.full_name ?? b.guest_name ?? "Aluno",
        clientId: b.client_id ?? null,
        bookingId: b.id,
        startTs,
        date,
      };
    } else if (cell.kind === "fixed") {
      const f = cell.fixed!;
      const fStart = Number(f.start_time.slice(0, 2));
      // Quadra dividida (dupla/grupo): os demais alunos DESTE professor no
      // mesmo horário/quadra são cancelados junto — cancelar só quem foi
      // clicado deixava a quadra "ocupada" pro(s) outro(s) no mapa.
      const siblings = (cell.fixedSiblings ?? [])
        .filter((s) => s.is_own)
        .map((s) => ({
          scheduleId: s.id,
          clientId: s.client_id ?? null,
          clientName: s.clients?.full_name ?? "Aluno",
        }));
      target = {
        kind: "fixed",
        court,
        hour: fStart,
        clientName: f.clients?.full_name ?? "Aluno",
        clientId: f.client_id ?? null,
        scheduleId: f.id,
        startTs: new Date(`${date}T${f.start_time}-03:00`).getTime(),
        date,
        fixedStart: f.start_time,
        fixedEnd: f.end_time,
        siblings,
      };
    } else {
      return;
    }

    await requestCancel(target);
  };

  const requestCancel = useCallback(async (target: CancelTarget) => {
    let fee = 0;
    if (target.clientId) {
      const { data } = await supabase
        .from("clients")
        .select("category:category_id(cancel_fee_amount)")
        .eq("id", target.clientId)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fee = Number((data?.category as any)?.cancel_fee_amount ?? 0) || 0;
    }
    setFeePreview(fee);
    // A barra lateral (agenda) não calcula "siblings" como o clique na célula
    // do mapa faz — sem isso, cancelar um fixo dividido (dupla/grupo) por ali
    // liberava só quem foi clicado e deixava o(s) outro(s) ainda ocupando a
    // quadra. Preenchemos aqui, no ponto compartilhado pelos dois caminhos,
    // para que ambos cancelem e notifiquem de forma idêntica.
    //
    // Busca direto no banco (RPC teacher_map_schedules/teacher_map_schedule_exceptions)
    // para a data/dia-da-semana DO ITEM sendo cancelado — não usa o estado
    // `fixed`, que só tem os fixos do dia atualmente selecionado na grade.
    // Cancelar pela agenda lateral um item de outro dia/semana (sem antes
    // clicar na data pra sincronizar a grade) fazia essa busca "achar" zero
    // colegas de quadra (comparando com o fixo do dia ERRADO) e cancelava só
    // o aluno clicado — a quadra dividida continuava ocupada pro(s) outro(s),
    // dando a impressão de que "não dá pra cancelar aula com 2 alunos".
    if (target.kind === "fixed" && target.scheduleId && target.siblings === undefined) {
      const weekday = weekdayOfISO(target.date);
      const [sRes, eRes] = await Promise.all([
        supabase.rpc("teacher_map_schedules", { _weekday: weekday, _date: target.date }),
        supabase.rpc("teacher_map_schedule_exceptions", { _date: target.date, _weekday: weekday }),
      ]);
      const scheds = (sRes.data ?? []) as unknown as FixedSchedule[];
      const exceptions = (eRes.data ?? []) as unknown as Array<
        FixedException & { client_schedule_id: string }
      >;
      const excByScheduleId = new Map<string, FixedException[]>();
      for (const e of exceptions) {
        const arr = excByScheduleId.get(e.client_schedule_id) ?? [];
        arr.push(e);
        excByScheduleId.set(e.client_schedule_id, arr);
      }
      const siblings = scheds
        .filter(
          (s) =>
            s.id !== target.scheduleId &&
            s.court === target.court &&
            s.is_own &&
            Number(s.start_time.slice(0, 2)) <= target.hour &&
            Number(s.end_time.slice(0, 2)) > target.hour &&
            isBillableFixed(s.clients?.full_name) &&
            !findFixedExceptionForHour(excByScheduleId.get(s.id), target.hour),
        )
        .map((s) => ({
          scheduleId: s.id,
          clientId: s.client_id ?? null,
          clientName: s.clients?.full_name ?? "Aluno",
        }));
      target = { ...target, siblings };
    }
    setCancelTarget(target);
  }, []);


  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const nowIso = new Date().toISOString();

    let error: { message: string } | null = null;
    if (cancelTarget.kind === "booking" && cancelTarget.bookingId) {
      const { error: e } = await supabase
        .from("court_bookings")
        .update({
          cancelled_at: nowIso,
          cancelled_by: user?.id ?? null,
          cancel_reason: "Cancelado pelo professor",
        })
        .eq("id", cancelTarget.bookingId);
      error = e;
    } else {
      // Fixo: cancelamento da OCORRÊNCIA inteira (preservando os minutos),
      // para TODOS que dividem este horário/quadra com este professor
      // (dupla/grupo) — cancelar só o aluno clicado deixava o(s) outro(s)
      // ainda ocupando a quadra no mapa (reportado em produção: cancelar a
      // aula de um dos dois alunos de uma dupla não liberava a quadra).
      // Uma exceção por aluno cobrindo start_time..end_time. Se já existir
      // uma reserva ativa correspondente (persistência da ocorrência fixa)
      // pra aquele aluno, ela é marcada como cancelada — evita duplicidade
      // e mantém o mapa sincronizado. Caso contrário, cria uma linha
      // "fantasma" cancelada para permitir a cobrança da multa via trigger.
      const targetDate = cancelTarget.date;
      const rangeStart = cancelTarget.fixedStart ?? `${String(cancelTarget.hour).padStart(2, "0")}:00:00`;
      const rangeEnd = cancelTarget.fixedEnd ?? `${String((cancelTarget.hour + 1) % 24).padStart(2, "0")}:00:00`;
      const allTargets = [
        { scheduleId: cancelTarget.scheduleId, clientId: cancelTarget.clientId },
        ...(cancelTarget.siblings ?? []).map((s) => ({ scheduleId: s.scheduleId, clientId: s.clientId })),
      ];
      const scheduleIds = allTargets
        .map((t) => t.scheduleId)
        .filter((id): id is string => !!id);
      if (scheduleIds.length) {
        const { error: excErr } = await supabase.from("client_schedule_exceptions").insert(
          scheduleIds.map((id) => ({
            client_schedule_id: id,
            exception_date: targetDate,
            start_time: rangeStart,
            end_time: rangeEnd,
            reason: "Cancelado pelo professor",
            created_by: user?.id ?? null,
          })),
        );
        if (excErr) {
          setCancelling(false);
          toast.error(excErr.message);
          return;
        }
      }
      for (const t of allTargets) {
        if (!t.clientId) continue;
        // Procura reserva ativa correspondente à ocorrência fixa deste aluno nesta data.
        const { data: existingActive } = await supabase
          .from("court_bookings")
          .select("id")
          .eq("booking_date", targetDate)
          .eq("court", cancelTarget.court)
          .eq("start_time", rangeStart)
          .eq("end_time", rangeEnd)
          .eq("client_id", t.clientId)
          .is("cancelled_at", null);
        if (existingActive && existingActive.length > 0) {
          const ids = existingActive.map((r) => r.id);
          const { error: e } = await supabase
            .from("court_bookings")
            .update({
              cancelled_at: nowIso,
              cancelled_by: user?.id ?? null,
              cancel_reason: "Cancelado pelo professor (fixo)",
            })
            .in("id", ids);
          if (e) error = e;
        } else {
          const { error: e } = await supabase.from("court_bookings").insert({
            court: cancelTarget.court,
            booking_date: targetDate,
            start_time: rangeStart,
            end_time: rangeEnd,
            source: "professor",
            client_id: t.clientId,
            teacher_id: teacher.id,
            created_by: user?.id ?? null,
            cancelled_at: nowIso,
            cancelled_by: user?.id ?? null,
            cancel_reason: "Cancelado pelo professor (fixo)",
          });
          if (e) error = e;
        }
      }
    }

    setCancelling(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    const targetDate = cancelTarget.date;
    const rangeStart = cancelTarget.fixedStart ?? `${String(cancelTarget.hour).padStart(2, "0")}:00:00`;
    const rangeEnd = cancelTarget.fixedEnd ?? `${String((cancelTarget.hour + 1) % 24).padStart(2, "0")}:00:00`;
    toast.success("Aula desmarcada");

    // Atualização otimista imediata: reflete o cancelamento na barra lateral
    // E no mapa antes mesmo do refetch/Realtime, para a célula desaparecer
    // imediatamente da visão de ocupação ativa.
    sidebarRef.current?.markCancelledLocally({
      bookingId: cancelTarget.bookingId ?? null,
      scheduleId: cancelTarget.scheduleId ?? null,
      date: cancelTarget.date,
    });
    setBookings((prev) =>
      prev.map((b) => {
        const matchBooking =
          cancelTarget.kind === "booking" &&
          cancelTarget.bookingId &&
          b.id === cancelTarget.bookingId;
        const matchFixed =
          cancelTarget.kind === "fixed" &&
          b.booking_date === targetDate &&
          b.court === cancelTarget.court &&
          b.start_time === rangeStart &&
          b.end_time === rangeEnd &&
          !b.cancelled_at;
        return matchBooking || matchFixed
          ? { ...b, cancelled_at: nowIso, cancel_reason: "Cancelado pelo professor" }
          : b;
      }),
    );
    if (cancelTarget.kind === "fixed") {
      const affectedScheduleIds = new Set(
        [cancelTarget.scheduleId, ...(cancelTarget.siblings ?? []).map((s) => s.scheduleId)].filter(
          (id): id is string => !!id,
        ),
      );
      setFixed((prev) =>
        prev.map((f) =>
          affectedScheduleIds.has(f.id)
            ? {
                ...f,
                exceptions: [
                  ...(f.exceptions ?? []),
                  {
                    id: `local-${Date.now()}`,
                    start_time: rangeStart,
                    end_time: rangeEnd,
                    reason: "Cancelado pelo professor",
                  },
                ],
              }
            : f,
        ),
      );
    }

    const allCancelledClientIds = [
      cancelTarget.clientId,
      ...(cancelTarget.siblings ?? []).map((s) => s.clientId),
    ];
    for (const cid of allCancelledClientIds) {
      if (!cid) continue;
      void offerBookingCancelledNotification({
        clientId: cid,
        court: cancelTarget.court,
        bookingDate: targetDate,
        startTime: rangeStart,
        endTime: rangeEnd,
        isFixed: cancelTarget.kind === "fixed",
        reason: "Cancelado pelo professor",
      });
    }
    setCancelTarget(null);
    // Recarrega mapa e barra lateral em background para confirmar o estado.
    load();
    sidebarRef.current?.reload();
  };

  const hoursDiff = cancelTarget
    ? (cancelTarget.startTs - Date.now()) / (1000 * 60 * 60)
    : 0;
  const willCharge = !!cancelTarget && hoursDiff < 3 && feePreview > 0;

  const mineCount = useMemo(
    () =>
      fixed.filter((f) => f.teacher_id === teacher.id).length +
      bookings.filter((b) => b.teacher_id === teacher.id).length,
    [fixed, bookings, teacher.id],
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
              P
            </div>
            <span>Prof. {teacher.name}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4">
        <Tabs defaultValue="mapa" className="space-y-4">
          <TabsList>
            <TabsTrigger value="mapa">Mapa de quadras</TabsTrigger>
            <TabsTrigger value="clientes">Meus clientes</TabsTrigger>
          </TabsList>

          <TabsContent value="mapa" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Mapa de quadras</h1>
                <p className="text-sm text-muted-foreground">
                  Suas aulas aparecem destacadas em amarelo — toque em uma delas para
                  desmarcar. Você tem {mineCount} aula(s) neste dia. Quadras livres podem
                  ser solicitadas à recepção; as demais são só para consulta.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <AvulsaWaitlistJoinDialog variant="professor" />
                <FixedWaitlistJoinDialog variant="professor" />
              </div>
            </div>

            <AvulsaWaitlistMyEntries />
            <FixedWaitlistMyEntries />

            <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
              <TeacherAgendaSidebar
                ref={sidebarRef}
                teacherId={teacher.id}
                teacherName={teacher.name}
                selectedDate={date}
                onSelectDate={setDate}
                onRequestCancel={requestCancel}
              />

              <Card>
                <CardContent className="pt-6 space-y-4 px-2 sm:px-6">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setDate(addDaysISO(date, -1))}
                      aria-label="Dia anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-auto"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setDate(addDaysISO(date, 1))}
                      aria-label="Próximo dia"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDate(dateISO(new Date()))}
                    >
                      <CalendarDays className="h-4 w-4 mr-2" /> Hoje
                    </Button>
                    <div className="ml-auto text-sm text-muted-foreground">
                      {weekdayShort[weekdayOfISO(date)]}, {fmtDateBR(date)}
                    </div>
                  </div>

                  {loading && !hasLoadedOnceRef.current ? (
                    <div className="py-16 flex items-center justify-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mapa...
                    </div>
                  ) : (
                    <div className="-mx-2 sm:mx-0 [--map-sticky-top:3.5rem] md:[--map-sticky-top:0px]">
                      <CourtMap
                        bookings={bookings}
                        fixedSchedules={fixed}
                        onCellClick={handleCell}
                        highlightAvailability
                        enforceOnlineHours
                        ownTeacherId={teacher.id}
                        priceBands={priceBands}
                        date={date}
                        currentUserId={user?.id ?? null}
                        waitlistLookup={teacherWaitlistLookup}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="clientes">
            <TeacherMyClientsTab teacherId={teacher.id} teacherName={teacher.name} />
          </TabsContent>
        </Tabs>
      </main>

      <RequestReservationDialog
        open={waDialog.open}
        onClose={() => setWaDialog((d) => ({ ...d, open: false }))}
        court={waDialog.court}
        hour={waDialog.hour}
        date={date}
        userName={teacher.name}
        userRole="Professor"
      />

      <Dialog open={!!cancelledChoice} onOpenChange={(v) => !v && settleCancelledChoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Horário cancelado</DialogTitle>
            <DialogDescription>
              {cancelledChoice?.description} O que você quer fazer?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => settleCancelledChoice(null)}>
              Voltar
            </Button>
            <Button variant="outline" onClick={() => settleCancelledChoice("reactivate")}>
              Reativar aula anterior
            </Button>
            <Button onClick={() => settleCancelledChoice("new")}>
              {teacher.can_book_directly ? "Nova locação" : "Pedir nova locação à recepção"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TeacherDirectBookingDialog
        open={directBookingDialog.open}
        onClose={() => setDirectBookingDialog((d) => ({ ...d, open: false }))}
        court={directBookingDialog.court}
        hour={directBookingDialog.hour}
        date={date}
        teacherId={teacher.id}
        teacherName={teacher.name}
        onBooked={load}
      />

      <Dialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desmarcar aula</DialogTitle>
            <DialogDescription>
              {cancelTarget && (
                <>
                  {[cancelTarget.clientName, ...(cancelTarget.siblings ?? []).map((s) => s.clientName)].join(
                    " e ",
                  )}{" "}
                  — {courtLabel(cancelTarget.court)} às {hourLabel(cancelTarget.hour)}
                  {!!cancelTarget.siblings?.length && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Quadra dividida: os {cancelTarget.siblings.length + 1} alunos serão
                      liberados e a quadra ficará disponível.
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {willCharge && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning-foreground" />
              <div>
                Cancelamento com menos de 3h. Uma multa de{" "}
                <strong>R$ {feePreview.toFixed(2).replace(".", ",")}</strong> será
                lançada na conta de {cancelTarget?.clientName}.
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelling}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={cancelling}
            >
              {cancelling && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -------------------------------------------------------------------
// Painel lateral: agenda mensal do professor com botão de cancelar.
// -------------------------------------------------------------------
interface AgendaItem {
  schedule_id: string | null;
  booking_id: string | null;
  kind: "fixed" | "booking";
  the_date: string;
  court: number;
  start_time: string;
  end_time: string;
  client_id: string | null;
  client_name: string | null;
  guest_name: string | null;
  cancelled: boolean;
}

interface TeacherSidebarHandle {
  markCancelledLocally: (target: {
    bookingId: string | null;
    scheduleId: string | null;
    date: string;
  }) => void;
  reload: () => void;
}

const TeacherAgendaSidebar = forwardRef<
  TeacherSidebarHandle,
  {
    teacherId: string;
    teacherName: string;
    selectedDate: string;
    onSelectDate: (iso: string) => void;
    onRequestCancel: (target: CancelTarget) => void | Promise<void>;
  }
>(function TeacherAgendaSidebar(
  { teacherId, teacherName, selectedDate, onSelectDate, onRequestCancel },
  ref,
) {
  
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date(`${selectedDate}T12:00:00-03:00`);
    // Início da semana (domingo)
    d.setDate(d.getDate() - d.getDay());
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reactivateTarget, setReactivateTarget] = useState<AgendaItem | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [changeTarget, setChangeTarget] = useState<TeacherClientChangeTarget | null>(null);



  const monthStart = useMemo(() => dateISO(cursor), [cursor]);
  const monthEnd = useMemo(() => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + 6);
    return dateISO(d);
  }, [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("teacher_agenda_range", {
      _start_date: monthStart,
      _end_date: monthEnd,
    });
    if (error) {
      toast.error(error.message);
      setItems([]);
    } else {
      setItems((data ?? []) as unknown as AgendaItem[]);
    }
    setLoading(false);
  }, [monthStart, monthEnd]);

  useEffect(() => {
    load();
  }, [load]);

  useImperativeHandle(
    ref,
    () => ({
      reload: () => load(),
      markCancelledLocally: ({ bookingId, scheduleId, date }) => {
        setItems((prev) =>
          prev.map((it) => {
            const matchBooking = bookingId && it.booking_id === bookingId;
            const matchFixed =
              scheduleId && it.schedule_id === scheduleId && it.the_date === date;
            return matchBooking || matchFixed ? { ...it, cancelled: true } : it;
          }),
        );
      },
    }),
    [load],
  );

  // Realtime: reflete cancelamentos e novas locações no painel.
  useLiveReload(load, {
    channel: "teacher_agenda",
    tables: ["court_bookings", "client_schedule_exceptions", "client_schedules"],
  });

  const grouped = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const arr = map.get(it.the_date) ?? [];
      arr.push(it);
      map.set(it.the_date, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.court - b.court);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const monthLabel = (() => {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 6);
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `${fmt(cursor)} — ${fmt(end)}`;
  })();

  const todayIso = dateISO(new Date());

  const handleCancel = async (it: AgendaItem) => {
    const hour = Number(it.start_time.slice(0, 2));
    const startTs = new Date(`${it.the_date}T${it.start_time}-03:00`).getTime();
    const clientName = it.client_name ?? it.guest_name ?? "Aluno";
    if (it.kind === "booking" && it.booking_id) {
      await onRequestCancel({
        kind: "booking",
        court: it.court,
        hour,
        clientName,
        clientId: it.client_id,
        bookingId: it.booking_id,
        startTs,
        date: it.the_date,
      });
    } else if (it.kind === "fixed" && it.schedule_id) {
      const fStart = Number(it.start_time.slice(0, 2));
      await onRequestCancel({
        kind: "fixed",
        court: it.court,
        hour: fStart,
        clientName,
        clientId: it.client_id,
        scheduleId: it.schedule_id,
        startTs: new Date(`${it.the_date}T${it.start_time}-03:00`).getTime(),
        date: it.the_date,
        fixedStart: it.start_time,
        fixedEnd: it.end_time,
      });
    }
    // Realtime + realoads mostrarão o estado "Cancelada" quando o cancelamento
    // for de fato confirmado no diálogo. Não marcamos otimisticamente aqui,
    // pois o usuário ainda pode desistir na tela de confirmação.
  };

  const confirmReactivate = async () => {
    if (!reactivateTarget) return;
    const it = reactivateTarget;
    setReactivating(true);
    let data: unknown = null;
    let error: { message: string } | null = null;
    if (it.kind === "fixed" && it.schedule_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (supabase as any).rpc("professor_reactivate_fixed_occurrence", {
        _schedule_id: it.schedule_id,
        _occurrence_date: it.the_date,
      });
      data = r.data;
      error = r.error;
    } else if (it.kind === "booking" && it.booking_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (supabase as any).rpc("professor_reactivate_booking", {
        _booking_id: it.booking_id,
      });
      data = r.data;
      error = r.error;
    } else {
      setReactivating(false);
      toast.error("Não foi possível identificar a ocorrência cancelada.");
      return;
    }
    setReactivating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as { ok: boolean; error?: string } | null;
    if (!res?.ok) {
      toast.error(res?.error ?? "Não foi possível reativar a reserva.");
      return;
    }
    toast.success("Reserva reativada com sucesso.");
    // Atualização otimista imediata: remove o estado "cancelada" do card
    setItems((prev) =>
      prev.map((x) => {
        const matchBooking =
          it.kind === "booking" && it.booking_id && x.booking_id === it.booking_id;
        const matchFixed =
          it.kind === "fixed" &&
          it.schedule_id &&
          x.schedule_id === it.schedule_id &&
          x.the_date === it.the_date;
        return matchBooking || matchFixed ? { ...x, cancelled: false } : x;
      }),
    );
    setReactivateTarget(null);
    void load();
  };


  const shiftWeek = (weeks: number) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + weeks * 7);
    setCursor(d);
  };

  return (
    <Card className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <CardContent className="pt-4 px-3 space-y-3">
        <div className="flex items-center justify-between gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => shiftWeek(-1)}
            aria-label="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-semibold text-center flex-1 truncate">
            {monthLabel}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => shiftWeek(1)}
            aria-label="Próxima semana"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">Minhas aulas</div>

        {loading ? (
          <div className="py-8 flex items-center justify-center text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
          </div>
        ) : grouped.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Nenhuma aula nesta semana.
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([iso, dayItems]) => {
              const wd = weekdayOfISO(iso);
              const isPast = iso < todayIso;
              const isSelected = iso === selectedDate;
              return (
                <div key={iso} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => onSelectDate(iso)}
                    className={`w-full text-left text-xs font-semibold px-2 py-1 rounded ${
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {weekdayShort[wd]}, {fmtDateBR(iso)}
                  </button>
                  <div className="space-y-1">
                    {dayItems.map((it) => {
                      const hour = Number(it.start_time.slice(0, 2));
                      const startTs = new Date(`${it.the_date}T${it.start_time}-03:00`).getTime();
                      const canCancel = !it.cancelled && startTs > Date.now();
                      return (
                        <div
                          key={`${it.kind}-${it.schedule_id ?? it.booking_id}-${it.the_date}-${it.start_time}-${it.court}`}
                          className={`flex items-center justify-between gap-2 rounded-md border p-2 text-xs ${
                            it.cancelled || isPast ? "opacity-50" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">
                              {it.client_name ?? it.guest_name ?? "Aluno"}
                            </div>
                            <div className="text-muted-foreground truncate">
                              {courtShort(it.court)} • {it.start_time.slice(0, 5)}–{it.end_time.slice(0, 5)}
                            </div>
                          </div>
                          {it.cancelled ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] uppercase tracking-wide text-destructive font-semibold">
                                Cancelada
                              </span>
                              {(it.kind === "fixed" && it.schedule_id) ||
                              (it.kind === "booking" && it.booking_id) ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setReactivateTarget(it)}
                                >
                                  Reativar
                                </Button>
                              ) : null}
                            </div>
                          ) : canCancel ? (
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => handleCancel(it)}
                              >
                                Cancelar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px]"
                                onClick={() =>
                                  setChangeTarget({
                                    kind: it.kind,
                                    scheduleId: it.schedule_id,
                                    bookingId: it.booking_id,
                                    occurrenceDate: it.the_date,
                                    court: it.court,
                                    startTime: it.start_time,
                                    endTime: it.end_time,
                                    currentClientId: it.client_id,
                                    currentClientName:
                                      it.client_name ?? it.guest_name ?? "Aluno",
                                    teacherId,
                                    teacherName,
                                  })
                                }
                              >
                                Alterar cliente
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                              Realizada
                            </span>
                          )}

                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <Dialog open={!!reactivateTarget} onOpenChange={(v) => !v && setReactivateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reativar reserva</DialogTitle>
          </DialogHeader>
          {reactivateTarget && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Aluno: </span>
                <span className="font-medium">
                  {reactivateTarget.client_name ?? reactivateTarget.guest_name ?? "Aluno"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Horário: </span>
                {courtShort(reactivateTarget.court)} • {reactivateTarget.start_time.slice(0, 5)}–
                {reactivateTarget.end_time.slice(0, 5)}
              </div>
              <p className="text-xs text-muted-foreground">
                A reserva voltará com a duração original. Se a quadra já foi ocupada por outra
                pessoa neste horário, a reativação não será permitida.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivateTarget(null)}>
              Voltar
            </Button>
            <Button onClick={confirmReactivate} disabled={reactivating}>
              {reactivating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar reativação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TeacherClientChangeDialog
        target={changeTarget}
        onClose={() => setChangeTarget(null)}
        onApplied={() => { void load(); }}
      />
    </Card>
  );
});



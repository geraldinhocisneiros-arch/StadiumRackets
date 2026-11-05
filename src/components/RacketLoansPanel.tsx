import { useEffect, useState, type ComponentType } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, History, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { logAction } from "@/lib/audit";
import {
  LOAN_ITEM_COLUMN,
  LOAN_TABLE,
  RACKETS,
  fmtLoanTime,
  isLoanOverdue,
  loanColumns,
  useOpenRemoteLoans,
  type LoanKind,
  type RemoteHolderSuggestion,
  type RemoteLoan,
} from "@/lib/racket-loans";

// O lucide não tem raquete: cabeça oval + cabo, no mesmo traço dos ícones dele.
function RacketIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="14.5" cy="9.5" rx="6" ry="7" transform="rotate(45 14.5 9.5)" />
      <path d="M10 14 3 21" />
    </svg>
  );
}

// Textos do empréstimo de raquetes.
interface LoanTexts {
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: readonly number[];
  gridClass: string;
  /** Quadrado mais compacto (faixa com muitos itens). */
  compact?: boolean;
  /** Rótulo curto no botão ("Raquete 1"). */
  short: (n: number) => string;
  /** Nome completo ("Raquete 1"). */
  name: (n: number) => string;
  dialogTitle: (n: number) => string;
  allIn: string;
  out: (count: number) => string;
  atReception: string;
  outOfReception: string;
  whoTook: string;
  whoTookRequired: string;
  alreadyOut: string;
  returnedButton: string;
  returned: (n: number) => string;
  historyTitle: string;
  auditEntity: string;
}

const LOAN_TEXTS: Record<LoanKind, LoanTexts> = {
  racket: {
    title: "Raquetes",
    icon: RacketIcon,
    items: RACKETS,
    gridClass: "grid-cols-2 sm:grid-cols-4",
    short: (n) => `Raquete ${n}`,
    name: (n) => `Raquete ${n}`,
    dialogTitle: (n) => `Raquete ${n}`,
    allIn: "todas na recepção",
    out: (c) => `${c} fora da recepção`,
    atReception: "Raquete na recepção. Registre quem está levando.",
    outOfReception: "Raquete fora da recepção.",
    whoTook: "Quem levou a raquete *",
    whoTookRequired: "Informe quem levou a raquete.",
    alreadyOut: "Esta raquete já consta como emprestada. Atualize a tela.",
    returnedButton: "Raquete devolvida",
    returned: (n) => `Raquete ${n} devolvida.`,
    historyTitle: "Últimos registros desta raquete",
    auditEntity: "racket_loan",
  },
};

/** Faixa com as 4 raquetes de empréstimo da recepção. */
export function RacketLoansPanel() {
  return <LoanPanel kind="racket" />;
}

function LoanPanel({
  kind,
  suggestionsByItem,
}: {
  kind: LoanKind;
  suggestionsByItem?: Record<number, RemoteHolderSuggestion[]>;
}) {
  const t = LOAN_TEXTS[kind];
  const Icon = t.icon;
  const { openLoans, loading, reload } = useOpenRemoteLoans(true, kind);
  const [selected, setSelected] = useState<number | null>(null);

  const outCount = Object.keys(openLoans).length;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{t.title}</span>
        <span className="text-muted-foreground">
          {loading ? "…" : outCount === 0 ? t.allIn : t.out(outCount)}
        </span>
      </div>
      <div className={cn("grid", t.compact ? "gap-1" : "gap-1.5", t.gridClass)}>
        {t.items.map((c) => {
          const loan = openLoans[c];
          const overdue = loan ? isLoanOverdue(loan) : false;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setSelected(c)}
              title={
                loan
                  ? `${t.name(c)} com ${loan.holder_name} desde ${fmtLoanTime(loan.lent_at)}`
                  : `${t.name(c)} na recepção — clique para registrar entrega`
              }
              className={cn(
                "min-w-0 rounded-md border text-left transition-colors hover:bg-muted/60",
                t.compact ? "px-1.5 py-1 text-[11px] leading-tight" : "px-2 py-1.5 text-xs",
                !loan && "border-green-600/40 bg-green-600/5",
                loan && !overdue && "border-amber-500/60 bg-amber-500/10",
                loan && overdue && "border-red-600/60 bg-red-600/10",
              )}
            >
              <div className="font-semibold">{t.short(c)}</div>
              <div className="truncate text-muted-foreground">
                {loading ? "…" : loan ? loan.holder_name : "Recepção"}
              </div>
              {loan && (
                <div
                  className={cn(
                    "text-[10px]",
                    overdue ? "text-red-600 font-medium" : "text-muted-foreground",
                  )}
                >
                  desde {fmtLoanTime(loan.lent_at)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <RemoteLoanDialog
        kind={kind}
        court={selected}
        openLoan={selected != null ? (openLoans[selected] ?? null) : null}
        suggestions={selected != null ? (suggestionsByItem?.[selected] ?? []) : []}
        onOpenChange={(v) => !v && setSelected(null)}
        onChanged={() => void reload()}
      />
    </div>
  );
}

function RemoteLoanDialog({
  kind,
  court,
  openLoan,
  suggestions,
  onOpenChange,
  onChanged,
}: {
  kind: LoanKind;
  court: number | null;
  openLoan: RemoteLoan | null;
  suggestions: RemoteHolderSuggestion[];
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [holderName, setHolderName] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<RemoteLoan[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);

  const t = LOAN_TEXTS[kind];
  const table = LOAN_TABLE[kind];
  const open = court != null;

  useEffect(() => {
    if (court == null) return;
    setHolderName("");
    setClientId(null);
    setBookingId(null);
    setNote("");
    void loadHistory(court);
  }, [court]);

  const loadHistory = async (c: number) => {
    setHistoryLoading(true);
    try {
      const { data, error } = await (
        supabase.from("racket_loans").select(loanColumns(kind)).eq("racket", c)
      )
        .order("lent_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      const list = (data ?? []) as unknown as RemoteLoan[];
      setHistory(list);
      const ids = Array.from(
        new Set(list.flatMap((l) => [l.lent_by, l.returned_by]).filter(Boolean)),
      ) as string[];
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        setNames(Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name ?? ""])));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar histórico do controle.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const pickSuggestion = (s: RemoteHolderSuggestion) => {
    setHolderName(s.name);
    setClientId(s.client_id);
    setBookingId(s.booking_id);
  };

  const handleLend = async () => {
    if (court == null) return;
    const name = holderName.trim();
    if (!name) {
      toast.error(t.whoTookRequired);
      return;
    }
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const row = {
        holder_name: name,
        client_id: clientId,
        booking_id: bookingId,
        notes: note.trim() || null,
        lent_by: uid,
      };
      const { data, error } = await (
        supabase.from("racket_loans").insert({ ...row, racket: court })
      )
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new Error(t.alreadyOut);
        throw error;
      }
      await logAction({
        entity: t.auditEntity,
        entity_id: data.id,
        action: "create",
        details: { [LOAN_ITEM_COLUMN[kind]]: court, holder_name: name },
      });
      toast.success(`${t.name(court)} entregue para ${name}.`);
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a entrega.");
    } finally {
      setSaving(false);
    }
  };

  const handleReturn = async () => {
    if (!openLoan) return;
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { error } = await supabase
        .from(table)
        .update({
          returned_at: new Date().toISOString(),
          returned_by: uid,
          return_notes: note.trim() || null,
        })
        .eq("id", openLoan.id)
        .is("returned_at", null);
      if (error) throw error;
      await logAction({
        entity: t.auditEntity,
        entity_id: openLoan.id,
        action: "update",
        details: { [LOAN_ITEM_COLUMN[kind]]: openLoan.court, returned: true },
      });
      toast.success(t.returned(openLoan.court));
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a devolução.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{court != null ? t.dialogTitle(court) : ""}</DialogTitle>
          <DialogDescription>{openLoan ? t.outOfReception : t.atReception}</DialogDescription>
        </DialogHeader>

        {openLoan ? (
          <div className="space-y-3 text-sm">
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3",
                isLoanOverdue(openLoan)
                  ? "border-red-600/40 bg-red-600/10"
                  : "border-amber-500/40 bg-amber-500/10",
              )}
            >
              <AlertTriangle
                className={cn(
                  "h-4 w-4 mt-0.5",
                  isLoanOverdue(openLoan) ? "text-red-600" : "text-amber-600",
                )}
              />
              <div>
                Com <strong>{openLoan.holder_name}</strong> desde {fmtLoanTime(openLoan.lent_at)}
                {openLoan.lent_by && names[openLoan.lent_by]
                  ? ` (entregue por ${names[openLoan.lent_by]})`
                  : ""}
                .
                {openLoan.notes ? (
                  <div className="text-xs text-muted-foreground mt-1">{openLoan.notes}</div>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação da devolução (opcional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: devolvido por outra pessoa"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {suggestions.length > 0 && (
              <div className="space-y-1.5">
                <Label>Jogando nesta quadra agora</Label>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s, i) => (
                    <Button
                      key={`${s.name}-${i}`}
                      type="button"
                      size="sm"
                      variant={holderName === s.name ? "default" : "outline"}
                      className="h-auto py-1 px-2 text-xs"
                      onClick={() => pickSuggestion(s)}
                    >
                      {s.name} <span className="ml-1 opacity-70">{s.timeLabel}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t.whoTook}</Label>
              <Input
                value={holderName}
                onChange={(e) => {
                  setHolderName(e.target.value);
                  setClientId(null);
                  setBookingId(null);
                }}
                placeholder="Nome de quem pegou"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: deixou a chave do carro"
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <History className="h-4 w-4" /> {t.historyTitle}
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border text-xs">
            {historyLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <div className="p-3 text-muted-foreground">Nenhum registro ainda.</div>
            ) : (
              <ul className="divide-y">
                {history.map((l) => (
                  <li key={l.id} className="p-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{l.holder_name}</div>
                      <div className="text-muted-foreground">
                        saiu {fmtLoanTime(l.lent_at)}
                        {l.lent_by && names[l.lent_by] ? ` · por ${names[l.lent_by]}` : ""}
                      </div>
                      {(l.notes || l.return_notes) && (
                        <div className="text-muted-foreground italic">
                          {[l.notes, l.return_notes].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {l.returned_at ? (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> voltou {fmtLoanTime(l.returned_at)}
                        </span>
                      ) : (
                        <span className="text-amber-600 font-medium">em aberto</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Fechar
          </Button>
          {openLoan ? (
            <Button onClick={handleReturn} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.returnedButton}
            </Button>
          ) : (
            <Button onClick={handleLend} disabled={saving || !holderName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar entrega
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

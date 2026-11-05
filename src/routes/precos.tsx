import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { courtShort } from "@/lib/court-map";
import { COURTS_PICKLEBALL, COURTS_TENIS, WEEKDAY_LABELS, type PriceBand } from "@/lib/pricing";
import { fmtBRL } from "@/lib/format";

export const Route = createFileRoute("/precos")({
  component: () => (
    <RequireAuth>
      <PrecosPage />
    </RequireAuth>
  ),
});

interface CategoryRow {
  id: string;
  name: string;
}

type CourtScope = "all" | "tenis" | "pickleball" | "custom";

const sameCourts = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((n, i) => n === b[i]);

const courtScopeFor = (courts: number[] | null | undefined): CourtScope => {
  if (!courts || courts.length === 0) return "all";
  if (sameCourts(courts, COURTS_TENIS)) return "tenis";
  if (sameCourts(courts, COURTS_PICKLEBALL)) return "pickleball";
  return "custom";
};

// Ordem de exibição dos dias: segunda primeiro, domingo por último.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Dias da semana (0–6) que caem dentro do intervalo de datas (inclusivo). */
const weekdaysInRange = (startsOn: string, endsOn: string): number[] => {
  if (!startsOn || !endsOn || endsOn < startsOn) return [];
  const found = new Set<number>();
  let d = new Date(`${startsOn}T12:00:00`);
  for (let i = 0; i < 7 && toYmd(d) <= endsOn; i++) {
    found.add(d.getDay());
    d = addDays(d, 1);
  }
  return [...found];
};

const courtsLabel = (courts: number[] | null) => {
  const scope = courtScopeFor(courts);
  if (scope === "all" || !courts) return "Todas";
  if (scope === "tenis") return "Tênis";
  if (scope === "pickleball") return "Pickleball";
  return [...courts].sort((a, b) => a - b).map(courtShort).join(", ");
};

const categoriesLabel = (ids: string[] | null, categories: CategoryRow[]) => {
  if (!ids || ids.length === 0) return "Todas";
  return ids
    .map((id) => categories.find((c) => c.id === id)?.name ?? "?")
    .join(", ");
};

function PrecosPage() {
  const { isAdmin } = useAuth();
  const [bands, setBands] = useState<PriceBand[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PriceBand | null>(null);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const [{ data: pb }, { data: cs }] = await Promise.all([
      supabase
        .from("price_table")
        .select("*")
        .order("weekday")
        .order("start_time"),
      supabase
        .from("client_categories")
        .select("id, name")
        .eq("active", true)
        .order("name"),
    ]);
    setBands((pb as unknown as PriceBand[]) ?? []);
    setCategories((cs as unknown as CategoryRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const sortedBands = useMemo(
    () =>
      [...bands].sort(
        (a, b) =>
          a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
      ),
    [bands],
  );

  const handleDelete = async (id: string) => {
    if (!(await confirm("Excluir esta faixa de preço?"))) return;
    const { error } = await supabase.from("price_table").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Faixa removida.");
      load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tabela de preços</h1>
          <p className="text-muted-foreground">
            Valor por hora, por dia da semana, faixa de horário, quadras e categorias.
            O valor é preenchido automaticamente no cadastro de pagamento. Em
            sobreposições de faixas, vale a faixa mais <strong>específica</strong>{" "}
            (quadra/categoria específica &gt; promoção &gt; faixa geral).
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)}>
                <Plus className="h-4 w-4 mr-2" /> Nova faixa
              </Button>
            </DialogTrigger>
            <BandDialog
              editing={editing}
              categories={categories}
              onSaved={load}
              onClose={() => setOpen(false)}
            />
          </Dialog>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">Carregando...</div>
      ) : sortedBands.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhuma faixa cadastrada ainda.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead>Categorias</TableHead>
                  <TableHead>Quadras</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Término</TableHead>
                  <TableHead>Promoção</TableHead>
                  <TableHead className="text-right">Valor / hora</TableHead>
                  {isAdmin && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedBands.map((b) => {
                  const hasPromo = !!(b.starts_on || b.ends_on);
                  const fmtD = (d?: string | null) =>
                    d ? d.split("-").reverse().join("/") : "—";
                  return (
                  <TableRow key={b.id} className={hasPromo ? "bg-amber-50 dark:bg-amber-950/20" : undefined}>
                    <TableCell>{WEEKDAY_LABELS[b.weekday]}</TableCell>
                    <TableCell className="text-xs">
                      {categoriesLabel(b.categories, categories)}
                    </TableCell>
                    <TableCell className="text-xs">{courtsLabel(b.courts)}</TableCell>
                    <TableCell>{b.start_time.slice(0, 5)}</TableCell>
                    <TableCell>{b.end_time.slice(0, 5)}</TableCell>
                    <TableCell className="text-xs">
                      {hasPromo ? (
                        <span
                          className="inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 px-1.5 py-0.5 font-medium"
                          title="Vale só na compra online (Mercado Pago) — recepção e horário fixo usam a tabela normal"
                        >
                          {fmtD(b.starts_on)} → {fmtD(b.ends_on)} (só online)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Permanente</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {b.discount_percent != null ? (
                        <span title="Desconto sobre o valor da tabela normal">
                          −{Number(b.discount_percent).toLocaleString("pt-BR")}%
                        </span>
                      ) : (
                        fmtBRL(Number(b.price_per_hour))
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(b);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(b.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BandDialog({
  editing,
  categories,
  onSaved,
  onClose,
}: {
  editing: PriceBand | null;
  categories: CategoryRow[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [pricePerHour, setPricePerHour] = useState("");
  const [courtScope, setCourtScope] = useState<CourtScope>("all");
  const [isPromo, setIsPromo] = useState(false);
  const [valueMode, setValueMode] = useState<"fixed" | "percent">("fixed");
  const [discountPercent, setDiscountPercent] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSelectedCategories(editing?.categories ?? []);
    setWeekdays(editing ? [editing.weekday] : [1, 2, 3, 4]);
    setStartTime(editing?.start_time ? editing.start_time.slice(0, 5) : "");
    setEndTime(editing?.end_time ? editing.end_time.slice(0, 5) : "");
    setPricePerHour(
      editing?.price_per_hour != null && editing.discount_percent == null
        ? String(editing.price_per_hour)
        : "",
    );
    setCourtScope(courtScopeFor(editing?.courts));
    const promo = !!(editing?.starts_on || editing?.ends_on);
    setIsPromo(promo);
    setValueMode(editing?.discount_percent != null ? "percent" : "fixed");
    setDiscountPercent(editing?.discount_percent != null ? String(editing.discount_percent) : "");
    setStartsOn(editing?.starts_on ?? "");
    setEndsOn(editing?.ends_on ?? "");
  }, [editing]);

  const toggleWeekday = (wd: number) => {
    setWeekdays((prev) => (prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd]));
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Ao escolher as datas da promoção, marca automaticamente os dias da
  // semana que caem no período (dá pra desmarcar depois, ex.: promoção de um
  // mês inteiro só nos fins de semana).
  const setPromoDates = (from: string, to: string) => {
    setStartsOn(from);
    setEndsOn(to);
    const inRange = weekdaysInRange(from, to);
    if (inRange.length > 0) setWeekdays(inRange);
  };

  const today = new Date();
  const nextSaturday = addDays(today, today.getDay() === 0 ? -1 : 6 - today.getDay());
  const datePresets: { label: string; from: string; to: string }[] = [
    { label: "Só hoje", from: toYmd(today), to: toYmd(today) },
    { label: "Hoje e amanhã", from: toYmd(today), to: toYmd(addDays(today, 1)) },
    {
      label: today.getDay() === 0 || today.getDay() === 6 ? "Este fim de semana" : "Próximo fim de semana",
      from: toYmd(today.getDay() === 0 ? today : nextSaturday),
      to: toYmd(addDays(nextSaturday, 1)),
    },
    { label: "Próximos 7 dias", from: toYmd(today), to: toYmd(addDays(today, 6)) },
  ];

  const weekdayPresets: { label: string; days: number[] }[] = [
    { label: "Seg a qui", days: [1, 2, 3, 4] },
    { label: "Seg a sex", days: [1, 2, 3, 4, 5] },
    { label: "Fim de semana", days: [6, 0] },
    { label: "Todos", days: [0, 1, 2, 3, 4, 5, 6] },
  ];

  const usePercent = isPromo && valueMode === "percent";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startTime || !endTime) {
      toast.error("Informe os horários.");
      return;
    }
    if (endTime <= startTime) {
      toast.error("O término deve ser depois do início.");
      return;
    }
    if (weekdays.length === 0) {
      toast.error("Marque pelo menos um dia da semana.");
      return;
    }
    const price = Number(pricePerHour);
    const pct = Number(discountPercent.replace(",", "."));
    if (usePercent) {
      if (!(pct > 0 && pct < 100)) {
        toast.error("Informe um desconto entre 1% e 99%.");
        return;
      }
    } else if (pricePerHour === "" || !(price >= 0)) {
      toast.error("Valor inválido.");
      return;
    }
    let daysToSave = weekdays;
    if (isPromo) {
      if (!startsOn || !endsOn) {
        toast.error("Informe as datas de início e término da promoção.");
        return;
      }
      if (endsOn < startsOn) {
        toast.error("A data de término da promoção deve ser depois do início.");
        return;
      }
      // Dia marcado que não cai no período nunca seria usado — não grava.
      const inRange = weekdaysInRange(startsOn, endsOn);
      daysToSave = weekdays.filter((wd) => inRange.includes(wd));
      if (daysToSave.length === 0) {
        toast.error("Nenhum dos dias marcados cai dentro do período da promoção.");
        return;
      }
    }
    setSubmitting(true);
    const courts =
      courtScope === "tenis"
        ? COURTS_TENIS
        : courtScope === "pickleball"
          ? COURTS_PICKLEBALL
          : courtScope === "custom"
            ? (editing?.courts ?? null)
            : null;
    const base = {
      categories: selectedCategories.length === 0 ? null : selectedCategories,
      start_time: startTime,
      end_time: endTime,
      price_per_hour: usePercent ? 0 : price,
      discount_percent: usePercent ? pct : null,
      courts,
      starts_on: isPromo ? startsOn : null,
      ends_on: isPromo ? endsOn : null,
    };
    let error: { message: string } | null = null;
    if (editing) {
      const del = await supabase.from("price_table").delete().eq("id", editing.id);
      if (del.error) error = del.error;
    }
    if (!error) {
      const ins = await supabase
        .from("price_table")
        .insert(daysToSave.map((wd) => ({ ...base, weekday: wd })));
      if (ins.error) error = ins.error;
    }
    setSubmitting(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Salvo!");
      onSaved();
      onClose();
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? "Editar faixa" : "Nova faixa de preço"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox
              checked={isPromo}
              onCheckedChange={(v) => {
                setIsPromo(v === true);
                if (v !== true) setValueMode("fixed");
              }}
            />
            Preço promocional (vale só num intervalo de datas)
          </label>
          {isPromo && (
            <>
              <p className="text-xs text-muted-foreground">
                <strong>Vale só para a compra online</strong>, paga pelo
                cliente no Checkout do Mercado Pago (Portal do Cliente).
                Reserva lançada pela recepção (avulso ou mensalista, qualquer
                categoria) e horário fixo/mensalista <strong>nunca</strong>{" "}
                usam o preço promocional — sempre seguem a tabela normal, com
                os descontos padrão do cliente.
              </p>
              <p className="text-xs text-muted-foreground">
                Nas datas abaixo, a promoção substitui a(s) faixa(s)
                permanente(s) que cobrem as mesmas quadras/categorias — mesmo
                que seja mais larga em horário. Uma faixa permanente de
                categoria específica continua valendo sobre uma promoção mais
                genérica.
              </p>
              <div className="flex flex-wrap gap-2">
                {datePresets.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPromoDates(p.from, p.to)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>De</Label>
                  <Input
                    type="date"
                    value={startsOn}
                    onChange={(e) => setPromoDates(e.target.value, endsOn)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Até</Label>
                  <Input
                    type="date"
                    value={endsOn}
                    onChange={(e) => setPromoDates(startsOn, e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="space-y-2">
          <Label>
            Categorias{" "}
            <span className="text-xs text-muted-foreground font-normal">
              (deixe vazio para "todas")
            </span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm cursor-pointer"
              >
                <Checkbox
                  checked={selectedCategories.includes(c.id)}
                  onCheckedChange={() => toggleCategory(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>
            Dias da semana
            {isPromo && (
              <span className="text-xs text-muted-foreground font-normal">
                {" "}
                (marcados pelas datas da promoção — desmarque os que não valem)
              </span>
            )}
          </Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_ORDER.map((wd) => (
              <label
                key={wd}
                className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm cursor-pointer"
              >
                <Checkbox checked={weekdays.includes(wd)} onCheckedChange={() => toggleWeekday(wd)} />
                {WEEKDAY_SHORT[wd]}
              </label>
            ))}
          </div>
          {!isPromo && (
            <div className="flex flex-wrap gap-2">
              {weekdayPresets.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setWeekdays(p.days)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Quadras</Label>
          <RadioGroup
            value={courtScope}
            onValueChange={(v) => setCourtScope(v as CourtScope)}
            className="flex flex-wrap gap-2"
          >
            {(
              [
                ["all", "Todas as quadras"],
                ["tenis", "Só tênis (saibro)"],
                ["pickleball", "Só pickleball (PB1–PB3)"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm cursor-pointer"
              >
                <RadioGroupItem value={value} />
                {label}
              </label>
            ))}
            {courtScopeFor(editing?.courts) === "custom" && (
              <label className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm cursor-pointer">
                <RadioGroupItem value="custom" />
                Manter atual ({courtsLabel(editing?.courts ?? null)})
              </label>
            )}
          </RadioGroup>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Início</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Término</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        {isPromo && (
          <div className="space-y-2">
            <Label>Tipo de promoção</Label>
            <RadioGroup
              value={valueMode}
              onValueChange={(v) => setValueMode(v as "fixed" | "percent")}
              className="flex flex-wrap gap-2"
            >
              <label className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm cursor-pointer">
                <RadioGroupItem value="fixed" />
                Valor fixo por hora
              </label>
              <label className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm cursor-pointer">
                <RadioGroupItem value="percent" />
                % de desconto sobre a tabela
              </label>
            </RadioGroup>
          </div>
        )}
        {usePercent ? (
          <div className="space-y-2">
            <Label>Desconto (%)</Label>
            <Input
              type="number"
              step="0.01"
              min="1"
              max="99"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Aplicado sobre o valor da tabela normal de cada horário/quadra
              (ex.: 20% num horário de R$ 120,00 = R$ 96,00). Se a tabela
              normal for reajustada, a promoção acompanha.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Valor por hora (R$)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={pricePerHour}
              onChange={(e) => setPricePerHour(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

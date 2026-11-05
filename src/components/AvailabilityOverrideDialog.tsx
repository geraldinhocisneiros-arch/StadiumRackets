import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { COURTS, courtLabel, fmtDateBR } from "@/lib/court-map";
import { calcPrice, weekdayFromYmd, type PriceBand } from "@/lib/pricing";
import { isWithinOnlineOperatingHours } from "@/lib/operating-hours";

export interface AvailabilityOverride {
  id: string;
  court: number;
  availability_date: string;
  start_time: string;
  end_time: string;
  hourly_price: number;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string;
  priceBands: PriceBand[];
  existing: AvailabilityOverride[];
  onSaved: () => void;
  initialCourt?: number | null;
  initialHour?: number | null;
}

const HOURS = Array.from({ length: 19 }, (_, i) => 5 + i); // 05:00..23:00

export function AvailabilityOverrideDialog({
  open,
  onOpenChange,
  date,
  priceBands,
  existing,
  onSaved,
  initialCourt,
  initialHour,
}: Props) {
  const [court, setCourt] = useState<number>(1);
  const [startH, setStartH] = useState<number>(18);
  const [endH, setEndH] = useState<number>(19);
  const [price, setPrice] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCourt(initialCourt ?? 1);
    const sh = initialHour ?? 18;
    setStartH(sh);
    setEndH(Math.min(sh + 1, 24));
    setNotes("");
  }, [open, initialCourt, initialHour]);

  // Sugere preço automaticamente a partir da tabela de preços.
  useEffect(() => {
    if (!open) return;
    const wd = weekdayFromYmd(date);
    if (wd == null) return;
    const startTime = `${String(startH).padStart(2, "0")}:00`;
    const endTime = `${String(Math.min(startH + 1, 24)).padStart(2, "0")}:00`;
    const calc = calcPrice({
      bands: priceBands,
      weekday: wd,
      startTime,
      endTime,
      court,
      date,
    });
    if (calc && calc.matched && calc.total > 0) {
      setPrice(calc.total.toFixed(2));
    } else {
      setPrice("");
    }
  }, [open, court, startH, date, priceBands]);

  const save = async () => {
    const p = Number(price.replace(",", "."));
    if (!Number.isFinite(p) || p < 0) {
      toast.error("Informe um preço/hora válido.");
      return;
    }
    if (endH <= startH) {
      toast.error("O horário final deve ser maior que o inicial.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("court_availability_overrides")
      .insert({
        court,
        availability_date: date,
        start_time: `${String(startH).padStart(2, "0")}:00:00`,
        end_time: `${String(endH).padStart(2, "0")}:00:00`,
        hourly_price: p,
        notes: notes.trim() || null,
      });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Quadra disponibilizada.");
    onSaved();
  };

  const cancelOverride = async (id: string) => {
    const { error } = await supabase
      .from("court_availability_overrides")
      .update({ active: false, cancelled_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Disponibilização removida.");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Disponibilizar quadra</DialogTitle>
          <DialogDescription>
            Libere manualmente uma quadra e um horário para {fmtDateBR(date)} com preço específico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Quadra</Label>
              <Select value={String(court)} onValueChange={(v) => setCourt(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURTS.map((c) => (
                    <SelectItem key={c} value={String(c)}>{courtLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Início</Label>
              <Select value={String(startH)} onValueChange={(v) => {
                const h = Number(v);
                setStartH(h);
                if (endH <= h) setEndH(Math.min(h + 1, 24));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fim</Label>
              <Select value={String(endH)} onValueChange={(v) => setEndH(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOURS.filter((h) => h > startH).concat([24]).map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h >= 24 ? "00:00" : `${String(h).padStart(2, "0")}:00`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Preço por hora (R$)</Label>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0,00"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Sugestão calculada pela tabela de preços; edite se quiser.
            </p>
          </div>

          <div>
            <Label>Observação (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: liberado para batedor"
            />
          </div>

          {!isWithinOnlineOperatingHours(date, startH, endH) && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-100">
              <strong>Fora do horário online.</strong> Esta disponibilização fica
              visível apenas no mapa interno — clientes e professores não
              conseguem visualizar nem solicitar reserva por este horário.
            </div>
          )}
        </div>

        {existing.length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <div className="text-sm font-semibold">Disponibilizações ativas neste dia</div>
            <ul className="space-y-1.5 max-h-40 overflow-auto pr-1">
              {existing.map((o) => (
                <li key={o.id} className="flex items-center justify-between text-sm rounded border p-2">
                  <span>
                    {courtLabel(o.court)} · {o.start_time.slice(0, 5)}–{o.end_time.slice(0, 5)} · R$ {Number(o.hourly_price).toFixed(2)}/h
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void cancelOverride(o.id)}
                    title="Remover disponibilização"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Disponibilizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

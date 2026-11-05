import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface StockItem {
  id: string;
  name: string;
  current_quantity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "entrada" | "ajuste";
  items: StockItem[];
  onSaved: () => void;
}

export function StockEntryDialog({ open, onOpenChange, mode, items, onSaved }: Props) {
  const [itemId, setItemId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setItemId(items[0]?.id ?? "");
      setQuantity("");
      setNotes("");
    }
  }, [open, items]);

  const handleSave = async () => {
    if (!itemId) {
      toast.error("Selecione um produto");
      return;
    }
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty === 0) {
      toast.error(mode === "ajuste" ? "Informe a diferença (use negativo para reduzir)" : "Informe uma quantidade");
      return;
    }
    if (mode === "entrada" && qty < 0) {
      toast.error("Quantidade deve ser positiva");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      setSaving(false);
      return;
    }

    const delta = mode === "entrada" ? Math.abs(qty) : qty;
    const movementType = mode === "entrada" ? "entrada" : "ajuste";

    const { error: movErr } = await supabase.from("stock_movements").insert({
      item_id: itemId,
      movement_type: movementType,
      quantity: Math.abs(delta),
      notes: notes.trim() || null,
      recorded_by: userData.user?.id ?? null,
    });
    if (movErr) {
      toast.error(movErr.message);
      setSaving(false);
      return;
    }
    const { error: updErr } = await supabase
      .from("stock_items")
      .update({ current_quantity: item.current_quantity + delta })
      .eq("id", itemId);
    if (updErr) {
      toast.error(updErr.message);
      setSaving(false);
      return;
    }
    toast.success(mode === "entrada" ? "Estoque reposto" : "Ajuste registrado");
    setSaving(false);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "entrada" ? "Repor estoque" : "Ajustar estoque"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Produto</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} (atual: {i.current_quantity})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>
              {mode === "entrada" ? "Quantidade a adicionar" : "Diferença (use negativo para reduzir)"}
            </Label>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={mode === "entrada" ? "Ex: 10" : "Ex: -2"}
            />
          </div>
          <div>
            <Label>Observação</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={mode === "entrada" ? "Ex: Compra fornecedor X" : "Ex: Contagem física"}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

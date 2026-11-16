import { useEffect, useState } from "react";
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

export interface LojinhaProduct {
  id: string;
  name: string;
  price: number;
  current_quantity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = cadastrar novo produto */
  product: LojinhaProduct | null;
  onSaved: () => void;
}

const parseMoney = (v: string): number | null => {
  const s = v.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return null;
  // Aceita "12,50", "12.50" e "1.234,50".
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

export function StockProductDialog({ open, onOpenChange, product, onSaved }: Props) {
  const isNew = product == null;
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? "");
    setPrice(product ? String(product.price ?? 0).replace(".", ",") : "");
    setQuantity(product ? String(product.current_quantity) : "");
  }, [open, product]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Informe o nome do produto");
      return;
    }
    const priceNum = parseMoney(price);
    if (priceNum == null) {
      toast.error("Informe um preço válido (ex.: 25,00)");
      return;
    }
    const qty = quantity.trim() === "" ? 0 : parseInt(quantity, 10);
    if (Number.isNaN(qty) || qty < 0) {
      toast.error("Quantidade inválida");
      return;
    }

    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    if (isNew) {
      const { data, error } = await supabase
        .from("stock_items")
        .insert({ name: trimmed, price: priceNum, current_quantity: qty })
        .select("id")
        .single();
      if (error) {
        setSaving(false);
        toast.error(
          error.code === "23505" ? "Já existe um produto com esse nome" : error.message,
        );
        return;
      }
      if (qty > 0) {
        await supabase.from("stock_movements").insert({
          item_id: data.id,
          movement_type: "entrada",
          quantity: qty,
          notes: "Cadastro do produto",
          recorded_by: userId,
        });
      }
      toast.success("Produto cadastrado");
    } else {
      const { error } = await supabase
        .from("stock_items")
        .update({ name: trimmed, price: priceNum, current_quantity: qty })
        .eq("id", product.id);
      if (error) {
        setSaving(false);
        toast.error(
          error.code === "23505" ? "Já existe um produto com esse nome" : error.message,
        );
        return;
      }
      const delta = qty - product.current_quantity;
      if (delta !== 0) {
        await supabase.from("stock_movements").insert({
          item_id: product.id,
          movement_type: "ajuste",
          quantity: Math.abs(delta),
          notes: `Edição do produto (${product.current_quantity} → ${qty})`,
          recorded_by: userId,
        });
      }
      toast.success("Produto atualizado");
    }
    setSaving(false);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo produto" : "Editar produto"}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "Cadastre o produto com o preço de venda e a quantidade que tem hoje."
              : "Altere nome, preço ou quantidade. Mudança na quantidade fica registrada no histórico."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nome do produto</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Água 500ml"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Preço (R$)</Label>
              <Input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Ex.: 5,00"
              />
            </div>
            <div>
              <Label>Quantidade</Label>
              <Input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Ex.: 24"
              />
            </div>
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

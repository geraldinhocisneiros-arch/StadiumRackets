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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { todayISO, fmtBRL } from "@/lib/format";
import type { CleaningProduct } from "@/components/CleaningProductDialog";
import type { CleaningSupplier } from "@/components/CleaningSupplierDialog";

export interface CleaningPurchase {
  id: string;
  product_id: string;
  supplier_id: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  purchase_date: string;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: CleaningProduct[];
  suppliers: CleaningSupplier[];
  defaultProductId?: string | null;
  editingPurchase?: CleaningPurchase | null;
  onSaved: () => void;
}

const NO_SUPPLIER = "__none__";

export function CleaningPurchaseDialog({
  open,
  onOpenChange,
  products,
  suppliers,
  defaultProductId,
  editingPurchase,
  onSaved,
}: Props) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [supplierId, setSupplierId] = useState<string>(NO_SUPPLIER);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingPurchase) {
      setProductId(editingPurchase.product_id);
      setQuantity(String(editingPurchase.quantity));
      setUnitPrice(String(editingPurchase.unit_price));
      setPurchaseDate(editingPurchase.purchase_date);
      setSupplierId(editingPurchase.supplier_id ?? NO_SUPPLIER);
      setNotes(editingPurchase.notes ?? "");
      return;
    }
    const pid = defaultProductId ?? products[0]?.id ?? "";
    setProductId(pid);
    setQuantity("");
    setUnitPrice("");
    setPurchaseDate(todayISO());
    setNotes("");
    const product = products.find((p) => p.id === pid);
    setSupplierId(product?.supplier_id ?? NO_SUPPLIER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProductId, editingPurchase]);

  useEffect(() => {
    if (!open || !productId || editingPurchase) return;
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("cleaning_purchases")
        .select("unit_price")
        .eq("product_id", productId)
        .order("purchase_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive && data) setUnitPrice(String(data.unit_price));
    })();
    return () => {
      alive = false;
    };
  }, [open, productId, editingPurchase]);

  const handleProductChange = (pid: string) => {
    setProductId(pid);
    const product = products.find((p) => p.id === pid);
    setSupplierId(product?.supplier_id ?? NO_SUPPLIER);
  };

  const qtyNum = Number(quantity);
  const priceNum = Number(unitPrice);
  const total = !isNaN(qtyNum) && !isNaN(priceNum) ? qtyNum * priceNum : 0;

  const handleSave = async () => {
    if (!productId) {
      toast.error("Selecione o produto");
      return;
    }
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error("Informe uma quantidade válida");
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error("Informe um valor unitário válido");
      return;
    }
    setSaving(true);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error } = editingPurchase
      ? await (supabase as any).rpc("cleaning_update_purchase", {
          _id: editingPurchase.id,
          _quantity: qtyNum,
          _unit_price: priceNum,
          _purchase_date: purchaseDate,
          _supplier_id: supplierId === NO_SUPPLIER ? null : supplierId,
          _notes: notes.trim() || null,
        })
      : await (supabase as any).rpc("cleaning_register_purchase", {
          _product_id: productId,
          _quantity: qtyNum,
          _unit_price: priceNum,
          _purchase_date: purchaseDate,
          _supplier_id: supplierId === NO_SUPPLIER ? null : supplierId,
          _notes: notes.trim() || null,
        });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingPurchase ? "Lançamento atualizado." : "Compra registrada e estoque reposto.");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingPurchase ? "Editar lançamento" : "Repor estoque"}</DialogTitle>
          <DialogDescription>
            {editingPurchase
              ? "Ajusta o lançamento e recalcula o estoque pela diferença de quantidade."
              : "Registra a compra e soma a quantidade no estoque atual do produto."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Produto</Label>
            <Select value={productId} onValueChange={handleProductChange} disabled={!!editingPurchase}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editingPurchase && (
              <p className="text-xs text-muted-foreground">
                Para trocar o produto, exclua este lançamento e registre de novo.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Quantidade comprada</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Valor unitário</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
          </div>
          {total > 0 && (
            <div className="text-sm text-muted-foreground">Total desta compra: {fmtBRL(total)}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Data da compra</Label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Fornecedor</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUPPLIER}>Sem fornecedor definido</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Observação (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : editingPurchase ? "Salvar alterações" : "Repor estoque"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

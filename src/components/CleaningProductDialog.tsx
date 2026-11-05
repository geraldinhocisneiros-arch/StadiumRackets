import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { useConfirm } from "@/hooks/useConfirm";
import type { CleaningSupplier } from "@/components/CleaningSupplierDialog";

export interface CleaningProduct {
  id: string;
  name: string;
  unit: string;
  supplier_id: string | null;
  min_stock: number;
  current_stock: number;
  active: boolean;
}

export const CLEANING_UNIT_LABELS: Record<string, string> = {
  "5_litros": "5 litros",
  unitario: "Unitário",
  pacote: "Pacote",
  rolo: "Rolo",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: CleaningProduct | null; // null = criando novo
  suppliers: CleaningSupplier[];
  onSaved: () => void;
}

const NO_SUPPLIER = "__none__";

export function CleaningProductDialog({ open, onOpenChange, product, suppliers, onSaved }: Props) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("unitario");
  const [supplierId, setSupplierId] = useState<string>(NO_SUPPLIER);
  const [minStock, setMinStock] = useState("0");
  const [currentStock, setCurrentStock] = useState("0");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    if (product) {
      setName(product.name);
      setUnit(product.unit);
      setSupplierId(product.supplier_id ?? NO_SUPPLIER);
      setMinStock(String(product.min_stock));
      setCurrentStock(String(product.current_stock));
    } else {
      setName("");
      setUnit("unitario");
      setSupplierId(NO_SUPPLIER);
      setMinStock("0");
      setCurrentStock("0");
    }
  }, [open, product]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Informe o nome do produto");
      return;
    }
    const min = Number(minStock);
    const current = Number(currentStock);
    if (isNaN(min) || min < 0) {
      toast.error("Estoque mínimo inválido");
      return;
    }
    if (isNaN(current) || current < 0) {
      toast.error("Estoque atual inválido");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      unit,
      supplier_id: supplierId === NO_SUPPLIER ? null : supplierId,
      min_stock: min,
      current_stock: current,
    };
    const { error } = product
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("cleaning_products").update(payload).eq("id", product.id)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("cleaning_products").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(product ? "Produto atualizado" : "Produto cadastrado");
    onOpenChange(false);
    onSaved();
  };

  const handleArchive = async () => {
    if (!product) return;
    if (!(await confirm(`Arquivar "${product.name}"? Ele deixa de aparecer no controle semanal.`))) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("cleaning_products")
      .update({ active: false })
      .eq("id", product.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Produto arquivado");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Produto</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Álcool 70%"
            />
          </div>
          <div className="space-y-1">
            <Label>Unidade</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLEANING_UNIT_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Estoque atual</Label>
              <Input
                type="number"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Avisar quando chegar em</Label>
              <Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {product && (
            <Button
              variant="outline"
              className="sm:mr-auto text-destructive"
              onClick={handleArchive}
            >
              Arquivar
            </Button>
          )}
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

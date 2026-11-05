import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Pencil, Plus, Trash2, X } from "lucide-react";

export interface CleaningSupplier {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suppliers: CleaningSupplier[];
  onChanged: () => void;
}

const emptyForm = { company_name: "", contact_name: "", phone: "" };

export function CleaningSupplierDialog({ open, onOpenChange, suppliers, onChanged }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setForm(emptyForm);
    }
  }, [open]);

  const startEdit = (s: CleaningSupplier) => {
    setEditingId(s.id);
    setForm({
      company_name: s.company_name,
      contact_name: s.contact_name ?? "",
      phone: s.phone ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.company_name.trim()) {
      toast.error("Informe o nome da empresa");
      return;
    }
    setSaving(true);
    const payload = {
      company_name: form.company_name.trim(),
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
    };
    const { error } =
      editingId === "new" || editingId === null
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from("cleaning_suppliers").insert(payload)
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from("cleaning_suppliers").update(payload).eq("id", editingId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      editingId && editingId !== "new" ? "Fornecedor atualizado" : "Fornecedor adicionado",
    );
    cancelEdit();
    onChanged();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm("Excluir este fornecedor? Produtos associados ficarão sem fornecedor."))) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("cleaning_suppliers").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Fornecedor excluído");
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fornecedores</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {suppliers.length === 0 && editingId === null ? (
            <div className="text-sm text-muted-foreground py-2">Nenhum fornecedor cadastrado.</div>
          ) : (
            suppliers.map((s) =>
              editingId === s.id ? null : (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.company_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {s.contact_name || "—"}
                      {s.phone ? ` · ${s.phone}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => startEdit(s)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleDelete(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ),
            )
          )}
        </div>

        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">
              {editingId && editingId !== "new" ? "Editar fornecedor" : "Novo fornecedor"}
            </Label>
            {editingId && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEdit}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <Input
              placeholder="Nome da empresa"
              value={form.company_name}
              onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
            />
            <Input
              placeholder="Nome do responsável"
              value={form.contact_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
            />
            <Input
              placeholder="Telefone de contato"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={saving}>
            {editingId && editingId !== "new" ? (
              <Pencil className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {saving
              ? "Salvando…"
              : editingId && editingId !== "new"
                ? "Salvar alterações"
                : "Adicionar fornecedor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

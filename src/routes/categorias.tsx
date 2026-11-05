import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Plus, Pencil, Trash2, Loader2, Check } from "lucide-react";
import { CATEGORY_COLOR_PRESETS, categoryColorPreset } from "@/lib/court-map";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/categorias")({
  component: () => (
    <RequireAuth pageKey="categorias">
      <CategoriasPage />
    </RequireAuth>
  ),
});

interface Category {
  id: string;
  name: string;
  default_amount: number;
  description: string | null;
  active: boolean;
  commission_percent: number;
  color: string | null;
}

function CategoriasPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("client_categories").select("*").order("name");
    setItems((data ?? []) as Category[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const deleteCategory = async (c: Category) => {
    if (
      !(await confirm(
        `Excluir a categoria "${c.name}"? Clientes, locações e pagamentos que usam essa categoria ficarão sem categoria — essa ação não pode ser desfeita.`,
      ))
    )
      return;
    setDeletingId(c.id);
    const { error } = await supabase.from("client_categories").delete().eq("id", c.id);
    setDeletingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Categoria excluída");
    setItems((prev) => prev.filter((x) => x.id !== c.id));
  };

  const setCategoryColor = async (id: string, color: string | null) => {
    const previous = items;
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, color } : c)));
    const { error } = await supabase.from("client_categories").update({ color }).eq("id", id);
    if (error) {
      setItems(previous);
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categorias de cliente</h1>
          <p className="text-muted-foreground">Tipos de cliente</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4 mr-2" /> Nova categoria
            </Button>
          </DialogTrigger>
          <CategoryDialog editing={editing} onSaved={load} onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cor no mapa</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.description ?? "—"}</TableCell>
                    <TableCell>
                      {Number(c.commission_percent) > 0
                        ? `${Number(c.commission_percent).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
                        : "—"}
                    </TableCell>
                    <TableCell>{c.active ? "Ativa" : "Inativa"}</TableCell>
                    <TableCell>
                      <CategoryColorPicker
                        value={c.color}
                        onChange={(color) => setCategoryColor(c.id, color)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(c);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deletingId === c.id}
                          onClick={() => deleteCategory(c)}
                        >
                          {deletingId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = categoryColorPreset(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={current ? current.label : "Sem cor personalizada — usa a cor padrão"}
          className={cn(
            "h-6 w-6 rounded-full border-2 border-border shrink-0 transition hover:scale-110",
            current ? current.swatchClass : "bg-muted",
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <p className="text-xs text-muted-foreground mb-2">
          Cor usada para essa categoria no mapa de quadras.
        </p>
        <div className="grid grid-cols-6 gap-2">
          {CATEGORY_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              title={preset.label}
              onClick={() => {
                onChange(preset.key);
                setOpen(false);
              }}
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center transition hover:scale-110",
                preset.swatchClass,
              )}
            >
              {value === preset.key && <Check className="h-4 w-4 text-white drop-shadow" />}
            </button>
          ))}
        </div>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full mt-2 h-7 text-xs"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Usar cor padrão
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CategoryDialog({
  editing,
  onSaved,
  onClose,
}: {
  editing: Category | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setCommissionPercent(
      editing?.commission_percent != null ? String(editing.commission_percent) : ""
    );
  }, [editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      name,
      default_amount: 0,
      description: description || null,
      commission_percent: Number(commissionPercent) || 0,
    };
    const { error } = editing
      ? await supabase.from("client_categories").update(payload).eq("id", editing.id)
      : await supabase.from("client_categories").insert(payload);
    setSubmitting(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Salvo!");
      onSaved();
      onClose();
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">Descrição</Label>
          <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission">Comissão sobre vendas de novo plano (%)</Label>
          <Input
            id="commission"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="0"
            value={commissionPercent}
            onChange={(e) => setCommissionPercent(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Percentual aplicado sobre o valor do pagamento marcado como "Venda de novo plano". Deixe 0 para não gerar comissão.
          </p>
        </div>
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

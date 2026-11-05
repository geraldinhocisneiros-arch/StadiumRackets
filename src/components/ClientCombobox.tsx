import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, ChevronsUpDown, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { accentInsensitiveFilter } from "@/lib/format";

export interface ClientOption {
  id: string;
  full_name: string;
  category_id?: string | null;
  category_name?: string | null;
  default_discount_percent?: number | null;
  teacher_id?: string | null;
}

interface Props {
  clients: ClientOption[];
  value: string; // client id
  onChange: (id: string) => void;
  onClientCreated?: (client: ClientOption) => void;
  placeholder?: string;
  allowClear?: boolean;
}

export function ClientCombobox({
  clients,
  value,
  onChange,
  onClientCreated,
  placeholder = "Buscar cliente...",
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = clients.find((c) => c.id === value);

  const openAdd = () => {
    setNewName(search.trim());
    setNewPhone("");
    setOpen(false);
    setAddOpen(true);
  };

  const createClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Informe o nome do cliente");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("clients")
      .insert({
        full_name: trimmed,
        phone: newPhone.trim() || null,
        active: true,
      })
      .select("id, full_name")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const created = data as ClientOption;
    toast.success("Cliente cadastrado");
    onClientCreated?.(created);
    onChange(created.id);
    setAddOpen(false);
    window.dispatchEvent(new Event("clients:updated"));
  };

  return (
    <>
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              className={cn(
                "flex-1 justify-between font-normal",
                !selected && "text-muted-foreground",
              )}
            >
              <span className="truncate">
                {selected ? (
                  <>
                    {selected.full_name}
                    {selected.category_name && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · {selected.category_name}
                      </span>
                    )}
                  </>
                ) : (
                  placeholder
                )}
              </span>
              <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
            <Command filter={accentInsensitiveFilter}>
              <CommandInput
                placeholder="Digite o nome..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>
                  <div className="py-3 text-center text-sm">
                    <div className="text-muted-foreground mb-2">
                      Nenhum cliente encontrado.
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={openAdd}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Cadastrar "{search.trim() || "novo cliente"}"
                    </Button>
                  </div>
                </CommandEmpty>
                <CommandGroup>
                  {clients.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.full_name}
                      onSelect={() => {
                        onChange(c.id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 mr-2",
                          value === c.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate">{c.full_name}</span>
                      {c.category_name && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.category_name}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <div className="border-t p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={openAdd}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Cadastrar novo cliente
                  </Button>
                </div>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {allowClear && selected && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            aria-label="Limpar"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar novo cliente</DialogTitle>
          </DialogHeader>
          <form onSubmit={createClient} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Você pode completar o cadastro depois em Clientes.
            </p>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Cadastrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

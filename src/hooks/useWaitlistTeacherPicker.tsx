import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const NONE = "__none__";

interface Teacher {
  id: string;
  name: string;
}

/** Professor escolhido na tela ("Marcar" da fila de espera); null = sem professor. */
export interface WaitlistTeacherChoice {
  teacherId: string | null;
}

interface PickerState {
  description: string;
  linkedName: string | null;
}

/**
 * Passo de confirmação do "Marcar" da fila de espera com escolha do
 * professor. Já vem preenchido com o professor do pedido ou, se não
 * houver, o professor vinculado ao cadastro do cliente (clients.teacher_id).
 * Retorna null se a recepção cancelar.
 */
export function useWaitlistTeacherPicker() {
  const [state, setState] = useState<PickerState | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [value, setValue] = useState<string>(NONE);
  const [loading, setLoading] = useState(false);
  const resolveRef = useRef<((v: WaitlistTeacherChoice | null) => void) | null>(null);

  const pick = useCallback(async (waitlistId: string, description: string) => {
    setLoading(true);
    setValue(NONE);
    setState({ description, linkedName: null });
    const promise = new Promise<WaitlistTeacherChoice | null>((resolve) => {
      resolveRef.current = resolve;
    });
    try {
      const [tRes, wRes] = await Promise.all([
        supabase.from("teachers").select("id, name").eq("active", true).order("name"),
        supabase
          .from("court_waitlist")
          .select("teacher_id, client_id, clients!client_id(teacher_id)")
          .eq("id", waitlistId)
          .maybeSingle(),
      ]);
      if (tRes.error) throw tRes.error;
      if (wRes.error) throw wRes.error;
      const list = (tRes.data ?? []) as Teacher[];
      const w = wRes.data as {
        teacher_id: string | null;
        clients: { teacher_id: string | null } | { teacher_id: string | null }[] | null;
      } | null;
      const client = Array.isArray(w?.clients) ? w?.clients[0] : w?.clients;
      const def = w?.teacher_id ?? client?.teacher_id ?? null;
      const linked = def ? list.find((t) => t.id === def) : undefined;
      setTeachers(list);
      setValue(linked ? linked.id : NONE);
      setState({ description, linkedName: linked?.name ?? null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar professores");
    } finally {
      setLoading(false);
    }
    return promise;
  }, []);

  const settle = (result: WaitlistTeacherChoice | null) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  };

  const element = (
    <Dialog open={!!state} onOpenChange={(open) => !open && settle(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar da fila de espera</DialogTitle>
          <DialogDescription>{state?.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Professor</Label>
          {loading ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando...
            </div>
          ) : (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o professor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem professor</SelectItem>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {state?.linkedName && (
            <div className="text-xs text-muted-foreground">
              Cliente vinculado ao professor {state.linkedName}.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(null)}>
            Cancelar
          </Button>
          <Button
            disabled={loading}
            onClick={() => settle({ teacherId: value === NONE ? null : value })}
          >
            Marcar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { pick, element };
}

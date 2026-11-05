import { createContext, useCallback, useContext, useRef, useState } from "react";
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

interface PromptOptions {
  title?: string;
  description?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}

// Retorna o texto digitado, ou null se cancelado/fechado sem preencher.
type PromptFn = (options: PromptOptions | string) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

/**
 * Substituto de window.prompt() — igual ao problema que window.confirm() já
 * dava (ver useConfirm.tsx): alguns navegadores bloqueiam silenciosamente
 * chamadas repetidas de prompt() numa página depois que o usuário nega uma
 * vez ("impedir mais diálogos"), fazendo o valor voltar sempre null sem
 * nenhuma janela aparecer — quem clicava no botão via só o erro de "motivo
 * obrigatório" sem nunca ter a chance de digitar nada.
 */
export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState("");
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback<PromptFn>((options) => {
    setState(typeof options === "string" ? { description: options } : options);
    setValue("");
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = (result: string | null) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  };

  const confirmDisabled = !value.trim();

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog open={!!state} onOpenChange={(open) => !open && settle(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{state?.title ?? "Informe um valor"}</DialogTitle>
            {state?.description && <DialogDescription>{state.description}</DialogDescription>}
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            placeholder={state?.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !confirmDisabled) settle(value.trim());
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(null)}>
              {state?.cancelText ?? "Cancelar"}
            </Button>
            <Button disabled={confirmDisabled} onClick={() => settle(value.trim())}>
              {state?.confirmText ?? "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  );
}

export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt precisa estar dentro de um PromptProvider");
  return ctx;
}

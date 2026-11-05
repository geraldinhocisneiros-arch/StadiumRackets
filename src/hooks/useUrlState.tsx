import { useEffect, useRef, useState } from "react";

/**
 * Persiste um valor de estado no querystring da URL (search params), sem
 * acionar navegação do router. Ao recarregar a página, o estado é restaurado.
 *
 * - Usa `history.replaceState` para não poluir o histórico do navegador.
 * - Serializa em JSON (suporta strings, números, booleanos, arrays, objetos
 *   simples). Para `Date`, converta para string ISO antes de salvar.
 * - Quando o valor é igual ao `defaultValue`, o parâmetro é removido da URL
 *   para mantê-la limpa.
 *
 * @param key Nome do parâmetro na URL.
 * @param defaultValue Valor inicial caso a URL não tenha o parâmetro.
 */
export function useUrlState<T>(key: string, defaultValue: T): [T, (v: T | ((prev: T) => T)) => void] {
  const isClient = typeof window !== "undefined";
  const defaultRef = useRef(defaultValue);

  const readFromUrl = (): T => {
    if (!isClient) return defaultRef.current;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get(key);
      if (raw == null) return defaultRef.current;
      // Tenta parsear como JSON; se falhar, devolve a string crua.
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    } catch {
      return defaultRef.current;
    }
  };

  const [value, setValue] = useState<T>(() => readFromUrl());

  // Atualiza a URL quando o valor muda
  useEffect(() => {
    if (!isClient) return;
    try {
      const url = new URL(window.location.href);
      const isDefault = JSON.stringify(value) === JSON.stringify(defaultRef.current);
      if (isDefault || value === undefined || value === null || value === "") {
        url.searchParams.delete(key);
      } else {
        const serialized =
          typeof value === "string" ? value : JSON.stringify(value);
        url.searchParams.set(key, serialized);
      }
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // ignore
    }
  }, [key, value, isClient]);

  return [value, setValue];
}

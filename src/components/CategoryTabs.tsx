import { cn } from "@/lib/utils";
import { normalizeText } from "@/lib/format";

// Abas de categoria de cliente (Mensalista, Escolinha Tênis, Escolinha
// Pickleball...). Só mostra categorias que têm pelo menos um cliente na
// lista recebida — categorias de lançamento (Estorno, Grip, Saldo anterior)
// não poluem a barra. O valor é o id da categoria, "all" ou "none".

export interface CategoryOption {
  id: string;
  name: string;
}

export function CategoryTabs({
  categories,
  items,
  value,
  onChange,
}: {
  categories: CategoryOption[];
  items: Array<{ category_id: string | null }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const counts = new Map<string, number>();
  let noneCount = 0;
  for (const it of items) {
    if (it.category_id) counts.set(it.category_id, (counts.get(it.category_id) ?? 0) + 1);
    else noneCount += 1;
  }

  const visible = categories
    .filter((c) => (counts.get(c.id) ?? 0) > 0 || c.id === value)
    .sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "pt-BR"));

  const tabs: Array<{ key: string; label: string; count: number }> = [
    { key: "all", label: "Todos", count: items.length },
    ...visible.map((c) => ({ key: c.id, label: c.name, count: counts.get(c.id) ?? 0 })),
  ];
  if (noneCount > 0 || value === "none") {
    tabs.push({ key: "none", label: "Sem categoria", count: noneCount });
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Categorias">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <span className="font-medium">{t.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
              )}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

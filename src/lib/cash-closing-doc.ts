import { fmtBRL } from "@/lib/format";
import { PAYMENT_METHOD_LABELS as METHOD_LABELS } from "@/lib/payment-methods";
import { courtShort } from "@/lib/court-map";


const METHODS_ORDER = [
  "dinheiro",
  "pix",
  "debito",
  "credito",
  "transferencia",
  "letzplay_pix",
  "letzplay_cartao",
  "rede_itau",
  "mercadopago",
  "conta_corrente",
  "outro",
];

export interface ClosingPaymentItem {
  client?: string | null;
  category?: string | null;
  notes?: string | null;
  amount: number;
  method: string;
}

export interface ClosingRecord {
  closing_date: string;
  closed_at: string;
  closed_by_name?: string | null;
  totals_system: Record<string, number>;
  totals_counted: Record<string, number>;
  differences: Record<string, number>;
  pending_resolved: Array<{
    payment_id?: string;
    client?: string;
    amount?: number;
    method?: string;
    action?: string;
  }>;
  stock_report?: Array<{
    name: string;
    initial: number;
    restocked: number;
    sold: number;
    expected: number;
    counted: number;
    diff: number;
    note?: string | null;
  }> | null;
  /** Conferência física dos controles das quadras. */
  remotes_report?: Array<{
    court: number;
    at_reception: boolean;
    expected_at_reception?: boolean;
    holder_name?: string | null;
    note?: string | null;
  }> | null;
  notes?: string | null;
  /** Itemized payments received that day (amount > 0). Optional. */
  received_items?: ClosingPaymentItem[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildClosingDocumentHtml(rec: ClosingRecord, opts?: { autoPrint?: boolean }): string {
  const dateLabel = (() => {
    const [y, m, d] = rec.closing_date.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR");
  })();
  const closedAt = new Date(rec.closed_at);
  const timeStr = closedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const closedAtFull = closedAt.toLocaleString("pt-BR");

  const methods = Array.from(
    new Set([
      ...METHODS_ORDER,
      ...Object.keys(rec.totals_system ?? {}),
      ...Object.keys(rec.totals_counted ?? {}),
    ]),
  ).filter((m) => {
    const sys = Number(rec.totals_system?.[m] ?? 0);
    const cnt = Number(rec.totals_counted?.[m] ?? 0);
    return sys !== 0 || cnt !== 0;
  });

  const methodRows = methods
    .map((m) => {
      const sys = Number(rec.totals_system?.[m] ?? 0);
      const cnt = Number(rec.totals_counted?.[m] ?? 0);
      const diff = Number(rec.differences?.[m] ?? cnt - sys);
      const diffColor = Math.abs(diff) < 0.005 ? "#16a34a" : "#dc2626";
      return `<tr>
        <td>${esc(METHOD_LABELS[m] ?? m)}</td>
        <td class="r">${fmtBRL(sys)}</td>
        <td class="r">${fmtBRL(cnt)}</td>
        <td class="r" style="color:${diffColor}">${fmtBRL(diff)}</td>
      </tr>`;
    })
    .join("");

  const totSys = methods.reduce((s, m) => s + Number(rec.totals_system?.[m] ?? 0), 0);
  const totCnt = methods.reduce((s, m) => s + Number(rec.totals_counted?.[m] ?? 0), 0);
  const totDiff = totCnt - totSys;
  const totDiffColor = Math.abs(totDiff) < 0.005 ? "#16a34a" : "#dc2626";

  const pendingHtml = (rec.pending_resolved ?? []).length
    ? `<h3>Pendentes revisados</h3>
        <table>
          <thead><tr><th>Cliente</th><th>Forma</th><th class="r">Valor</th><th>Ação</th></tr></thead>
          <tbody>${rec.pending_resolved
            .map(
              (p) => `<tr>
                <td>${esc(p.client ?? "—")}</td>
                <td>${esc(METHOD_LABELS[p.method ?? ""] ?? p.method ?? "")}</td>
                <td class="r">${fmtBRL(Number(p.amount ?? 0))}</td>
                <td>${p.action === "paid" ? "Marcado como pago" : "Mantido pendente"}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>`
    : "";

  const stockHtml = (rec.stock_report ?? []).length
    ? `<h3>Prestação de contas — Loja</h3>
        <table>
          <thead><tr>
            <th>Item</th><th class="r">Inicial</th><th class="r">+ Reposição</th>
            <th class="r">- Vendido</th><th class="r">Esperado</th>
            <th class="r">Contado</th><th class="r">Dif.</th><th>Observação</th>
          </tr></thead>
          <tbody>${rec
            .stock_report!.map(
              (r) => `<tr>
                <td>${esc(r.name)}</td>
                <td class="r">${r.initial}</td>
                <td class="r">+${r.restocked}</td>
                <td class="r">-${r.sold}</td>
                <td class="r">${r.expected}</td>
                <td class="r">${r.counted}</td>
                <td class="r" style="color:${r.diff === 0 ? "#16a34a" : "#dc2626"}">${r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                <td>${esc(r.note ?? "")}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>`
    : "";

  // Itemized payments grouped by method
  const items = (rec.received_items ?? []).filter((p) => Number(p.amount) > 0);
  let itemsHtml = "";
  if (items.length) {
    const sorted = [...items].sort((a, b) => {
      const ai = METHODS_ORDER.indexOf(a.method);
      const bi = METHODS_ORDER.indexOf(b.method);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    const byMethod = new Map<string, ClosingPaymentItem[]>();
    sorted.forEach((p) => {
      const list = byMethod.get(p.method) ?? [];
      list.push(p);
      byMethod.set(p.method, list);
    });
    itemsHtml = `<h3>Lançamentos recebidos</h3>` +
      Array.from(byMethod.entries())
        .map(([method, list]) => {
          const subtotal = list.reduce((s, p) => s + Number(p.amount), 0);
          const rows = list
            .map(
              (p) => `<tr>
                <td>${esc(p.client ?? "—")}</td>
                <td>${esc(p.category ?? "")}</td>
                <td>${esc(p.notes ?? "")}</td>
                <td class="r">${fmtBRL(Number(p.amount))}</td>
              </tr>`,
            )
            .join("");
          return `<h4 style="margin:14px 0 4px;font-size:13px;">${esc(METHOD_LABELS[method] ?? method)}</h4>
            <table>
              <thead><tr><th>Cliente</th><th>Categoria</th><th>Obs.</th><th class="r">Valor</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr><td colspan="3" class="r">Subtotal</td><td class="r">${fmtBRL(subtotal)}</td></tr></tfoot>
            </table>`;
        })
        .join("");
  }

  const remotesHtml = (rec.remotes_report ?? []).length
    ? `<h3>Controles das quadras</h3>
        <table>
          <thead><tr><th>Quadra</th><th>Situação</th><th>Com quem</th><th>Obs.</th></tr></thead>
          <tbody>${rec
            .remotes_report!.map(
              (r) => `<tr>
                <td>${courtShort(r.court)}</td>
                <td style="color:${r.at_reception ? "#16a34a" : "#dc2626"}">${r.at_reception ? "Na recepção" : "Fora"}</td>
                <td>${esc(r.at_reception ? "" : r.holder_name ?? "—")}</td>
                <td>${esc(
                  r.expected_at_reception !== undefined && r.expected_at_reception !== r.at_reception
                    ? r.at_reception
                      ? "Constava emprestado — devolvido na conferência"
                      : "Saída não registrada" + (r.note ? ` — ${r.note}` : "")
                    : "",
                )}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>`
    : "";

  const notesHtml = rec.notes
    ? `<h3>Observações</h3><p style="white-space:pre-wrap">${esc(rec.notes)}</p>`
    : "";

  const userLine = rec.closed_by_name
    ? ` • Fechado por: ${esc(rec.closed_by_name)}`
    : "";

  const autoPrintScript = opts?.autoPrint
    ? `<script>window.onload = () => { window.print(); };</script>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Fechamento de caixa — ${dateLabel}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  h3 { margin: 18px 0 6px; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
  .muted { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th.r, td.r { text-align: right; }
  tfoot td { border-top: 1px solid #999; border-bottom: none; font-weight: 600; }
  .total { margin-top: 18px; font-size: 14px; text-align: right; border-top: 2px solid #000; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h1>Fechamento de caixa — ${dateLabel}</h1>
  <div class="muted">Fechado às ${timeStr} (${esc(closedAtFull)})${userLine}</div>

  <h3>Conferência por forma de pagamento</h3>
  <table>
    <thead><tr><th>Forma</th><th class="r">Sistema</th><th class="r">Conferido</th><th class="r">Diferença</th></tr></thead>
    <tbody>${methodRows || `<tr><td colspan="4" class="muted">Sem movimentação.</td></tr>`}</tbody>
    <tfoot><tr>
      <td>Total</td>
      <td class="r">${fmtBRL(totSys)}</td>
      <td class="r">${fmtBRL(totCnt)}</td>
      <td class="r" style="color:${totDiffColor}">${fmtBRL(totDiff)}</td>
    </tr></tfoot>
  </table>

  ${itemsHtml}
  ${pendingHtml}
  ${stockHtml}
  ${remotesHtml}
  ${notesHtml}

  <div class="total"><strong>Total conferido: ${fmtBRL(totCnt)}</strong></div>
  ${autoPrintScript}
</body></html>`;
}

export function sumCounted(totals: Record<string, number> | null | undefined): number {
  if (!totals) return 0;
  return Object.values(totals).reduce((s, v) => s + Number(v ?? 0), 0);
}

export function sumDifferences(diffs: Record<string, number> | null | undefined): number {
  if (!diffs) return 0;
  return Object.values(diffs).reduce((s, v) => s + Number(v ?? 0), 0);
}

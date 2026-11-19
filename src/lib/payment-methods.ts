// Fonte única das formas de pagamento. Toda tela com escolha de forma
// (locação, caixa, taxas, filtros de finanças) usa
// PAYMENT_METHOD_OPTIONS, pra lista ser sempre a mesma em todo lugar.
// Pra criar uma forma nova: adicionar aqui + ALTER TYPE payment_method.

export const PAYMENT_METHOD_OPTIONS: Array<[string, string]> = [
  ["dinheiro", "Dinheiro"],
  ["pix", "Pix"],
  ["debito", "Débito"],
  ["credito", "Crédito"],
  ["letzplay_pix", "Letzplay Pix"],
  ["letzplay_cartao", "Letzplay Cartão"],
  ["rede_itau", "Rede Itaú"],
  ["mercadopago", "Mercado Pago"],
  ["outro", "Outro"],
];

// Rótulos pra exibir lançamentos — inclui formas que não se escolhem à mão
// (conta corrente, pagamentos online do Mercado Pago, legado).
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ...Object.fromEntries(PAYMENT_METHOD_OPTIONS),
  transferencia: "Transferência",
  conta_corrente: "Conta corrente",
  mercadopago_pix: "Mercado Pago Pix (online)",
  mercadopago_cartao: "Mercado Pago Cartão (online)",
};

// Fechamento de caixa: mesmas linhas, na mesma ordem, das formas do Caixa.
// Pagamento online do Mercado Pago entra na linha "Mercado Pago"; forma
// fora da lista (legado) entra em "Outro". Conta corrente e transferência
// não são dinheiro conferido no caixa e ficam de fora.
export const CLOSING_METHODS: string[] = PAYMENT_METHOD_OPTIONS.map(([v]) => v);
const CLOSING_EXCLUDED = new Set(["conta_corrente", "transferencia"]);

export function closingMethodOf(method: string | null | undefined): string | null {
  const m = method ?? "outro";
  if (CLOSING_EXCLUDED.has(m)) return null;
  if (m === "mercadopago_pix" || m === "mercadopago_cartao") return "mercadopago";
  return CLOSING_METHODS.includes(m) ? m : "outro";
}

export const MENSALISTA_CREDITO_COM_QUADRA_MSG =
  'Locação paga na hora não vai para a conta corrente. Desmarque "Creditar na C/C" e deixe só "Pagamento recebido". Crédito é só para saldo adiantado, sem quadra/horário.';

// Fonte única das formas de pagamento. Toda tela com escolha de forma
// (locação, caixa, taxas) usa PAYMENT_METHOD_OPTIONS, pra lista ser
// sempre a mesma em todo lugar; filtros usam PAYMENT_METHOD_FILTER_OPTIONS.
// Pra criar uma forma nova: adicionar aqui + ALTER TYPE payment_method.

// Formas que a recepção pode escolher: só estas quatro.
export const PAYMENT_METHOD_OPTIONS: Array<[string, string]> = [
  ["dinheiro", "Dinheiro"],
  ["pix", "Pix"],
  ["debito", "Débito"],
  ["credito", "Crédito"],
];

// Formas antigas ou automáticas: não se escolhem mais, mas existem em
// lançamentos já feitos (e o Mercado Pago online grava as suas). Ficam
// nos rótulos e nos filtros pra histórico continuar legível/filtrável.
const LEGACY_PAYMENT_METHODS: Array<[string, string]> = [
  ["letzplay_pix", "Letzplay Pix"],
  ["letzplay_cartao", "Letzplay Cartão"],
  ["rede_itau", "Rede Itaú"],
  ["mercadopago", "Mercado Pago"],
  ["mercadopago_pix", "Mercado Pago Pix (online)"],
  ["mercadopago_cartao", "Mercado Pago Cartão (online)"],
  ["outro", "Outro"],
];

// Filtros de relatórios/caixa: as quatro + as antigas.
export const PAYMENT_METHOD_FILTER_OPTIONS: Array<[string, string]> = [
  ...PAYMENT_METHOD_OPTIONS,
  ...LEGACY_PAYMENT_METHODS,
];

// Rótulos pra exibir lançamentos.
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ...Object.fromEntries(PAYMENT_METHOD_FILTER_OPTIONS),
  transferencia: "Transferência",
  conta_corrente: "Conta corrente",
};

// Fechamento de caixa: sempre as quatro formas do Caixa, nessa ordem.
// Se no dia houver dinheiro numa forma antiga/online, ela aparece numa
// linha extra (só quando tem valor) — melhor ver do que sumir com o valor.
// Conta corrente e transferência não são conferidas no caixa.
export const CLOSING_METHODS: string[] = PAYMENT_METHOD_OPTIONS.map(([v]) => v);
const CLOSING_EXCLUDED = new Set(["conta_corrente", "transferencia"]);

export function isClosingExcluded(method: string): boolean {
  return CLOSING_EXCLUDED.has(method);
}

/** Linhas do fechamento: as quatro fixas + formas extras que tiveram valor. */
export function closingRows(totals: Record<string, number>): string[] {
  const extras = Object.keys(totals).filter(
    (m) => !CLOSING_METHODS.includes(m) && !CLOSING_EXCLUDED.has(m) && Math.abs(totals[m] ?? 0) >= 0.005,
  );
  return [...CLOSING_METHODS, ...extras];
}

export const MENSALISTA_CREDITO_COM_QUADRA_MSG =
  'Locação paga na hora não vai para a conta corrente. Desmarque "Creditar na C/C" e deixe só "Pagamento recebido". Crédito é só para saldo adiantado, sem quadra/horário.';

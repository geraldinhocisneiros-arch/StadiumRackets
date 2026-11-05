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

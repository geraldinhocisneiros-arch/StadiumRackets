// Helpers para identificar categorias especiais que NÃO devem entrar em
// somas de faturamento/recebidos (ex.: "Saldo Anterior" — apenas importado
// de outro sistema, nunca representa receita real; "Terno de bola" e "Grip"
// — vendas de produtos cujo valor não entra na conta da empresa).

export const normalizeCategoryName = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Categoria de venda de produto da Lojinha (dá baixa no estoque). Produtos
// novos ficam ligados pela coluna stock_item_id; Terno de bola e Grip
// continuam reconhecidos pelo nome.
export const isStockCategory = (
  cat: { name?: string | null; stock_item_id?: string | null } | null | undefined,
): boolean => {
  if (!cat) return false;
  if (cat.stock_item_id) return true;
  const n = normalizeCategoryName(cat.name);
  return n === "grip" || n === "terno de bola";
};

// Categoria de "balcão" (cliente que aluga a quadra avulsa, sem plano). No
// Squash ela se chamava "Avulso"; na Stadium é "Aluguel quadra". É a base do
// preço mostrado no mapa, do valor automático no caixa e do preço online.
export const isAvulsoCategoryName = (name: string | null | undefined): boolean => {
  const n = normalizeCategoryName(name);
  return n === "avulso" || n === "aluguel quadra" || n === "aluguel de quadra";
};

export const isSaldoAnterior = (name: string | null | undefined): boolean =>
  normalizeCategoryName(name) === "saldo anterior";

// "Funcionário", "Funcionária …": joga na casa sem
// pagar quadra — não é cliente pra vender plano, ligar ou contar receita.
export const isEmployeeCategoryName = (name: string | null | undefined): boolean =>
  normalizeCategoryName(name).startsWith("funcionari");

export const isEstorno = (name: string | null | undefined): boolean =>
  normalizeCategoryName(name) === "estorno";

// Categorias que não compõem o faturamento da empresa
const NON_REVENUE_CATEGORIES = new Set([
  "saldo anterior",
  "terno de bola",
  "grip",
]);

// Produtos da Lojinha (categorias com stock_item_id) também ficam fora do
// faturamento: a Lojinha tem gestão própria (cliente pega, paga ou fica
// devendo). As telas que somam faturamento chamam registerLojinhaCategories
// com as categorias que carregaram (select "id, name, stock_item_id").
const lojinhaCategoryNames = new Set<string>();
export const registerLojinhaCategories = (
  cats: Array<{ name?: string | null; stock_item_id?: string | null }> | null | undefined,
) => {
  for (const c of cats ?? []) {
    if (c.stock_item_id) lojinhaCategoryNames.add(normalizeCategoryName(c.name));
  }
};

export const isNonRevenueCategory = (name: string | null | undefined): boolean => {
  const n = normalizeCategoryName(name);
  return NON_REVENUE_CATEGORIES.has(n) || lojinhaCategoryNames.has(n);
};

// Desconto efetivo do cliente nas locações. Na Stadium o Mensalista NÃO
// tem desconto padrão: vale só o desconto cadastrado no próprio cliente
// (0 = valor cheio da tabela de preços).
export const effectiveClientDiscount = (
  client:
    { default_discount_percent?: number | null; category_name?: string | null } | null | undefined,
): number => Number(client?.default_discount_percent) || 0;

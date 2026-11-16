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

export const isNonRevenueCategory = (name: string | null | undefined): boolean =>
  NON_REVENUE_CATEGORIES.has(normalizeCategoryName(name));

// Desconto efetivo do cliente nas locações. O cadastro (Clientes) mostra
// 10% sugerido para todo Mensalista que tem 0 salvo no banco — sem esta
// regra, o mapa cobrava o preço cheio de um mensalista cujo cadastro
// "parece" ter 10%. Valor explícito > 0 no cadastro sempre prevalece.
export const MENSALISTA_DEFAULT_DISCOUNT = 10;

export const effectiveClientDiscount = (
  client:
    { default_discount_percent?: number | null; category_name?: string | null } | null | undefined,
): number => {
  const stored = Number(client?.default_discount_percent) || 0;
  if (stored > 0) return stored;
  return normalizeCategoryName(client?.category_name) === "mensalista"
    ? MENSALISTA_DEFAULT_DISCOUNT
    : 0;
};

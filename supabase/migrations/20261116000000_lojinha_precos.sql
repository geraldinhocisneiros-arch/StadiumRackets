-- Lojinha: produtos com preço de venda.
-- A antiga aba "Estoque" passa a se chamar "Lojinha" e permite cadastrar
-- novos produtos com preço e quantidade.
ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS price numeric(10,2) NOT NULL DEFAULT 0;

-- Nome do produto não pode repetir (o caixa localiza o item pelo nome).
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_name_unique
  ON public.stock_items (lower(btrim(name)));

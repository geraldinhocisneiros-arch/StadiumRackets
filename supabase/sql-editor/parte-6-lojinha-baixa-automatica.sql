-- Stadium Rackets — parte 6 (Lojinha: baixa automática). Rode no SQL Editor do Supabase do projeto da STADIUM, depois da parte 5.

-- Lojinha: todo produto dá baixa automática no estoque quando vendido no caixa.
--
-- Cada produto da Lojinha ganha uma categoria de lançamento no caixa com o
-- mesmo nome e o preço do produto (client_categories.stock_item_id). Criar,
-- renomear, mudar o preço ou excluir o produto na Lojinha mantém essa
-- categoria sincronizada. A venda no caixa nessa categoria abate a quantidade.

ALTER TABLE public.client_categories
  ADD COLUMN IF NOT EXISTS stock_item_id uuid UNIQUE
  REFERENCES public.stock_items(id) ON DELETE SET NULL;

-- Liga (ou cria) a categoria do caixa de um produto.
CREATE OR REPLACE FUNCTION public.link_stock_item_category(_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _item public.stock_items%ROWTYPE;
  _cat_id uuid;
BEGIN
  SELECT * INTO _item FROM public.stock_items WHERE id = _item_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO _cat_id FROM public.client_categories WHERE stock_item_id = _item.id;
  IF _cat_id IS NULL THEN
    SELECT id INTO _cat_id FROM public.client_categories
     WHERE stock_item_id IS NULL
       AND public.normalize_category(name) = public.normalize_category(_item.name)
     ORDER BY active DESC, created_at
     LIMIT 1;
  END IF;

  IF _cat_id IS NULL THEN
    INSERT INTO public.client_categories (name, default_amount, description, stock_item_id)
    VALUES (_item.name, _item.price, 'Produto da Lojinha', _item.id);
  ELSE
    UPDATE public.client_categories
       SET stock_item_id = _item.id,
           name = _item.name,
           default_amount = _item.price,
           active = true
     WHERE id = _cat_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_stock_item_category()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Produto excluído: some do caixa (categoria desativada, histórico fica).
    UPDATE public.client_categories SET active = false WHERE stock_item_id = OLD.id;
    RETURN OLD;
  END IF;
  -- Venda/reposição só muda a quantidade: nada a sincronizar.
  IF TG_OP = 'UPDATE'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.price IS NOT DISTINCT FROM OLD.price THEN
    RETURN NEW;
  END IF;
  PERFORM public.link_stock_item_category(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stock_item_category_upsert ON public.stock_items;
CREATE TRIGGER trg_stock_item_category_upsert
  AFTER INSERT OR UPDATE OF name, price ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_stock_item_category();

DROP TRIGGER IF EXISTS trg_stock_item_category_delete ON public.stock_items;
CREATE TRIGGER trg_stock_item_category_delete
  BEFORE DELETE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_stock_item_category();

-- Venda no caixa: categoria ligada a um produto da Lojinha dá baixa nele.
-- Mantém a regra antiga (Terno de bola / Grip pelo nome) como reserva.
CREATE OR REPLACE FUNCTION public.payment_stock_item_name(_category_id uuid, _client_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _cat_name TEXT;
  _norm TEXT;
  _item_name TEXT;
BEGIN
  IF _category_id IS NOT NULL THEN
    SELECT si.name INTO _item_name
      FROM public.client_categories cc
      JOIN public.stock_items si ON si.id = cc.stock_item_id
     WHERE cc.id = _category_id;
    IF _item_name IS NOT NULL THEN RETURN _item_name; END IF;
  END IF;

  SELECT name INTO _cat_name FROM public.client_categories WHERE id = _category_id;
  IF _cat_name IS NULL AND _client_id IS NOT NULL THEN
    SELECT cc.name INTO _cat_name
    FROM public.clients cl
    LEFT JOIN public.client_categories cc ON cc.id = cl.category_id
    WHERE cl.id = _client_id;
  END IF;
  _norm := public.normalize_category(_cat_name);
  IF _norm = 'terno de bola' THEN RETURN 'Terno de bola'; END IF;
  IF _norm = 'grip' THEN RETURN 'Grip'; END IF;
  RETURN NULL;
END $$;

-- Liga os produtos que já existem (Terno de bola, Grip e o que você cadastrou).
SELECT public.link_stock_item_category(id) FROM public.stock_items;

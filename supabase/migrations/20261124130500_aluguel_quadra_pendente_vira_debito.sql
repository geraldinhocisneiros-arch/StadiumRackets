-- Aluguel quadra (avulso): ou recebeu, ou ficou devendo.
--
-- Antes: marcar "Debitar da C/C" num Aluguel quadra gravava o lançamento como
-- débito, mas o débito não ia para a conta corrente (a categoria não estava na
-- lista), e o "pendente vira débito" estava desligado. O valor sumia: nem
-- recebido, nem dívida do cliente.
--
-- Agora:
-- 1. Aluguel quadra não usa conta corrente (crédito/débito são limpos ao gravar).
-- 2. Aluguel quadra com cliente e não recebido vira débito na conta do cliente
--    (Inadimplentes); marcar recebido apaga esse débito.
-- Vale só para lançamentos criados a partir desta migração.

CREATE OR REPLACE FUNCTION public.is_avulso_category_norm(_norm text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT COALESCE(_norm, '') IN ('avulso', 'aluguel quadra', 'aluguel de quadra');
$$;

CREATE OR REPLACE FUNCTION public.payment_avulso_sem_conta_corrente() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _cat_name TEXT;
  _cat_norm TEXT;
BEGIN
  IF COALESCE(NEW.created_at, now()) < '2026-11-24 13:05:00+00'::timestamptz THEN
    RETURN NEW;
  END IF;
  IF NEW.account_direction IS NULL AND COALESCE(NEW.to_account, false) = false THEN
    RETURN NEW;
  END IF;
  SELECT name INTO _cat_name FROM public.client_categories WHERE id = NEW.category_id;
  _cat_norm := translate(
    lower(btrim(COALESCE(_cat_name, ''))),
    'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
  );
  IF public.is_avulso_category_norm(_cat_norm) THEN
    NEW.to_account := false;
    NEW.account_direction := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_avulso_sem_conta_corrente ON public.payments;
CREATE TRIGGER trg_payment_avulso_sem_conta_corrente
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_avulso_sem_conta_corrente();

CREATE OR REPLACE FUNCTION public.payment_to_account_entry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _desc TEXT;
  _cat_name TEXT;
  _cat_norm TEXT;
  _entry_amount NUMERIC;
  _bucket TEXT;
  _is_pending BOOLEAN;
BEGIN
  SELECT name INTO _cat_name FROM public.client_categories WHERE id = NEW.category_id;
  IF _cat_name IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT cc.name INTO _cat_name
    FROM public.clients cl
    LEFT JOIN public.client_categories cc ON cc.id = cl.category_id
    WHERE cl.id = NEW.client_id;
  END IF;

  _cat_norm := lower(btrim(COALESCE(_cat_name, '')));
  _cat_norm := translate(
    _cat_norm,
    'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
  );


  -- Aluguel quadra não recebido = cliente ficou devendo: vira débito na
  -- conta corrente (entra em Inadimplentes) até o pagamento. Ao marcar
  -- "recebido" o débito some. Só para lançamentos criados a partir desta
  -- regra — os antigos ficam como estavam.
  _is_pending := (
    NEW.client_id IS NOT NULL
    AND NEW.received = false
    AND NEW.amount > 0
    AND public.is_avulso_category_norm(_cat_norm)
    AND COALESCE(NEW.to_account, false) = false
    AND NEW.created_at >= '2026-11-24 13:05:00+00'::timestamptz
  );

  IF _is_pending THEN
    _desc := COALESCE(NEW.notes, 'Pendente' || CASE WHEN _cat_name IS NOT NULL THEN ' - ' || _cat_name ELSE '' END);
    _bucket := 'geral';
    INSERT INTO public.account_entries(client_id, entry_type, amount, description, entry_date, payment_id, recorded_by, bucket)
    VALUES (
      NEW.client_id,
      'debito'::public.account_entry_type,
      NEW.amount,
      _desc,
      (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      NEW.id,
      NEW.recorded_by,
      _bucket
    );
    RETURN NEW;
  END IF;

  IF NEW.client_id IS NULL OR NEW.to_account = false OR NEW.account_direction IS NULL THEN
    RETURN NEW;
  END IF;

  IF _cat_norm NOT IN ('mensalista', 'debito avulso', 'saldo anterior', 'credito gympass', 'pendencia avulsa', 'estorno', 'energia (luz)', 'ranking masculino', 'ranking feminino', 'ranking dupla') THEN
    RETURN NEW;
  END IF;

  _desc := COALESCE(NEW.notes, 'Lançamento do caixa');

  IF _cat_norm = 'credito gympass' THEN
    _entry_amount := NEW.amount - COALESCE(NEW.passthrough_amount, 0);
  ELSE
    _entry_amount := NEW.amount;
  END IF;

  IF _entry_amount <= 0 THEN
    RETURN NEW;
  END IF;

  _bucket := 'geral';

  INSERT INTO public.account_entries(client_id, entry_type, amount, description, entry_date, payment_id, recorded_by, bucket)
  VALUES (
    NEW.client_id,
    NEW.account_direction::public.account_entry_type,
    _entry_amount,
    _desc,
    (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
    NEW.id,
    NEW.recorded_by,
    _bucket
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_update_account_entry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _desc TEXT;
  _cat_name TEXT;
  _cat_norm TEXT;
  _eligible BOOLEAN;
  _existing_id UUID;
  _entry_amount NUMERIC;
  _bucket TEXT;
  _direction public.account_entry_type;
  _is_pending BOOLEAN;
BEGIN
  SELECT name INTO _cat_name FROM public.client_categories WHERE id = NEW.category_id;
  IF _cat_name IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT cc.name INTO _cat_name
    FROM public.clients cl
    LEFT JOIN public.client_categories cc ON cc.id = cl.category_id
    WHERE cl.id = NEW.client_id;
  END IF;

  _cat_norm := lower(btrim(COALESCE(_cat_name, '')));
  _cat_norm := translate(
    _cat_norm,
    'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
  );


  -- Aluguel quadra não recebido = cliente ficou devendo: vira débito na
  -- conta corrente (entra em Inadimplentes) até o pagamento. Ao marcar
  -- "recebido" o débito some. Só para lançamentos criados a partir desta
  -- regra — os antigos ficam como estavam.
  _is_pending := (
    NEW.client_id IS NOT NULL
    AND NEW.received = false
    AND NEW.amount > 0
    AND public.is_avulso_category_norm(_cat_norm)
    AND COALESCE(NEW.to_account, false) = false
    AND NEW.created_at >= '2026-11-24 13:05:00+00'::timestamptz
  );

  IF _is_pending THEN
    _eligible := true;
    _entry_amount := NEW.amount;
    _direction := 'debito'::public.account_entry_type;
    _bucket := 'geral';
    _desc := COALESCE(NEW.notes, 'Pendente' || CASE WHEN _cat_name IS NOT NULL THEN ' - ' || _cat_name ELSE '' END);
  ELSE
    _eligible := (
      NEW.client_id IS NOT NULL
      AND NEW.to_account = true
      AND NEW.account_direction IS NOT NULL
      AND _cat_norm IN ('mensalista', 'debito avulso', 'saldo anterior', 'credito gympass', 'pendencia avulsa', 'estorno', 'energia (luz)', 'ranking masculino', 'ranking feminino', 'ranking dupla')
    );

    IF _cat_norm = 'credito gympass' THEN
      _entry_amount := NEW.amount - COALESCE(NEW.passthrough_amount, 0);
    ELSE
      _entry_amount := NEW.amount;
    END IF;

    _bucket := 'geral';

    IF NEW.account_direction IS NOT NULL THEN
      _direction := NEW.account_direction::public.account_entry_type;
    END IF;
    _desc := COALESCE(NEW.notes, 'Lançamento do caixa');
  END IF;

  SELECT id INTO _existing_id FROM public.account_entries WHERE payment_id = NEW.id LIMIT 1;

  IF NOT _eligible OR _entry_amount <= 0 THEN
    IF _existing_id IS NOT NULL THEN
      DELETE FROM public.account_entries WHERE id = _existing_id;
    END IF;
    RETURN NEW;
  END IF;

  IF _existing_id IS NULL THEN
    INSERT INTO public.account_entries(
      client_id, entry_type, amount, description, entry_date, payment_id, recorded_by, bucket
    ) VALUES (
      NEW.client_id,
      _direction,
      _entry_amount,
      _desc,
      (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      NEW.id,
      COALESCE(NEW.updated_by, NEW.recorded_by),
      _bucket
    );
  ELSE
    UPDATE public.account_entries
    SET
      client_id = NEW.client_id,
      entry_type = _direction,
      amount = _entry_amount,
      description = _desc,
      entry_date = (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      bucket = _bucket,
      updated_at = now()
    WHERE id = _existing_id;
  END IF;

  RETURN NEW;
END;
$$;

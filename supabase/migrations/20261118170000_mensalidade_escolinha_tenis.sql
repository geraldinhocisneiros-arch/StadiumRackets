-- Mensalidade da Escolinha de Tênis: mesmo controle do pickleball.
--
-- Todo mês, "Gerar mensalidades" (escolhendo Tênis) lança um débito
-- "Mensalidade tênis — novembro/26" na conta de cada cliente ATIVO da
-- categoria "Escolinha Tenis", com o valor do cadastro do cliente
-- (custom_amount) ou, sem ele, o valor padrão da categoria. Quando o aluno
-- paga no Caixa, o pagamento entra como crédito na conta e abate o débito:
-- saldo zerado = mês quitado.
--
-- Nunca lança duas vezes no mesmo mês (registro em tennis_school_billing) e
-- pula quem já tem um débito com a mesma descrição lançado à mão.

CREATE TABLE IF NOT EXISTS public.tennis_school_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reference_month date NOT NULL CHECK (EXTRACT(DAY FROM reference_month) = 1),
  amount numeric(10,2) NOT NULL,
  account_entry_id uuid REFERENCES public.account_entries(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, reference_month)
);

ALTER TABLE public.tennis_school_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tennis_school_billing_select ON public.tennis_school_billing;
CREATE POLICY tennis_school_billing_select ON public.tennis_school_billing
  FOR SELECT TO authenticated USING (public._is_class_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public._tennis_fee_description(_month date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Mensalidade tênis — '
    || (ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
              'setembro','outubro','novembro','dezembro'])[EXTRACT(MONTH FROM _month)::int]
    || '/' || to_char(_month, 'YY');
$$;

-- Mesmo formato de pickleball_class_fee_preview, pra tela ser a mesma.
-- status: 'gerar' | 'ja_gerada' | 'ja_lancada' (lançada à mão) | 'sem_valor'
CREATE OR REPLACE FUNCTION public.tennis_school_fee_preview(_month date)
RETURNS TABLE(client_id uuid, full_name text, amount numeric, classes text, status text, from_category boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _m date := date_trunc('month', _month)::date;
  _desc text := public._tennis_fee_description(date_trunc('month', _month)::date);
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN QUERY
  SELECT c.id, c.full_name,
    COALESCE(c.custom_amount, cc.default_amount, 0)::numeric,
    'Escolinha de Tênis'::text,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.tennis_school_billing b
                   WHERE b.client_id = c.id AND b.reference_month = _m) THEN 'ja_gerada'
      WHEN EXISTS (SELECT 1 FROM public.account_entries e
                   WHERE e.client_id = c.id AND e.entry_type = 'debito' AND e.description = _desc) THEN 'ja_lancada'
      WHEN COALESCE(c.custom_amount, cc.default_amount, 0) <= 0 THEN 'sem_valor'
      ELSE 'gerar'
    END,
    true
  FROM public.clients c
  JOIN public.client_categories cc ON cc.id = c.category_id
  WHERE c.active
    AND lower(btrim(cc.name)) IN ('escolinha tenis', 'escolinha tênis')
  ORDER BY c.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.tennis_school_fee_preview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tennis_school_fee_preview(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.tennis_school_generate_fees(_month date)
RETURNS TABLE(generated integer, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _m date := date_trunc('month', _month)::date;
  _desc text := public._tennis_fee_description(date_trunc('month', _month)::date);
  _r record;
  _bid uuid;
  _eid uuid;
  _n int := 0;
  _sum numeric := 0;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  FOR _r IN SELECT * FROM public.tennis_school_fee_preview(_month) p WHERE p.status = 'gerar' LOOP
    INSERT INTO public.tennis_school_billing (client_id, reference_month, amount)
    VALUES (_r.client_id, _m, _r.amount)
    ON CONFLICT (client_id, reference_month) DO NOTHING
    RETURNING id INTO _bid;
    CONTINUE WHEN _bid IS NULL;

    INSERT INTO public.account_entries (client_id, entry_type, amount, description, entry_date, recorded_by)
    VALUES (_r.client_id, 'debito', _r.amount, _desc, _m, auth.uid())
    RETURNING id INTO _eid;

    UPDATE public.tennis_school_billing SET account_entry_id = _eid WHERE id = _bid;
    _n := _n + 1;
    _sum := _sum + _r.amount;
  END LOOP;
  RETURN QUERY SELECT _n, _sum;
END;
$$;
REVOKE ALL ON FUNCTION public.tennis_school_generate_fees(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tennis_school_generate_fees(date) TO authenticated;

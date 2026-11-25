-- Gerar mensalidades também para quem é da categoria "Escolinha Pickleball"
-- sem estar matriculado em turma.
--
-- Antes, a prévia/geração só enxergava matrículas de turma. Hoje quase
-- nenhum aluno está em turma, mas todos estão na categoria Escolinha
-- Pickleball. Agora entram também os clientes ATIVOS dessa categoria que
-- não têm matrícula ativa no mês, com o valor do cadastro do cliente
-- (custom_amount) ou, sem ele, o valor padrão da categoria.
--
-- from_category = true marca essas linhas (a tela deixa digitar o valor de
-- quem está sem valor e grava no cadastro do cliente).

DROP FUNCTION IF EXISTS public.pickleball_class_fee_preview(date);

CREATE FUNCTION public.pickleball_class_fee_preview(_month date)
RETURNS TABLE(client_id uuid, full_name text, amount numeric, classes text, status text, from_category boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _m date := date_trunc('month', _month)::date;
  _m_end date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  _desc text := public._pickleball_fee_description(date_trunc('month', _month)::date);
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN QUERY
  WITH m AS (
    SELECT cs.client_id, sum(COALESCE(cs.class_monthly_amount, 0)) AS amount,
           string_agg(pc.name || ' (' || (ARRAY['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[pc.weekday + 1]
                      || ' ' || to_char(pc.start_time, 'HH24:MI') || ')', ', ' ORDER BY pc.weekday, pc.start_time) AS classes,
           false AS from_category
    FROM public.client_schedules cs
    JOIN public.pickleball_classes pc ON pc.id = cs.class_id
    WHERE (cs.valid_from IS NULL OR cs.valid_from <= _m_end)
      AND (cs.valid_until IS NULL OR cs.valid_until >= _m)
    GROUP BY cs.client_id
  ),
  cat AS (
    SELECT c.id AS client_id,
           COALESCE(c.custom_amount, cc.default_amount, 0)::numeric AS amount,
           'Sem turma (categoria Escolinha Pickleball)'::text AS classes,
           true AS from_category
    FROM public.clients c
    JOIN public.client_categories cc ON cc.id = c.category_id
    WHERE c.active
      AND lower(btrim(cc.name)) = 'escolinha pickleball'
      AND NOT EXISTS (SELECT 1 FROM m WHERE m.client_id = c.id)
  ),
  todos AS (
    SELECT * FROM m
    UNION ALL
    SELECT * FROM cat
  )
  SELECT t.client_id, c.full_name, t.amount, t.classes,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.pickleball_class_billing b
                   WHERE b.client_id = t.client_id AND b.reference_month = _m) THEN 'ja_gerada'
      WHEN EXISTS (SELECT 1 FROM public.account_entries e
                   WHERE e.client_id = t.client_id AND e.entry_type = 'debito' AND e.description = _desc) THEN 'ja_lancada'
      WHEN t.amount <= 0 THEN 'sem_valor'
      ELSE 'gerar'
    END,
    t.from_category
  FROM todos t JOIN public.clients c ON c.id = t.client_id
  ORDER BY c.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_fee_preview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_fee_preview(date) TO authenticated;

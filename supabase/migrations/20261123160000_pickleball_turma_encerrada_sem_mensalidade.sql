-- Turma de pickleball encerrada não gera mais mensalidade para os alunos dela.
--
-- Antes: ao encerrar a turma, os alunos saíam dela, mas quem tinha categoria
-- "Escolinha Pickleball" caía na regra "Sem turma (categoria)" e continuava
-- sendo cobrado todo mês. Agora, quem esteve numa turma encerrada antes do
-- mês cobrado fica fora da regra da categoria. Se o aluno for colocado em
-- outra turma, ele volta a ser cobrado normalmente por essa turma (CTE "m").
CREATE OR REPLACE FUNCTION public.pickleball_class_fee_preview(_month date)
 RETURNS TABLE(client_id uuid, full_name text, amount numeric, classes text, status text, from_category boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Aluno de turma encerrada antes deste mês: não cobra pela categoria.
      AND NOT EXISTS (
        SELECT 1
        FROM public.client_schedules cs2
        JOIN public.pickleball_classes pc2 ON pc2.id = cs2.class_id
        WHERE cs2.client_id = c.id
          AND pc2.valid_until IS NOT NULL
          AND pc2.valid_until < _m
      )
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
$function$;

-- Encerrar turma num clique (botão "Encerrar turma" em Turmas).
-- Mesma convenção de "tirar aluno": o último dia é ontem, então a turma já
-- aparece como encerrada e o horário fica livre para locação hoje.
-- Alunos com matrícula marcada para começar depois disso (nunca começaram)
-- são removidos; os demais saem junto com a turma.
CREATE OR REPLACE FUNCTION public.pickleball_class_end(_class_id uuid)
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _last date := public.recife_today() - 1;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  PERFORM 1 FROM public.pickleball_classes WHERE id = _class_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;

  DELETE FROM public.client_schedules
  WHERE class_id = _class_id AND valid_from IS NOT NULL AND valid_from > _last;

  UPDATE public.client_schedules SET valid_until = _last
  WHERE class_id = _class_id AND (valid_until IS NULL OR valid_until > _last);

  UPDATE public.pickleball_classes SET
    valid_from = CASE WHEN valid_from IS NOT NULL AND valid_from > _last THEN _last ELSE valid_from END,
    valid_until = _last
  WHERE id = _class_id AND (valid_until IS NULL OR valid_until > _last);

  RETURN _last;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_end(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_end(uuid) TO authenticated;

-- Mensalidade do pickleball é do ALUNO, não da turma.
--
-- Antes: cada matrícula tinha seu valor (class_monthly_amount) e o aluno de
-- 2x por semana precisava ter o valor numa turma e 0 na outra (ou 200 + 200).
-- Agora: matricular é só reservar o horário. A mensalidade vem do cadastro do
-- cliente (clients.custom_amount — o mesmo valor que o Caixa já usa) ou, sem
-- ele, do valor padrão da categoria Escolinha Pickleball. Um valor por aluno
-- por mês, não importa em quantas turmas ele esteja.
--
-- class_monthly_amount fica na tabela só como histórico; nada mais lê dele.

-- Matrícula sem valor: _monthly_amount passa a ser opcional e é ignorado.
CREATE OR REPLACE FUNCTION public.pickleball_class_add_member(
  _class_id uuid, _client_id uuid, _monthly_amount numeric DEFAULT NULL, _start date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.pickleball_classes%ROWTYPE;
  _from date := COALESCE(_start, public.recife_today());
  _members int;
  _sid uuid;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  SELECT * INTO _c FROM public.pickleball_classes WHERE id = _class_id FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  IF _c.valid_until IS NOT NULL AND _c.valid_until < _from THEN
    RAISE EXCEPTION 'Essa turma está encerrada.';
  END IF;

  SELECT count(*) INTO _members FROM public.client_schedules
  WHERE class_id = _class_id AND client_id <> _client_id
    AND (valid_until IS NULL OR valid_until >= _from);
  IF _c.capacity IS NOT NULL AND _members >= _c.capacity THEN
    RAISE EXCEPTION 'Turma cheia (% de % vagas).', _members, _c.capacity;
  END IF;

  IF _c.valid_from IS NOT NULL AND _c.valid_from > _from THEN
    _from := _c.valid_from;
  END IF;

  -- Já matriculado (mesmo que tenha saído): reativa.
  SELECT id INTO _sid FROM public.client_schedules WHERE class_id = _class_id AND client_id = _client_id;
  IF _sid IS NOT NULL THEN
    UPDATE public.client_schedules SET
      valid_from = CASE WHEN valid_until IS NOT NULL AND valid_until < _from THEN _from ELSE valid_from END,
      valid_until = _c.valid_until
    WHERE id = _sid;
    RETURN _sid;
  END IF;

  INSERT INTO public.client_schedules
    (client_id, teacher_id, weekday, start_time, end_time, court, notes, valid_from, valid_until, class_id)
  VALUES
    (_client_id, _c.teacher_id, _c.weekday, _c.start_time, _c.end_time, _c.court, 'Turma: ' || _c.name,
     _from, _c.valid_until, _class_id)
  RETURNING id INTO _sid;

  IF _c.teacher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.client_teachers WHERE client_id = _client_id AND teacher_id = _c.teacher_id
  ) THEN
    INSERT INTO public.client_teachers (client_id, teacher_id) VALUES (_client_id, _c.teacher_id);
  END IF;

  RETURN _sid;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_add_member(uuid, uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_add_member(uuid, uuid, numeric, date) TO authenticated;

-- Prévia: um valor por aluno, vindo do cadastro.
--   * aluno em turma no mês: custom_amount; sem ele, o padrão da categoria
--     só se a categoria for Escolinha Pickleball (padrão de outra categoria
--     não é mensalidade de pickleball);
--   * aluno da categoria sem turma: igual a antes (inclusive a regra de
--     turma encerrada).
-- from_category agora significa "valor editável na prévia" (todas as linhas):
-- o valor digitado é gravado no cadastro do cliente.
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
    SELECT cs.client_id,
           string_agg(pc.name || ' (' || (ARRAY['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[pc.weekday + 1]
                      || ' ' || to_char(pc.start_time, 'HH24:MI') || ')', ', ' ORDER BY pc.weekday, pc.start_time) AS classes
    FROM public.client_schedules cs
    JOIN public.pickleball_classes pc ON pc.id = cs.class_id
    WHERE (cs.valid_from IS NULL OR cs.valid_from <= _m_end)
      AND (cs.valid_until IS NULL OR cs.valid_until >= _m)
    GROUP BY cs.client_id
  ),
  cat AS (
    SELECT c.id AS client_id,
           'Sem turma (categoria Escolinha Pickleball)'::text AS classes
    FROM public.clients c
    JOIN public.client_categories cc ON cc.id = c.category_id
    WHERE c.active
      AND lower(btrim(cc.name)) = 'escolinha pickleball'
      AND NOT EXISTS (SELECT 1 FROM m WHERE m.client_id = c.id)
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
    SELECT t.client_id, t.classes,
           COALESCE(c.custom_amount,
                    CASE WHEN lower(btrim(cc.name)) = 'escolinha pickleball' THEN cc.default_amount END,
                    0)::numeric AS amount
    FROM (SELECT * FROM m UNION ALL SELECT * FROM cat) t
    JOIN public.clients c ON c.id = t.client_id
    LEFT JOIN public.client_categories cc ON cc.id = c.category_id
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
    true
  FROM todos t JOIN public.clients c ON c.id = t.client_id
  ORDER BY c.full_name;
END;
$function$;

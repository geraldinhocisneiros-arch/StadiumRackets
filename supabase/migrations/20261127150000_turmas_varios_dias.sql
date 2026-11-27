-- Turmas com vários dias na semana (ex.: Segunda e Quarta) e Escolinha Kids
-- também nas quadras de pickleball.
--
-- Modelo: cada DIA continua sendo uma linha em pickleball_classes (a chamada,
-- a reposição e a ocupação da quadra no mapa seguem por dia). Os dias da
-- mesma turma compartilham group_id. Turma antiga (group_id nulo) é um grupo
-- de um dia só: a chave do grupo é COALESCE(group_id, id).
--
-- Matrícula: o aluno escolhe em quais dias da turma vai (1x ou 2x por semana);
-- cada dia é uma matrícula, e a mensalidade kids usa o nº de dias.

ALTER TABLE public.pickleball_classes ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS idx_pickleball_classes_group ON public.pickleball_classes(group_id)
  WHERE group_id IS NOT NULL;

-- Escolinha Kids: quadra de tênis ou de pickleball.
ALTER TABLE public.pickleball_classes DROP CONSTRAINT IF EXISTS pickleball_classes_program_court_check;
ALTER TABLE public.pickleball_classes ADD CONSTRAINT pickleball_classes_program_court_check
  CHECK ((program = 'pickleball' AND court BETWEEN 2 AND 4) OR (program = 'kids' AND court BETWEEN 1 AND 4));

CREATE OR REPLACE FUNCTION public.pickleball_class_save(
  _id uuid, _name text, _court smallint, _weekday smallint, _start time, _end time,
  _teacher_id uuid, _capacity integer, _valid_from date, _valid_until date, _notes text,
  _program text DEFAULT 'pickleball'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cid uuid := _id;
  _prog text := COALESCE(_program, 'pickleball');
  _conflict text;
  _members int;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  IF _cid IS NOT NULL THEN
    SELECT program INTO _prog FROM public.pickleball_classes WHERE id = _cid;
    IF _prog IS NULL THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  END IF;
  IF _prog NOT IN ('pickleball', 'kids') THEN
    RAISE EXCEPTION 'Programa inválido.';
  END IF;
  IF _prog = 'pickleball' AND _court NOT IN (2, 3, 4) THEN
    RAISE EXCEPTION 'Turma de pickleball só em quadra de pickleball (PB1, PB2 ou PB3).';
  END IF;
  IF _prog = 'kids' AND _court NOT IN (1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Quadra inválida.';
  END IF;
  IF _end <= _start THEN
    RAISE EXCEPTION 'O horário final precisa ser depois do inicial.';
  END IF;

  IF _cid IS NOT NULL THEN
    SELECT count(*) INTO _members FROM public.client_schedules
    WHERE class_id = _cid AND (valid_until IS NULL OR valid_until >= public.recife_today());
    IF _capacity IS NOT NULL AND _members > _capacity THEN
      RAISE EXCEPTION 'A turma já tem % alunos ativos; o limite não pode ser menor que isso.', _members;
    END IF;
  END IF;

  _conflict := public._pickleball_class_conflict(_cid, _court, _weekday, _start, _end, _valid_from, _valid_until);
  IF _conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Quadra ocupada (%): %. Cancele ou mova antes de criar/alterar a turma.',
      (ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[_weekday + 1], _conflict;
  END IF;

  IF _cid IS NULL THEN
    INSERT INTO public.pickleball_classes
      (name, court, weekday, start_time, end_time, teacher_id, capacity, valid_from, valid_until, notes, program)
    VALUES (btrim(_name), _court, _weekday, _start, _end, _teacher_id, _capacity, _valid_from, _valid_until,
            NULLIF(btrim(COALESCE(_notes, '')), ''), _prog)
    RETURNING id INTO _cid;
  ELSE
    UPDATE public.pickleball_classes SET
      name = btrim(_name), court = _court, weekday = _weekday, start_time = _start, end_time = _end,
      teacher_id = _teacher_id, capacity = _capacity, valid_from = _valid_from, valid_until = _valid_until,
      notes = NULLIF(btrim(COALESCE(_notes, '')), '')
    WHERE id = _cid;

    UPDATE public.client_schedules cs SET
      court = _court, weekday = _weekday, start_time = _start, end_time = _end,
      teacher_id = _teacher_id,
      notes = 'Turma: ' || btrim(_name),
      valid_from = CASE
        WHEN _valid_from IS NOT NULL AND (cs.valid_from IS NULL OR cs.valid_from < _valid_from) THEN _valid_from
        ELSE cs.valid_from END,
      valid_until = CASE
        WHEN _valid_until IS NOT NULL AND (cs.valid_until IS NULL OR cs.valid_until > _valid_until) THEN _valid_until
        ELSE cs.valid_until END
    WHERE cs.class_id = _cid;
  END IF;

  RETURN _cid;
END;
$$;

-- Criar/editar a turma com todos os dias de uma vez (tudo ou nada).
--   * dia marcado que já existe na turma → atualiza;
--   * dia marcado novo → cria no mesmo grupo;
--   * dia desmarcado que estava ativo → encerra (alunos saem desse dia).
-- Retorna a chave do grupo.
CREATE OR REPLACE FUNCTION public.class_group_save(
  _group_id uuid, _name text, _court smallint, _weekdays smallint[], _start time, _end time,
  _teacher_id uuid, _capacity integer, _valid_from date, _valid_until date, _notes text,
  _program text DEFAULT 'pickleball'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _gid uuid := COALESCE(_group_id, gen_random_uuid());
  _today date := public.recife_today();
  _wd smallint;
  _cid uuid;
  _prog text := _program;
  _r record;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  IF _weekdays IS NULL OR cardinality(_weekdays) = 0 THEN
    RAISE EXCEPTION 'Marque pelo menos um dia da semana.';
  END IF;

  IF _group_id IS NOT NULL THEN
    -- Turma antiga (sem grupo) passa a ter o grupo = o próprio id.
    UPDATE public.pickleball_classes SET group_id = _gid
    WHERE group_id IS NULL AND id = _gid;
    SELECT program INTO _prog FROM public.pickleball_classes WHERE group_id = _gid LIMIT 1;
    IF _prog IS NULL THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  END IF;

  FOREACH _wd IN ARRAY (SELECT array_agg(DISTINCT w ORDER BY w) FROM unnest(_weekdays) w) LOOP
    IF _wd NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'Dia da semana inválido.'; END IF;
    SELECT id INTO _cid FROM public.pickleball_classes
    WHERE group_id = _gid AND weekday = _wd
      AND (valid_until IS NULL OR valid_until >= _today)
    ORDER BY created_at DESC LIMIT 1;

    _cid := public.pickleball_class_save(_cid, _name, _court, _wd, _start, _end, _teacher_id,
                                         _capacity, _valid_from, _valid_until, _notes, _prog);
    UPDATE public.pickleball_classes SET group_id = _gid WHERE id = _cid AND group_id IS DISTINCT FROM _gid;
  END LOOP;

  -- Dias desmarcados: encerra.
  FOR _r IN
    SELECT id FROM public.pickleball_classes
    WHERE group_id = _gid AND NOT (weekday = ANY(_weekdays))
      AND (valid_until IS NULL OR valid_until >= _today)
  LOOP
    PERFORM public.pickleball_class_end(_r.id);
  END LOOP;

  RETURN _gid;
END;
$$;
REVOKE ALL ON FUNCTION public.class_group_save(uuid, text, smallint, smallint[], time, time, uuid, integer, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.class_group_save(uuid, text, smallint, smallint[], time, time, uuid, integer, date, date, text, text) TO authenticated;

-- Matricular o aluno em vários dias da turma de uma vez (tudo ou nada).
CREATE OR REPLACE FUNCTION public.class_group_add_member(
  _class_ids uuid[], _client_id uuid, _start date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _id uuid;
  _n int := 0;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  IF _class_ids IS NULL OR cardinality(_class_ids) = 0 THEN
    RAISE EXCEPTION 'Marque pelo menos um dia.';
  END IF;
  FOREACH _id IN ARRAY _class_ids LOOP
    PERFORM public.pickleball_class_add_member(_id, _client_id, NULL, _start);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.class_group_add_member(uuid[], uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.class_group_add_member(uuid[], uuid, date) TO authenticated;

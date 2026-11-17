-- Stadium Rackets — parte 8 (Turmas de pickleball). Rode no SQL Editor do Supabase do projeto da STADIUM.

-- Turmas fixas de pickleball.
--
-- No pickleball existem TURMAS FIXAS e LOCAÇÕES. Na turma o aluno paga UMA
-- mensalidade e treina o mês inteiro: não há cobrança por aula (diferente do
-- fixo do tênis, em que cada presença vira lançamento no caixa). O horário
-- da turma ocupa a quadra; o que não tem turma fica livre para locação.
--
-- Modelo:
--   * pickleball_classes  = a turma (nome, quadra, dia, horário, professor,
--     limite de alunos, vigência). Cada turma é UM horário semanal; quem
--     treina 2x por semana é matriculado em duas turmas.
--   * Matrícula = uma linha em client_schedules com class_id preenchido.
--     Reaproveitar o horário fixo faz TODO o resto do sistema (reserva
--     online, lista de espera, mapa do professor/TV, checagem de conflito)
--     já enxergar a quadra ocupada, sem duplicar essas regras.
--   * client_schedules.class_monthly_amount = valor da mensalidade daquela
--     matrícula (aluno de 2x: valor numa matrícula e 0 na outra).
--   * Horário da turma vazio (sem aluno) não ocupa a quadra.
--
-- O que NÃO vale para a matrícula (class_id preenchido):
--   * presença com cobrança no mapa (tratado no frontend);
--   * projeção de "locações restantes no mês" (abaixo);
--   * lembrete de confirmação 4h antes (tratado no hook).
--
-- Mensalidade: botão mensal na tela de Turmas. Gera UM débito por aluno por
-- mês ("Mensalidade pickleball — dezembro/26"), soma das matrículas ativas no
-- mês. Nunca gera duas vezes (registro em pickleball_class_billing) e pula
-- quem já tem a mensalidade do mês lançada à mão com a mesma descrição.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pickleball_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  court smallint NOT NULL CHECK (court BETWEEN 2 AND 4),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  valid_from date,
  valid_until date,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

DROP TRIGGER IF EXISTS trg_pickleball_classes_updated ON public.pickleball_classes;
CREATE TRIGGER trg_pickleball_classes_updated BEFORE UPDATE ON public.pickleball_classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_schedules
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.pickleball_classes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS class_monthly_amount numeric(10,2)
    CHECK (class_monthly_amount IS NULL OR class_monthly_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_client_schedules_class ON public.client_schedules(class_id)
  WHERE class_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_schedules_class_client
  ON public.client_schedules(class_id, client_id) WHERE class_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pickleball_class_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reference_month date NOT NULL CHECK (EXTRACT(DAY FROM reference_month) = 1),
  amount numeric(10,2) NOT NULL,
  account_entry_id uuid REFERENCES public.account_entries(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, reference_month)
);

-- ---------------------------------------------------------------------------
-- Permissões: leitura para a equipe e professores; gravação só pelas funções.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._is_class_staff(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'diretoria'::public.app_role)
      OR public.has_role(_uid, 'recepcionista'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public._is_class_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_class_staff(uuid) TO authenticated;

ALTER TABLE public.pickleball_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickleball_class_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pickleball_classes_select ON public.pickleball_classes;
CREATE POLICY pickleball_classes_select ON public.pickleball_classes
  FOR SELECT TO authenticated
  USING (
    public._is_class_staff(auth.uid())
    OR public.has_role(auth.uid(), 'professor'::public.app_role)
    OR public.has_role(auth.uid(), 'visualizador'::public.app_role)
  );

DROP POLICY IF EXISTS pickleball_class_billing_select ON public.pickleball_class_billing;
CREATE POLICY pickleball_class_billing_select ON public.pickleball_class_billing
  FOR SELECT TO authenticated USING (public._is_class_staff(auth.uid()));

-- ---------------------------------------------------------------------------
-- Conflito de horário: outro fixo (que não seja desta turma) ou locação
-- futura na mesma quadra/dia/horário dentro da vigência.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._pickleball_class_conflict(
  _class_id uuid, _court smallint, _weekday smallint, _start time, _end time,
  _valid_from date, _valid_until date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _from date := GREATEST(COALESCE(_valid_from, public.recife_today()), public.recife_today());
  _msg text;
BEGIN
  SELECT 'Horário fixo de ' || c.full_name || ' (' || to_char(cs.start_time, 'HH24:MI') || '–'
         || to_char(cs.end_time, 'HH24:MI') || ')'
    INTO _msg
  FROM public.client_schedules cs
  JOIN public.clients c ON c.id = cs.client_id
  WHERE cs.court = _court AND cs.weekday = _weekday
    AND cs.start_time < _end AND cs.end_time > _start
    AND cs.class_id IS DISTINCT FROM _class_id
    AND (cs.valid_until IS NULL OR cs.valid_until >= _from)
    AND (_valid_until IS NULL OR cs.valid_from IS NULL OR cs.valid_from <= _valid_until)
  LIMIT 1;
  IF _msg IS NOT NULL THEN RETURN _msg; END IF;

  SELECT 'Locação em ' || to_char(b.booking_date, 'DD/MM') || ' ' || to_char(b.start_time, 'HH24:MI')
         || '–' || to_char(b.end_time, 'HH24:MI') || COALESCE(' (' || COALESCE(c.full_name, b.guest_name) || ')', '')
    INTO _msg
  FROM public.court_bookings b
  LEFT JOIN public.clients c ON c.id = b.client_id
  WHERE b.court = _court AND b.cancelled_at IS NULL
    AND EXTRACT(DOW FROM b.booking_date)::int = _weekday
    AND b.booking_date >= _from
    AND (_valid_until IS NULL OR b.booking_date <= _valid_until)
    AND b.start_time < _end AND b.end_time > _start
  ORDER BY b.booking_date
  LIMIT 1;
  RETURN _msg;
END;
$$;
REVOKE ALL ON FUNCTION public._pickleball_class_conflict(uuid, smallint, smallint, time, time, date, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Criar/editar turma (sincroniza o horário de todos os alunos matriculados)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pickleball_class_save(
  _id uuid, _name text, _court smallint, _weekday smallint, _start time, _end time,
  _teacher_id uuid, _capacity integer, _valid_from date, _valid_until date, _notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cid uuid := _id;
  _conflict text;
  _members int;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  IF _court NOT IN (2, 3, 4) THEN
    RAISE EXCEPTION 'Turma só em quadra de pickleball (PB1, PB2 ou PB3).';
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
    RAISE EXCEPTION 'Quadra ocupada nesse horário: %. Cancele ou mova antes de criar/alterar a turma.', _conflict;
  END IF;

  IF _cid IS NULL THEN
    INSERT INTO public.pickleball_classes
      (name, court, weekday, start_time, end_time, teacher_id, capacity, valid_from, valid_until, notes)
    VALUES (btrim(_name), _court, _weekday, _start, _end, _teacher_id, _capacity, _valid_from, _valid_until,
            NULLIF(btrim(COALESCE(_notes, '')), ''))
    RETURNING id INTO _cid;
  ELSE
    UPDATE public.pickleball_classes SET
      name = btrim(_name), court = _court, weekday = _weekday, start_time = _start, end_time = _end,
      teacher_id = _teacher_id, capacity = _capacity, valid_from = _valid_from, valid_until = _valid_until,
      notes = NULLIF(btrim(COALESCE(_notes, '')), '')
    WHERE id = _cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;

    -- Alunos acompanham a turma. A vigência do aluno fica dentro da turma.
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
REVOKE ALL ON FUNCTION public.pickleball_class_save(uuid, text, smallint, smallint, time, time, uuid, integer, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_save(uuid, text, smallint, smallint, time, time, uuid, integer, date, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Matrícula
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pickleball_class_add_member(
  _class_id uuid, _client_id uuid, _monthly_amount numeric, _start date DEFAULT NULL
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
  IF _monthly_amount IS NULL OR _monthly_amount < 0 THEN
    RAISE EXCEPTION 'Informe o valor da mensalidade (0 se ela já é cobrada em outra turma).';
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

  -- Já matriculado (mesmo que tenha saído): reativa com o novo valor.
  SELECT id INTO _sid FROM public.client_schedules WHERE class_id = _class_id AND client_id = _client_id;
  IF _sid IS NOT NULL THEN
    UPDATE public.client_schedules SET
      class_monthly_amount = _monthly_amount,
      valid_from = CASE WHEN valid_until IS NOT NULL AND valid_until < _from THEN _from ELSE valid_from END,
      valid_until = _c.valid_until
    WHERE id = _sid;
    RETURN _sid;
  END IF;

  INSERT INTO public.client_schedules
    (client_id, teacher_id, weekday, start_time, end_time, court, notes, valid_from, valid_until,
     class_id, class_monthly_amount)
  VALUES
    (_client_id, _c.teacher_id, _c.weekday, _c.start_time, _c.end_time, _c.court, 'Turma: ' || _c.name,
     _from, _c.valid_until, _class_id, _monthly_amount)
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

CREATE OR REPLACE FUNCTION public.pickleball_class_set_member_amount(_schedule_id uuid, _monthly_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  IF _monthly_amount IS NULL OR _monthly_amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;
  UPDATE public.client_schedules SET class_monthly_amount = _monthly_amount
  WHERE id = _schedule_id AND class_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Matrícula não encontrada.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_set_member_amount(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_set_member_amount(uuid, numeric) TO authenticated;

-- Saída da turma: a matrícula termina em _end_date (mantém o histórico).
-- Se a matrícula ainda nem começou, é apagada.
CREATE OR REPLACE FUNCTION public.pickleball_class_remove_member(_schedule_id uuid, _end_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _end date := COALESCE(_end_date, public.recife_today() - 1);
  _vf date;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas.';
  END IF;
  SELECT valid_from INTO _vf FROM public.client_schedules WHERE id = _schedule_id AND class_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Matrícula não encontrada.'; END IF;
  IF _vf IS NOT NULL AND _vf > _end THEN
    DELETE FROM public.client_schedules WHERE id = _schedule_id;
  ELSE
    UPDATE public.client_schedules SET valid_until = _end WHERE id = _schedule_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_remove_member(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_remove_member(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Mensalidades do mês
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._pickleball_fee_description(_month date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Mensalidade pickleball — '
    || (ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
              'setembro','outubro','novembro','dezembro'])[EXTRACT(MONTH FROM _month)::int]
    || '/' || to_char(_month, 'YY');
$$;

-- status: 'gerar' | 'ja_gerada' | 'ja_lancada' (lançada à mão) | 'sem_valor'
CREATE OR REPLACE FUNCTION public.pickleball_class_fee_preview(_month date)
RETURNS TABLE(client_id uuid, full_name text, amount numeric, classes text, status text)
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
                      || ' ' || to_char(pc.start_time, 'HH24:MI') || ')', ', ' ORDER BY pc.weekday, pc.start_time) AS classes
    FROM public.client_schedules cs
    JOIN public.pickleball_classes pc ON pc.id = cs.class_id
    WHERE (cs.valid_from IS NULL OR cs.valid_from <= _m_end)
      AND (cs.valid_until IS NULL OR cs.valid_until >= _m)
    GROUP BY cs.client_id
  )
  SELECT m.client_id, c.full_name, m.amount, m.classes,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.pickleball_class_billing b
                   WHERE b.client_id = m.client_id AND b.reference_month = _m) THEN 'ja_gerada'
      WHEN EXISTS (SELECT 1 FROM public.account_entries e
                   WHERE e.client_id = m.client_id AND e.entry_type = 'debito' AND e.description = _desc) THEN 'ja_lancada'
      WHEN m.amount <= 0 THEN 'sem_valor'
      ELSE 'gerar'
    END
  FROM m JOIN public.clients c ON c.id = m.client_id
  ORDER BY c.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_fee_preview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_fee_preview(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.pickleball_class_generate_fees(_month date)
RETURNS TABLE(generated integer, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _m date := date_trunc('month', _month)::date;
  _desc text := public._pickleball_fee_description(date_trunc('month', _month)::date);
  _r record;
  _bid uuid;
  _eid uuid;
  _n int := 0;
  _sum numeric := 0;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  FOR _r IN SELECT * FROM public.pickleball_class_fee_preview(_month) p WHERE p.status = 'gerar' LOOP
    INSERT INTO public.pickleball_class_billing (client_id, reference_month, amount)
    VALUES (_r.client_id, _m, _r.amount)
    ON CONFLICT (client_id, reference_month) DO NOTHING
    RETURNING id INTO _bid;
    CONTINUE WHEN _bid IS NULL;

    INSERT INTO public.account_entries (client_id, entry_type, amount, description, entry_date, recorded_by)
    VALUES (_r.client_id, 'debito', _r.amount, _desc, _m, auth.uid())
    RETURNING id INTO _eid;

    UPDATE public.pickleball_class_billing SET account_entry_id = _eid WHERE id = _bid;
    _n := _n + 1;
    _sum := _sum + _r.amount;
  END LOOP;
  RETURN QUERY SELECT _n, _sum;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_generate_fees(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_generate_fees(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Projeção de fim de mês: aula de turma não é cobrada por sessão.
-- (Mesma função de antes; só ignora matrículas de turma.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._client_remaining_sessions_amount(_client_id uuid, _range_start date DEFAULT NULL::date, _range_end date DEFAULT NULL::date)
 RETURNS TABLE(session_count integer, session_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _today DATE := public.recife_today();
  _start DATE := COALESCE(_range_start, public.recife_today() + 1);
  _end DATE := COALESCE(_range_end, public.recife_month_end());
  _category_id UUID;
  _category_name TEXT;
  _discount NUMERIC;
  _cs RECORD;
  _d DATE;
  _count INT := 0;
  _sum NUMERIC := 0;
  _split INT;
  _price NUMERIC;
  _cancelled BOOLEAN;
BEGIN
  SELECT c.category_id, c.default_discount_percent, cc.name
  INTO _category_id, _discount, _category_name
  FROM public.clients c
  LEFT JOIN public.client_categories cc ON cc.id = c.category_id
  WHERE c.id = _client_id;

  IF _discount IS NULL AND lower(trim(COALESCE(_category_name, ''))) = 'mensalista' THEN
    _discount := 10;
  END IF;

  FOR _cs IN
    SELECT cs.id, cs.court, cs.weekday, cs.start_time, cs.end_time, cs.valid_from, cs.valid_until
    FROM public.client_schedules cs
    JOIN public.clients c ON c.id = cs.client_id
    WHERE cs.client_id = _client_id
      AND cs.court IS NOT NULL
      AND cs.class_id IS NULL
      AND (cs.valid_from IS NULL OR cs.valid_from <= _end)
      AND (cs.valid_until IS NULL OR cs.valid_until >= _start)
  LOOP
    _d := _start + ((_cs.weekday - EXTRACT(DOW FROM _start)::int + 7) % 7);

    WHILE _d <= _end LOOP
      IF (_cs.valid_from IS NULL OR _cs.valid_from <= _d)
         AND (_cs.valid_until IS NULL OR _cs.valid_until >= _d) THEN

        SELECT EXISTS (
          SELECT 1 FROM public.client_schedule_exceptions e
          WHERE e.client_schedule_id = _cs.id
            AND e.exception_date <= _d
            AND COALESCE(e.range_end, e.exception_date) >= _d
            AND e.start_time IS NULL AND e.end_time IS NULL
        ) INTO _cancelled;

        IF NOT _cancelled THEN
          SELECT 1 + count(*) INTO _split
          FROM public.client_schedules cs2
          JOIN public.clients c2 ON c2.id = cs2.client_id
          WHERE cs2.court = _cs.court
            AND cs2.weekday = _cs.weekday
            AND cs2.id <> _cs.id
            AND cs2.client_id <> _client_id
            AND cs2.class_id IS NULL
            AND cs2.start_time < _cs.end_time
            AND cs2.end_time > _cs.start_time
            AND (cs2.valid_from IS NULL OR cs2.valid_from <= _d)
            AND (cs2.valid_until IS NULL OR cs2.valid_until >= _d)
            AND NOT EXISTS (
              SELECT 1 FROM public.client_schedule_exceptions e2
              WHERE e2.client_schedule_id = cs2.id
                AND e2.exception_date <= _d
                AND COALESCE(e2.range_end, e2.exception_date) >= _d
                AND e2.start_time IS NULL AND e2.end_time IS NULL
            );

          _price := public.debt_limit_slot_price(_cs.court, _cs.weekday, _cs.start_time, _cs.end_time, _category_id, _d);
          _sum := _sum + ROUND((_price / _split) * (1 - COALESCE(_discount, 0) / 100), 2);
          _count := _count + 1;
        END IF;
      END IF;

      _d := _d + 7;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT _count, _sum;
END;
$function$;

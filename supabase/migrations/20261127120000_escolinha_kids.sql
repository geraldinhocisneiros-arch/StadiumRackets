-- Escolinha Kids de tênis: mesma lógica das turmas de pickleball + aula avulsa.
--
-- Turmas:
--   * pickleball_classes ganha "program" ('pickleball' | 'kids'). Turma kids
--     é na quadra de tênis (1); turma de pickleball continua nas PB1–PB3.
--     Matrícula, chamada (Veio/Faltou/Cancelou, prazo de 12h, abono) e
--     reposição são as mesmas funções. A reposição só vale dentro do mesmo
--     programa: cancelou na kids, repõe na kids.
--
-- Mensalidade kids (botão "Gerar mensalidades" na aba Escolinha Kids):
--   * um débito por aluno por mês "Mensalidade escolinha kids — dezembro/26";
--   * valor: o do cadastro do cliente (custom_amount); sem ele, o padrão da
--     categoria × nº de turmas kids no mês (1x = 200, 2x = 400 com padrão 200);
--   * entram os alunos matriculados em turma kids e os clientes ativos da
--     categoria Escolinha Kids / Escolinha Tenis sem turma;
--   * cliente marcado como AVULSO (clients.kids_avulso) não gera mensalidade.
--   * Substitui o gerador antigo "Mensalidade tênis" (que nunca foi usado:
--     tennis_school_billing vazio) — mesma tabela de controle.
--
-- Aula avulsa (chamada da turma kids no mapa):
--   * lança um cliente que NÃO é da turma naquela aula, cobrando R$ 70 (valor
--     editável) como débito na conta dele: "Aula avulsa escolinha kids — 27/11/26";
--   * avulso NÃO ganha reposição (não entra na chamada da turma);
--   * ocupa vaga da turma no dia, como a reposição;
--   * remover o avulso apaga o débito.

-- ---------------------------------------------------------------------------
-- Turma: programa e quadra
-- ---------------------------------------------------------------------------

ALTER TABLE public.pickleball_classes
  ADD COLUMN IF NOT EXISTS program text NOT NULL DEFAULT 'pickleball';

ALTER TABLE public.pickleball_classes DROP CONSTRAINT IF EXISTS pickleball_classes_court_check;
ALTER TABLE public.pickleball_classes DROP CONSTRAINT IF EXISTS pickleball_classes_program_court_check;
ALTER TABLE public.pickleball_classes ADD CONSTRAINT pickleball_classes_program_court_check
  CHECK ((program = 'pickleball' AND court BETWEEN 2 AND 4) OR (program = 'kids' AND court = 1));

CREATE INDEX IF NOT EXISTS idx_pickleball_classes_program ON public.pickleball_classes(program);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS kids_avulso boolean NOT NULL DEFAULT false;

-- Categoria da escolinha kids (aceita o nome antigo "Escolinha Tenis").
CREATE OR REPLACE FUNCTION public._is_kids_category(_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(_name, ''))) IN
    ('escolinha kids', 'escolinha tenis', 'escolinha tênis', 'escolinha kids tenis', 'escolinha kids tênis');
$$;

-- Programa da turma de uma matrícula (client_schedules.id).
CREATE OR REPLACE FUNCTION public._class_program(_class_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT program FROM public.pickleball_classes WHERE id = _class_id;
$$;
REVOKE ALL ON FUNCTION public._class_program(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._class_program(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Criar/editar turma (agora com programa)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.pickleball_class_save(uuid, text, smallint, smallint, time, time, uuid, integer, date, date, text);
CREATE FUNCTION public.pickleball_class_save(
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
  -- Editando: o programa é o da turma (não troca kids ↔ pickleball).
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
  IF _prog = 'kids' AND _court <> 1 THEN
    RAISE EXCEPTION 'Turma da Escolinha Kids só na quadra de tênis.';
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
REVOKE ALL ON FUNCTION public.pickleball_class_save(uuid, text, smallint, smallint, time, time, uuid, integer, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_save(uuid, text, smallint, smallint, time, time, uuid, integer, date, date, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Aula avulsa
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.class_drop_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.pickleball_classes(id) ON DELETE CASCADE,
  class_date date NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  account_entry_id uuid REFERENCES public.account_entries(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, class_id, class_date)
);
CREATE INDEX IF NOT EXISTS idx_class_drop_ins_class_date ON public.class_drop_ins(class_id, class_date);

ALTER TABLE public.class_drop_ins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS class_drop_ins_select ON public.class_drop_ins;
CREATE POLICY class_drop_ins_select ON public.class_drop_ins
  FOR SELECT TO authenticated
  USING (
    public._is_class_staff(auth.uid())
    OR public.has_role(auth.uid(), 'professor'::public.app_role)
  );
-- Gravação só pelas funções abaixo.

-- Vagas ocupadas na turma no dia: matriculados que não cancelaram +
-- reposições + avulsos.
CREATE OR REPLACE FUNCTION public._class_occupied_on(_class_id uuid, _date date)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (
    (SELECT count(*) FROM public.client_schedules cs
     WHERE cs.class_id = _class_id
       AND (cs.valid_from IS NULL OR cs.valid_from <= _date)
       AND (cs.valid_until IS NULL OR cs.valid_until >= _date)
       AND NOT EXISTS (
         SELECT 1 FROM public.client_schedule_attendance a
         WHERE a.client_schedule_id = cs.id AND a.attendance_date = _date
           AND a.status LIKE 'cancelled%'))
    + (SELECT count(*) FROM public.pickleball_class_makeups mk
       WHERE mk.class_id = _class_id AND mk.class_date = _date)
    + (SELECT count(*) FROM public.class_drop_ins d
       WHERE d.class_id = _class_id AND d.class_date = _date)
  )::int;
$$;
REVOKE ALL ON FUNCTION public._class_occupied_on(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._drop_in_description(_program text, _date date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Aula avulsa ' || CASE WHEN _program = 'kids' THEN 'escolinha kids' ELSE 'turma pickleball' END
    || ' — ' || to_char(_date, 'DD/MM/YY');
$$;

-- _mark_avulso = true marca o cliente como avulso (não gera mensalidade kids).
CREATE OR REPLACE FUNCTION public.class_add_drop_in(
  _class_id uuid, _client_id uuid, _date date, _amount numeric DEFAULT 70, _mark_avulso boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.pickleball_classes%ROWTYPE;
  _id uuid;
  _eid uuid;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para lançar aula avulsa.';
  END IF;
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;
  SELECT * INTO _c FROM public.pickleball_classes WHERE id = _class_id FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  IF _date IS NULL OR EXTRACT(DOW FROM _date)::int <> _c.weekday
     OR (_c.valid_from IS NOT NULL AND _c.valid_from > _date)
     OR (_c.valid_until IS NOT NULL AND _c.valid_until < _date) THEN
    RAISE EXCEPTION 'Essa turma não tem aula nesse dia.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_schedules
    WHERE class_id = _class_id AND client_id = _client_id
      AND (valid_from IS NULL OR valid_from <= _date)
      AND (valid_until IS NULL OR valid_until >= _date)
  ) THEN
    RAISE EXCEPTION 'Esse aluno já é desta turma — marque a presença na chamada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pickleball_class_makeups
    WHERE class_id = _class_id AND client_id = _client_id AND class_date = _date
  ) THEN
    RAISE EXCEPTION 'Esse aluno já está nesta aula como reposição.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.class_drop_ins
    WHERE class_id = _class_id AND client_id = _client_id AND class_date = _date
  ) THEN
    RAISE EXCEPTION 'Esse aluno já está lançado como avulso nesta aula.';
  END IF;
  IF _c.capacity IS NOT NULL AND public._class_occupied_on(_class_id, _date) >= _c.capacity THEN
    RAISE EXCEPTION 'Turma cheia nesse dia (% vagas).', _c.capacity;
  END IF;

  INSERT INTO public.class_drop_ins (client_id, class_id, class_date, amount)
  VALUES (_client_id, _class_id, _date, _amount)
  RETURNING id INTO _id;

  IF _amount > 0 THEN
    INSERT INTO public.account_entries (client_id, entry_type, amount, description, entry_date, recorded_by)
    VALUES (_client_id, 'debito', _amount, public._drop_in_description(_c.program, _date), _date, auth.uid())
    RETURNING id INTO _eid;
    UPDATE public.class_drop_ins SET account_entry_id = _eid WHERE id = _id;
  END IF;

  IF _mark_avulso THEN
    UPDATE public.clients SET kids_avulso = true WHERE id = _client_id;
  END IF;

  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.class_add_drop_in(uuid, uuid, date, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.class_add_drop_in(uuid, uuid, date, numeric, boolean) TO authenticated;

-- Remove o avulso e o débito lançado na conta.
CREATE OR REPLACE FUNCTION public.class_remove_drop_in(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _eid uuid;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  DELETE FROM public.class_drop_ins WHERE id = _id RETURNING account_entry_id INTO _eid;
  IF _eid IS NOT NULL THEN
    DELETE FROM public.account_entries WHERE id = _eid;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.class_remove_drop_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.class_remove_drop_in(uuid) TO authenticated;

-- Marcar/desmarcar cliente como avulso (sem mensalidade kids).
CREATE OR REPLACE FUNCTION public.kids_set_avulso(_client_id uuid, _avulso boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  UPDATE public.clients SET kids_avulso = COALESCE(_avulso, false) WHERE id = _client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.kids_set_avulso(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kids_set_avulso(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Reposição por programa
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.pickleball_makeup_balance(uuid[]);
CREATE FUNCTION public.pickleball_makeup_balance(_client_ids uuid[], _program text DEFAULT NULL)
RETURNS TABLE(client_id uuid, earned integer, used integer, available integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ids AS (SELECT DISTINCT unnest(_client_ids) AS client_id),
  e AS (
    SELECT cs.client_id, count(*)::int AS n
    FROM public.client_schedule_attendance a
    JOIN public.client_schedules cs ON cs.id = a.client_schedule_id
    JOIN public.pickleball_classes pc ON pc.id = cs.class_id
    WHERE a.status IN ('cancelled_ok', 'cancelled_late_waived')
      AND cs.client_id = ANY(_client_ids)
      AND (_program IS NULL OR pc.program = _program)
    GROUP BY cs.client_id
  ),
  u AS (
    SELECT mk.client_id, count(*)::int AS n
    FROM public.pickleball_class_makeups mk
    JOIN public.pickleball_classes pc ON pc.id = mk.class_id
    WHERE mk.client_id = ANY(_client_ids)
      AND (_program IS NULL OR pc.program = _program)
    GROUP BY mk.client_id
  )
  SELECT ids.client_id, COALESCE(e.n, 0), COALESCE(u.n, 0), COALESCE(e.n, 0) - COALESCE(u.n, 0)
  FROM ids LEFT JOIN e ON e.client_id = ids.client_id LEFT JOIN u ON u.client_id = ids.client_id
  WHERE public._is_class_staff(auth.uid()) OR public.has_role(auth.uid(), 'professor'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.pickleball_makeup_balance(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_makeup_balance(uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pickleball_class_mark_attendance(
  _schedule_id uuid, _date date, _status text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cs public.client_schedules%ROWTYPE;
  _cur text;
  _new text := _status;
  _starts timestamptz;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para fazer a chamada.';
  END IF;
  SELECT * INTO _cs FROM public.client_schedules WHERE id = _schedule_id;
  IF _cs.id IS NULL OR _cs.class_id IS NULL THEN
    RAISE EXCEPTION 'Matrícula de turma não encontrada.';
  END IF;
  IF _date IS NULL OR EXTRACT(DOW FROM _date)::int <> _cs.weekday
     OR (_cs.valid_from IS NOT NULL AND _cs.valid_from > _date)
     OR (_cs.valid_until IS NOT NULL AND _cs.valid_until < _date) THEN
    RAISE EXCEPTION 'O aluno não tem aula dessa turma nesse dia.';
  END IF;

  SELECT status INTO _cur FROM public.client_schedule_attendance
  WHERE client_schedule_id = _schedule_id AND attendance_date = _date;

  IF _new = 'cancelled' THEN
    _starts := (_date + _cs.start_time) AT TIME ZONE 'America/Recife';
    _new := CASE WHEN now() <= _starts - interval '12 hours'
                 THEN 'cancelled_ok' ELSE 'cancelled_late_charged' END;
    IF _cur IN ('cancelled_ok', 'cancelled_late_waived', 'cancelled_late_charged') THEN
      RETURN _cur;
    END IF;
  ELSIF _new = 'cancelled_late_waived' THEN
    IF _cur IS DISTINCT FROM 'cancelled_late_charged' THEN
      RAISE EXCEPTION 'Só dá para abonar um cancelamento fora do prazo.';
    END IF;
  ELSIF _new = 'cancelled_late_charged' THEN
    IF _cur IS DISTINCT FROM 'cancelled_late_waived' THEN
      RAISE EXCEPTION 'Esse cancelamento não está abonado.';
    END IF;
  ELSIF _new IS NOT NULL AND _new NOT IN ('came', 'no_show') THEN
    RAISE EXCEPTION 'Situação inválida.';
  END IF;

  IF _cur IN ('cancelled_ok', 'cancelled_late_waived')
     AND _new IS DISTINCT FROM 'cancelled_ok' AND _new IS DISTINCT FROM 'cancelled_late_waived'
     AND (SELECT b.available FROM public.pickleball_makeup_balance(
            ARRAY[_cs.client_id], public._class_program(_cs.class_id)) b) <= 0 THEN
    RAISE EXCEPTION 'A reposição desse cancelamento já foi usada. Remova a reposição antes de mudar.';
  END IF;

  IF _new IS NULL THEN
    DELETE FROM public.client_schedule_attendance
    WHERE client_schedule_id = _schedule_id AND attendance_date = _date;
    RETURN NULL;
  END IF;

  INSERT INTO public.client_schedule_attendance
    (client_schedule_id, attendance_date, status, amount, created_by)
  VALUES (_schedule_id, _date, _new, NULL, auth.uid())
  ON CONFLICT (client_schedule_id, attendance_date)
  DO UPDATE SET status = EXCLUDED.status, amount = NULL, payment_id = NULL, updated_at = now();
  RETURN _new;
END;
$$;

CREATE OR REPLACE FUNCTION public.pickleball_class_add_makeup(
  _class_id uuid, _client_id uuid, _date date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.pickleball_classes%ROWTYPE;
  _id uuid;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para lançar reposição.';
  END IF;
  SELECT * INTO _c FROM public.pickleball_classes WHERE id = _class_id FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  IF EXTRACT(DOW FROM _date)::int <> _c.weekday
     OR (_c.valid_from IS NOT NULL AND _c.valid_from > _date)
     OR (_c.valid_until IS NOT NULL AND _c.valid_until < _date) THEN
    RAISE EXCEPTION 'Essa turma não tem aula nesse dia.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_schedules
    WHERE class_id = _class_id AND client_id = _client_id
      AND (valid_from IS NULL OR valid_from <= _date)
      AND (valid_until IS NULL OR valid_until >= _date)
  ) THEN
    RAISE EXCEPTION 'Esse aluno já é desta turma — marque a presença na chamada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.class_drop_ins
    WHERE class_id = _class_id AND client_id = _client_id AND class_date = _date
  ) THEN
    RAISE EXCEPTION 'Esse aluno já está lançado como avulso nesta aula.';
  END IF;
  IF COALESCE((SELECT b.available FROM public.pickleball_makeup_balance(ARRAY[_client_id], _c.program) b), 0) <= 0 THEN
    RAISE EXCEPTION 'Esse aluno não tem reposição disponível.';
  END IF;
  IF _c.capacity IS NOT NULL AND public._class_occupied_on(_class_id, _date) >= _c.capacity THEN
    RAISE EXCEPTION 'Turma cheia nesse dia (% vagas). Só abre vaga se algum aluno cancelar.', _c.capacity;
  END IF;

  INSERT INTO public.pickleball_class_makeups (client_id, class_id, class_date)
  VALUES (_client_id, _class_id, _date)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Mensalidade do pickleball: só turmas de pickleball
-- ---------------------------------------------------------------------------

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
    WHERE pc.program = 'pickleball'
      AND (cs.valid_from IS NULL OR cs.valid_from <= _m_end)
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
          AND pc2.program = 'pickleball'
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

-- ---------------------------------------------------------------------------
-- Mensalidade da Escolinha Kids (substitui a "Mensalidade tênis")
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._tennis_fee_description(_month date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Mensalidade escolinha kids — '
    || (ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
              'setembro','outubro','novembro','dezembro'])[EXTRACT(MONTH FROM _month)::int]
    || '/' || to_char(_month, 'YY');
$$;

-- status: 'gerar' | 'ja_gerada' | 'ja_lancada' | 'sem_valor' | 'avulso'
CREATE OR REPLACE FUNCTION public.tennis_school_fee_preview(_month date)
RETURNS TABLE(client_id uuid, full_name text, amount numeric, classes text, status text, from_category boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _m date := date_trunc('month', _month)::date;
  _m_end date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  _desc text := public._tennis_fee_description(date_trunc('month', _month)::date);
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN QUERY
  WITH m AS (
    SELECT cs.client_id, count(*)::int AS n,
           string_agg(pc.name || ' (' || (ARRAY['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[pc.weekday + 1]
                      || ' ' || to_char(pc.start_time, 'HH24:MI') || ')', ', ' ORDER BY pc.weekday, pc.start_time) AS classes
    FROM public.client_schedules cs
    JOIN public.pickleball_classes pc ON pc.id = cs.class_id
    WHERE pc.program = 'kids'
      AND (cs.valid_from IS NULL OR cs.valid_from <= _m_end)
      AND (cs.valid_until IS NULL OR cs.valid_until >= _m)
    GROUP BY cs.client_id
  ),
  cat AS (
    SELECT c.id AS client_id, 1 AS n, 'Sem turma (categoria)'::text AS classes
    FROM public.clients c
    JOIN public.client_categories cc ON cc.id = c.category_id
    WHERE c.active
      AND public._is_kids_category(cc.name)
      AND NOT EXISTS (SELECT 1 FROM m WHERE m.client_id = c.id)
      -- Aluno de turma kids encerrada antes deste mês: não cobra pela categoria.
      AND NOT EXISTS (
        SELECT 1
        FROM public.client_schedules cs2
        JOIN public.pickleball_classes pc2 ON pc2.id = cs2.class_id
        WHERE cs2.client_id = c.id
          AND pc2.program = 'kids'
          AND pc2.valid_until IS NOT NULL
          AND pc2.valid_until < _m
      )
  ),
  todos AS (
    SELECT t.client_id, t.classes, c.kids_avulso,
           COALESCE(c.custom_amount,
                    CASE WHEN public._is_kids_category(cc.name) THEN cc.default_amount * t.n END,
                    0)::numeric AS amount
    FROM (SELECT * FROM m UNION ALL SELECT * FROM cat) t
    JOIN public.clients c ON c.id = t.client_id
    LEFT JOIN public.client_categories cc ON cc.id = c.category_id
  )
  SELECT t.client_id, c.full_name, t.amount, t.classes,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.tennis_school_billing b
                   WHERE b.client_id = t.client_id AND b.reference_month = _m) THEN 'ja_gerada'
      WHEN EXISTS (SELECT 1 FROM public.account_entries e
                   WHERE e.client_id = t.client_id AND e.entry_type = 'debito' AND e.description = _desc) THEN 'ja_lancada'
      WHEN t.kids_avulso THEN 'avulso'
      WHEN t.amount <= 0 THEN 'sem_valor'
      ELSE 'gerar'
    END,
    true
  FROM todos t JOIN public.clients c ON c.id = t.client_id
  ORDER BY c.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.tennis_school_fee_preview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tennis_school_fee_preview(date) TO authenticated;
-- tennis_school_generate_fees continua igual: gera só as linhas 'gerar'.

-- Reposição da turma de pickleball: prazo de 12h, abono e vaga.
--
-- Cancelamento (chamada no mapa):
--   * "Cancelou" marcado até 12h antes do início da aula → cancelled_ok,
--     ganha 1 reposição. O sistema decide pelo horário em que é marcado.
--   * Marcado com menos de 12h (ou depois da aula) → cancelled_late_charged
--     = "fora do prazo", NÃO ganha reposição (turma não cobra aula avulsa;
--     o nome do status é o mesmo do tênis só para reaproveitar a tabela).
--   * Abonar o fora do prazo → cancelled_late_waived, ganha a reposição.
-- Sem limite por mês e sem validade.
--
-- Reposição respeita o limite de alunos da turma no dia: ocupam vaga os
-- matriculados que não cancelaram + quem já veio repor naquele dia.

CREATE OR REPLACE FUNCTION public.pickleball_makeup_balance(_client_ids uuid[])
RETURNS TABLE(client_id uuid, earned integer, used integer, available integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ids AS (SELECT DISTINCT unnest(_client_ids) AS client_id),
  e AS (
    SELECT cs.client_id, count(*)::int AS n
    FROM public.client_schedule_attendance a
    JOIN public.client_schedules cs ON cs.id = a.client_schedule_id
    WHERE cs.class_id IS NOT NULL
      AND a.status IN ('cancelled_ok', 'cancelled_late_waived')
      AND cs.client_id = ANY(_client_ids)
    GROUP BY cs.client_id
  ),
  u AS (
    SELECT mk.client_id, count(*)::int AS n
    FROM public.pickleball_class_makeups mk
    WHERE mk.client_id = ANY(_client_ids)
    GROUP BY mk.client_id
  )
  SELECT ids.client_id, COALESCE(e.n, 0), COALESCE(u.n, 0), COALESCE(e.n, 0) - COALESCE(u.n, 0)
  FROM ids LEFT JOIN e ON e.client_id = ids.client_id LEFT JOIN u ON u.client_id = ids.client_id
  WHERE public._is_class_staff(auth.uid()) OR public.has_role(auth.uid(), 'professor'::public.app_role);
$$;

-- _status: 'came' | 'no_show' | 'cancelled' (o sistema aplica o prazo de 12h)
--          | 'cancelled_late_waived' (abonar) | 'cancelled_late_charged'
--          (tirar o abono) | NULL (desmarcar).
DROP FUNCTION IF EXISTS public.pickleball_class_mark_attendance(uuid, date, text);
CREATE FUNCTION public.pickleball_class_mark_attendance(
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
    -- Já estava cancelado: não perde o "no prazo"/abono ao clicar de novo.
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

  -- Tirar um cancelamento que deu reposição, se ela já foi usada, deixaria
  -- o saldo negativo.
  IF _cur IN ('cancelled_ok', 'cancelled_late_waived')
     AND _new IS DISTINCT FROM 'cancelled_ok' AND _new IS DISTINCT FROM 'cancelled_late_waived'
     AND (SELECT b.available FROM public.pickleball_makeup_balance(ARRAY[_cs.client_id]) b) <= 0 THEN
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
REVOKE ALL ON FUNCTION public.pickleball_class_mark_attendance(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_mark_attendance(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pickleball_class_add_makeup(
  _class_id uuid, _client_id uuid, _date date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.pickleball_classes%ROWTYPE;
  _occupied int;
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
  IF COALESCE((SELECT b.available FROM public.pickleball_makeup_balance(ARRAY[_client_id]) b), 0) <= 0 THEN
    RAISE EXCEPTION 'Esse aluno não tem reposição disponível.';
  END IF;

  IF _c.capacity IS NOT NULL THEN
    SELECT
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
    INTO _occupied;
    IF _occupied >= _c.capacity THEN
      RAISE EXCEPTION 'Turma cheia nesse dia (% de % vagas). Só abre vaga se algum aluno cancelar.',
        _occupied, _c.capacity;
    END IF;
  END IF;

  INSERT INTO public.pickleball_class_makeups (client_id, class_id, class_date)
  VALUES (_client_id, _class_id, _date)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

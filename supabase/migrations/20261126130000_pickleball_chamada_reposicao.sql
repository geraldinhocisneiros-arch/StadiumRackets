-- Chamada da turma de pickleball no mapa de quadras + reposição de aula.
--
-- Para cada aluno da turma no dia (client_schedule_attendance, a mesma tabela
-- da presença do tênis, mas SEM cobrança — turma paga mensalidade):
--   * came         = Veio     → presença.
--   * no_show      = Faltou   → aula perdida, SEM direito a reposição.
--   * cancelled_ok = Cancelou → não conta presença e dá direito a 1 reposição.
--
-- Reposição: o aluno vem em outra aula de turma (qualquer turma/dia). Cada
-- vinda registrada em pickleball_class_makeups consome 1 crédito.
-- Saldo = cancelamentos em turma − reposições usadas.

CREATE TABLE IF NOT EXISTS public.pickleball_class_makeups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.pickleball_classes(id) ON DELETE CASCADE,
  class_date date NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, class_id, class_date)
);
CREATE INDEX IF NOT EXISTS idx_pickleball_class_makeups_class_date
  ON public.pickleball_class_makeups(class_id, class_date);

ALTER TABLE public.pickleball_class_makeups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pickleball_class_makeups_select ON public.pickleball_class_makeups;
CREATE POLICY pickleball_class_makeups_select ON public.pickleball_class_makeups
  FOR SELECT TO authenticated
  USING (
    public._is_class_staff(auth.uid())
    OR public.has_role(auth.uid(), 'professor'::public.app_role)
  );
-- Gravação só pelas funções abaixo.

-- Saldo de reposição por aluno.
CREATE OR REPLACE FUNCTION public.pickleball_makeup_balance(_client_ids uuid[])
RETURNS TABLE(client_id uuid, earned integer, used integer, available integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ids AS (SELECT DISTINCT unnest(_client_ids) AS client_id),
  e AS (
    SELECT cs.client_id, count(*)::int AS n
    FROM public.client_schedule_attendance a
    JOIN public.client_schedules cs ON cs.id = a.client_schedule_id
    WHERE cs.class_id IS NOT NULL AND a.status = 'cancelled_ok'
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
REVOKE ALL ON FUNCTION public.pickleball_makeup_balance(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_makeup_balance(uuid[]) TO authenticated;

-- Marca (ou limpa, com _status NULL) a chamada de um aluno da turma no dia.
CREATE OR REPLACE FUNCTION public.pickleball_class_mark_attendance(
  _schedule_id uuid, _date date, _status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cs public.client_schedules%ROWTYPE;
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

  IF _status IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.client_schedule_attendance
      WHERE client_schedule_id = _schedule_id AND attendance_date = _date AND status = 'cancelled_ok'
    ) AND (SELECT b.available FROM public.pickleball_makeup_balance(ARRAY[_cs.client_id]) b) <= 0 THEN
      RAISE EXCEPTION 'Esse cancelamento já virou reposição usada. Remova a reposição antes de mudar.';
    END IF;
    DELETE FROM public.client_schedule_attendance
    WHERE client_schedule_id = _schedule_id AND attendance_date = _date;
    RETURN;
  END IF;
  IF _status NOT IN ('came', 'no_show', 'cancelled_ok') THEN
    RAISE EXCEPTION 'Situação inválida.';
  END IF;
  -- Tirar o "Cancelou" de quem já usou a reposição deixaria saldo negativo.
  IF _status <> 'cancelled_ok' AND EXISTS (
    SELECT 1 FROM public.client_schedule_attendance
    WHERE client_schedule_id = _schedule_id AND attendance_date = _date AND status = 'cancelled_ok'
  ) AND (SELECT b.available FROM public.pickleball_makeup_balance(ARRAY[_cs.client_id]) b) <= 0 THEN
    RAISE EXCEPTION 'Esse cancelamento já virou reposição usada. Remova a reposição antes de mudar.';
  END IF;

  INSERT INTO public.client_schedule_attendance
    (client_schedule_id, attendance_date, status, amount, created_by)
  VALUES (_schedule_id, _date, _status, NULL, auth.uid())
  ON CONFLICT (client_schedule_id, attendance_date)
  DO UPDATE SET status = EXCLUDED.status, amount = NULL, payment_id = NULL, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_mark_attendance(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_mark_attendance(uuid, date, text) TO authenticated;

-- Aluno vem repor uma aula nesta turma/dia (consome 1 crédito).
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
  SELECT * INTO _c FROM public.pickleball_classes WHERE id = _class_id;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  IF EXTRACT(DOW FROM _date)::int <> _c.weekday THEN
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
  INSERT INTO public.pickleball_class_makeups (client_id, class_id, class_date)
  VALUES (_client_id, _class_id, _date)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_add_makeup(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_add_makeup(uuid, uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.pickleball_class_remove_makeup(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  DELETE FROM public.pickleball_class_makeups WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_class_remove_makeup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_class_remove_makeup(uuid) TO authenticated;

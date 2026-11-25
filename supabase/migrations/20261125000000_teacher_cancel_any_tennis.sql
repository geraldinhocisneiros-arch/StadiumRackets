-- Professor com permissão de cancelar QUALQUER locação da quadra de tênis
-- (quadra 1), seja aula dele, de outro professor ou locação sem professor.
-- Continua sendo um professor comum em tudo o mais: só enxerga o mapa e não
-- edita/cria nada além do que professor já pode. Pickleball fica de fora.
--
-- Só administrador liga/desliga a permissão (trigger abaixo), porque a
-- recepção também pode editar o cadastro de professores.

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS can_cancel_any_tennis boolean DEFAULT false NOT NULL;

CREATE OR REPLACE FUNCTION public.teachers_guard_cancel_any_tennis() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- SQL Editor / service role
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.can_cancel_any_tennis)
     OR (TG_OP = 'UPDATE' AND NEW.can_cancel_any_tennis IS DISTINCT FROM OLD.can_cancel_any_tennis) THEN
    IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Apenas administradores podem alterar a permissão de cancelar aulas de tênis'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teachers_guard_cancel_any_tennis ON public.teachers;
CREATE TRIGGER trg_teachers_guard_cancel_any_tennis
  BEFORE INSERT OR UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.teachers_guard_cancel_any_tennis();

CREATE OR REPLACE FUNCTION public.can_cancel_any_tennis(_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_role(_uid, 'professor'::public.app_role)
     AND EXISTS (
       SELECT 1 FROM public.teachers
        WHERE user_id = _uid AND active AND can_cancel_any_tennis
     )
$$;

-- Cancela uma locação avulsa da quadra de tênis. Os gatilhos já existentes
-- cuidam do resto: aviso ao cliente ("Aula cancelada pelo professor") e,
-- com menos de 24h, o aviso de cobrança para recepção/diretoria.
CREATE OR REPLACE FUNCTION public.tennis_cancel_any_booking(_booking_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _b public.court_bookings%ROWTYPE;
  _who text;
BEGIN
  IF NOT public.can_cancel_any_tennis(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Você não tem permissão para cancelar esta locação.');
  END IF;

  SELECT * INTO _b FROM public.court_bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Locação não encontrada.');
  END IF;
  IF _b.court <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Só é permitido cancelar locações da quadra de tênis.');
  END IF;
  IF _b.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta locação já está cancelada.');
  END IF;
  IF ((_b.booking_date + _b.end_time) AT TIME ZONE 'America/Sao_Paulo') <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta locação já terminou e não pode mais ser cancelada.');
  END IF;

  _who := public._canceller_label(auth.uid());
  UPDATE public.court_bookings
     SET cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = 'Cancelado por ' || _who
   WHERE id = _booking_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Cancela a ocorrência de um ou mais horários fixos (dupla/grupo dividindo a
-- quadra) da quadra de tênis em uma data.
CREATE OR REPLACE FUNCTION public.tennis_cancel_any_fixed(_schedule_ids uuid[], _date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _s record;
  _who text;
  _reason text;
  _had_booking boolean;
  _count integer := 0;
BEGIN
  IF NOT public.can_cancel_any_tennis(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Você não tem permissão para cancelar esta aula.');
  END IF;
  IF _schedule_ids IS NULL OR array_length(_schedule_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma aula informada.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_schedules cs
     WHERE cs.id = ANY (_schedule_ids) AND cs.court IS DISTINCT FROM 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Só é permitido cancelar aulas da quadra de tênis.');
  END IF;

  _who := public._canceller_label(auth.uid());
  _reason := 'Cancelado por ' || _who;

  FOR _s IN
    SELECT cs.*
      FROM public.client_schedules cs
     WHERE cs.id = ANY (_schedule_ids)
       AND cs.weekday = EXTRACT(DOW FROM _date)::int
       AND public.client_schedule_valid_on(cs.valid_from, cs.valid_until, _date)
  LOOP
    IF ((_date + _s.end_time) AT TIME ZONE 'America/Sao_Paulo') <= now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Esta aula já terminou e não pode mais ser cancelada.');
    END IF;

    -- Já cancelada neste dia? Pula.
    IF EXISTS (
      SELECT 1 FROM public.client_schedule_exceptions e
       WHERE e.client_schedule_id = _s.id
         AND e.exception_date <= _date
         AND COALESCE(e.range_end, e.exception_date) >= _date
         AND (e.start_time IS NULL OR (e.start_time <= _s.start_time AND e.end_time >= _s.end_time))
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.client_schedule_exceptions (
      client_schedule_id, exception_date, start_time, end_time, reason, created_by
    ) VALUES (
      _s.id, _date, _s.start_time, _s.end_time, _reason, auth.uid()
    );

    -- Locação ativa que materializa esta ocorrência: cancela junto (o
    -- gatilho de court_bookings avisa o cliente e gera a cobrança se tardio).
    UPDATE public.court_bookings b
       SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = _reason
     WHERE b.booking_date = _date
       AND b.court = 1
       AND b.client_id = _s.client_id
       AND b.cancelled_at IS NULL
       AND b.start_time < _s.end_time
       AND b.end_time > _s.start_time;
    _had_booking := FOUND;

    -- Sem locação materializada, o aviso de cobrança tardia sai daqui.
    IF NOT _had_booking
       AND public.court_cancel_is_late(1, _date, _s.start_time, now()) THEN
      PERFORM public._notify_professor_late_cancel(
        'fixed:' || _s.id::text || ':' || _date::text || ':' || _s.start_time::text,
        _s.client_id, _who, 1,
        _date, _s.start_time, _s.end_time, now(), true, NULL
      );
    END IF;

    _count := _count + 1;
  END LOOP;

  IF _count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma aula ativa encontrada para cancelar neste dia.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'count', _count);
END;
$$;

REVOKE ALL ON FUNCTION public.can_cancel_any_tennis(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tennis_cancel_any_booking(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tennis_cancel_any_fixed(uuid[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_cancel_any_tennis(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tennis_cancel_any_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tennis_cancel_any_fixed(uuid[], date) TO authenticated;

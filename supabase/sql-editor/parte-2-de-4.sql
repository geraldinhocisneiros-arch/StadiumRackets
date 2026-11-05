-- Stadium Rackets — parte 2 de 4 (rode depois da parte 1)
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: move_fixed_today(uuid, date, smallint, time without time zone, time without time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _lead public.client_schedules%ROWTYPE;
  _lead_name text;
  _wd integer := EXTRACT(DOW FROM _date)::integer;
  _oc smallint;
  _os time;
  _oe time;
  _notes text;
  _target_label text;
  _b public.court_bookings%ROWTYPE;
  _occ public.court_bookings%ROWTYPE;
  _o public.court_bookings%ROWTYPE;
  _occ_end time;
  _from_court smallint;
  _from_start time;
  _lead_booking uuid;
  _bid uuid;
  _w record;
  _m record;
  _og uuid[];
  _restored_ids uuid[];
  _in_b uuid[];
  _moved jsonb;
  _swapped_booking jsonb := NULL;
  _swapped_fixed jsonb := '[]'::jsonb;
BEGIN
  IF NOT (
    public.has_role(_uid, 'admin')
    OR public.has_role(_uid, 'diretoria')
    OR public.has_role(_uid, 'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _end_time <= _start_time THEN
    RAISE EXCEPTION 'Horário final deve ser maior que o inicial';
  END IF;

  SELECT * INTO _lead FROM public.client_schedules WHERE id = _schedule_id;
  IF _lead.id IS NULL THEN
    RAISE EXCEPTION 'Horário fixo não encontrado';
  END IF;
  IF _lead.court IS NULL OR _lead.weekday <> _wd THEN
    RAISE EXCEPTION 'Este horário fixo não acontece nesta data';
  END IF;

  -- Um movimento por dia de cada vez: dois cliques/recepcionistas mexendo
  -- no mesmo dia ao mesmo tempo esperam um pelo outro.
  PERFORM pg_advisory_xact_lock(hashtext('move_fixed_today'), hashtext(_date::text));

  SELECT full_name INTO _lead_name FROM public.clients WHERE id = _lead.client_id;
  _lead_name := COALESCE(_lead_name, 'cliente');
  _oc := _lead.court;
  _os := _lead.start_time;
  _oe := _lead.end_time;
  _notes := 'Movido do fixo (' || public._court_label(_oc) || ' ' || public._hhmi(_os) || '–' || public._hhmi(_oe) || ')';
  _target_label := public._court_label(_court) || ' ' || public._hhmi(_start_time) || '–' || public._hhmi(_end_time);

  -- Grupo: todo fixo que divide a quadra/horário original hoje (mesmo
  -- critério de "dividido" do mapa), com a situação de cada um.
  IF to_regclass('pg_temp._mft_group') IS NOT NULL THEN
    DROP TABLE pg_temp._mft_group;
  END IF;
  CREATE TEMP TABLE _mft_group ON COMMIT DROP AS
  SELECT
    s.id,
    s.client_id,
    s.teacher_id,
    s.start_time,
    s.end_time,
    s.created_at,
    COALESCE(c.full_name, 'cliente') AS full_name,
    (s.id = _lead.id) AS is_lead,
    EXISTS (
      SELECT 1 FROM public.client_schedule_exceptions e
      WHERE e.client_schedule_id = s.id AND e.exception_date = _date AND e.range_end IS NULL
        AND e.start_time IS NULL AND e.end_time IS NULL
    ) AS moved,
    public._fixed_is_off_today(s.id, _date) AS off_today
  FROM public.client_schedules s
  LEFT JOIN public.clients c ON c.id = s.client_id
  WHERE s.weekday = _wd
    AND s.court = _oc
    AND (s.valid_from IS NULL OR s.valid_from <= _date)
    AND (s.valid_until IS NULL OR s.valid_until >= _date)
    AND s.start_time < _oe
    AND s.end_time > _os
    AND s.is_demo = _lead.is_demo;

  -- Onde o grupo está hoje, se já foi movido: a locação "movida do fixo"
  -- que aponta pro horário original e tem alguém do grupo como dono ou
  -- participante. Prioriza a célula clicada (_booking_id).
  IF _booking_id IS NOT NULL THEN
    SELECT b.* INTO _b
    FROM public.court_bookings b
    WHERE b.id = _booking_id
      AND b.booking_date = _date
      AND b.cancelled_at IS NULL
      AND public._moved_notes_point_to(b.notes, _oc, _os, _oe)
      AND (
        b.client_id IN (SELECT client_id FROM _mft_group)
        OR EXISTS (
          SELECT 1 FROM public.court_booking_participants p
          WHERE p.booking_id = b.id AND p.client_id IN (SELECT client_id FROM _mft_group)
        )
      );
  END IF;
  IF _b.id IS NULL THEN
    SELECT b.* INTO _b
    FROM public.court_bookings b
    WHERE b.booking_date = _date
      AND b.cancelled_at IS NULL
      AND public._moved_notes_point_to(b.notes, _oc, _os, _oe)
      AND (
        b.client_id IN (SELECT client_id FROM _mft_group)
        OR EXISTS (
          SELECT 1 FROM public.court_booking_participants p
          WHERE p.booking_id = b.id AND p.client_id IN (SELECT client_id FROM _mft_group)
        )
      )
    ORDER BY (b.client_id = _lead.client_id) DESC, b.created_at DESC
    LIMIT 1;
  END IF;

  -- ---------------------------------------------------------------
  -- Destino = o próprio horário fixo: restaura o fixo original.
  -- ---------------------------------------------------------------
  IF _court = _oc AND _start_time = _os AND _end_time = _oe THEN
    IF _b.id IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM _mft_group WHERE is_lead AND moved) THEN
        RAISE EXCEPTION 'Altere quadra ou horário para mover.';
      END IF;
      -- Movido antes, mas a locação de hoje já não existe: só devolve o
      -- fixo (dele e de quem foi junto e também ficou sem locação).
      SELECT array_agg(g.id) INTO _restored_ids
      FROM _mft_group g
      WHERE g.moved
        AND (g.is_lead OR g.start_time = _os)
        AND NOT EXISTS (
          SELECT 1 FROM public.court_bookings b
          WHERE b.booking_date = _date AND b.cancelled_at IS NULL
            AND b.notes LIKE 'Movido do fixo%'
            AND (
              b.client_id = g.client_id
              OR EXISTS (SELECT 1 FROM public.court_booking_participants p WHERE p.booking_id = b.id AND p.client_id = g.client_id)
            )
        );
      DELETE FROM public.client_schedule_exceptions e
      WHERE e.client_schedule_id = ANY(_restored_ids)
        AND e.exception_date = _date AND e.range_end IS NULL
        AND e.start_time IS NULL AND e.end_time IS NULL;
      RETURN jsonb_build_object(
        'restored', true,
        'from_court', _oc,
        'to_court', _oc,
        'moved', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('client_id', g.client_id, 'name', g.full_name,
            'start_time', g.start_time, 'end_time', g.end_time, 'is_lead', g.is_lead))
          FROM _mft_group g WHERE g.id = ANY(_restored_ids)
        ), '[]'::jsonb),
        'swapped_booking', NULL,
        'swapped_fixed', '[]'::jsonb
      );
    END IF;

    -- Só restaura se ninguém foi trocado pro lugar original enquanto isso;
    -- se foi, segue como movimento normal (troca os dois).
    IF NOT EXISTS (
      SELECT 1 FROM public.court_bookings x
      WHERE x.court = _oc AND x.booking_date = _date AND x.start_time = _os
        AND x.cancelled_at IS NULL AND x.id <> _b.id
    ) THEN
      _in_b := ARRAY[_b.client_id] || COALESCE(
        (SELECT array_agg(p.client_id) FROM public.court_booking_participants p WHERE p.booking_id = _b.id),
        ARRAY[]::uuid[]
      );
      SELECT array_agg(g.id) INTO _restored_ids
      FROM _mft_group g
      WHERE g.is_lead OR g.client_id = ANY(_in_b);

      UPDATE public.court_bookings
        SET cancelled_at = now(), cancelled_by = _uid, cancel_reason = 'Horário fixo original restaurado'
        WHERE id = _b.id;
      DELETE FROM public.court_booking_participants WHERE booking_id = _b.id;

      -- Quem do grupo tinha horário diferente e foi movido na própria
      -- locação (apontando pro próprio horário original) volta junto.
      FOR _o IN
        SELECT b.* FROM public.court_bookings b
        JOIN _mft_group g ON g.client_id = b.client_id AND NOT g.is_lead
        WHERE b.booking_date = _date AND b.cancelled_at IS NULL AND b.id <> _b.id
          AND g.start_time <> _os
          AND public._moved_notes_point_to(b.notes, _oc, g.start_time, g.end_time)
      LOOP
        UPDATE public.court_bookings
          SET cancelled_at = now(), cancelled_by = _uid, cancel_reason = 'Horário fixo original restaurado'
          WHERE id = _o.id;
        _restored_ids := _restored_ids || COALESCE((
          SELECT array_agg(g.id) FROM _mft_group g
          WHERE g.client_id = _o.client_id
             OR g.client_id IN (SELECT p.client_id FROM public.court_booking_participants p WHERE p.booking_id = _o.id)
        ), ARRAY[]::uuid[]);
        DELETE FROM public.court_booking_participants WHERE booking_id = _o.id;
      END LOOP;

      DELETE FROM public.client_schedule_exceptions e
      WHERE e.client_schedule_id = ANY(_restored_ids)
        AND e.exception_date = _date AND e.range_end IS NULL
        AND e.start_time IS NULL AND e.end_time IS NULL;

      RETURN jsonb_build_object(
        'restored', true,
        'from_court', _b.court,
        'to_court', _oc,
        'moved', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('client_id', g.client_id, 'name', g.full_name,
            'start_time', g.start_time, 'end_time', g.end_time, 'is_lead', g.is_lead))
          FROM _mft_group g WHERE g.id = ANY(_restored_ids)
        ), '[]'::jsonb),
        'swapped_booking', NULL,
        'swapped_fixed', '[]'::jsonb
      );
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- Movimento (ou ajuste de um movimento já feito hoje).
  -- ---------------------------------------------------------------
  BEGIN
    -- Quem vai junto agora: o próprio fixo clicado + quem divide e ainda
    -- está ocupando a quadra original (não movido, não cancelado).
    IF to_regclass('pg_temp._mft_moving') IS NOT NULL THEN
      DROP TABLE pg_temp._mft_moving;
    END IF;
    CREATE TEMP TABLE _mft_moving ON COMMIT DROP AS
    SELECT g.* FROM _mft_group g
    WHERE g.is_lead OR (NOT g.moved AND NOT g.off_today);

    IF _b.id IS NOT NULL THEN
      _from_court := _b.court;
      _from_start := _b.start_time;
      -- Estaciona numa data sentinela pra nunca haver duas locações na
      -- mesma (quadra, data, horário) no meio da troca.
      UPDATE public.court_bookings SET booking_date = DATE '9999-12-31' WHERE id = _b.id;
    ELSE
      _from_court := _oc;
      _from_start := _os;
    END IF;

    -- Ocorrência de hoje já materializada como locação "espelho" (mesmo
    -- cliente, quadra e horário do fixo — reativada pelo professor) de quem
    -- está saindo agora: cancela, senão ela reaparece sozinha na quadra
    -- original quando a exceção abaixo "desmascara" a célula.
    UPDATE public.court_bookings b
      SET cancelled_at = now(), cancelled_by = _uid, cancel_reason = 'Movido para ' || _target_label
      FROM _mft_moving m
      WHERE b.booking_date = _date AND b.cancelled_at IS NULL
        AND b.court = _oc AND b.client_id = m.client_id
        AND b.start_time = m.start_time AND b.end_time = m.end_time
        AND NOT m.moved;

    -- Exceção do dia (libera o horário original) de cada um que sai agora.
    INSERT INTO public.client_schedule_exceptions (
      client_schedule_id, exception_date, start_time, end_time, reason, created_by
    )
    SELECT m.id, _date, NULL, NULL,
      CASE WHEN m.is_lead THEN 'Movido para ' || _target_label
           ELSE 'Movido para ' || _target_label || ' (divide com ' || _lead_name || ')' END,
      _uid
    FROM _mft_moving m
    WHERE NOT m.moved;

    -- Quem ocupa o destino: locação materializada no horário exato...
    SELECT * INTO _occ FROM public.court_bookings
    WHERE court = _court AND booking_date = _date AND start_time = _start_time AND cancelled_at IS NULL
    LIMIT 1;

    -- ...e fixos ainda "virtuais" lá (não movidos, não cancelados hoje).
    SELECT array_agg(s.id) INTO _og
    FROM public.client_schedules s
    WHERE s.weekday = _wd
      AND s.court = _court
      AND (s.valid_from IS NULL OR s.valid_from <= _date)
      AND (s.valid_until IS NULL OR s.valid_until >= _date)
      AND s.start_time < COALESCE(_occ.end_time, _end_time)
      AND s.end_time > COALESCE(_occ.start_time, _start_time)
      AND s.id NOT IN (SELECT id FROM _mft_group)
      AND s.is_demo = _lead.is_demo
      AND NOT public._fixed_is_off_today(s.id, _date);

    IF _occ.id IS NOT NULL THEN
      -- Vai pro lugar de onde o grupo saiu, com a PRÓPRIA duração (#194).
      _occ_end := _from_start + (_occ.end_time - _occ.start_time);
      IF _occ_end <= _from_start THEN
        _occ_end := TIME '24:00';
      END IF;
      UPDATE public.court_bookings
        SET court = _from_court, start_time = _from_start, end_time = _occ_end
        WHERE id = _occ.id;
      _swapped_booking := jsonb_build_object(
        'client_id', _occ.client_id,
        'name', COALESCE((SELECT full_name FROM public.clients WHERE id = _occ.client_id), _occ.guest_name),
        'start_time', _from_start,
        'end_time', _occ_end
      );
    END IF;

    -- Demais locações do destino que se sobrepõem à nova janela: vão pra
    -- quadra de origem no próprio horário, se lá estiver livre (mesma regra
    -- do move_or_swap_booking).
    IF _court <> _from_court THEN
      FOR _o IN
        SELECT * FROM public.court_bookings
        WHERE court = _court AND booking_date = _date AND cancelled_at IS NULL
          AND start_time < _end_time AND end_time > _start_time
        ORDER BY start_time
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.court_bookings x
          WHERE x.court = _from_court AND x.booking_date = _date AND x.cancelled_at IS NULL
            AND x.start_time < _o.end_time AND x.end_time > _o.start_time
        ) THEN
          UPDATE public.court_bookings SET court = _from_court WHERE id = _o.id;
        END IF;
      END LOOP;
    END IF;

    IF _og IS NOT NULL THEN
      INSERT INTO public.client_schedule_exceptions (
        client_schedule_id, exception_date, start_time, end_time, reason, created_by
      )
      SELECT s.id, _date, NULL, NULL,
        'Trocado com ' || _lead_name || ' (' || public._court_label(_from_court) || ' '
          || public._hhmi(_os) || '–' || public._hhmi(_oe) || ')',
        _uid
      FROM public.client_schedules s WHERE s.id = ANY(_og);

      PERFORM public._materialize_swapped_fixed(
        _og, _date, _from_court, _court, _occ.client_id, _occ.start_time
      );

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'client_id', s.client_id, 'name', COALESCE(c.full_name, 'cliente'),
        'start_time', s.start_time, 'end_time', s.end_time
      )), '[]'::jsonb) INTO _swapped_fixed
      FROM public.client_schedules s LEFT JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = ANY(_og);
    END IF;

    -- O grupo no destino: uma locação só pra quem começa junto com o fixo
    -- clicado (a dupla) — os demais entram nela como participantes.
    IF _b.id IS NOT NULL THEN
      UPDATE public.court_bookings
        SET court = _court, start_time = _start_time, end_time = _end_time, booking_date = _date
        WHERE id = _b.id;
      _lead_booking := _b.id;
    ELSE
      INSERT INTO public.court_bookings (
        court, booking_date, start_time, end_time, source, client_id, teacher_id, notes,
        created_by
      )
      SELECT _court, _date, _start_time, _end_time, 'avulsa', m.client_id, m.teacher_id, _notes,
        _uid
      FROM _mft_moving m WHERE m.is_lead
      RETURNING id INTO _lead_booking;
    END IF;

    INSERT INTO public.court_booking_participants (booking_id, client_id)
    SELECT DISTINCT _lead_booking, m.client_id
    FROM _mft_moving m
    WHERE m.client_id IS NOT NULL
      AND (m.is_lead OR m.start_time = _os)
      AND m.client_id IS DISTINCT FROM (SELECT client_id FROM public.court_bookings WHERE id = _lead_booking)
    ON CONFLICT (booking_id, client_id) DO NOTHING;

    -- Quem divide mas começa em outro horário (sobreposto) vai pra mesma
    -- quadra mantendo o PRÓPRIO horário (igual ao CourtBookingDialog).
    FOR _w IN
      SELECT DISTINCT m.start_time FROM _mft_moving m
      WHERE NOT m.is_lead AND m.start_time <> _os
    LOOP
      _bid := NULL;
      FOR _m IN
        SELECT * FROM _mft_moving m
        WHERE NOT m.is_lead AND m.start_time = _w.start_time
        ORDER BY m.end_time DESC, m.created_at, m.id
      LOOP
        IF _bid IS NULL THEN
          INSERT INTO public.court_bookings (
            court, booking_date, start_time, end_time, source, client_id, teacher_id, notes,
            created_by
          ) VALUES (
            _court, _date, _m.start_time, _m.end_time, 'avulsa', _m.client_id, _m.teacher_id,
            'Movido do fixo (' || public._court_label(_oc) || ' ' || public._hhmi(_m.start_time)
              || '–' || public._hhmi(_m.end_time) || ')',
            _uid
          )
          RETURNING id INTO _bid;
        ELSE
          INSERT INTO public.court_booking_participants (booking_id, client_id)
          VALUES (_bid, _m.client_id)
          ON CONFLICT (booking_id, client_id) DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Não deu para mover: o destino ficaria com duas locações no mesmo horário. Nada foi alterado — confira o mapa e tente de novo.';
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client_id', m.client_id, 'name', m.full_name,
    'start_time', CASE WHEN m.is_lead OR m.start_time = _os THEN _start_time ELSE m.start_time END,
    'end_time', CASE WHEN m.is_lead OR m.start_time = _os THEN _end_time ELSE m.end_time END,
    'is_lead', m.is_lead
  ) ORDER BY m.is_lead DESC, m.created_at), '[]'::jsonb) INTO _moved
  FROM _mft_moving m;

  RETURN jsonb_build_object(
    'restored', false,
    'from_court', _from_court,
    'to_court', _court,
    'booking_id', _lead_booking,
    'moved', _moved,
    'swapped_booking', _swapped_booking,
    'swapped_fixed', _swapped_fixed
  );
END;
$$;


--
-- Name: move_or_swap_booking(uuid, smallint, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_or_swap_booking(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) RETURNS TABLE(swapped_booking_id uuid, swapped_client_id uuid, swapped_start_time time without time zone, swapped_end_time time without time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _b public.court_bookings%ROWTYPE;
  _occ public.court_bookings%ROWTYPE;
  _o public.court_bookings%ROWTYPE;
  _occ_end time;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretoria')
    OR public.has_role(auth.uid(), 'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _b FROM public.court_bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'Locação não encontrada';
  END IF;
  IF _b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Locação já está cancelada';
  END IF;
  IF _end_time <= _start_time THEN
    RAISE EXCEPTION 'Horário final deve ser maior que o inicial';
  END IF;

  -- Estaciona a locação que está se movendo numa data sentinela, pra nunca
  -- haver duas com a mesma (quadra, data, horário) no meio da troca.
  UPDATE public.court_bookings SET booking_date = DATE '9999-12-31' WHERE id = _b.id;

  SELECT * INTO _occ FROM public.court_bookings
  WHERE court = _court
    AND booking_date = _b.booking_date
    AND start_time = _start_time
    AND cancelled_at IS NULL
  LIMIT 1;

  IF _occ.id IS NOT NULL THEN
    -- Vai pro horário de origem, mas com a própria duração.
    _occ_end := _b.start_time + (_occ.end_time - _occ.start_time);
    IF _occ_end <= _b.start_time THEN
      _occ_end := TIME '24:00';
    END IF;
    UPDATE public.court_bookings
      SET court = _b.court, start_time = _b.start_time, end_time = _occ_end
      WHERE id = _occ.id;
  END IF;

  -- Demais locações do destino que se sobrepõem à nova janela: vão pra
  -- quadra de origem no próprio horário, se lá estiver livre.
  IF _court <> _b.court THEN
    FOR _o IN
      SELECT * FROM public.court_bookings
      WHERE court = _court
        AND booking_date = _b.booking_date
        AND cancelled_at IS NULL
        AND start_time < _end_time
        AND end_time > _start_time
      ORDER BY start_time
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.court_bookings x
        WHERE x.court = _b.court
          AND x.booking_date = _b.booking_date
          AND x.cancelled_at IS NULL
          AND x.start_time < _o.end_time
          AND x.end_time > _o.start_time
      ) THEN
        UPDATE public.court_bookings SET court = _b.court WHERE id = _o.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.court_bookings
    SET court = _court, start_time = _start_time, end_time = _end_time, booking_date = _b.booking_date
    WHERE id = _b.id;

  IF _occ.id IS NOT NULL THEN
    swapped_booking_id := _occ.id;
    swapped_client_id := _occ.client_id;
    swapped_start_time := _b.start_time;
    swapped_end_time := _occ_end;
    RETURN NEXT;
  END IF;
END;
$$;


--
-- Name: next_occurrence_of_day(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_occurrence_of_day(_day integer, _from date) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  _this_month date;
  _last_day_this int;
  _next_month_start date;
  _last_day_next int;
BEGIN
  _last_day_this := extract(day from (date_trunc('month', _from) + interval '1 month - 1 day'))::int;
  _this_month := (date_trunc('month', _from)::date + (LEAST(_day, _last_day_this) - 1));
  IF _this_month >= _from THEN
    RETURN _this_month;
  END IF;
  _next_month_start := (date_trunc('month', _from) + interval '1 month')::date;
  _last_day_next := extract(day from (_next_month_start + interval '1 month - 1 day'))::int;
  RETURN (_next_month_start + (LEAST(_day, _last_day_next) - 1));
END;
$$;


--
-- Name: normalize_category(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_category(_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT translate(
    lower(btrim(COALESCE(_name, ''))),
    'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
  );
$$;


--
-- Name: notify_portal_booking_cancel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_portal_booking_cancel() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _is_portal boolean;
  _teacher_id uuid;
  _teacher_name text;
  _client_name text;
  _date_br text;
  _time_br text;
  _court_lbl text;
BEGIN
  IF (OLD.cancelled_at IS NOT NULL) OR (NEW.cancelled_at IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = NEW.cancelled_by
  ) INTO _is_portal;
  IF NOT _is_portal THEN
    RETURN NEW;
  END IF;

  _teacher_id := NEW.teacher_id;
  IF _teacher_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT c.teacher_id INTO _teacher_id FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;

  SELECT t.name INTO _teacher_name FROM public.teachers t WHERE t.id = _teacher_id;
  SELECT c.full_name INTO _client_name FROM public.clients c WHERE c.id = NEW.client_id;

  _date_br := to_char(NEW.booking_date, 'DD/MM');
  _time_br := to_char(NEW.start_time, 'HH24"h"');
  _court_lbl := public._court_short(NEW.court);

  IF _teacher_id IS NOT NULL THEN
    INSERT INTO public.app_notifications (
      kind, client_id, title, body, requires_ack, metadata
    ) VALUES (
      'booking_cancelled_by_client',
      NEW.client_id,
      'Cancelamento de aula',
      COALESCE(_client_name, 'Cliente') || ' cancelou a aula de ' || _date_br || ' às ' || _time_br || ' (' || _court_lbl || ')',
      true,
      jsonb_build_object(
        'booking_id', NEW.id,
        'teacher_id', _teacher_id,
        'client_id', NEW.client_id,
        'date', NEW.booking_date,
        'start_time', NEW.start_time,
        'court', NEW.court,
        'for_staff', false,
        'whatsapp_context', 'portal_cancel_teacher'
      )
    );
  END IF;

  INSERT INTO public.app_notifications (
    kind, client_id, title, body, requires_ack, metadata
  ) VALUES (
    'booking_cancelled_by_client_staff',
    NEW.client_id,
    'Reserva cancelada pelo cliente',
    COALESCE(_client_name, 'Cliente') || ' cancelou reserva ' || _date_br || ' ' || _time_br || ' (' || _court_lbl || ')' ||
      CASE WHEN _teacher_name IS NOT NULL THEN ' — Prof. ' || _teacher_name ELSE '' END,
    true,  -- popup blocking for staff
    jsonb_build_object(
      'booking_id', NEW.id,
      'teacher_id', _teacher_id,
      'client_id', NEW.client_id,
      'date', NEW.booking_date,
      'start_time', NEW.start_time,
      'court', NEW.court,
      'for_staff', true
    )
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_portal_schedule_cancel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_portal_schedule_cancel() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _is_portal boolean;
  _cs RECORD;
  _teacher_name text;
  _client_name text;
  _date_br text;
  _time_br text;
  _court_lbl text;
BEGIN
  IF NEW.start_time IS NOT NULL OR NEW.end_time IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = NEW.created_by
  ) INTO _is_portal;
  IF NOT _is_portal THEN
    RETURN NEW;
  END IF;

  SELECT cs.* INTO _cs FROM public.client_schedules cs WHERE cs.id = NEW.client_schedule_id;
  IF _cs.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.name INTO _teacher_name FROM public.teachers t WHERE t.id = _cs.teacher_id;
  SELECT c.full_name INTO _client_name FROM public.clients c WHERE c.id = _cs.client_id;

  _date_br := to_char(NEW.exception_date, 'DD/MM');
  _time_br := to_char(_cs.start_time, 'HH24"h"');
  _court_lbl := public._court_short(_cs.court);

  IF _cs.teacher_id IS NOT NULL THEN
    INSERT INTO public.app_notifications (
      kind, client_id, title, body, requires_ack, metadata
    ) VALUES (
      'booking_cancelled_by_client',
      _cs.client_id,
      'Cancelamento de aula fixa',
      COALESCE(_client_name, 'Cliente') || ' cancelou a aula fixa de ' || _date_br || ' às ' || _time_br || ' (' || _court_lbl || ')',
      true,
      jsonb_build_object(
        'schedule_id', _cs.id,
        'exception_id', NEW.id,
        'teacher_id', _cs.teacher_id,
        'client_id', _cs.client_id,
        'date', NEW.exception_date,
        'start_time', _cs.start_time,
        'court', _cs.court,
        'for_staff', false,
        'whatsapp_context', 'portal_cancel_teacher'
      )
    );
  END IF;

  INSERT INTO public.app_notifications (
    kind, client_id, title, body, requires_ack, metadata
  ) VALUES (
    'booking_cancelled_by_client_staff',
    _cs.client_id,
    'Aula fixa cancelada pelo cliente',
    COALESCE(_client_name, 'Cliente') || ' cancelou aula fixa ' || _date_br || ' ' || _time_br || ' (' || _court_lbl || ')' ||
      CASE WHEN _teacher_name IS NOT NULL THEN ' — Prof. ' || _teacher_name ELSE '' END,
    false,
    jsonb_build_object(
      'schedule_id', _cs.id,
      'exception_id', NEW.id,
      'teacher_id', _cs.teacher_id,
      'client_id', _cs.client_id,
      'date', NEW.exception_date,
      'start_time', _cs.start_time,
      'court', _cs.court,
      'for_staff', true
    )
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_staff_booking_reactivate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_staff_booking_reactivate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _actor uuid := auth.uid();
  _is_client boolean;
  _client_name text;
  _date_br text;
  _time_br text;
  _court_lbl text;
BEGIN
  IF OLD.cancelled_at IS NULL OR NEW.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = _actor
  ) INTO _is_client;
  IF _is_client THEN
    RETURN NEW;
  END IF;

  SELECT c.full_name INTO _client_name FROM public.clients c WHERE c.id = NEW.client_id;
  _date_br := to_char(NEW.booking_date, 'DD/MM');
  _time_br := to_char(NEW.start_time, 'HH24"h"');
  _court_lbl := public._court_short(NEW.court);

  INSERT INTO public.app_notifications (
    kind, client_id, title, body, requires_ack, metadata
  ) VALUES (
    'booking_reactivated_by_staff',
    NEW.client_id,
    'Reserva reativada',
    'Sua reserva de ' || _date_br || ' às ' || _time_br || ' (' || _court_lbl || ') foi reativada pela recepção.',
    true,  -- popup blocking for client
    jsonb_build_object(
      'booking_id', NEW.id,
      'client_id', NEW.client_id,
      'date', NEW.booking_date,
      'start_time', NEW.start_time,
      'court', NEW.court
    )
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_staff_fixed_waitlist_joined(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_staff_fixed_waitlist_joined() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _u RECORD;
  _client_name TEXT;
  _wd_name TEXT;
  _title TEXT;
  _body TEXT;
BEGIN
  IF NEW.status <> 'waiting' THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO _client_name FROM public.clients WHERE id = NEW.client_id;
  _wd_name := (ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[NEW.desired_weekday + 1];
  _title := '🎾 Nova inscrição na fila fixa';
  _body := COALESCE(_client_name, 'Alguém') || ' entrou na fila de horário fixo — ' ||
    CASE WHEN NEW.court IS NULL THEN 'qualquer quadra'
         WHEN NEW.court = 0 THEN 'qualquer quadra de pickleball'
         ELSE 'Quadra ' || NEW.court END || ', ' || _wd_name || ' ' ||
    to_char(NEW.start_time,'HH24:MI') || '–' || to_char(NEW.end_time,'HH24:MI') || '.';

  FOR _u IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('admin'::public.app_role,'diretoria'::public.app_role,'recepcionista'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'fixed_waitlist_joined', NEW.client_id, _u.user_id, _title, _body, false,
      jsonb_build_object('entry_id', NEW.id, 'court', NEW.court, 'weekday', NEW.desired_weekday),
      'fixed_waitlist_joined:' || NEW.id::text || ':' || _u.user_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: notify_staff_schedule_reactivate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_staff_schedule_reactivate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _actor uuid := auth.uid();
  _is_client boolean;
  _cs RECORD;
  _date_br text;
  _time_br text;
  _court_lbl text;
  _dedup text;
BEGIN
  IF OLD.start_time IS NOT NULL OR OLD.end_time IS NOT NULL THEN
    RETURN OLD;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = _actor
  ) INTO _is_client;
  IF _is_client THEN
    RETURN OLD;
  END IF;

  SELECT cs.* INTO _cs FROM public.client_schedules cs WHERE cs.id = OLD.client_schedule_id;
  IF _cs.id IS NULL OR _cs.client_id IS NULL THEN
    RETURN OLD;
  END IF;

  _dedup := 'staff_schedule_reactivate|' || _cs.id::text || '|' || OLD.exception_date::text;

  IF EXISTS (SELECT 1 FROM public.app_notifications WHERE dedup_key = _dedup) THEN
    RETURN OLD;
  END IF;

  _date_br := to_char(OLD.exception_date, 'DD/MM');
  _time_br := to_char(_cs.start_time, 'HH24"h"');
  _court_lbl := public._court_short(_cs.court);

  INSERT INTO public.app_notifications (
    kind, client_id, title, body, requires_ack, metadata, dedup_key
  ) VALUES (
    'booking_reactivated_by_staff',
    _cs.client_id,
    'Aula fixa reativada',
    'Sua aula fixa de ' || _date_br || ' às ' || _time_br || ' (' || _court_lbl || ') foi reativada pela recepção.',
    true,  -- popup blocking for client
    jsonb_build_object(
      'schedule_id', _cs.id,
      'client_id', _cs.client_id,
      'date', OLD.exception_date,
      'start_time', _cs.start_time,
      'court', _cs.court
    ),
    _dedup
  )
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN OLD;
END;
$$;


--
-- Name: notify_staff_waitlist_joined(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_staff_waitlist_joined() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _requester_name TEXT;
  _requester_type TEXT;
  _client_phone TEXT;
  _position INT;
  _title TEXT;
  _body TEXT;
  _meta JSONB;
  _u RECORD;
  _display TEXT;
BEGIN
  IF NEW.status <> 'waiting' THEN
    RETURN NEW;
  END IF;

  -- Resolve requester by explicit source of truth
  IF NEW.teacher_id IS NOT NULL THEN
    _requester_type := 'teacher';
    SELECT name INTO _requester_name FROM public.teachers WHERE id = NEW.teacher_id;
    _display := 'Professor ' || COALESCE(_requester_name, 'sem nome');
  ELSIF NEW.client_id IS NOT NULL THEN
    _requester_type := 'client';
    SELECT full_name, phone INTO _requester_name, _client_phone
      FROM public.clients WHERE id = NEW.client_id;
    _display := COALESCE(_requester_name, 'Cliente');
  ELSIF NULLIF(btrim(COALESCE(NEW.guest_name,'')),'') IS NOT NULL THEN
    _requester_type := 'guest';
    _requester_name := NEW.guest_name;
    _display := _requester_name;
  ELSE
    _requester_type := 'unknown';
    _requester_name := NULL;
    _display := 'Alguém';
  END IF;

  SELECT COUNT(*)::INT INTO _position
    FROM public.court_waitlist w
    WHERE w.desired_date = NEW.desired_date
      AND w.court = NEW.court
      AND w.start_time = NEW.start_time
      AND w.end_time = NEW.end_time
      AND w.status IN ('waiting','notified','contacted')
      AND w.created_at <= NEW.created_at;

  _title := '🎾 Nova entrada na lista de espera';
  _body  := _display || ' entrou na lista de espera.' ||
            E'\n' || COALESCE(public._court_short(NEW.court), 'Quadra ?') ||
            ' • ' || to_char(NEW.desired_date, 'DD/MM/YYYY') ||
            ' • ' || to_char(NEW.start_time, 'HH24:MI') || '–' || to_char(NEW.end_time, 'HH24:MI') ||
            E'\nPosição: ' || _position;

  _meta := jsonb_build_object(
    'waitlist_id', NEW.id,
    'court', NEW.court,
    'waitlist_date', NEW.desired_date,
    'start_time', NEW.start_time::text,
    'end_time', NEW.end_time::text,
    'requester_type', _requester_type,
    'requester_name', _requester_name,
    'teacher_id', NEW.teacher_id,
    'client_id', NEW.client_id,
    'client_phone', _client_phone,
    'position', _position
  );

  FOR _u IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role IN ('admin'::public.app_role,'diretoria'::public.app_role,'recepcionista'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'court_waitlist_joined', NULL, _u.user_id, _title, _body, false, _meta,
      'court_waitlist_joined:' || NEW.id::text || ':' || _u.user_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: notify_staff_waitlist_left(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_staff_waitlist_left() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _requester_name TEXT;
  _requester_type TEXT;
  _client_phone TEXT;
  _prev_position INT;
  _title TEXT;
  _body TEXT;
  _meta JSONB;
  _u RECORD;
  _display TEXT;
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.cancel_reason, '') NOT IN ('Cancelado pelo usuário', 'Removido pela recepção', 'Removido pela diretoria') THEN
    RETURN NEW;
  END IF;

  IF NEW.teacher_id IS NOT NULL THEN
    _requester_type := 'teacher';
    SELECT name INTO _requester_name FROM public.teachers WHERE id = NEW.teacher_id;
    _display := 'Professor ' || COALESCE(_requester_name, 'sem nome');
  ELSIF NEW.client_id IS NOT NULL THEN
    _requester_type := 'client';
    SELECT full_name, phone INTO _requester_name, _client_phone
      FROM public.clients WHERE id = NEW.client_id;
    _display := COALESCE(_requester_name, 'Cliente');
  ELSIF NULLIF(btrim(COALESCE(NEW.guest_name,'')),'') IS NOT NULL THEN
    _requester_type := 'guest';
    _requester_name := NEW.guest_name;
    _display := _requester_name;
  ELSE
    _requester_type := 'unknown';
    _display := 'Alguém';
  END IF;

  SELECT COUNT(*)::INT INTO _prev_position
    FROM public.court_waitlist w
    WHERE w.desired_date = NEW.desired_date
      AND w.court = NEW.court
      AND w.start_time = NEW.start_time
      AND w.end_time = NEW.end_time
      AND w.id <> NEW.id
      AND w.status IN ('waiting','notified','contacted')
      AND w.created_at < NEW.created_at;
  _prev_position := _prev_position + 1;

  _title := '🎾 Saída da lista de espera';
  _body  := _display || ' saiu da lista de espera.' ||
            E'\n' || COALESCE(public._court_short(NEW.court), 'Quadra ?') ||
            ' • ' || to_char(NEW.desired_date, 'DD/MM/YYYY') ||
            ' • ' || to_char(NEW.start_time, 'HH24:MI') || '–' || to_char(NEW.end_time, 'HH24:MI') ||
            E'\nPosição anterior: ' || _prev_position;

  _meta := jsonb_build_object(
    'waitlist_id', NEW.id,
    'court', NEW.court,
    'waitlist_date', NEW.desired_date,
    'start_time', NEW.start_time::text,
    'end_time', NEW.end_time::text,
    'requester_type', _requester_type,
    'requester_name', _requester_name,
    'teacher_id', NEW.teacher_id,
    'client_id', NEW.client_id,
    'client_phone', _client_phone,
    'previous_position', _prev_position
  );

  FOR _u IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role IN ('admin'::public.app_role,'diretoria'::public.app_role,'recepcionista'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'court_waitlist_left', NULL, _u.user_id, _title, _body, false, _meta,
      'court_waitlist_left:' || NEW.id::text || ':' || _u.user_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: notify_waitlist_slot_available(date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_waitlist_slot_available(_date date, _start time without time zone, _end time without time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _entry record;
  _first record;
  _staff record;
  _dedup_key text;
  _plan_hash text;
  _title_c text;
  _body_c text;
  _title_s text;
  _body_s text;
  _waiting_count integer;
  _duration_min integer;
  _blocks_start time[];
  _blocks_end time[];
  _b integer;
  _bs time;
  _be time;
  _plan jsonb;
  _plan_arr jsonb[];
  _same_court integer;
  _picked integer;
  _plan_summary text;
  _candidate jsonb;
begin
  for _entry in
    select w.id, w.start_time, w.end_time, w.court_continuity,
           w.client_id, w.teacher_id, w.court, w.created_at
    from public.court_waitlist w
    where w.desired_date = _date
      and w.status in ('waiting','notified','contacted')
      and w.start_time < _end
      and w.end_time > _start
    order by
      (extract(epoch from (w.end_time - w.start_time)))::integer asc,
      w.created_at asc,
      w.id asc
  loop
    select w.id into _first
    from public.court_waitlist w
    where w.desired_date = _date
      and w.status in ('waiting','notified','contacted')
      and w.start_time = _entry.start_time
      and w.end_time = _entry.end_time
      and (w.court is not distinct from _entry.court)
    order by
      (case when w.source_booking_id is null then 0 else 1 end) asc,
      w.priority desc, w.created_at asc, w.id asc
    limit 1;

    if _first.id is null or _first.id <> _entry.id then
      continue;
    end if;

    -- Já notificado hoje para este slot? Não gera outra notificação a
    -- cada evento de liberação — o plano de quadras (qual quadra ficou
    -- livre) mudava a cada chamada e isso fazia a dedup por hash de
    -- plano falhar, empilhando dezenas de notificações duplicadas para
    -- o mesmo pedido (cliente/professor e toda a equipe).
    _dedup_key := _date::text || '|' || _entry.start_time::text || '|' ||
                  _entry.end_time::text || '|' || _entry.id::text;

    if exists (
      select 1
      from public.app_notifications n
      where n.kind = 'waitlist_slot_available'
        and n.metadata->>'dedup_key' = _dedup_key
        and n.created_at > now() - interval '1 day'
    ) then
      continue;
    end if;

    _duration_min := extract(epoch from (_entry.end_time - _entry.start_time))::integer / 60;
    if _duration_min < 60 or (_duration_min % 60) <> 0 then
      continue;
    end if;

    _blocks_start := array[]::time[];
    _blocks_end := array[]::time[];
    for _b in 0..(_duration_min / 60 - 1) loop
      _blocks_start := array_append(_blocks_start, _entry.start_time + (_b * interval '1 hour'));
      _blocks_end := array_append(_blocks_end, _entry.start_time + ((_b + 1) * interval '1 hour'));
    end loop;

    -- Prioriza quem quer só 1 hora: se ALGUM bloco deste pedido de 2h+
    -- coincide com um pedido concorrente de exatamente 1h que também
    -- poderia ser atendido agora, não oferece essa rodada pro pedido de
    -- 2h+ — evita perder o aluguel da 1h por causa de uma combinação
    -- maior ainda incerta.
    if _duration_min > 60 and exists (
      select 1
      from generate_subscripts(_blocks_start, 1) i
      where exists (
        select 1
        from public.court_waitlist w2
        where w2.id <> _entry.id
          and w2.desired_date = _date
          and w2.start_time = _blocks_start[i]
          and w2.end_time = _blocks_end[i]
          and w2.status in ('waiting','notified','contacted')
          and exists (
            select 1 from generate_series(1,9) c2
            where (w2.court is null or c2 = w2.court or (w2.court = 0 and c2 between 1 and 8))
              and public.waitlist_court_block_is_free(_date, c2, _blocks_start[i], _blocks_end[i])
          )
      )
    ) then
      continue;
    end if;

    _plan_arr := array[]::jsonb[];

    if coalesce(_entry.court_continuity, 'same_court') = 'same_court' or _duration_min = 60 then
      select min(c) into _same_court
      from generate_series(1, 9) c
      where (_entry.court is null or c = _entry.court or (_entry.court = 0 and c between 1 and 8))
        and not exists (
          select 1
          from generate_subscripts(_blocks_start, 1) i
          where not public.waitlist_court_block_is_free(
            _date, c, _blocks_start[i], _blocks_end[i]
          )
        );

      if _same_court is null then
        continue;
      end if;

      for _b in 1..array_length(_blocks_start, 1) loop
        _plan_arr := array_append(_plan_arr, jsonb_build_object(
          'start', to_char(_blocks_start[_b], 'HH24:MI'),
          'end', to_char(_blocks_end[_b], 'HH24:MI'),
          'court', _same_court
        ));
      end loop;
    else
      for _b in 1..array_length(_blocks_start, 1) loop
        _bs := _blocks_start[_b];
        _be := _blocks_end[_b];

        select min(c) into _picked
        from generate_series(1, 9) c
        where (_entry.court is null or c = _entry.court or (_entry.court = 0 and c between 1 and 8))
          and public.waitlist_court_block_is_free(_date, c, _bs, _be);

        if _picked is null then
          _plan_arr := null;
          exit;
        end if;

        _plan_arr := array_append(_plan_arr, jsonb_build_object(
          'start', to_char(_bs, 'HH24:MI'),
          'end', to_char(_be, 'HH24:MI'),
          'court', _picked
        ));
      end loop;

      if _plan_arr is null then
        continue;
      end if;
    end if;

    _plan := to_jsonb(_plan_arr);
    _plan_hash := md5(_plan::text);

    update public.court_waitlist
    set status = 'notified'::public.waitlist_status,
        notified_at = now(),
        availability_plan = _plan,
        updated_at = now()
    where id = _entry.id;

    select w.*, c.full_name as client_name, c.phone as client_phone,
           t.name as teacher_name
    into _first
    from public.court_waitlist w
    left join public.clients c on c.id = w.client_id
    left join public.teachers t on t.id = w.teacher_id
    where w.id = _entry.id;

    select count(*)::integer into _waiting_count
    from public.court_waitlist w
    where w.desired_date = _date
      and w.start_time = _entry.start_time
      and w.end_time = _entry.end_time
      and w.status in ('waiting','notified','contacted');

    select string_agg(
      (p->>'start') || '–' || (p->>'end') || ' ' || public._court_short((p->>'court')::int),
      ', '
    ) into _plan_summary
    from jsonb_array_elements(_plan) p;

    _candidate := jsonb_build_object(
      'waitlist_id', _first.id,
      'client_id', _first.client_id,
      'teacher_id', _first.teacher_id,
      'full_name', _first.client_name,
      'guest_name', _first.guest_name,
      'teacher_name', _first.teacher_name,
      'w_start', _first.start_time::text,
      'w_end', _first.end_time::text,
      'w_court', _first.court,
      'priority', coalesce(_first.priority, 0),
      'notes', _first.notes
    );

    if coalesce(_entry.court_continuity, 'same_court') = 'allow_court_change'
       and _duration_min > 60 then
      _title_c := 'Surgiu uma possibilidade para o seu horário';
      _title_s := 'Lista de espera — combinação disponível';
    else
      _title_c := 'O horário que você aguardava foi liberado';
      _title_s := 'Lista de espera — horário liberado';
    end if;

    _body_c := to_char(_date, 'DD/MM/YYYY') || ', das ' ||
               to_char(_entry.start_time, 'HH24:MI') || ' às ' ||
               to_char(_entry.end_time, 'HH24:MI') || ' — ' || _plan_summary ||
               '. Nossa equipe entrará em contato para confirmar. A liberação não representa reserva automática.';

    _body_s := coalesce(_first.client_name, _first.teacher_name, _first.guest_name, 'Cliente') ||
               ' aguarda ' || to_char(_entry.start_time, 'HH24:MI') || '–' ||
               to_char(_entry.end_time, 'HH24:MI') || ' em ' || to_char(_date, 'DD/MM/YYYY') ||
               '. Disponível: ' || _plan_summary ||
               '. Deseja enviar um WhatsApp solicitando a confirmação?';

    insert into public.app_notifications
      (kind, client_id, title, body, requires_ack, metadata, dedup_key)
    values (
      'waitlist_slot_available',
      _first.client_id,
      _title_c,
      _body_c,
      true,
      jsonb_build_object(
        'dedup_key', _dedup_key,
        'for_first', true,
        'waitlist_id', _first.id,
        'teacher_id', _first.teacher_id,
        'date', _date,
        'start_time', _entry.start_time::text,
        'end_time', _entry.end_time::text,
        'court_continuity', _entry.court_continuity,
        'availability_plan', _plan
      ),
      _dedup_key || '|client'
    )
    on conflict (dedup_key) do nothing;

    for _staff in
      select distinct ur.user_id
      from public.user_roles ur
      where ur.role in (
        'admin'::public.app_role,
        'diretoria'::public.app_role,
        'recepcionista'::public.app_role
      )
    loop
      insert into public.app_notifications
        (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
      values (
        'waitlist_slot_available',
        null,
        _staff.user_id,
        _title_s,
        _body_s,
        true,
        jsonb_build_object(
          'dedup_key', _dedup_key || '|staff',
          'for_staff', true,
          'waitlist_id', _first.id,
          'client_id', _first.client_id,
          'client_name', _first.client_name,
          'teacher_name', _first.teacher_name,
          'client_phone', _first.client_phone,
          'waiting_count', _waiting_count,
          'date', _date,
          'start_time', _entry.start_time::text,
          'end_time', _entry.end_time::text,
          'court', ((_plan->0)->>'court')::integer,
          'court_continuity', _entry.court_continuity,
          'availability_plan', _plan,
          'candidates', jsonb_build_array(_candidate)
        ),
        _dedup_key || '|staff|' || _staff.user_id::text
      )
      on conflict (dedup_key) do nothing;
    end loop;
  end loop;
end;
$$;


--
-- Name: open_debt_report(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_debt_report(_from date, _to date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _start timestamptz := (_from::timestamp AT TIME ZONE 'America/Recife');
  _end timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'America/Recife');
  _sends jsonb;
  _actions jsonb;
  _together jsonb;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  WITH s AS (
    SELECT wn.id, wn.client_id, wn.context, wn.sent_at, wn.sent_by
    FROM public.whatsapp_notifications wn
    WHERE wn.context IN ('open_debt_d1', 'overdue')
      AND wn.sent_at >= _start AND wn.sent_at < _end
  ),
  d AS (
    SELECT
      s.*,
      GREATEST(0, -COALESCE((
        SELECT SUM(CASE WHEN ae.entry_type = 'credito' THEN ae.amount ELSE -ae.amount END)
        FROM public.account_entries ae
        WHERE ae.client_id = s.client_id AND ae.created_at <= s.sent_at
      ), 0)) AS debt_at_send
    FROM s
  ),
  r AS (
    SELECT
      d.*,
      (SELECT COALESCE(SUM(ae.amount), 0) FROM public.account_entries ae
        WHERE ae.client_id = d.client_id AND ae.entry_type = 'credito'
          AND ae.created_at > d.sent_at AND ae.created_at <= d.sent_at + interval '1 day') AS c1,
      (SELECT COALESCE(SUM(ae.amount), 0) FROM public.account_entries ae
        WHERE ae.client_id = d.client_id AND ae.entry_type = 'credito'
          AND ae.created_at > d.sent_at AND ae.created_at <= d.sent_at + interval '3 days') AS c3,
      (SELECT COALESCE(SUM(ae.amount), 0) FROM public.account_entries ae
        WHERE ae.client_id = d.client_id AND ae.entry_type = 'credito'
          AND ae.created_at > d.sent_at AND ae.created_at <= d.sent_at + interval '7 days') AS c7
    FROM d
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'client_id', r.client_id,
      'client_name', c.full_name,
      'context', r.context,
      'sent_at', r.sent_at,
      'sent_by', r.sent_by,
      'sent_by_name', p.full_name,
      'debt_at_send', r.debt_at_send,
      'recovered_1d', LEAST(r.debt_at_send, r.c1),
      'recovered_3d', LEAST(r.debt_at_send, r.c3),
      'recovered_7d', LEAST(r.debt_at_send, r.c7)
    ) ORDER BY r.sent_at DESC), '[]'::jsonb)
  INTO _sends
  FROM r
  LEFT JOIN public.clients c ON c.id = r.client_id
  LEFT JOIN public.profiles p ON p.id = r.sent_by;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', x.acted_by,
      'user_name', p.full_name,
      'sent', x.sent,
      'skipped', x.skipped
    )), '[]'::jsonb)
  INTO _actions
  FROM (
    SELECT a.acted_by,
           COUNT(*) FILTER (WHERE a.action = 'sent') AS sent,
           COUNT(*) FILTER (WHERE a.action = 'skipped') AS skipped
    FROM public.open_debt_reminder_actions a
    WHERE a.reminder_date BETWEEN _from AND _to
    GROUP BY a.acted_by
  ) x
  LEFT JOIN public.profiles p ON p.id = x.acted_by;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', x.recorded_by,
      'user_name', p.full_name,
      'count', x.cnt,
      'total', x.total
    )), '[]'::jsonb)
  INTO _together
  FROM (
    SELECT pay.recorded_by, COUNT(*) AS cnt, SUM(pay.amount) AS total
    FROM public.payments pay
    WHERE pay.notes = 'Quitação de débito em aberto (recebido junto)'
      AND pay.paid_at >= _start AND pay.paid_at < _end
    GROUP BY pay.recorded_by
  ) x
  LEFT JOIN public.profiles p ON p.id = x.recorded_by;

  RETURN jsonb_build_object('sends', _sends, 'actions', _actions, 'together', _together);
END;
$$;


--
-- Name: payment_stock_item_name(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_stock_item_name(_category_id uuid, _client_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _cat_name TEXT;
  _norm TEXT;
BEGIN
  SELECT name INTO _cat_name FROM public.client_categories WHERE id = _category_id;
  IF _cat_name IS NULL AND _client_id IS NOT NULL THEN
    SELECT cc.name INTO _cat_name
    FROM public.clients cl
    LEFT JOIN public.client_categories cc ON cc.id = cl.category_id
    WHERE cl.id = _client_id;
  END IF;
  _norm := public.normalize_category(_cat_name);
  IF _norm = 'terno de bola' THEN RETURN 'Terno de bola'; END IF;
  IF _norm = 'grip' THEN RETURN 'Grip'; END IF;
  RETURN NULL;
END $$;


--
-- Name: payment_sync_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_sync_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _old_item TEXT;
  _new_item TEXT;
  _old_item_id UUID;
  _new_item_id UUID;
  _old_qty INTEGER;
  _new_qty INTEGER;
  _diff INTEGER;
  _old_is_pending BOOLEAN;
  _new_is_pending BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _old_is_pending := COALESCE(OLD.is_pending_payment, false);
    IF NOT _old_is_pending THEN
      _old_item := public.payment_stock_item_name(OLD.category_id, OLD.client_id);
      _old_qty := COALESCE(OLD.quantity, 1);
      IF _old_item IS NOT NULL AND _old_qty > 0 THEN
        SELECT id INTO _old_item_id FROM public.stock_items WHERE name = _old_item;
        IF _old_item_id IS NOT NULL THEN
          INSERT INTO public.stock_movements(item_id, movement_type, quantity, notes, payment_id, recorded_by)
          VALUES (_old_item_id, 'entrada', _old_qty, 'Estorno de venda removida', NULL, OLD.updated_by);
          UPDATE public.stock_items SET current_quantity = current_quantity + _old_qty WHERE id = _old_item_id;
        END IF;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  _new_item := public.payment_stock_item_name(NEW.category_id, NEW.client_id);
  _new_qty := COALESCE(NEW.quantity, 1);
  _new_is_pending := COALESCE(NEW.is_pending_payment, false);

  IF TG_OP = 'INSERT' THEN
    IF _new_is_pending THEN
      RETURN NEW;
    END IF;
    IF _new_item IS NOT NULL AND _new_qty > 0 THEN
      SELECT id INTO _new_item_id FROM public.stock_items WHERE name = _new_item;
      IF _new_item_id IS NOT NULL THEN
        INSERT INTO public.stock_movements(item_id, movement_type, quantity, notes, payment_id, recorded_by)
        VALUES (_new_item_id, 'saida', _new_qty, 'Venda no caixa', NEW.id, NEW.recorded_by);
        UPDATE public.stock_items SET current_quantity = current_quantity - _new_qty WHERE id = _new_item_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  _old_item := public.payment_stock_item_name(OLD.category_id, OLD.client_id);
  _old_qty := COALESCE(OLD.quantity, 1);
  _old_is_pending := COALESCE(OLD.is_pending_payment, false);

  IF _old_is_pending IS DISTINCT FROM _new_is_pending OR _old_item IS DISTINCT FROM _new_item THEN
    IF NOT _old_is_pending AND _old_item IS NOT NULL AND _old_qty > 0 THEN
      SELECT id INTO _old_item_id FROM public.stock_items WHERE name = _old_item;
      IF _old_item_id IS NOT NULL THEN
        INSERT INTO public.stock_movements(item_id, movement_type, quantity, notes, payment_id, recorded_by)
        VALUES (_old_item_id, 'entrada', _old_qty, 'Estorno por edição de venda', NEW.id, NEW.updated_by);
        UPDATE public.stock_items SET current_quantity = current_quantity + _old_qty WHERE id = _old_item_id;
      END IF;
    END IF;
    IF NOT _new_is_pending AND _new_item IS NOT NULL AND _new_qty > 0 THEN
      SELECT id INTO _new_item_id FROM public.stock_items WHERE name = _new_item;
      IF _new_item_id IS NOT NULL THEN
        INSERT INTO public.stock_movements(item_id, movement_type, quantity, notes, payment_id, recorded_by)
        VALUES (_new_item_id, 'saida', _new_qty, 'Venda no caixa (editada)', NEW.id, COALESCE(NEW.updated_by, NEW.recorded_by));
        UPDATE public.stock_items SET current_quantity = current_quantity - _new_qty WHERE id = _new_item_id;
      END IF;
    END IF;
  ELSIF NOT _new_is_pending AND _new_item IS NOT NULL AND _old_qty <> _new_qty THEN
    _diff := _new_qty - _old_qty;
    SELECT id INTO _new_item_id FROM public.stock_items WHERE name = _new_item;
    IF _new_item_id IS NOT NULL THEN
      IF _diff > 0 THEN
        INSERT INTO public.stock_movements(item_id, movement_type, quantity, notes, payment_id, recorded_by)
        VALUES (_new_item_id, 'saida', _diff, 'Ajuste de quantidade (edição)', NEW.id, COALESCE(NEW.updated_by, NEW.recorded_by));
        UPDATE public.stock_items SET current_quantity = current_quantity - _diff WHERE id = _new_item_id;
      ELSE
        INSERT INTO public.stock_movements(item_id, movement_type, quantity, notes, payment_id, recorded_by)
        VALUES (_new_item_id, 'entrada', -_diff, 'Ajuste de quantidade (edição)', NEW.id, COALESCE(NEW.updated_by, NEW.recorded_by));
        UPDATE public.stock_items SET current_quantity = current_quantity + (-_diff) WHERE id = _new_item_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: payment_to_account_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_to_account_entry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _desc TEXT;
  _cat_name TEXT;
  _cat_norm TEXT;
  _entry_amount NUMERIC;
  _bucket TEXT;
  _is_pending BOOLEAN;
BEGIN
  SELECT name INTO _cat_name FROM public.client_categories WHERE id = NEW.category_id;
  IF _cat_name IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT cc.name INTO _cat_name
    FROM public.clients cl
    LEFT JOIN public.client_categories cc ON cc.id = cl.category_id
    WHERE cl.id = NEW.client_id;
  END IF;

  _cat_norm := lower(btrim(COALESCE(_cat_name, '')));
  _cat_norm := translate(
    _cat_norm,
    'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
  );


  _is_pending := (
    NEW.client_id IS NOT NULL
    AND NEW.received = false
    AND NEW.amount > 0
    AND false -- pendente automático (não usado no Stadium)
    AND COALESCE(NEW.to_account, false) = false
  );

  IF _is_pending THEN
    _desc := COALESCE(NEW.notes, 'Pendente' || CASE WHEN _cat_name IS NOT NULL THEN ' - ' || _cat_name ELSE '' END);
    _bucket := 'geral';
    INSERT INTO public.account_entries(client_id, entry_type, amount, description, entry_date, payment_id, recorded_by, bucket)
    VALUES (
      NEW.client_id,
      'debito'::public.account_entry_type,
      NEW.amount,
      _desc,
      (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      NEW.id,
      NEW.recorded_by,
      _bucket
    );
    RETURN NEW;
  END IF;

  IF NEW.client_id IS NULL OR NEW.to_account = false OR NEW.account_direction IS NULL THEN
    RETURN NEW;
  END IF;

  IF _cat_norm NOT IN ('mensalista', 'debito avulso', 'saldo anterior', 'credito gympass', 'pendencia avulsa', 'estorno', 'energia (luz)', 'ranking masculino', 'ranking feminino') THEN
    RETURN NEW;
  END IF;

  _desc := COALESCE(NEW.notes, 'Lançamento do caixa');

  IF _cat_norm = 'credito gympass' THEN
    _entry_amount := NEW.amount - COALESCE(NEW.passthrough_amount, 0);
  ELSE
    _entry_amount := NEW.amount;
  END IF;

  IF _entry_amount <= 0 THEN
    RETURN NEW;
  END IF;

  _bucket := 'geral';

  INSERT INTO public.account_entries(client_id, entry_type, amount, description, entry_date, payment_id, recorded_by, bucket)
  VALUES (
    NEW.client_id,
    NEW.account_direction::public.account_entry_type,
    _entry_amount,
    _desc,
    (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
    NEW.id,
    NEW.recorded_by,
    _bucket
  );

  RETURN NEW;
END;
$$;


--
-- Name: payment_update_account_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_update_account_entry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _desc TEXT;
  _cat_name TEXT;
  _cat_norm TEXT;
  _eligible BOOLEAN;
  _existing_id UUID;
  _entry_amount NUMERIC;
  _bucket TEXT;
  _direction public.account_entry_type;
  _is_pending BOOLEAN;
BEGIN
  SELECT name INTO _cat_name FROM public.client_categories WHERE id = NEW.category_id;
  IF _cat_name IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT cc.name INTO _cat_name
    FROM public.clients cl
    LEFT JOIN public.client_categories cc ON cc.id = cl.category_id
    WHERE cl.id = NEW.client_id;
  END IF;

  _cat_norm := lower(btrim(COALESCE(_cat_name, '')));
  _cat_norm := translate(
    _cat_norm,
    'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
  );


  _is_pending := (
    NEW.client_id IS NOT NULL
    AND NEW.received = false
    AND NEW.amount > 0
    AND false -- pendente automático (não usado no Stadium)
    AND COALESCE(NEW.to_account, false) = false
  );

  IF _is_pending THEN
    _eligible := true;
    _entry_amount := NEW.amount;
    _direction := 'debito'::public.account_entry_type;
    _bucket := 'geral';
    _desc := COALESCE(NEW.notes, 'Pendente' || CASE WHEN _cat_name IS NOT NULL THEN ' - ' || _cat_name ELSE '' END);
  ELSE
    _eligible := (
      NEW.client_id IS NOT NULL
      AND NEW.to_account = true
      AND NEW.account_direction IS NOT NULL
      AND _cat_norm IN ('mensalista', 'debito avulso', 'saldo anterior', 'credito gympass', 'pendencia avulsa', 'estorno', 'energia (luz)', 'ranking masculino', 'ranking feminino')
    );

    IF _cat_norm = 'credito gympass' THEN
      _entry_amount := NEW.amount - COALESCE(NEW.passthrough_amount, 0);
    ELSE
      _entry_amount := NEW.amount;
    END IF;

    _bucket := 'geral';

    IF NEW.account_direction IS NOT NULL THEN
      _direction := NEW.account_direction::public.account_entry_type;
    END IF;
    _desc := COALESCE(NEW.notes, 'Lançamento do caixa');
  END IF;

  SELECT id INTO _existing_id FROM public.account_entries WHERE payment_id = NEW.id LIMIT 1;

  IF NOT _eligible OR _entry_amount <= 0 THEN
    IF _existing_id IS NOT NULL THEN
      DELETE FROM public.account_entries WHERE id = _existing_id;
    END IF;
    RETURN NEW;
  END IF;

  IF _existing_id IS NULL THEN
    INSERT INTO public.account_entries(
      client_id, entry_type, amount, description, entry_date, payment_id, recorded_by, bucket
    ) VALUES (
      NEW.client_id,
      _direction,
      _entry_amount,
      _desc,
      (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      NEW.id,
      COALESCE(NEW.updated_by, NEW.recorded_by),
      _bucket
    );
  ELSE
    UPDATE public.account_entries
    SET
      client_id = NEW.client_id,
      entry_type = _direction,
      amount = _entry_amount,
      description = _desc,
      entry_date = (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
      bucket = _bucket,
      updated_at = now()
    WHERE id = _existing_id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: portal_can_view_client(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_can_view_client(_client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.portal_owned_client_ids(auth.uid()) owned(client_id)
    WHERE owned.client_id = _client_id
  );
$$;


--
-- Name: portal_cancel_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_cancel_booking(_booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _b public.court_bookings%ROWTYPE;
  _allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT * INTO _b
  FROM public.court_bookings
  WHERE id = _booking_id;

  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'Reserva não encontrada';
  END IF;

  IF _b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Reserva já cancelada';
  END IF;

  IF _b.client_id IS NULL THEN
    RAISE EXCEPTION 'Sem permissão para cancelar esta reserva';
  END IF;

  SELECT public.portal_can_view_client(_b.client_id) INTO _allowed;
  IF NOT COALESCE(_allowed, false) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar esta reserva';
  END IF;

  UPDATE public.court_bookings
     SET cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = 'Cancelado pelo cliente'
   WHERE id = _booking_id;
END;
$$;


--
-- Name: portal_cancel_fixed_schedule(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text DEFAULT 'Cancelado pelo cliente'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_id uuid;
  _exc_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT cs.client_id INTO _client_id
  FROM public.client_schedules cs
  WHERE cs.id = _schedule_id;
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'schedule not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.portal_owned_client_ids(auth.uid()) p
    WHERE p.client_id = _client_id
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Remove any partial exceptions for this day and insert a full-day cancel
  DELETE FROM public.client_schedule_exceptions
  WHERE client_schedule_id = _schedule_id AND exception_date = _date;

  INSERT INTO public.client_schedule_exceptions (
    client_schedule_id, exception_date, reason, created_by, start_time, end_time
  ) VALUES (
    _schedule_id, _date, _reason, auth.uid(), NULL, NULL
  )
  RETURNING id INTO _exc_id;

  RETURN _exc_id;
END;
$$;


--
-- Name: portal_create_paid_booking_hold(integer, date, time without time zone, time without time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_create_paid_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _client_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _booking_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.');
  END IF;

  IF _client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.client_portal_users
    WHERE user_id = auth.uid() AND client_id = _client_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário sem vínculo de cliente.');
  END IF;

  IF _court < 1 OR _court > 9 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quadra inválida.');
  END IF;
  IF _end <= _start THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Horário inválido.');
  END IF;
  IF _date < public.recife_today() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Data inválida.');
  END IF;

  IF public.portal_slot_has_active_fixed_conflict(_court, _date, _start, _end) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este horário já está ocupado por uma locação fixa.');
  END IF;

  BEGIN
    INSERT INTO public.court_bookings (
      court, booking_date, start_time, end_time, source, client_id,
      hold_expires_at, created_by
    ) VALUES (
      _court::smallint, _date, _start, _end, 'avulsa'::booking_source, _client_id,
      now() + interval '5 minutes', auth.uid()
    )
    RETURNING id INTO _booking_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'booking_id', _booking_id);
END;
$$;


--
-- Name: portal_get_category_names(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_get_category_names(_ids uuid[]) RETURNS TABLE(id uuid, name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.name
  FROM public.client_categories c
  WHERE c.id = ANY(_ids);
$$;


--
-- Name: portal_join_court_waitlist(date, time without time zone, time without time zone, uuid, text, smallint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_join_court_waitlist(_date date, _start time without time zone, _end time without time zone, _source_booking_id uuid DEFAULT NULL::uuid, _court_continuity text DEFAULT 'same_court'::text, _court smallint DEFAULT NULL::smallint, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _self_client_id uuid;
  _teacher_id uuid;
  _final_client_id uuid;
  _requested_by uuid;
  _existing public.court_waitlist%ROWTYPE;
  _inserted public.court_waitlist%ROWTYPE;
  _position integer;
  _duration_minutes integer;
  _dow integer;
  _open_hour integer;
  _close_hour integer;
  _continuity text;
  _source public.court_bookings%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authenticated');
  END IF;

  IF _start IS NULL OR _end IS NULL OR _start >= _end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid interval');
  END IF;

  _duration_minutes := EXTRACT(EPOCH FROM (_end - _start))::integer / 60;

  IF EXTRACT(MINUTE FROM _start)::int <> 0
     OR EXTRACT(SECOND FROM _start)::int <> 0
     OR EXTRACT(MINUTE FROM _end)::int <> 0
     OR EXTRACT(SECOND FROM _end)::int <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Horários da lista de espera devem começar e terminar em hora cheia.');
  END IF;

  IF _duration_minutes < 60 OR (_duration_minutes % 60) <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'O intervalo deve ter duração em blocos de 60 minutos.');
  END IF;

  IF _court IS NOT NULL AND (_court < 0 OR _court > 9) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quadra inválida para a fila de espera.');
  END IF;

  _dow := EXTRACT(DOW FROM _date)::int;
  _open_hour := CASE WHEN _dow IN (0, 6) THEN 7 ELSE 5 END;
  _close_hour := CASE WHEN _dow IN (0, 6) THEN 19 WHEN _dow = 5 THEN 22 ELSE 23 END;

  IF EXTRACT(HOUR FROM _start)::int < _open_hour
     OR EXTRACT(HOUR FROM _end)::int > _close_hour THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este horário está fora do funcionamento online.');
  END IF;

  _continuity := COALESCE(NULLIF(_court_continuity,''),'same_court');
  IF _continuity NOT IN ('same_court','allow_court_change') THEN
    _continuity := 'same_court';
  END IF;
  -- Para 60 min, continuidade é irrelevante — normaliza para 'same_court'
  IF _duration_minutes = 60 THEN
    _continuity := 'same_court';
  END IF;

  SELECT c.id INTO _self_client_id
  FROM public.client_portal_users cpu
  JOIN public.clients c ON c.id = cpu.client_id
  WHERE cpu.user_id = _uid
  LIMIT 1;

  SELECT t.id INTO _teacher_id
  FROM public.teachers t
  WHERE t.user_id = _uid
  LIMIT 1;

  IF _self_client_id IS NULL AND _teacher_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário sem vínculo de cliente/professor.');
  END IF;

  IF _client_id IS NOT NULL THEN
    IF _teacher_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Somente professores podem solicitar em nome de outro cliente.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.client_schedules cs WHERE cs.client_id = _client_id AND cs.teacher_id = _teacher_id
      UNION ALL
      SELECT 1 FROM public.court_bookings cb WHERE cb.client_id = _client_id AND cb.teacher_id = _teacher_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Aluno não vinculado a este professor.');
    END IF;
    _final_client_id := _client_id;
    _requested_by := _teacher_id;
  ELSE
    _final_client_id := _self_client_id;
    _requested_by := NULL;
  END IF;

  -- Pedido de antecipação/troca de uma reserva já existente: valida que a
  -- reserva é mesmo do cliente em nome de quem se está pedindo, que ainda
  -- está ativa, que o novo horário+quadra é de fato diferente do atual, e
  -- que não há outro pedido de troca em aberto pra essa mesma reserva
  -- (evita duas trocas concorrentes virarem duas reservas novas pra uma
  -- única antiga).
  IF _source_booking_id IS NOT NULL THEN
    SELECT * INTO _source FROM public.court_bookings WHERE id = _source_booking_id;
    IF _source.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Reserva original não encontrada.');
    END IF;
    IF _source.cancelled_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A reserva original já está cancelada.');
    END IF;
    IF _source.client_id IS DISTINCT FROM _final_client_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Esta reserva não pertence a este cliente.');
    END IF;
    IF _source.booking_date = _date AND _source.start_time = _start AND _source.end_time = _end
       AND _court IS NOT DISTINCT FROM _source.court THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Este já é o horário e a quadra atuais da reserva.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.court_waitlist w
      WHERE w.source_booking_id = _source_booking_id
        AND w.status IN ('waiting','notified','contacted')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Já existe um pedido de troca de horário em aberto para esta reserva.');
    END IF;
  END IF;

  SELECT * INTO _existing
  FROM public.court_waitlist w
  WHERE w.desired_date = _date
    AND w.start_time = _start
    AND w.end_time = _end
    AND w.status IN ('waiting','notified','contacted')
    AND w.court IS NOT DISTINCT FROM _court
    AND (
      (_client_id IS NOT NULL AND w.client_id = _final_client_id AND w.requested_by_teacher_id = _requested_by)
      OR (_client_id IS NULL AND (
        w.user_id = _uid
        OR (_self_client_id IS NOT NULL AND w.client_id = _self_client_id)
        OR (_teacher_id IS NOT NULL AND w.teacher_id = _teacher_id AND w.requested_by_teacher_id IS NULL)
      ))
    )
  ORDER BY w.created_at ASC, w.id ASC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.court_waitlist
      SET user_id = COALESCE(user_id, _uid),
          court_continuity = _continuity,
          source_booking_id = COALESCE(source_booking_id, _source_booking_id),
          updated_at = now()
      WHERE id = _existing.id;

    SELECT COUNT(*)::int INTO _position
    FROM public.court_waitlist w
    WHERE w.desired_date = _date
      AND w.start_time = _start
      AND w.end_time = _end
      AND w.status IN ('waiting','notified','contacted')
      AND w.court IS NOT DISTINCT FROM _court
      AND (
        (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
          < (CASE WHEN _existing.source_booking_id IS NULL THEN 0 ELSE 1 END)
        OR (
          (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
            = (CASE WHEN _existing.source_booking_id IS NULL THEN 0 ELSE 1 END)
          AND (w.created_at, w.id) <= (_existing.created_at, _existing.id)
        )
      );

    RETURN jsonb_build_object('ok', true, 'already', true, 'id', _existing.id, 'position', _position);
  END IF;

  INSERT INTO public.court_waitlist (
    desired_date, court, start_time, end_time, source_booking_id,
    client_id, teacher_id, requested_by_teacher_id, status, created_by, user_id, court_continuity
  ) VALUES (
    _date, _court, _start, _end, _source_booking_id,
    _final_client_id, _teacher_id, _requested_by, 'waiting'::public.waitlist_status, _uid, _uid, _continuity
  )
  RETURNING * INTO _inserted;

  SELECT COUNT(*)::int INTO _position
  FROM public.court_waitlist w
  WHERE w.desired_date = _date
    AND w.start_time = _start
    AND w.end_time = _end
    AND w.status IN ('waiting','notified','contacted')
    AND w.court IS NOT DISTINCT FROM _court
    AND (
      (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
        < (CASE WHEN _inserted.source_booking_id IS NULL THEN 0 ELSE 1 END)
      OR (
        (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
          = (CASE WHEN _inserted.source_booking_id IS NULL THEN 0 ELSE 1 END)
        AND (w.created_at, w.id) <= (_inserted.created_at, _inserted.id)
      )
    );

  RETURN jsonb_build_object('ok', true, 'already', false, 'id', _inserted.id, 'position', _position);
END;
$$;


--
-- Name: portal_leave_court_waitlist(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_leave_court_waitlist(_waitlist_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _client_id uuid;
  _teacher_id uuid;
  _row public.court_waitlist%ROWTYPE;
  _updated INT;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authenticated');
  END IF;

  SELECT * INTO _row FROM public.court_waitlist WHERE id = _waitlist_id;

  IF _row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entrada não encontrada');
  END IF;

  SELECT c.id INTO _client_id
  FROM public.client_portal_users cpu
  JOIN public.clients c ON c.id = cpu.client_id
  WHERE cpu.user_id = _uid
  LIMIT 1;

  SELECT t.id INTO _teacher_id FROM public.teachers t WHERE t.user_id = _uid LIMIT 1;

  IF _row.user_id IS DISTINCT FROM _uid
     AND (_client_id IS NULL OR _row.client_id IS DISTINCT FROM _client_id)
     AND (_teacher_id IS NULL OR _row.teacher_id IS DISTINCT FROM _teacher_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissão');
  END IF;

  -- Idempotente
  IF _row.status NOT IN ('waiting','notified','contacted') THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  UPDATE public.court_waitlist
     SET status = 'cancelled'::public.waitlist_status,
         cancelled_at = now(),
         cancelled_by = _uid,
         cancel_reason = 'Cancelado pelo usuário',
         updated_at = now()
   WHERE id = _waitlist_id
     AND status IN ('waiting','notified','contacted');

  GET DIAGNOSTICS _updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'already', _updated = 0);
END;
$$;


--
-- Name: portal_log_booking_failure(uuid, date, integer, integer, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text DEFAULT NULL::text, _details jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _recent int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Só registra em nome de um cliente que a própria conta do portal enxerga.
  IF _client_id IS NOT NULL AND NOT public.portal_can_view_client(_client_id) THEN
    RETURN;
  END IF;

  IF _stage NOT IN ('regra_horario', 'categoria', 'servidor', 'carregamento') THEN
    RETURN;
  END IF;

  -- Trava contra enxurrada (cliente clicando sem parar, ou loop de erro):
  -- no máximo 60 registros por login por hora. Passou disso, ignora.
  SELECT count(*) INTO _recent
  FROM public.portal_booking_failures
  WHERE user_id = auth.uid()
    AND created_at > now() - INTERVAL '1 hour';
  IF _recent >= 60 THEN
    RETURN;
  END IF;

  INSERT INTO public.portal_booking_failures (
    user_id, client_id, booking_date, court, start_hour, stage, message, error_code, details
  ) VALUES (
    auth.uid(),
    _client_id,
    _booking_date,
    _court::smallint,
    _start_hour::smallint,
    _stage,
    left(coalesce(nullif(btrim(_message), ''), '(sem mensagem)'), 500),
    left(_error_code, 50),
    coalesce(_details, '{}'::jsonb)
  );
END;
$$;


--
-- Name: portal_map_bookings(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_map_bookings(_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH me AS (
    SELECT client_id FROM public.portal_owned_client_ids(auth.uid())
  ),
  gate AS (
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = auth.uid()
    )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      b.id,
      b.court,
      b.booking_date,
      b.start_time,
      b.end_time,
      b.source,
      b.cancelled_at,
      (b.client_id IN (SELECT client_id FROM me)) AS is_own,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.client_id END AS client_id,
      CASE WHEN b.client_id IN (SELECT client_id FROM me)
           THEN jsonb_build_object('id', c.id, 'full_name', c.full_name)
      END AS clients,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.category_id END AS category_id,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN cat.name END AS category_name,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.teacher_id END AS teacher_id,
      CASE WHEN b.client_id IN (SELECT client_id FROM me)
           THEN jsonb_build_object('id', t.id, 'name', t.name)
      END AS teachers,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.guest_name END AS guest_name,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.notes END AS notes,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.cancel_reason END AS cancel_reason,
      CASE WHEN b.client_id IN (SELECT client_id FROM me) THEN b.hold_expires_at END AS hold_expires_at
    FROM public.court_bookings b
    LEFT JOIN public.clients c ON c.id = b.client_id
    LEFT JOIN public.client_categories cat ON cat.id = b.category_id
    LEFT JOIN public.teachers t ON t.id = b.teacher_id
    WHERE b.booking_date = _date
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: portal_map_price_bands(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_map_price_bands(_weekday integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH gate AS (
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = auth.uid()
    )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  FROM (
    SELECT
      p.id,
      p.categories,
      p.courts,
      p.weekday,
      p.start_time,
      p.end_time,
      p.price_per_hour,
      p.starts_on,
      p.ends_on,
      p.discount_percent
    FROM public.price_table p
    WHERE p.weekday = _weekday
      AND EXISTS (SELECT 1 FROM gate)
    ORDER BY p.start_time
  ) x;
$$;


--
-- Name: portal_map_schedule_exceptions(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_map_schedule_exceptions(_date date, _weekday integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH me AS (
    SELECT client_id FROM public.portal_owned_client_ids(auth.uid())
  ),
  gate AS (
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = auth.uid()
    )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      e.id, e.client_schedule_id, e.exception_date, e.range_end, e.start_time, e.end_time,
      (s.client_id IN (SELECT client_id FROM me)) AS is_own,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN e.reason END AS reason
    FROM public.client_schedule_exceptions e
    JOIN public.client_schedules s ON s.id = e.client_schedule_id
    WHERE e.exception_date <= _date
      AND COALESCE(e.range_end, e.exception_date) >= _date
      AND s.weekday = _weekday
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: portal_map_schedules(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_map_schedules(_weekday integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH me AS (
    SELECT client_id FROM public.portal_owned_client_ids(auth.uid())
  ),
  gate AS (
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = auth.uid()
    )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      s.id,
      s.weekday,
      s.start_time,
      s.end_time,
      s.court,
      (s.client_id IN (SELECT client_id FROM me)) AS is_own,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN s.client_id END AS client_id,
      CASE WHEN s.client_id IN (SELECT client_id FROM me)
           THEN jsonb_build_object('id', c.id, 'full_name', c.full_name)
      END AS clients,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN s.teacher_id END AS teacher_id,
      CASE WHEN s.client_id IN (SELECT client_id FROM me)
           THEN jsonb_build_object('id', t.id, 'name', t.name)
      END AS teachers,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN s.notes END AS notes
    FROM public.client_schedules s
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.teachers t ON t.id = s.teacher_id
    WHERE s.weekday = _weekday
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: portal_map_schedules(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_map_schedules(_weekday integer, _date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH me AS (
    SELECT client_id FROM public.portal_owned_client_ids(auth.uid())
  ),
  gate AS (
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM public.client_portal_users cpu WHERE cpu.user_id = auth.uid()
    )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      s.id, s.weekday, s.start_time, s.end_time, s.court,
      s.valid_from, s.valid_until,
      (s.client_id IN (SELECT client_id FROM me)) AS is_own,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN s.client_id END AS client_id,
      CASE WHEN s.client_id IN (SELECT client_id FROM me)
           THEN jsonb_build_object('id', c.id, 'full_name', c.full_name)
      END AS clients,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN s.teacher_id END AS teacher_id,
      CASE WHEN s.client_id IN (SELECT client_id FROM me)
           THEN jsonb_build_object('id', t.id, 'name', t.name)
      END AS teachers,
      CASE WHEN s.client_id IN (SELECT client_id FROM me) THEN s.notes END AS notes
    FROM public.client_schedules s
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.teachers t ON t.id = s.teacher_id
    WHERE s.weekday = _weekday
      AND (_date IS NULL OR public.client_schedule_valid_on(s.valid_from, s.valid_until, _date))
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: portal_owned_client_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_owned_client_ids(_user_id uuid) RETURNS TABLE(client_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT cpu.client_id
    FROM public.client_portal_users cpu
    WHERE cpu.user_id = _user_id
  UNION
  SELECT c.id
    FROM public.clients c
    WHERE c.responsible_client_id IN (
      SELECT cpu2.client_id
        FROM public.client_portal_users cpu2
        WHERE cpu2.user_id = _user_id
    );
$$;


--
-- Name: portal_remove_profile_photo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_remove_profile_photo(_client_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.portal_can_view_client(_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  UPDATE public.clients
     SET profile_photo_path = NULL,
         profile_photo_updated_at = now(),
         profile_photo_updated_by = v_uid,
         updated_at = now()
   WHERE id = _client_id;
END;
$$;


--
-- Name: portal_set_profile_photo(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_set_profile_photo(_client_id uuid, _photo_path text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.portal_can_view_client(_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  IF _photo_path IS NULL OR length(trim(_photo_path)) = 0 THEN
    RAISE EXCEPTION 'photo path required';
  END IF;

  UPDATE public.clients
     SET profile_photo_path = _photo_path,
         profile_photo_updated_at = now(),
         profile_photo_updated_by = v_uid,
         profile_photo_consent_at = COALESCE(profile_photo_consent_at, now()),
         updated_at = now()
   WHERE id = _client_id;
END;
$$;


--
-- Name: portal_slot_has_active_fixed_conflict(integer, date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.fixed_schedule_conflicts(_court, _date, _start, _end);
$$;


--
-- Name: portal_update_profile(uuid, smallint, smallint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Uses existing portal authorization helper (handles linked + dependents)
  v_allowed := public.portal_can_view_client(_client_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  IF _birth_month IS NOT NULL AND (_birth_month < 1 OR _birth_month > 12) THEN
    RAISE EXCEPTION 'invalid month';
  END IF;
  IF _birth_day IS NOT NULL THEN
    IF _birth_day < 1 OR _birth_day > 31 THEN
      RAISE EXCEPTION 'invalid day';
    END IF;
    IF _birth_month IS NULL THEN
      RAISE EXCEPTION 'month required when day provided';
    END IF;
    IF (_birth_month IN (4,6,9,11) AND _birth_day > 30)
       OR (_birth_month = 2 AND _birth_day > 29) THEN
      RAISE EXCEPTION 'invalid day for month';
    END IF;
  END IF;

  IF _tennis_class IS NOT NULL AND _tennis_class NOT IN
     ('iniciante','5_classe','4_classe','3_classe','2_classe','1_classe') THEN
    RAISE EXCEPTION 'invalid tennis class';
  END IF;

  UPDATE public.clients
     SET birth_day = _birth_day,
         birth_month = _birth_month,
         tennis_class = _tennis_class,
         updated_at = now()
   WHERE id = _client_id;
END;
$$;


--
-- Name: portal_waitlist_position(date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_waitlist_position(_date date, _start time without time zone, _end time without time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _teacher_id uuid;
  _row public.court_waitlist%ROWTYPE;
  _pos int;
  _total int;
BEGIN
  SELECT COUNT(*)::INT INTO _total FROM public.court_waitlist
    WHERE desired_date = _date
      AND start_time = _start AND end_time = _end
      AND status IN ('waiting','notified','contacted');

  IF _uid IS NULL THEN
    RETURN jsonb_build_object('in_queue', false, 'total', _total);
  END IF;

  SELECT c.id INTO _client_id
  FROM public.client_portal_users cpu
  JOIN public.clients c ON c.id = cpu.client_id
  WHERE cpu.user_id = _uid
  LIMIT 1;

  SELECT t.id INTO _teacher_id FROM public.teachers t WHERE t.user_id = _uid LIMIT 1;

  SELECT * INTO _row FROM public.court_waitlist w
    WHERE w.desired_date = _date
      AND w.start_time = _start AND w.end_time = _end
      AND w.status IN ('waiting','notified','contacted')
      AND (
        w.user_id = _uid
        OR (_client_id IS NOT NULL AND w.client_id = _client_id)
        OR (_teacher_id IS NOT NULL AND w.teacher_id = _teacher_id)
      )
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT 1;

  IF _row.id IS NULL THEN
    RETURN jsonb_build_object('in_queue', false, 'total', _total);
  END IF;

  SELECT COUNT(*)::INT INTO _pos FROM public.court_waitlist w
    WHERE w.desired_date = _date
      AND w.start_time = _start AND w.end_time = _end
      AND w.status IN ('waiting','notified','contacted')
      AND (
        (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
          < (CASE WHEN _row.source_booking_id IS NULL THEN 0 ELSE 1 END)
        OR (
          (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
            = (CASE WHEN _row.source_booking_id IS NULL THEN 0 ELSE 1 END)
          AND (w.created_at, w.id) <= (_row.created_at, _row.id)
        )
      );

  RETURN jsonb_build_object(
    'in_queue', true,
    'id', _row.id,
    'position', _pos,
    'total', _total,
    'status', _row.status,
    'created_at', _row.created_at,
    'requested_start_time', _row.start_time,
    'requested_end_time', _row.end_time
  );
END;
$$;


--
-- Name: portal_waitlist_position_by_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_waitlist_position_by_id(_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _self_client_id uuid;
  _teacher_id uuid;
  _row public.court_waitlist%ROWTYPE;
  _pos int;
  _total int;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authenticated');
  END IF;

  SELECT * INTO _row FROM public.court_waitlist WHERE id = _id;
  IF _row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entrada não encontrada');
  END IF;

  SELECT c.id INTO _self_client_id
  FROM public.client_portal_users cpu
  JOIN public.clients c ON c.id = cpu.client_id
  WHERE cpu.user_id = _uid
  LIMIT 1;

  SELECT t.id INTO _teacher_id FROM public.teachers t WHERE t.user_id = _uid LIMIT 1;

  IF _row.user_id IS DISTINCT FROM _uid
     AND (_self_client_id IS NULL OR _row.client_id IS DISTINCT FROM _self_client_id)
     AND (_teacher_id IS NULL OR _row.teacher_id IS DISTINCT FROM _teacher_id)
     AND NOT public.has_role(_uid, 'admin')
     AND NOT public.has_role(_uid, 'diretoria')
     AND NOT public.has_role(_uid, 'recepcionista') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissão');
  END IF;

  SELECT COUNT(*)::int INTO _total
  FROM public.court_waitlist w
  WHERE w.desired_date = _row.desired_date
    AND w.start_time = _row.start_time
    AND w.end_time = _row.end_time
    AND w.status IN ('waiting','notified','contacted')
    AND w.court IS NOT DISTINCT FROM _row.court;

  SELECT COUNT(*)::int INTO _pos
  FROM public.court_waitlist w
  WHERE w.desired_date = _row.desired_date
    AND w.start_time = _row.start_time
    AND w.end_time = _row.end_time
    AND w.status IN ('waiting','notified','contacted')
    AND w.court IS NOT DISTINCT FROM _row.court
    AND (
      (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
        < (CASE WHEN _row.source_booking_id IS NULL THEN 0 ELSE 1 END)
      OR (
        (CASE WHEN w.source_booking_id IS NULL THEN 0 ELSE 1 END)
          = (CASE WHEN _row.source_booking_id IS NULL THEN 0 ELSE 1 END)
        AND (w.created_at, w.id) <= (_row.created_at, _row.id)
      )
    );

  RETURN jsonb_build_object('ok', true, 'position', _pos, 'total', _total, 'status', _row.status);
END;
$$;


--
-- Name: process_court_waitlist_releases(date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_court_waitlist_releases(_date date, _changed_start time without time zone DEFAULT NULL::time without time zone, _changed_end time without time zone DEFAULT NULL::time without time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _r RECORD;
BEGIN
  FOR _r IN
    SELECT DISTINCT w.start_time, w.end_time
      FROM public.court_waitlist w
     WHERE w.desired_date = _date
       AND w.status IN ('waiting','notified','contacted')
       AND (
         _changed_start IS NULL OR _changed_end IS NULL
         OR (w.start_time < _changed_end AND w.end_time > _changed_start)
       )
  LOOP
    PERFORM public.notify_waitlist_slot_available(_date, _r.start_time, _r.end_time);
  END LOOP;
END; $$;


--
-- Name: professor_cancel_is_late(date, time without time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_cancel_is_late(_date date, _start time without time zone, _cancelled_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT date_trunc('minute', _cancelled_at)
         > ((_date::text || ' ' || _start::text)::timestamp AT TIME ZONE 'America/Recife')
           - interval '3 hours';
$$;


--
-- Name: professor_create_direct_booking(smallint, date, integer, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _teacher_id   UUID;
  _teacher_name TEXT;
  _can_book     BOOLEAN;
  _start        TIME;
  _end          TIME;
  _category_id  UUID;
  _guest_type   public.booking_guest_type;
  _guest        TEXT;
  _inserted_id  UUID;
BEGIN
  SELECT t.id, t.name, t.can_book_directly INTO _teacher_id, _teacher_name, _can_book
  FROM public.teachers t
  WHERE t.user_id = auth.uid();

  IF _teacher_id IS NULL
     OR NOT COALESCE(_can_book, false)
     OR NOT public.has_role(auth.uid(), 'professor'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  IF _hour IS NULL OR _hour < 0 OR _hour > 23 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Horário inválido.');
  END IF;

  IF COALESCE(_for_self, false) THEN
    _client_id := NULL;
    _guest := NULL;
    _guest_type := NULL;
  ELSIF _client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _client_id AND c.teacher_id = _teacher_id
      UNION ALL
      SELECT 1 FROM public.client_teachers ct
      WHERE ct.client_id = _client_id AND ct.teacher_id = _teacher_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Este cliente não está vinculado a você.');
    END IF;
    SELECT category_id INTO _category_id FROM public.clients WHERE id = _client_id;
    _guest := NULL;
    _guest_type := NULL;
  ELSE
    _guest := NULLIF(btrim(COALESCE(_guest_name, '')), '');
    IF _guest IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Informe em nome de quem é a quadra.');
    END IF;
    _guest_type := 'convidado'::public.booking_guest_type;
  END IF;

  _start := (lpad(_hour::text, 2, '0') || ':00:00')::time;
  _end   := (lpad((_hour + 1)::text, 2, '0') || ':00:00')::time;

  BEGIN
    INSERT INTO public.court_bookings (
      court, booking_date, start_time, end_time, source,
      client_id, category_id, teacher_id, guest_name, guest_type, notes, created_by
    ) VALUES (
      _court, _date, _start, _end, 'professor',
      _client_id, _category_id, _teacher_id,
      _guest, _guest_type,
      'Reservado por Prof. ' || COALESCE(_teacher_name, 'professor') || ' direto no mapa.',
      auth.uid()
    )
    RETURNING id INTO _inserted_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Este horário acabou de ser ocupado. Atualize o mapa e tente novamente.');
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'id', _inserted_id);
END;
$$;


--
-- Name: professor_fixed_late_cancel_notice(uuid[], date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _teacher_name text;
  _s record;
  _count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'professor'::public.app_role) THEN
    RETURN 0;
  END IF;
  IF NOT public.professor_cancel_is_late(_date, _start, now()) THEN
    RETURN 0;
  END IF;

  SELECT name INTO _teacher_name FROM public.teachers WHERE user_id = auth.uid();

  FOR _s IN
    SELECT cs.id, cs.client_id, cs.court
    FROM public.client_schedules cs
    WHERE cs.id = ANY (_schedule_ids)
      AND cs.client_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.client_schedule_exceptions e
        WHERE e.client_schedule_id = cs.id
          AND e.exception_date = _date
          AND e.created_by = auth.uid()
          AND e.created_at > now() - interval '5 minutes'
      )
  LOOP
    PERFORM public._notify_professor_late_cancel(
      'fixed:' || _s.id::text || ':' || _date::text || ':' || _start::text,
      _s.client_id, _teacher_name, _s.court,
      _date, _start, _end, now(), true, NULL
    );
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;


--
-- Name: professor_late_cancel_resolve(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_late_cancel_resolve(_notification_id uuid, _outcome text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _key text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _outcome NOT IN ('charged', 'waived') THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  SELECT metadata->>'event_key' INTO _key
  FROM public.app_notifications
  WHERE id = _notification_id AND kind = 'professor_late_cancel';
  IF _key IS NULL THEN
    RAISE EXCEPTION 'Aviso não encontrado';
  END IF;

  UPDATE public.app_notifications
    SET read_at = COALESCE(read_at, now()),
        metadata = metadata || jsonb_build_object(
          'outcome', _outcome,
          'resolved_by', auth.uid(),
          'resolved_at', now()
        )
  WHERE kind = 'professor_late_cancel'
    AND metadata->>'event_key' = _key;
END;
$$;


--
-- Name: professor_partial_late_cancel_notice(uuid, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _b public.court_bookings%ROWTYPE;
  _teacher_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'professor'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO _b FROM public.court_bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.client_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.professor_cancel_is_late(_b.booking_date, _start, now()) THEN
    RETURN false;
  END IF;
  -- O trecho precisa estar livre de locação ativa desse cliente nessa quadra.
  IF EXISTS (
    SELECT 1 FROM public.court_bookings x
    WHERE x.booking_date = _b.booking_date
      AND x.court = _b.court
      AND x.client_id = _b.client_id
      AND x.cancelled_at IS NULL
      AND x.start_time < _end
      AND x.end_time > _start
  ) THEN
    RETURN false;
  END IF;

  SELECT name INTO _teacher_name FROM public.teachers WHERE user_id = auth.uid();

  PERFORM public._notify_professor_late_cancel(
    'partial:' || _b.id::text || ':' || _start::text,
    _b.client_id, _teacher_name, _b.court,
    _b.booking_date, _start, _end, now(), false, _b.id
  );
  RETURN true;
END;
$$;


--
-- Name: professor_reactivate_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_reactivate_booking(_booking_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _teacher_id uuid;
  _b public.court_bookings%ROWTYPE;
  _client_teacher_id uuid;
  _conflict_booking RECORD;
  _conflict_schedule RECORD;
BEGIN
  SELECT t.id INTO _teacher_id
  FROM public.teachers t
  WHERE t.user_id = auth.uid()
  LIMIT 1;

  IF _teacher_id IS NULL OR NOT public.has_role(auth.uid(), 'professor'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  SELECT * INTO _b
  FROM public.court_bookings
  WHERE id = _booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reserva não encontrada.');
  END IF;

  SELECT c.teacher_id INTO _client_teacher_id
  FROM public.clients c
  WHERE c.id = _b.client_id;

  IF COALESCE(_b.teacher_id, _client_teacher_id) IS DISTINCT FROM _teacher_id
     AND _client_teacher_id IS DISTINCT FROM _teacher_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Você não pode reativar esta reserva.');
  END IF;

  IF _b.cancelled_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reserva não está cancelada.');
  END IF;

  SELECT b.id, b.start_time, b.end_time INTO _conflict_booking
  FROM public.court_bookings b
  WHERE b.booking_date = _b.booking_date
    AND b.court = _b.court
    AND b.id <> _b.id
    AND b.cancelled_at IS NULL
    AND b.start_time < _b.end_time
    AND b.end_time > _b.start_time
  ORDER BY b.start_time, b.created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Quadra não está livre: existe uma reserva ativa das ' ||
        to_char(_conflict_booking.start_time, 'HH24:MI') || ' às ' ||
        to_char(_conflict_booking.end_time, 'HH24:MI') || '.',
      'conflict_type', 'booking',
      'conflict_id', _conflict_booking.id
    );
  END IF;

  SELECT s.id, s.start_time, s.end_time INTO _conflict_schedule
  FROM public.client_schedules s
  WHERE s.court = _b.court
    AND s.weekday = EXTRACT(DOW FROM _b.booking_date)::int
    AND s.start_time < _b.end_time
    AND s.end_time > _b.start_time
    AND public.client_schedule_valid_on(s.valid_from, s.valid_until, _b.booking_date)
    -- Não é conflito: é a própria recorrência semanal deste cliente que
    -- gerou a locação sendo reativada (mesmo cliente, mesma quadra/horário).
    AND NOT (
      s.client_id IS NOT DISTINCT FROM _b.client_id
      AND s.start_time = _b.start_time
      AND s.end_time = _b.end_time
    )
    AND NOT public.client_schedule_exception_covers(
      s.id, _b.booking_date,
      GREATEST(s.start_time, _b.start_time),
      LEAST(s.end_time, _b.end_time)
    )
  ORDER BY s.start_time, s.created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Quadra não está livre: existe um horário fixo ativo das ' ||
        to_char(_conflict_schedule.start_time, 'HH24:MI') || ' às ' ||
        to_char(_conflict_schedule.end_time, 'HH24:MI') || '.',
      'conflict_type', 'fixed_schedule',
      'conflict_id', _conflict_schedule.id
    );
  END IF;

  UPDATE public.court_bookings
  SET cancelled_at = NULL,
      cancelled_by = NULL,
      cancel_reason = NULL,
      updated_at = now()
  WHERE id = _b.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', _b.id);
END;
$$;


--
-- Name: professor_reactivate_fixed_occurrence(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_reactivate_fixed_occurrence(_schedule_id uuid, _occurrence_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _teacher_id uuid;
  _s RECORD;
  _conflict_booking RECORD;
  _conflict_schedule RECORD;
BEGIN
  SELECT t.id INTO _teacher_id
  FROM public.teachers t
  WHERE t.user_id = auth.uid()
  LIMIT 1;

  IF _teacher_id IS NULL OR NOT public.has_role(auth.uid(), 'professor'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  SELECT s.*, c.teacher_id AS client_teacher_id INTO _s
  FROM public.client_schedules s
  LEFT JOIN public.clients c ON c.id = s.client_id
  WHERE s.id = _schedule_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Horário fixo não encontrado.');
  END IF;

  IF _s.court IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este horário fixo não tem quadra definida.');
  END IF;

  IF _s.teacher_id IS DISTINCT FROM _teacher_id
     AND _s.client_teacher_id IS DISTINCT FROM _teacher_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Você não pode reativar este horário.');
  END IF;

  SELECT b.id, b.start_time, b.end_time INTO _conflict_booking
  FROM public.court_bookings b
  WHERE b.booking_date = _occurrence_date
    AND b.court = _s.court
    AND b.cancelled_at IS NULL
    AND b.start_time < _s.end_time
    AND b.end_time > _s.start_time
  ORDER BY b.start_time, b.created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Quadra não está livre: existe uma reserva ativa das ' ||
        to_char(_conflict_booking.start_time, 'HH24:MI') || ' às ' ||
        to_char(_conflict_booking.end_time, 'HH24:MI') || '.',
      'conflict_type', 'booking',
      'conflict_id', _conflict_booking.id
    );
  END IF;

  SELECT s2.id, s2.start_time, s2.end_time INTO _conflict_schedule
  FROM public.client_schedules s2
  WHERE s2.id <> _s.id
    AND s2.court = _s.court
    AND s2.weekday = EXTRACT(DOW FROM _occurrence_date)::int
    AND s2.start_time < _s.end_time
    AND s2.end_time > _s.start_time
    AND public.client_schedule_valid_on(s2.valid_from, s2.valid_until, _occurrence_date)
    AND NOT public.client_schedule_exception_covers(
      s2.id, _occurrence_date,
      GREATEST(s2.start_time, _s.start_time),
      LEAST(s2.end_time, _s.end_time)
    )
  ORDER BY s2.start_time, s2.created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Quadra não está livre: existe um horário fixo ativo das ' ||
        to_char(_conflict_schedule.start_time, 'HH24:MI') || ' às ' ||
        to_char(_conflict_schedule.end_time, 'HH24:MI') || '.',
      'conflict_type', 'fixed_schedule',
      'conflict_id', _conflict_schedule.id
    );
  END IF;

  -- Remove especificamente a exceção desta ocorrência (dia exato, não o
  -- período inteiro de uma exceção por range) — permanece exata de
  -- propósito, é a exceção do PRÓPRIO horário sendo reativado.
  DELETE FROM public.client_schedule_exceptions e
  WHERE e.client_schedule_id = _s.id
    AND e.exception_date = _occurrence_date
    AND (
      (e.start_time IS NULL AND e.end_time IS NULL)
      OR (
        e.start_time < _s.end_time
        AND e.end_time > _s.start_time
      )
    );

  -- Só a locação cancelada do PRÓPRIO cliente do fixo (o registro que o
  -- cancelamento pelo professor gera), e no máximo uma — nunca locações
  -- canceladas de outros clientes no mesmo slot (ex.: a avulsa do cliente
  -- novo de uma troca), que voltariam a ficar ativas junto e quebrariam
  -- o índice único court_bookings_unique_slot.
  UPDATE public.court_bookings b
  SET cancelled_at = NULL,
      cancelled_by = NULL,
      cancel_reason = NULL,
      updated_at = now()
  WHERE b.id = (
    SELECT b2.id FROM public.court_bookings b2
    WHERE b2.booking_date = _occurrence_date
      AND b2.court = _s.court
      AND b2.start_time = _s.start_time
      AND b2.end_time = _s.end_time
      AND b2.cancelled_at IS NOT NULL
      AND b2.client_id = _s.client_id
    ORDER BY b2.cancelled_at DESC
    LIMIT 1
  );

  RETURN jsonb_build_object('ok', true, 'schedule_id', _s.id, 'date', _occurrence_date);
END;
$$;


--
-- Name: professor_search_clients_for_link(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.professor_search_clients_for_link(_query text) RETURNS TABLE(id uuid, full_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.full_name
  FROM public.clients c
  WHERE public.has_role(auth.uid(), 'professor'::public.app_role)
    AND c.active
    AND length(btrim(_query)) >= 2
    AND translate(
          lower(c.full_name),
          'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
          'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
        ) LIKE '%' || translate(
          lower(btrim(_query)),
          'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
          'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
        ) || '%'
  ORDER BY c.full_name
  LIMIT 20;
$$;


--
-- Name: recife_month_end(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recife_month_end(_d date DEFAULT NULL::date) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT (date_trunc('month', COALESCE(_d, public.recife_today())) + INTERVAL '1 month - 1 day')::date;
$$;


--
-- Name: recife_today(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recife_today() RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT (now() AT TIME ZONE 'America/Recife')::date;
$$;


--
-- Name: recife_week_start(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recife_week_start(_d date DEFAULT NULL::date) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT date_trunc('week', COALESCE(_d, public.recife_today()))::date;
$$;


--
-- Name: reject_client_change_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_client_change_request(_request_id uuid, _reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretoria')
    OR public.has_role(auth.uid(), 'recepcionista')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  UPDATE public.teacher_client_change_requests
     SET status = 'recusada',
         review_notes = _reason,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = _request_id AND status = 'pendente';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada ou já processada.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: reject_client_teacher_link_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_client_teacher_link_request(_request_id uuid, _reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _r public.client_teacher_link_requests%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT * INTO _r FROM public.client_teacher_link_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada.');
  END IF;
  IF _r.status <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação já foi analisada.');
  END IF;

  UPDATE public.client_teacher_link_requests
    SET status = 'recusada', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = _reason
    WHERE id = _request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: request_court_booking_hold(integer, date, time without time zone, time without time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_court_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _label text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _booking_id uuid;
  _label_clean text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF _court < 1 OR _court > 9 THEN
    RAISE EXCEPTION 'Quadra inválida';
  END IF;
  IF _end <= _start THEN
    RAISE EXCEPTION 'Horário inválido';
  END IF;
  IF _date < public.recife_today() THEN
    RAISE EXCEPTION 'Data inválida';
  END IF;

  IF public.portal_slot_has_active_fixed_conflict(_court, _date, _start, _end) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este horário já está ocupado por uma locação fixa.');
  END IF;

  _label_clean := btrim(coalesce(_label, ''));
  IF _label_clean = '' THEN
    _label_clean := 'Solicitação via WhatsApp';
  END IF;

  BEGIN
    INSERT INTO public.court_bookings (
      court, booking_date, start_time, end_time, source, guest_type, guest_name,
      hold_expires_at, created_by
    ) VALUES (
      _court::smallint, _date, _start, _end, 'avulsa'::booking_source, 'convidado'::booking_guest_type,
      'PRÉ-RESERVA — ' || _label_clean || ' (aguardando confirmação)',
      now() + interval '7 minutes', auth.uid()
    )
    RETURNING id INTO _booking_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'id', _booking_id);
END;
$$;


--
-- Name: resolve_portal_email_by_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_portal_email_by_phone(_phone text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT cpu.email
  FROM public.client_portal_users cpu
  JOIN public.clients c ON c.id = cpu.client_id
  WHERE c.phone IS NOT NULL
    AND cpu.email IS NOT NULL
    AND (
      CASE
        WHEN length(regexp_replace(c.phone, '\D', '', 'g')) >= 12
             AND left(regexp_replace(c.phone, '\D', '', 'g'), 2) = '55'
        THEN '+55' || substring(regexp_replace(c.phone, '\D', '', 'g') from 3)
        ELSE '+55' || regexp_replace(c.phone, '\D', '', 'g')
      END
    ) = _phone
  LIMIT 1;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;


--
-- Name: staff_confirm_waitlist_booking(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_confirm_waitlist_booking(_waitlist_id uuid, _booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _w RECORD;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'sem permissao';
  END IF;
  SELECT * INTO _w FROM public.court_waitlist WHERE id = _waitlist_id;
  IF _w.id IS NULL THEN RAISE EXCEPTION 'entrada nao encontrada'; END IF;

  UPDATE public.court_waitlist
    SET status = 'confirmed'::public.waitlist_status,
        confirmed_at = now(),
        booking_id_created = _booking_id,
        resulting_booking_id = _booking_id,
        updated_at = now()
    WHERE id = _waitlist_id;

  WITH rest AS (
    UPDATE public.court_waitlist
      SET status = 'expired'::public.waitlist_status, updated_at = now()
      WHERE desired_date = _w.desired_date AND court = _w.court
        AND start_time = _w.start_time AND end_time = _w.end_time
        AND id <> _waitlist_id
        AND status IN ('waiting','notified','contacted')
      RETURNING id, client_id, teacher_id
  )
  INSERT INTO public.app_notifications (kind, client_id, title, body, requires_ack, metadata)
  SELECT
    'waitlist_slot_filled', r.client_id, 'Vaga preenchida',
    'A vaga deste horário foi preenchida. Sua solicitação foi encerrada.', false,
    jsonb_build_object('waitlist_id', r.id, 'teacher_id', r.teacher_id,
      'date', _w.desired_date, 'start_time', _w.start_time::text,
      'end_time', _w.end_time::text, 'court', _w.court)
  FROM rest r;
END; $$;


--
-- Name: staff_create_client_for_pending_signup(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_create_client_for_pending_signup(_pending_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row public.pending_client_signups%ROWTYPE;
  _client_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT * INTO _row FROM public.pending_client_signups WHERE id = _pending_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pendência não encontrada ou já resolvida.');
  END IF;

  INSERT INTO public.clients (full_name, email, phone, active)
  VALUES (_row.full_name, _row.email, _row.phone, true)
  RETURNING id INTO _client_id;

  INSERT INTO public.client_portal_users (user_id, client_id, email)
  VALUES (_row.user_id, _client_id, _row.email);

  UPDATE public.pending_client_signups
  SET status = 'created', resolved_client_id = _client_id, resolved_by = auth.uid(), resolved_at = now()
  WHERE id = _pending_id;

  RETURN jsonb_build_object('ok', true, 'client_id', _client_id);
END;
$$;


--
-- Name: staff_get_waitlist_counts_for_date(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_get_waitlist_counts_for_date(_date date) RETURNS TABLE(court integer, start_time time without time zone, end_time time without time zone, cnt integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NULL::int AS court, w.start_time, w.end_time, COUNT(*)::int
    FROM public.court_waitlist w
   WHERE (
     public.has_role(auth.uid(),'admin'::public.app_role)
     OR public.has_role(auth.uid(),'diretoria'::public.app_role)
     OR public.has_role(auth.uid(),'recepcionista'::public.app_role)
   )
   AND w.desired_date = _date
   AND w.status IN ('waiting','notified','contacted')
   GROUP BY w.start_time, w.end_time;
$$;


--
-- Name: staff_get_waitlist_for_slot(date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_get_waitlist_for_slot(_date date, _start time without time zone, _end time without time zone) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(),'admin'::public.app_role)
              OR public.has_role(auth.uid(),'diretoria'::public.app_role)
              OR public.has_role(auth.uid(),'recepcionista'::public.app_role)
  ), q AS (
    SELECT w.*,
      row_number() OVER (
        PARTITION BY w.start_time, w.end_time
        ORDER BY w.created_at ASC, w.id ASC
      ) AS position,
      c.full_name AS client_name,
      c.phone AS client_phone,
      t.name AS teacher_name
    FROM public.court_waitlist w
    LEFT JOIN public.clients c ON c.id = w.client_id
    LEFT JOIN public.teachers t ON t.id = w.teacher_id
    WHERE EXISTS (SELECT 1 FROM gate)
      AND w.desired_date = _date
      AND w.start_time < _end
      AND w.end_time   > _start
      AND w.status IN ('waiting','notified','contacted')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.start_time, x.end_time, x.position), '[]'::jsonb) FROM (
    SELECT
      q.id, q.position, q.status, q.created_at,
      q.start_time, q.end_time,
      q.client_id, q.client_name, q.client_phone,
      q.teacher_id, q.teacher_name, q.guest_name, q.notes,
      q.court_continuity, q.availability_plan,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', a.user_id,
          'actor_name', a.actor_name,
          'acknowledged_at', a.acknowledged_at
        ) ORDER BY a.acknowledged_at)
        FROM public.waitlist_acknowledgements a
        WHERE a.waitlist_id = q.id
      ), '[]'::jsonb) AS acknowledgements
    FROM q
  ) x;
$$;


--
-- Name: staff_link_pending_client_signup(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_link_pending_client_signup(_pending_id uuid, _client_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row public.pending_client_signups%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT * INTO _row FROM public.pending_client_signups WHERE id = _pending_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pendência não encontrada ou já resolvida.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cliente não encontrado.');
  END IF;

  BEGIN
    INSERT INTO public.client_portal_users (user_id, client_id, email)
    VALUES (_row.user_id, _client_id, _row.email);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este acesso já está vinculado a este cliente.');
  END;

  UPDATE public.pending_client_signups
  SET status = 'linked', resolved_client_id = _client_id, resolved_by = auth.uid(), resolved_at = now()
  WHERE id = _pending_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: staff_mark_waitlist_contacted(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_mark_waitlist_contacted(_waitlist_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'sem permissao';
  END IF;
  UPDATE public.court_waitlist
    SET status = 'contacted'::public.waitlist_status,
        contacted_at = now(), updated_at = now()
    WHERE id = _waitlist_id;
END; $$;


--
-- Name: staff_search_clients_for_signup_match(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_search_clients_for_signup_match(_query text) RETURNS TABLE(id uuid, full_name text, email text, phone text, active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.full_name, c.email, c.phone, c.active
  FROM public.clients c
  WHERE (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  )
  AND length(btrim(_query)) >= 2
  AND translate(
        lower(c.full_name),
        'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
        'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
      ) LIKE '%' || translate(
        lower(btrim(_query)),
        'áàâãäåāăąéèêëēĕėęěíìîïīĭįóòôõöøōŏőúùûüūŭůűųçćčĉċñńňņṅÿýŷ',
        'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuucccccnnnnnyyy'
      ) || '%'
  ORDER BY c.full_name
  LIMIT 20;
$$;


--
-- Name: staff_skip_waitlist_entry(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_skip_waitlist_entry(_waitlist_id uuid, _reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _w RECORD;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'sem permissao';
  END IF;
  SELECT * INTO _w FROM public.court_waitlist WHERE id = _waitlist_id;
  IF _w.id IS NULL THEN RAISE EXCEPTION 'entrada nao encontrada'; END IF;

  UPDATE public.court_waitlist
    SET status = 'expired'::public.waitlist_status,
        cancel_reason = COALESCE(_reason,'Não confirmou'), updated_at = now()
    WHERE id = _waitlist_id;

  PERFORM public.notify_waitlist_slot_available(_w.desired_date, _w.start_time, _w.end_time);
END; $$;


--
-- Name: swap_booking_courts(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.swap_booking_courts(_booking_id_a uuid, _booking_id_b uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _a public.court_bookings%ROWTYPE;
  _b public.court_bookings%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretoria')
    OR public.has_role(auth.uid(), 'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF _booking_id_a = _booking_id_b THEN
    RAISE EXCEPTION 'Selecione duas locações diferentes';
  END IF;

  SELECT * INTO _a FROM public.court_bookings WHERE id = _booking_id_a;
  SELECT * INTO _b FROM public.court_bookings WHERE id = _booking_id_b;

  IF _a.id IS NULL OR _b.id IS NULL THEN
    RAISE EXCEPTION 'Locação não encontrada';
  END IF;
  IF _a.cancelled_at IS NOT NULL OR _b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Uma das locações já está cancelada';
  END IF;
  IF _a.booking_date <> _b.booking_date OR _a.start_time <> _b.start_time OR _a.end_time <> _b.end_time THEN
    RAISE EXCEPTION 'As duas locações precisam ser do mesmo dia e horário';
  END IF;
  IF _a.court = _b.court THEN
    RAISE EXCEPTION 'As duas locações já estão na mesma quadra';
  END IF;

  UPDATE public.court_bookings SET court = _b.court WHERE id = _a.id;
  UPDATE public.court_bookings SET court = _a.court WHERE id = _b.id;
END;
$$;


--
-- Name: teacher_agenda_range(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_agenda_range(_start_date date, _end_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH my_teacher AS (
    SELECT id FROM public.teachers WHERE user_id = auth.uid()
  ),
  gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'professor'::public.app_role)
      AND EXISTS (SELECT 1 FROM my_teacher)
  ),
  days AS (
    SELECT d::date AS the_date, EXTRACT(DOW FROM d)::int AS weekday
    FROM generate_series(_start_date, _end_date, INTERVAL '1 day') AS d
    WHERE EXISTS (SELECT 1 FROM gate)
  ),
  fixed_occurrences AS (
    SELECT
      s.id AS schedule_id,
      -- Prefer a matching booking id (active or cancelled) so Reativar has a target
      (
        SELECT b.id FROM public.court_bookings b
        WHERE b.booking_date = d.the_date
          AND b.court = s.court
          AND b.start_time = s.start_time
          AND b.end_time = s.end_time
        ORDER BY (b.client_id IS NOT DISTINCT FROM s.client_id) DESC,
                 (b.cancelled_at IS NULL) DESC, b.created_at DESC
        LIMIT 1
      ) AS booking_id,
      'fixed'::text AS kind,
      d.the_date AS the_date,
      s.court,
      s.start_time,
      s.end_time,
      s.client_id,
      c.full_name AS client_name,
      NULL::text AS guest_name,
      public.client_schedule_exception_covers(s.id, d.the_date, s.start_time, s.end_time)
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.court_bookings b
          WHERE b.booking_date = d.the_date
            AND b.court = s.court
            AND b.start_time = s.start_time
            AND b.end_time = s.end_time
            AND b.cancelled_at IS NULL
            AND b.client_id = s.client_id
        )
        AND EXISTS (
          SELECT 1 FROM public.court_bookings b
          WHERE b.booking_date = d.the_date
            AND b.court = s.court
            AND b.start_time = s.start_time
            AND b.end_time = s.end_time
            AND b.cancelled_at IS NOT NULL
            AND b.client_id = s.client_id
        )
      ) AS cancelled,
      NULL::timestamptz AS cancelled_at
    FROM public.client_schedules s
    JOIN days d ON d.weekday = s.weekday
    LEFT JOIN public.clients c ON c.id = s.client_id
    WHERE (s.teacher_id IN (SELECT id FROM my_teacher)
       OR c.teacher_id IN (SELECT id FROM my_teacher))
      AND public.client_schedule_valid_on(s.valid_from, s.valid_until, d.the_date)
  ),
  bookings AS (
    SELECT
      NULL::uuid AS schedule_id,
      b.id AS booking_id,
      'booking'::text AS kind,
      b.booking_date AS the_date,
      b.court,
      b.start_time,
      b.end_time,
      b.client_id,
      c.full_name AS client_name,
      b.guest_name,
      (b.cancelled_at IS NOT NULL) AS cancelled,
      b.cancelled_at
    FROM public.court_bookings b
    LEFT JOIN public.clients c ON c.id = b.client_id
    WHERE b.booking_date BETWEEN _start_date AND _end_date
      AND (
        b.teacher_id IN (SELECT id FROM my_teacher)
        OR c.teacher_id IN (SELECT id FROM my_teacher)
      )
      AND EXISTS (SELECT 1 FROM gate)
      -- Exclude bookings that are the persisted state of a fixed schedule occurrence
      AND NOT EXISTS (
        SELECT 1 FROM public.client_schedules s
        JOIN days d ON d.weekday = s.weekday
        WHERE d.the_date = b.booking_date
          AND s.court = b.court
          AND s.start_time = b.start_time
          AND s.end_time = b.end_time
          AND s.client_id = b.client_id
          AND public.client_schedule_valid_on(s.valid_from, s.valid_until, b.booking_date)
      )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.the_date, x.start_time, x.court), '[]'::jsonb)
  FROM (
    SELECT * FROM fixed_occurrences
    UNION ALL
    SELECT * FROM bookings
  ) x;
$$;


--
-- Name: teacher_client_change_requests_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_client_change_requests_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  s public.client_schedules%ROWTYPE;
  b public.court_bookings%ROWTYPE;
  v_teacher_name text;
BEGIN
  -- Pedido criado por quem não é da equipe sempre nasce pendente (a policy
  -- de INSERT não restringe status; sem isto o professor poderia gravar um
  -- pedido já "aprovado").
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretoria')
    OR public.has_role(auth.uid(), 'recepcionista')
  ) THEN
    NEW.status := 'pendente';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_notes := NULL;
  END IF;

  IF NEW.status <> 'pendente'
     OR NEW.new_client_id IS NULL
     OR NEW.current_client_id IS NULL
     OR NEW.new_client_id = NEW.current_client_id THEN
    RETURN NEW;
  END IF;

  -- Só quando quem pede é o próprio professor da aula.
  IF NOT EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.id = NEW.teacher_id AND t.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT (public._client_belongs_to_teacher(NEW.current_client_id, NEW.teacher_id)
          AND public._client_belongs_to_teacher(NEW.new_client_id, NEW.teacher_id)) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.new_client_id AND c.active) THEN
    RETURN NEW;
  END IF;

  IF NEW.occurrence_date < (now() AT TIME ZONE 'America/Recife')::date THEN
    RETURN NEW;
  END IF;

  -- Os dados do pedido vêm do app do professor: confere contra o fixo /
  -- a locação real antes de aplicar qualquer coisa sozinho.
  IF NEW.booking_id IS NULL AND NEW.schedule_id IS NOT NULL THEN
    SELECT * INTO s FROM public.client_schedules WHERE id = NEW.schedule_id;
    IF NOT FOUND
       OR (s.teacher_id IS NOT NULL AND s.teacher_id <> NEW.teacher_id)
       OR s.client_id <> NEW.current_client_id
       OR s.court IS DISTINCT FROM NEW.court
       OR s.start_time <> NEW.start_time
       OR s.end_time <> NEW.end_time
       OR s.weekday <> EXTRACT(DOW FROM NEW.occurrence_date)::int
       OR NOT public.client_schedule_valid_on(s.valid_from, s.valid_until, NEW.occurrence_date)
       OR public.client_schedule_exception_covers(s.id, NEW.occurrence_date, s.start_time, s.end_time)
       OR EXISTS (SELECT 1 FROM public._client_change_slot_occupant(NEW.court, NEW.occurrence_date, NEW.start_time)) THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.booking_id IS NOT NULL THEN
    SELECT * INTO b FROM public.court_bookings WHERE id = NEW.booking_id;
    IF NOT FOUND
       OR b.cancelled_at IS NOT NULL
       OR (b.teacher_id IS NOT NULL AND b.teacher_id <> NEW.teacher_id)
       OR b.client_id IS DISTINCT FROM NEW.current_client_id
       OR b.booking_date <> NEW.occurrence_date THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public._apply_client_change_request(NEW);
    NEW.status := 'aprovada';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := now();
    NEW.review_notes := 'Aprovada automaticamente: os dois clientes são do professor.';

    -- Aviso (pop-up com OK) pra recepção/diretoria: a troca não passou por
    -- elas, e o cancelamento do fixo daquele dia não pode parecer
    -- cancelamento de aula.
    SELECT t.name INTO v_teacher_name FROM public.teachers t WHERE t.id = NEW.teacher_id;
    INSERT INTO public.app_notifications
      (kind, client_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'court_swap_by_teacher',
      NEW.current_client_id,
      'Professor trocou o cliente de uma aula',
      format('Prof. %s trocou %s por %s — Quadra %s, %s–%s (%s).',
             COALESCE(v_teacher_name, 'professor'),
             COALESCE(NEW.current_client_name, 'cliente'),
             NEW.new_client_name,
             NEW.court,
             to_char(NEW.start_time, 'HH24:MI'),
             to_char(NEW.end_time, 'HH24:MI'),
             to_char(NEW.occurrence_date, 'DD/MM/YYYY')),
      true,
      jsonb_build_object(
        'request_id', NEW.id,
        'teacher_id', NEW.teacher_id,
        'current_client_id', NEW.current_client_id,
        'new_client_id', NEW.new_client_id,
        'date', NEW.occurrence_date,
        'court', NEW.court,
        'start_time', NEW.start_time,
        'end_time', NEW.end_time
      ),
      'court_swap_by_teacher:' || NEW.id
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Qualquer bloqueio (pré-reserva no slot,
    -- etc.): desfaz o que foi aplicado e deixa o pedido pendente pra
    -- recepção decidir, como antes.
    NULL;
  END;

  RETURN NEW;
END;
$$;


--
-- Name: teacher_map_bookings(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_map_bookings(_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH my_teacher AS (
    SELECT id FROM public.teachers WHERE user_id = auth.uid()
  ),
  my_students AS (
    SELECT DISTINCT cs.client_id
      FROM public.client_schedules cs
      WHERE cs.teacher_id IN (SELECT id FROM my_teacher)
    UNION
    SELECT c.id
      FROM public.clients c
      WHERE c.teacher_id IN (SELECT id FROM my_teacher)
  ),
  gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'professor'::public.app_role)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      b.id, b.court, b.booking_date, b.start_time, b.end_time, b.source,
      b.cancelled_at,
      (
        (b.teacher_id IN (SELECT id FROM my_teacher))
        OR (b.client_id IN (SELECT client_id FROM my_students))
      ) AS is_own,
      b.client_id,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'full_name', c.full_name) END AS clients,
      b.teacher_id,
      CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'name', t.name) END AS teachers,
      b.guest_type,
      b.guest_name,
      CASE WHEN (b.teacher_id IN (SELECT id FROM my_teacher))
             OR (b.client_id IN (SELECT client_id FROM my_students))
           THEN b.notes END AS notes,
      CASE WHEN (b.teacher_id IN (SELECT id FROM my_teacher))
             OR (b.client_id IN (SELECT client_id FROM my_students))
           THEN b.cancel_reason END AS cancel_reason,
      b.category_id
    FROM public.court_bookings b
    LEFT JOIN public.clients c ON c.id = b.client_id
    LEFT JOIN public.teachers t ON t.id = b.teacher_id
    WHERE b.booking_date = _date
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: teacher_map_schedule_exceptions(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_map_schedule_exceptions(_date date, _weekday integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH my_teacher AS (
    SELECT id FROM public.teachers WHERE user_id = auth.uid()
  ),
  gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'professor'::public.app_role)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      e.id, e.client_schedule_id, e.exception_date, e.range_end, e.start_time, e.end_time,
      ((s.teacher_id IN (SELECT id FROM my_teacher))
        OR (c.teacher_id IN (SELECT id FROM my_teacher))) AS is_own,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN e.reason END AS reason
    FROM public.client_schedule_exceptions e
    JOIN public.client_schedules s ON s.id = e.client_schedule_id
    LEFT JOIN public.clients c ON c.id = s.client_id
    WHERE e.exception_date <= _date
      AND COALESCE(e.range_end, e.exception_date) >= _date
      AND s.weekday = _weekday
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: teacher_map_schedules(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_map_schedules(_weekday integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH my_teacher AS (
    SELECT id FROM public.teachers WHERE user_id = auth.uid()
  ),
  gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'professor'::public.app_role)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      s.id, s.weekday, s.start_time, s.end_time, s.court,
      (
        (s.teacher_id IN (SELECT id FROM my_teacher))
        OR (c.teacher_id IN (SELECT id FROM my_teacher))
      ) AS is_own,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN s.client_id END AS client_id,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN jsonb_build_object('id', c.id, 'full_name', c.full_name)
      END AS clients,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN s.teacher_id END AS teacher_id,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN jsonb_build_object('id', t.id, 'name', t.name)
      END AS teachers,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN s.notes END AS notes
    FROM public.client_schedules s
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.teachers t ON t.id = s.teacher_id
    WHERE s.weekday = _weekday
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;



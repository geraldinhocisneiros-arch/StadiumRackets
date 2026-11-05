-- Stadium Rackets — schema inicial (baseline)
-- Gerado a partir do sistema do Squash Tennis Center, sem boleiro, Clube do Tênis/
-- Mini Clube/benefício DBT, liberações de pagamento, anexos, reuniões, placares,
-- manutenção de quadra e Quadra 10. Quadras: 1 = Tênis (saibro), 2-4 = Pickleball.

--
-- PostgreSQL database dump
--



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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--




--
-- Name: account_entry_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_entry_type AS ENUM (
    'debito',
    'credito'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'recepcionista',
    'diretoria',
    'professor',
    'limpeza',
    'visualizador'
);


--
-- Name: booking_guest_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_guest_type AS ENUM (
    'convidado',
    'batedor'
);


--
-- Name: booking_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_source AS ENUM (
    'avulsa',
    'professor'
);


--
-- Name: charge_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.charge_status AS ENUM (
    'aberta',
    'paga',
    'atrasada',
    'cancelada'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'dinheiro',
    'pix',
    'debito',
    'credito',
    'transferencia',
    'outro',
    'conta_corrente',
    'letzplay_pix',
    'letzplay_cartao',
    'mercadopago_pix',
    'mercadopago_cartao',
    'rede_itau',
    'mercadopago'
);


--
-- Name: stock_movement_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_movement_type AS ENUM (
    'entrada',
    'saida',
    'ajuste'
);


--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_priority AS ENUM (
    'baixa',
    'media',
    'alta'
);


--
-- Name: task_recurrence; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_recurrence AS ENUM (
    'none',
    'daily',
    'weekly',
    'monthly'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'pendente',
    'em_andamento',
    'concluida',
    'cancelada'
);


--
-- Name: waitlist_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waitlist_status AS ENUM (
    'waiting',
    'awaiting_confirmation',
    'fulfilled',
    'declined',
    'cancelled',
    'notified',
    'contacted',
    'confirmed',
    'expired'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: teacher_client_change_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_client_change_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    booking_id uuid,
    schedule_id uuid,
    occurrence_date date NOT NULL,
    court integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    current_client_id uuid,
    current_client_name text,
    new_client_id uuid,
    new_client_name text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    review_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_client_change_requests_check CHECK (((booking_id IS NOT NULL) OR (schedule_id IS NOT NULL))),
    CONSTRAINT teacher_client_change_requests_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovada'::text, 'recusada'::text, 'cancelada'::text])))
);


--
-- Stadium Rackets — quadras
--   1 = Tênis (saibro) · 2 = Pickleball 1 · 3 = Pickleball 2 · 4 = Pickleball 3
-- Nas filas de espera, court = 0 significa "qualquer quadra de pickleball".
--

CREATE FUNCTION public._court_short(_court integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN _court IS NULL THEN NULL
    WHEN _court = 1 THEN 'Tênis'
    WHEN _court BETWEEN 2 AND 4 THEN 'PB' || (_court - 1)
    ELSE 'Q' || _court
  END
$$;

COMMENT ON FUNCTION public._court_short(integer) IS 'Nome curto da quadra: 1 = Tênis, 2..4 = PB1..PB3 (Stadium Rackets).';


--
-- Name: _apply_client_change_request(public.teacher_client_change_requests); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._apply_client_change_request(r public.teacher_client_change_requests) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_new_booking_id UUID;
  v_category_id UUID;
  v_teacher_name TEXT;
BEGIN
  -- Marca a transação como "troca de cliente" (só vale até o fim dela):
  -- ver app_notifications_skip_cancel_during_swap abaixo.
  PERFORM set_config('app.client_change_swap', '1', true);

  IF r.booking_id IS NOT NULL THEN
    UPDATE public.court_bookings
       SET client_id = r.new_client_id,
           guest_name = CASE WHEN r.new_client_id IS NULL THEN r.new_client_name ELSE NULL END,
           guest_type = CASE WHEN r.new_client_id IS NULL THEN COALESCE(guest_type, 'convidado'::booking_guest_type) ELSE guest_type END
     WHERE id = r.booking_id;
  ELSIF r.schedule_id IS NOT NULL THEN
    IF r.new_client_id IS NOT NULL THEN
      SELECT category_id INTO v_category_id FROM public.clients WHERE id = r.new_client_id;
    END IF;
    SELECT name INTO v_teacher_name FROM public.teachers WHERE id = r.teacher_id;

    -- Locação avulsa (NÃO usar notes "Movido do fixo…": ver item 3 do
    -- cabeçalho).
    INSERT INTO public.court_bookings
      (court, booking_date, start_time, end_time, source, client_id,
       category_id, teacher_id, guest_type, guest_name, notes, created_by)
    VALUES
      (r.court, r.occurrence_date, r.start_time, r.end_time,
       'avulsa', r.new_client_id, v_category_id, r.teacher_id,
       CASE WHEN r.new_client_id IS NULL THEN 'convidado'::booking_guest_type ELSE NULL END,
       CASE WHEN r.new_client_id IS NULL THEN r.new_client_name ELSE NULL END,
       format('Troca de cliente: no lugar do fixo de %s (Prof. %s).',
              COALESCE(r.current_client_name, 'cliente'),
              COALESCE(v_teacher_name, 'professor')),
       auth.uid())
    RETURNING id INTO v_new_booking_id;

    -- Exceção do fixo SÓ depois da locação nova: o trigger de lista de
    -- espera em client_schedule_exceptions avisaria "vaga disponível" se
    -- visse o horário livre nem que fosse por um instante.
    INSERT INTO public.client_schedule_exceptions
      (client_schedule_id, exception_date, start_time, end_time, reason, created_by)
    VALUES
      (r.schedule_id, r.occurrence_date, r.start_time, r.end_time,
       'Troca de cliente aprovada', auth.uid());
  END IF;
  RETURN v_new_booking_id;
END;
$$;


--
-- Name: _client_belongs_to_teacher(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._client_belongs_to_teacher(_client_id uuid, _teacher_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = _client_id AND c.teacher_id = _teacher_id
  ) OR EXISTS (
    SELECT 1 FROM public.client_teachers ct
    WHERE ct.client_id = _client_id AND ct.teacher_id = _teacher_id
  );
$$;


--
-- Name: _client_change_slot_occupant(integer, date, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._client_change_slot_occupant(_court integer, _date date, _start time without time zone) RETURNS TABLE(booking_id uuid, client_id uuid, occupant_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT cb.id, cb.client_id, COALESCE(c.full_name, cb.guest_name, 'outra locação')
  FROM public.court_bookings cb
  LEFT JOIN public.clients c ON c.id = cb.client_id
  WHERE cb.court = _court
    AND cb.booking_date = _date
    AND cb.start_time = _start
    AND cb.cancelled_at IS NULL
    AND (cb.hold_expires_at IS NULL OR cb.hold_expires_at > now())
  LIMIT 1;
$$;


--
-- Name: _client_remaining_sessions_amount(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._client_remaining_sessions_amount(_client_id uuid, _range_start date DEFAULT NULL::date, _range_end date DEFAULT NULL::date) RETURNS TABLE(session_count integer, session_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
      AND (cs.valid_from IS NULL OR cs.valid_from <= _end)
      AND (cs.valid_until IS NULL OR cs.valid_until >= _start)
  LOOP
    -- Primeira ocorrência a partir de _start (inclusive). Quando _start é
    -- "hoje + 1" (janela padrão do mês atual), isso equivale a "estritamente
    -- após hoje" — a mesma regra de sempre, só expressa em termos da janela.
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
$$;


--
-- Name: _cobranca_is_staff(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._cobranca_is_staff(_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'diretoria'::public.app_role)
      OR public.has_role(_uid, 'recepcionista'::public.app_role);
$$;


--
-- Name: _court_label(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._court_label(_court integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT 'Q' || _court || ' (' || public._court_short(_court) || ')'
$$;


--
-- Name: _debt_limit_add_exception_internal(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._debt_limit_add_exception_internal(_client_id uuid, _reason text, _actor uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _id UUID;
  _alert_id UUID;
BEGIN
  INSERT INTO public.debt_limit_exceptions (client_id, reason, created_by)
  VALUES (_client_id, _reason, _actor)
  RETURNING id INTO _id;

  UPDATE public.debt_limit_alerts
    SET status = 'resolved', resolved_by = _actor, resolved_at = now(),
        resolved_note = 'Encerrado automaticamente — cliente passou a ter exceção do limite de débito.'
    WHERE client_id = _client_id AND status = 'active'
    RETURNING id INTO _alert_id;

  IF _alert_id IS NOT NULL THEN
    INSERT INTO public.debt_limit_alert_events (alert_id, event_type, actor, note)
    VALUES (_alert_id, 'resolved', _actor, 'Encerrado automaticamente — exceção adicionada.');
  END IF;

  RETURN _id;
END;
$$;


--
-- Name: _fixed_court_free(smallint, smallint, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._fixed_court_free(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.client_schedules cs
    WHERE cs.court = _court
      AND cs.weekday = _weekday
      AND cs.is_demo = false
      AND cs.start_time < _end AND cs.end_time > _start
      AND (cs.valid_until IS NULL OR cs.valid_until >= public.recife_today())
  );
$$;


--
-- Name: _fixed_is_off_today(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._fixed_is_off_today(_schedule_id uuid, _date date) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_schedule_exceptions e
    JOIN public.client_schedules s ON s.id = e.client_schedule_id
    WHERE e.client_schedule_id = _schedule_id
      AND e.exception_date <= _date
      AND (e.range_end >= _date OR (e.range_end IS NULL AND e.exception_date = _date))
      AND (
        e.start_time IS NULL OR e.end_time IS NULL
        OR (e.start_time < s.end_time AND e.end_time > s.start_time)
      )
  )
$$;


--
-- Name: _fixed_waitlist_accepts(smallint, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._fixed_waitlist_accepts(_pref smallint, _court smallint) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  -- NULL = qualquer; 0 = qualquer quadra de pickleball (2 a 4); >0 = aquela quadra.
  SELECT _pref IS NULL OR (_pref = 0 AND _court BETWEEN 2 AND 4) OR _court = _pref;
$$;


--
-- Name: _fixed_waitlist_free_matches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._fixed_waitlist_free_matches() RETURNS TABLE(entry_id uuid, person_name text, desired_weekday smallint, start_time time without time zone, end_time time without time zone, pref smallint, free_courts smallint[], called boolean, slot_free smallint[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _slot RECORD;
  _w RECORD;
  _free SMALLINT[];
  _left SMALLINT[];
  _acc SMALLINT[];
  _seen TEXT[];
  _ids UUID[];
  _prefs SMALLINT[];
  _called UUID[];
  _picks SMALLINT[];
  _pick SMALLINT;
  _n INT;
  _i INT;
BEGIN
  FOR _slot IN
    SELECT DISTINCT w.desired_weekday AS wd, w.start_time AS st, w.end_time AS et
    FROM public.fixed_court_waitlist w
    WHERE w.status IN ('waiting','notified','contacted')
  LOOP
    _free := ARRAY[]::SMALLINT[];
    FOR _pick IN SELECT generate_series(1, 4)::SMALLINT LOOP
      IF public._fixed_court_free(_pick, _slot.wd, _slot.st, _slot.et) THEN
        _free := _free || _pick;
      END IF;
    END LOOP;
    CONTINUE WHEN cardinality(_free) = 0;

    -- Fila do horário: uma inscrição por pessoa, a mais antiga que aceita
    -- alguma das quadras livres (quem tem "Pickleball" e "Qualquer" no mesmo
    -- horário entra pela que serve).
    _seen := ARRAY[]::TEXT[];
    _ids := ARRAY[]::UUID[];
    _prefs := ARRAY[]::SMALLINT[];
    FOR _w IN
      SELECT w.id, w.client_id, w.court
      FROM public.fixed_court_waitlist w
      WHERE w.desired_weekday = _slot.wd AND w.start_time = _slot.st AND w.end_time = _slot.et
        AND w.status IN ('waiting','notified','contacted')
      ORDER BY w.created_at, w.id
    LOOP
      CONTINUE WHEN COALESCE(_w.client_id::text, _w.id::text) = ANY(_seen);
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM unnest(_free) f WHERE public._fixed_waitlist_accepts(_w.court, f)
      );
      _seen := _seen || COALESCE(_w.client_id::text, _w.id::text);
      _ids := _ids || _w.id;
      _prefs := _prefs || _w.court;
    END LOOP;

    -- Distribui: na ordem de chegada, cada um fica com a quadra que ainda
    -- sobra e que menos gente atrás dele aceita.
    _left := _free;
    _called := ARRAY[]::UUID[];
    _picks := ARRAY[]::SMALLINT[];
    _n := cardinality(_ids);
    FOR _i IN 1.._n LOOP
      EXIT WHEN cardinality(_left) = 0;
      SELECT f INTO _pick
      FROM unnest(_left) f
      WHERE public._fixed_waitlist_accepts(_prefs[_i], f)
      ORDER BY (
        SELECT count(*) FROM generate_series(_i + 1, _n) j
        WHERE public._fixed_waitlist_accepts(_prefs[j], f)
      ), f
      LIMIT 1;
      CONTINUE WHEN _pick IS NULL;
      _left := array_remove(_left, _pick);
      _called := _called || _ids[_i];
      _picks := _picks || _pick;
    END LOOP;

    -- Devolve quem está na fila desse horário (Aguardando, Avisado ou
    -- Contatado), chamado ou não.
    _seen := ARRAY[]::TEXT[];
    FOR _w IN
      SELECT w.*, c.full_name
      FROM public.fixed_court_waitlist w
      LEFT JOIN public.clients c ON c.id = w.client_id
      WHERE w.desired_weekday = _slot.wd AND w.start_time = _slot.st AND w.end_time = _slot.et
        AND w.status IN ('waiting','notified','contacted')
      ORDER BY (w.id = ANY(_called)) DESC, w.created_at, w.id
    LOOP
      -- A mesma pessoa aparece uma vez: pela inscrição chamada, se houver.
      CONTINUE WHEN COALESCE(_w.client_id::text, _w.id::text) = ANY(_seen);
      _seen := _seen || COALESCE(_w.client_id::text, _w.id::text);

      SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::SMALLINT[]) INTO _acc
      FROM unnest(_free) f
      WHERE public._fixed_waitlist_accepts(_w.court, f);

      entry_id := _w.id;
      person_name := COALESCE(_w.full_name, _w.guest_name, '—');
      desired_weekday := _w.desired_weekday;
      start_time := _w.start_time;
      end_time := _w.end_time;
      pref := _w.court;
      called := _w.id = ANY(_called);
      IF called THEN
        _pick := _picks[array_position(_called, _w.id)];
        free_courts := ARRAY[_pick] || array_remove(_acc, _pick);
      ELSE
        free_courts := _acc;
      END IF;
      slot_free := _free;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;


--
-- Name: _fixed_waitlist_position(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._fixed_waitlist_position(_id uuid) RETURNS TABLE(queue_position integer, total integer, tied boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row public.fixed_court_waitlist%ROWTYPE;
  _generic BOOLEAN;
  _me TEXT;
  _pos INT;
  _tot INT;
  _tied BOOLEAN;
BEGIN
  SELECT * INTO _row FROM public.fixed_court_waitlist WHERE id = _id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  _generic := _row.court IS NULL OR _row.court = 0;
  _me := COALESCE(_row.client_id::text, _row.id::text);

  WITH pool AS (
    SELECT DISTINCT ON (COALESCE(w.client_id::text, w.id::text))
      COALESCE(w.client_id::text, w.id::text) AS person, w.created_at, w.id
    FROM public.fixed_court_waitlist w
    WHERE w.desired_weekday = _row.desired_weekday
      AND w.start_time = _row.start_time AND w.end_time = _row.end_time
      AND w.status IN ('waiting','notified','contacted')
      AND (
        (_generic AND (w.court IS NULL OR w.court = 0))
        OR (NOT _generic AND (
          w.court = _row.court
          OR w.court IS NULL
          OR (_row.court BETWEEN 2 AND 4 AND w.court = 0)
        ))
      )
    ORDER BY COALESCE(w.client_id::text, w.id::text), w.created_at, w.id
  ), mine AS (
    SELECT * FROM pool WHERE person = _me
  )
  SELECT
    (SELECT COUNT(*)::INT FROM pool p, mine m WHERE (p.created_at, p.id) <= (m.created_at, m.id)),
    (SELECT COUNT(*)::INT FROM pool),
    EXISTS (SELECT 1 FROM pool p, mine m WHERE p.person <> m.person AND p.created_at = m.created_at)
  INTO _pos, _tot, _tied;

  queue_position := _pos;
  total := _tot;
  tied := _tied;
  RETURN NEXT;
END;
$$;


--
-- Name: _hhmi(time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._hhmi(_t time without time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT to_char(_t, 'HH24:MI')
$$;


--
-- Name: _materialize_swapped_fixed(uuid[], date, smallint, smallint, uuid, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._materialize_swapped_fixed(_ids uuid[], _date date, _to_court smallint, _from_court smallint, _mirror_client uuid, _mirror_start time without time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _w record;
  _m record;
  _bid uuid;
BEGIN
  FOR _w IN
    SELECT DISTINCT s.start_time
    FROM public.client_schedules s
    WHERE s.id = ANY(_ids)
      AND NOT (_mirror_client IS NOT NULL AND s.client_id = _mirror_client AND s.start_time = _mirror_start)
    ORDER BY s.start_time
  LOOP
    _bid := NULL;
    FOR _m IN
      SELECT s.*
      FROM public.client_schedules s
      WHERE s.id = ANY(_ids)
        AND s.start_time = _w.start_time
        AND NOT (_mirror_client IS NOT NULL AND s.client_id = _mirror_client AND s.start_time = _mirror_start)
      ORDER BY s.end_time DESC, s.created_at, s.id
    LOOP
      IF _bid IS NULL THEN
        INSERT INTO public.court_bookings (
          court, booking_date, start_time, end_time, source, client_id, teacher_id, notes,
          created_by
        ) VALUES (
          _to_court, _date, _m.start_time, _m.end_time, 'avulsa', _m.client_id, _m.teacher_id,
          'Movido do fixo (' || public._court_label(_from_court) || ' ' || public._hhmi(_m.start_time)
            || '–' || public._hhmi(_m.end_time) || ')',
          auth.uid()
        )
        RETURNING id INTO _bid;
      ELSE
        INSERT INTO public.court_booking_participants (booking_id, client_id)
        VALUES (_bid, _m.client_id)
        ON CONFLICT (booking_id, client_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;


--
-- Name: _moved_notes_point_to(text, integer, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._moved_notes_point_to(_notes text, _court integer, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT COALESCE((
    SELECT m[1]::integer = _court AND m[2] = public._hhmi(_start) AND m[3] = public._hhmi(_end)
    FROM regexp_match(
      COALESCE(_notes, ''),
      '^Movido do fixo \(Q(\d+)(?:\s*\([^)]*\))?\s+(\d{2}:\d{2})[–-](\d{2}:\d{2})\)'
    ) AS m
  ), false)
$$;


--
-- Name: _notify_fixed_waitlist_position_changed(smallint, smallint, time without time zone, time without time zone, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._notify_fixed_waitlist_position_changed(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _exclude_id uuid, _cause_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _w RECORD;
  _wd_name TEXT;
BEGIN
  _wd_name := (ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[_weekday + 1];
  FOR _w IN
    SELECT * FROM public.fixed_court_waitlist w
    WHERE w.id <> _exclude_id AND w.desired_weekday = _weekday
      AND w.start_time = _start AND w.end_time = _end
      AND w.status IN ('waiting','notified','contacted')
      AND w.user_id IS NOT NULL
      AND (
        w.court IS NOT DISTINCT FROM _court
        OR ((_court IS NULL OR _court = 0) AND (w.court IS NULL OR w.court = 0))
        OR (_court IS NULL AND w.court > 0)
        OR (_court = 0 AND w.court BETWEEN 2 AND 4)
      )
  LOOP
    INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'fixed_waitlist_position_changed',
      _w.client_id,
      _w.user_id,
      'Sua posição na fila mudou',
      'A fila de horário fixo (' ||
        CASE WHEN _w.court IS NULL THEN 'qualquer quadra'
             WHEN _w.court = 0 THEN 'qualquer quadra de pickleball'
             ELSE 'Quadra ' || _w.court END
        || ', ' || _wd_name || ' ' ||
        to_char(_start,'HH24:MI') || '–' || to_char(_end,'HH24:MI') || ') teve uma atualização — confira sua posição atual.',
      false,
      jsonb_build_object('entry_id', _w.id),
      'fixed_waitlist_position_changed:' || _w.id::text || ':' || _cause_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$$;


--
-- Name: _notify_professor_late_cancel(text, uuid, text, integer, date, time without time zone, time without time zone, timestamp with time zone, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name text;
  _staff record;
  _title text := 'Cancelamento com menos de 3h';
  _body text;
BEGIN
  SELECT full_name INTO _client_name FROM public.clients WHERE id = _client_id;

  _body := COALESCE(_teacher_name, 'Professor') || ' cancelou '
    || CASE WHEN _is_fixed THEN 'o horário fixo' ELSE 'a locação' END
    || ' de ' || COALESCE(_client_name, 'cliente')
    || ' — ' || to_char(_date, 'DD/MM') || ' às ' || to_char(_start, 'HH24:MI')
    || '–' || to_char(_end, 'HH24:MI')
    || COALESCE(' (' || public._court_short(_court) || ')', '')
    || ', às ' || to_char(_cancelled_at AT TIME ZONE 'America/Recife', 'HH24:MI')
    || '. Pela regra (até 3h antes), a quadra deve ser lançada como débito na conta do cliente.';

  FOR _staff IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'recepcionista'::public.app_role
  LOOP
    INSERT INTO public.app_notifications
      (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'professor_late_cancel',
      _client_id,
      _staff.user_id,
      _title,
      _body,
      true,
      jsonb_build_object(
        'event_key', _event_key,
        'client_id', _client_id,
        'client_name', _client_name,
        'teacher_name', _teacher_name,
        'court', _court,
        'date', _date,
        'start_time', _start::text,
        'end_time', _end::text,
        'cancelled_at', _cancelled_at,
        'is_fixed', _is_fixed,
        'booking_id', _booking_id
      ),
      'professor_late_cancel|' || _event_key || '|' || _staff.user_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$$;


--
-- Name: _trg_fixed_waitlist_notify_free_slots(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._trg_fixed_waitlist_notify_free_slots() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  BEGIN
    PERFORM public.fixed_waitlist_notify_free_slots();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fixed_waitlist_notify_free_slots falhou: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;


--
-- Name: admin_save_client_schedule(uuid, uuid, integer, time without time zone, time without time zone, integer, uuid, text, boolean, text, date, date, uuid[], uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_client_schedule(_id uuid, _client_id uuid, _weekday integer, _start_time time without time zone, _end_time time without time zone, _court integer, _teacher_id uuid, _notes text, _valid_from date, _valid_until date, _group_ids uuid[] DEFAULT NULL::uuid[], _replace_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _conflict RECORD;
  _client_name text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  IF _end_time <= _start_time THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hora final deve ser maior que a inicial.');
  END IF;

  IF _replace_ids IS NOT NULL AND array_length(_replace_ids, 1) > 0 THEN
    IF _valid_until IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'Pra ocupar o horário de outro cliente temporariamente, preencha a vigência "Até".');
    END IF;
    IF _court IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Informe a quadra.');
    END IF;
  END IF;

  IF _court IS NOT NULL THEN
    SELECT s.id, s.start_time, s.end_time, c.full_name AS client_name
    INTO _conflict
    FROM public.client_schedules s
    JOIN public.clients c ON c.id = s.client_id
    WHERE s.court = _court
      AND s.weekday = _weekday
      AND s.start_time < _end_time
      AND s.end_time > _start_time
      AND (_id IS NULL OR s.id <> _id)
      -- Ids movendo junto no mesmo grupo não conflitam entre si.
      AND (_group_ids IS NULL OR NOT (s.id = ANY(_group_ids)))
      -- Fixos sendo liberados no período (item 1 do cabeçalho).
      AND (_replace_ids IS NULL OR NOT (s.id = ANY(_replace_ids)))
      -- Um fixo já encerrado nunca mais ocupa esse horário.
      AND (s.valid_until IS NULL OR s.valid_until >= CURRENT_DATE)
      -- Janelas de vigência precisam se sobrepor pra ser conflito real.
      AND (s.valid_from IS NULL OR _valid_until IS NULL OR s.valid_from <= _valid_until)
      AND (s.valid_until IS NULL OR _valid_from IS NULL OR s.valid_until >= _valid_from)
      -- Fixo já liberado em todas as ocorrências do período (item 2 do
      -- cabeçalho). Só dá pra afirmar isso com período finito.
      AND NOT (
        _valid_until IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM generate_series(
            GREATEST(CURRENT_DATE, _valid_from, s.valid_from),
            LEAST(_valid_until, s.valid_until),
            interval '1 day'
          ) AS d
          WHERE EXTRACT(DOW FROM d)::int = _weekday
            AND NOT EXISTS (
              SELECT 1 FROM public.client_schedule_exceptions e
              WHERE e.client_schedule_id = s.id
                AND e.start_time IS NULL
                AND e.exception_date <= d::date
                AND COALESCE(e.range_end, e.exception_date) >= d::date
            )
        )
      )
    ORDER BY s.start_time
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Quadra ' || _court || ' já tem horário fixo de ' || _conflict.client_name ||
          ' das ' || to_char(_conflict.start_time, 'HH24:MI') || ' às ' ||
          to_char(_conflict.end_time, 'HH24:MI') || ' nesse dia — mude a quadra ou o horário.',
        'conflict_type', 'fixed_schedule',
        'conflict_id', _conflict.id
      );
    END IF;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.client_schedules
      (client_id, weekday, start_time, end_time, court, teacher_id, notes,
       valid_from, valid_until)
    VALUES
      (_client_id, _weekday, _start_time, _end_time, _court, _teacher_id, _notes,
       _valid_from, _valid_until);
  ELSE
    UPDATE public.client_schedules
    SET weekday = _weekday,
        start_time = _start_time,
        end_time = _end_time,
        court = _court,
        teacher_id = _teacher_id,
        notes = _notes,
        valid_from = _valid_from,
        valid_until = _valid_until
    WHERE id = _id;
  END IF;

  -- Libera os fixos substituídos só no período (depois de gravar o novo).
  IF _replace_ids IS NOT NULL AND array_length(_replace_ids, 1) > 0 THEN
    SELECT full_name INTO _client_name FROM public.clients WHERE id = _client_id;
    INSERT INTO public.client_schedule_exceptions
      (client_schedule_id, exception_date, range_end, reason, created_by)
    SELECT s.id,
           GREATEST(CURRENT_DATE, COALESCE(_valid_from, CURRENT_DATE)),
           _valid_until,
           'Substituição temporária por ' || COALESCE(_client_name, 'outro cliente'),
           auth.uid()
    FROM public.client_schedules s
    WHERE s.id = ANY(_replace_ids)
      AND s.court = _court
      AND s.weekday = _weekday
      AND (_id IS NULL OR s.id <> _id)
      AND GREATEST(CURRENT_DATE, COALESCE(_valid_from, CURRENT_DATE)) <= _valid_until;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: app_notifications_skip_cancel_during_swap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_notifications_skip_cancel_during_swap() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.kind IN ('court_cancel_by_teacher', 'court_reactivate_by_teacher', 'court_swap_by_teacher') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: app_settings_is_public_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_settings_is_public_key(_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT _key IN ('whatsapp_reservations_number');
$$;


--
-- Name: approve_client_change_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_client_change_request(_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r public.teacher_client_change_requests%ROWTYPE;
  o RECORD;
  v_new_booking_id UUID;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretoria')
    OR public.has_role(auth.uid(), 'recepcionista')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT * INTO r FROM public.teacher_client_change_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada.');
  END IF;
  IF r.status <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação já foi processada.');
  END IF;

  -- Aula fixa: a troca cria uma locação nova no mesmo slot — confere antes
  -- se ele já está ocupado.
  IF r.booking_id IS NULL AND r.schedule_id IS NOT NULL THEN
    SELECT * INTO o
    FROM public._client_change_slot_occupant(r.court, r.occurrence_date, r.start_time);
    IF FOUND THEN
      IF r.new_client_id IS NOT NULL AND o.client_id = r.new_client_id THEN
        -- Troca já feita manualmente no mapa: só garante que o fixo do
        -- cliente antigo não aparece mais nesse dia.
        IF NOT public.client_schedule_exception_covers(
             r.schedule_id, r.occurrence_date, r.start_time, r.end_time) THEN
          INSERT INTO public.client_schedule_exceptions
            (client_schedule_id, exception_date, start_time, end_time, reason, created_by)
          VALUES
            (r.schedule_id, r.occurrence_date, r.start_time, r.end_time,
             'Troca de cliente aprovada', auth.uid());
        END IF;

        UPDATE public.teacher_client_change_requests
           SET status = 'aprovada',
               reviewed_by = auth.uid(),
               reviewed_at = now(),
               review_notes = 'Troca já havia sido feita manualmente no mapa.'
         WHERE id = _request_id;

        RETURN jsonb_build_object('ok', true, 'already_done', true, 'new_booking_id', o.booking_id);
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Já existe uma locação na Q%s em %s às %s (%s). Confira no mapa — se a troca já foi feita manualmente, recuse esta solicitação.',
          r.court,
          to_char(r.occurrence_date, 'DD/MM/YYYY'),
          to_char(r.start_time, 'HH24:MI'),
          o.occupant_name
        )
      );
    END IF;
  END IF;

  v_new_booking_id := public._apply_client_change_request(r);

  UPDATE public.teacher_client_change_requests
     SET status = 'aprovada',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = _request_id;

  RETURN jsonb_build_object('ok', true, 'new_booking_id', v_new_booking_id);
END;
$$;


--
-- Name: approve_client_teacher_link_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_client_teacher_link_request(_request_id uuid) RETURNS jsonb
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

  IF _r.action = 'vincular' THEN
    INSERT INTO public.client_teachers (client_id, teacher_id)
    VALUES (_r.client_id, _r.teacher_id)
    ON CONFLICT (client_id, teacher_id) DO NOTHING;
    UPDATE public.clients SET teacher_id = _r.teacher_id
      WHERE id = _r.client_id AND teacher_id IS NULL;
  ELSE
    DELETE FROM public.client_teachers
      WHERE client_id = _r.client_id AND teacher_id = _r.teacher_id;
    UPDATE public.clients SET teacher_id = NULL
      WHERE id = _r.client_id AND teacher_id = _r.teacher_id;
  END IF;

  UPDATE public.client_teacher_link_requests
    SET status = 'aprovada', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = _request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: approve_pending_signup(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_pending_signup(target_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'diretoria')
    OR public.has_role(auth.uid(),'recepcionista')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM public.pending_signups WHERE user_id = target_user;
END;
$$;


--
-- Name: audit_row_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_row_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _name TEXT;
  _entity TEXT := TG_ARGV[0];
  _action TEXT;
  _entity_id UUID;
  _details JSONB := '{}'::jsonb;
  _old JSONB;
  _new JSONB;
  _diff JSONB := '{}'::jsonb;
  _cols TEXT[];
  _col TEXT;
  _o JSONB;
  _n JSONB;
BEGIN
  -- Skip when no authenticated user (system-triggered changes)
  IF _uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    _action := 'create';
    _entity_id := (NEW).id;
    _new := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    _action := 'delete';
    _entity_id := (OLD).id;
    _old := to_jsonb(OLD);
  ELSE
    _action := 'update';
    _entity_id := (NEW).id;
    _old := to_jsonb(OLD);
    _new := to_jsonb(NEW);
  END IF;

  -- Fields to track per entity
  IF _entity = 'court_booking' THEN
    _cols := ARRAY['court','booking_date','start_time','end_time','client_id','teacher_id',
                   'guest_type','guest_name','notes','cancelled_at','cancel_reason',
                   'category_id','source'];
  ELSIF _entity = 'client_schedule' THEN
    _cols := ARRAY['weekday','start_time','end_time','court','client_id','teacher_id',
                   'notes',
                   'valid_from','valid_until'];
  ELSIF _entity = 'client_schedule_exception' THEN
    _cols := ARRAY['client_schedule_id','exception_date','start_time','end_time','reason'];
  ELSE
    _cols := ARRAY[]::TEXT[];
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH _col IN ARRAY _cols LOOP
      _o := _old -> _col;
      _n := _new -> _col;
      IF _o IS DISTINCT FROM _n THEN
        _diff := _diff || jsonb_build_object(_col, jsonb_build_object('from', _o, 'to', _n));
      END IF;
    END LOOP;
    IF _diff = '{}'::jsonb THEN
      RETURN NEW; -- nothing meaningful changed
    END IF;
    _details := jsonb_build_object('changes', _diff);
  ELSIF TG_OP = 'INSERT' THEN
    FOREACH _col IN ARRAY _cols LOOP
      _n := _new -> _col;
      IF _n IS NOT NULL AND _n <> 'null'::jsonb THEN
        _diff := _diff || jsonb_build_object(_col, _n);
      END IF;
    END LOOP;
    _details := jsonb_build_object('values', _diff);
  ELSE -- DELETE
    FOREACH _col IN ARRAY _cols LOOP
      _o := _old -> _col;
      IF _o IS NOT NULL AND _o <> 'null'::jsonb THEN
        _diff := _diff || jsonb_build_object(_col, _o);
      END IF;
    END LOOP;
    _details := jsonb_build_object('values', _diff);
  END IF;

  -- Attach schedule linkage on exception rows so the fixed-schedule history can find them
  IF _entity = 'client_schedule_exception' THEN
    _details := _details || jsonb_build_object(
      'client_schedule_id', COALESCE((NEW).client_schedule_id, (OLD).client_schedule_id)
    );
  END IF;

  -- Add booking_date/weekday context
  IF _entity = 'court_booking' THEN
    _details := _details || jsonb_build_object(
      'booking_date', COALESCE((NEW).booking_date, (OLD).booking_date)
    );
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.audit_logs(entity, entity_id, action, actor_id, actor_email, actor_name, details)
  VALUES (_entity, _entity_id, _action, _uid, _email, _name, _details);

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: auth_user_exists(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_user_exists(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id);
$$;


--
-- Name: can_access_client_photo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_client_photo(_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _parts TEXT[];
  _cid UUID;
BEGIN
  IF _name IS NULL THEN RETURN FALSE; END IF;
  _parts := string_to_array(_name, '/');
  IF array_length(_parts, 1) < 2 OR _parts[1] <> 'clients' THEN
    RETURN FALSE;
  END IF;
  BEGIN
    _cid := _parts[2]::uuid;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;
  IF public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
     OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) THEN
    RETURN TRUE;
  END IF;
  RETURN public.portal_can_view_client(_cid);
END;
$$;


--
-- Name: cleaning_delete_purchase(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleaning_delete_purchase(_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _old public.cleaning_purchases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'limpeza'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _old FROM public.cleaning_purchases WHERE id = _id FOR UPDATE;
  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  UPDATE public.cleaning_weekly_usage
    SET initial_qty = initial_qty - _old.quantity
    WHERE product_id = _old.product_id AND week_start = _old.stock_week_start;

  DELETE FROM public.cleaning_purchases WHERE id = _id;

  RETURN true;
END;
$$;


--
-- Name: cleaning_notify_low_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleaning_notify_low_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _u RECORD;
  _title TEXT;
  _body TEXT;
BEGIN
  IF NOT NEW.active OR NEW.current_stock > NEW.min_stock THEN
    RETURN NEW;
  END IF;

  _title := 'Estoque baixo: ' || NEW.name;
  _body := 'Estoque atual (' || NEW.current_stock || ') chegou no mínimo definido (' || NEW.min_stock || '). Hora de fazer o pedido.';

  FOR _u IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role IN ('diretoria'::public.app_role, 'limpeza'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications (kind, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'cleaning_low_stock',
      _u.user_id,
      _title,
      _body,
      false,
      jsonb_build_object('product_id', NEW.id, 'current_stock', NEW.current_stock, 'min_stock', NEW.min_stock),
      'cleaning_low_stock:' || NEW.id::text || ':' || _u.user_id::text || ':' || current_date::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;


--
-- Name: cleaning_recompute_current_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleaning_recompute_current_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _pid UUID;
  _latest_balance NUMERIC;
BEGIN
  _pid := COALESCE(NEW.product_id, OLD.product_id);
  SELECT balance_qty INTO _latest_balance
    FROM public.cleaning_weekly_usage
   WHERE product_id = _pid
   ORDER BY week_start DESC
   LIMIT 1;
  IF _latest_balance IS NOT NULL THEN
    UPDATE public.cleaning_products SET current_stock = _latest_balance WHERE id = _pid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: cleaning_register_purchase(uuid, numeric, numeric, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleaning_register_purchase(_product_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date DEFAULT NULL::date, _supplier_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _id UUID;
  _date DATE;
  _week DATE;
  _exists BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'limpeza'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero';
  END IF;
  IF _unit_price IS NULL OR _unit_price < 0 THEN
    RAISE EXCEPTION 'Valor unitário inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cleaning_products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  _date := COALESCE(_purchase_date, public.recife_today());
  _week := (public.recife_today() - (EXTRACT(DOW FROM public.recife_today()))::int);

  INSERT INTO public.cleaning_purchases
    (product_id, supplier_id, quantity, unit_price, purchase_date, stock_week_start, notes, created_by)
  VALUES (
    _product_id, _supplier_id, _quantity, _unit_price, _date, _week,
    NULLIF(btrim(COALESCE(_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO _id;

  SELECT EXISTS (
    SELECT 1 FROM public.cleaning_weekly_usage
    WHERE product_id = _product_id AND week_start = _week
  ) INTO _exists;

  IF _exists THEN
    UPDATE public.cleaning_weekly_usage
      SET initial_qty = initial_qty + _quantity
      WHERE product_id = _product_id AND week_start = _week;
  ELSE
    INSERT INTO public.cleaning_weekly_usage (product_id, week_start, initial_qty, used_qty, created_by)
    SELECT _product_id, _week, cp.current_stock + _quantity, 0, auth.uid()
    FROM public.cleaning_products cp
    WHERE cp.id = _product_id;
  END IF;

  RETURN _id;
END;
$$;


--
-- Name: cleaning_update_purchase(uuid, numeric, numeric, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleaning_update_purchase(_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date DEFAULT NULL::date, _supplier_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _old public.cleaning_purchases%ROWTYPE;
  _date DATE;
  _diff NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'limpeza'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero';
  END IF;
  IF _unit_price IS NULL OR _unit_price < 0 THEN
    RAISE EXCEPTION 'Valor unitário inválido';
  END IF;

  SELECT * INTO _old FROM public.cleaning_purchases WHERE id = _id FOR UPDATE;
  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  _date := COALESCE(_purchase_date, _old.purchase_date);
  _diff := _quantity - _old.quantity;

  IF _diff <> 0 THEN
    UPDATE public.cleaning_weekly_usage
      SET initial_qty = initial_qty + _diff
      WHERE product_id = _old.product_id AND week_start = _old.stock_week_start;
  END IF;

  UPDATE public.cleaning_purchases
    SET quantity = _quantity,
        unit_price = _unit_price,
        purchase_date = _date,
        supplier_id = _supplier_id,
        notes = NULLIF(btrim(COALESCE(_notes, '')), '')
    WHERE id = _id;

  RETURN true;
END;
$$;


--
-- Name: client_account_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_account_balance(_client_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(SUM(
    CASE WHEN entry_type = 'credito' THEN amount ELSE -amount END
  ), 0)::NUMERIC
  FROM public.account_entries
  WHERE client_id = _client_id;
$$;


--
-- Name: client_account_balances(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_account_balances(_client_id uuid) RETURNS TABLE(bucket text, balance numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    ae.bucket,
    COALESCE(SUM(CASE WHEN ae.entry_type = 'credito' THEN ae.amount ELSE -ae.amount END), 0)::NUMERIC
  FROM public.account_entries ae
  WHERE ae.client_id = _client_id
  GROUP BY ae.bucket;
$$;


--
-- Name: client_family_month_end_projection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_family_month_end_projection(_client_id uuid) RETURNS TABLE(client_id uuid, full_name text, phone text, is_responsible boolean, current_balance numeric, remaining_sessions integer, remaining_sessions_amount numeric, projected_balance numeric, amount_needed numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _full_name TEXT;
  _fr TEXT;
  _responsible_name TEXT;
  _m RECORD;
  _sessions RECORD;
  _balance NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT c.full_name, c.financial_responsible INTO _full_name, _fr
  FROM public.clients c WHERE c.id = _client_id;

  IF _full_name IS NULL THEN
    RETURN;
  END IF;

  IF _fr IS NOT NULL AND trim(_fr) <> '' AND EXISTS (
    SELECT 1 FROM public.clients c WHERE lower(c.full_name) = lower(trim(_fr))
  ) THEN
    _responsible_name := trim(_fr);
  ELSE
    _responsible_name := _full_name;
  END IF;

  FOR _m IN
    SELECT c.id, c.full_name, c.phone,
      (lower(c.full_name) = lower(_responsible_name)) AS is_responsible
    FROM public.clients c
    WHERE lower(c.full_name) = lower(_responsible_name)
       OR lower(COALESCE(c.financial_responsible, '')) = lower(_responsible_name)
    ORDER BY (lower(c.full_name) = lower(_responsible_name)) DESC, c.full_name
  LOOP
    SELECT public.client_account_balance(_m.id) INTO _balance;
    SELECT * INTO _sessions FROM public._client_remaining_sessions_amount(_m.id);

    client_id := _m.id;
    full_name := _m.full_name;
    phone := _m.phone;
    is_responsible := _m.is_responsible;
    current_balance := _balance;
    remaining_sessions := _sessions.session_count;
    remaining_sessions_amount := _sessions.session_amount;
    projected_balance := _balance - _sessions.session_amount;
    amount_needed := GREATEST(0, _sessions.session_amount - _balance);
    RETURN NEXT;
  END LOOP;
END;
$$;


--
-- Name: client_month_end_projection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_month_end_projection(_client_id uuid) RETURNS TABLE(current_balance numeric, remaining_sessions integer, remaining_sessions_amount numeric, projected_balance numeric, amount_needed numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _balance NUMERIC;
  _sessions RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT public.client_account_balance(_client_id) INTO _balance;
  SELECT * INTO _sessions FROM public._client_remaining_sessions_amount(_client_id);

  RETURN QUERY SELECT
    _balance,
    _sessions.session_count,
    _sessions.session_amount,
    _balance - _sessions.session_amount,
    GREATEST(0, _sessions.session_amount - _balance);
END;
$$;


--
-- Name: client_next_month_projection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_next_month_projection(_client_id uuid) RETURNS TABLE(starting_balance numeric, remaining_sessions integer, remaining_sessions_amount numeric, projected_balance numeric, amount_needed numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _balance NUMERIC;
  _this_month RECORD;
  _next_month RECORD;
  _next_month_start DATE;
  _next_month_end DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT public.client_account_balance(_client_id) INTO _balance;
  SELECT * INTO _this_month FROM public._client_remaining_sessions_amount(_client_id);

  _next_month_start := (date_trunc('month', public.recife_today()) + INTERVAL '1 month')::date;
  _next_month_end := public.recife_month_end(_next_month_start);

  SELECT * INTO _next_month
  FROM public._client_remaining_sessions_amount(_client_id, _next_month_start, _next_month_end);

  starting_balance := _balance - _this_month.session_amount;
  remaining_sessions := _next_month.session_count;
  remaining_sessions_amount := _next_month.session_amount;
  projected_balance := starting_balance - _next_month.session_amount;
  amount_needed := GREATEST(0, _next_month.session_amount - starting_balance);
  RETURN NEXT;
END;
$$;


--
-- Name: client_open_debt_items(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_open_debt_items(_client_id uuid) RETURNS TABLE(entry_date date, description text, amount numeric, booking_date date, court integer, start_time time without time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH ordered AS (
    SELECT
      ae.*,
      ROW_NUMBER() OVER (ORDER BY ae.entry_date, ae.created_at, ae.id) AS pos,
      SUM(CASE WHEN ae.entry_type = 'credito' THEN ae.amount ELSE -ae.amount END)
        OVER (ORDER BY ae.entry_date, ae.created_at, ae.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
    FROM public.account_entries ae
    WHERE ae.client_id = _client_id
  ),
  last_ok AS (
    SELECT COALESCE(MAX(pos), 0) AS pos FROM ordered WHERE running >= 0
  )
  SELECT
    o.entry_date,
    o.description,
    o.amount,
    cb.booking_date,
    COALESCE(p.court, cb.court)::integer,
    COALESCE(p.start_time, cb.start_time)
  FROM ordered o
  CROSS JOIN last_ok
  LEFT JOIN public.payments p ON p.id = o.payment_id
  LEFT JOIN public.court_bookings cb ON cb.id = p.booking_id
  WHERE o.pos > last_ok.pos
    AND o.entry_type = 'debito'
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
      OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
    )
  ORDER BY o.pos;
$$;


--
-- Name: client_revoke_portal_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_revoke_portal_access() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid;
BEGIN
  FOR _uid IN
    SELECT user_id FROM public.client_portal_users WHERE client_id = OLD.id
  LOOP
    DELETE FROM auth.users WHERE id = _uid;
  END LOOP;
  RETURN OLD;
END;
$$;


--
-- Name: client_schedule_exception_covers(uuid, date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_schedule_exceptions ex
    WHERE ex.client_schedule_id = _schedule_id
      AND ex.exception_date <= _date
      AND COALESCE(ex.range_end, ex.exception_date) >= _date
      AND (
        (ex.start_time IS NULL AND ex.end_time IS NULL)
        OR (ex.start_time <= _window_start AND ex.end_time >= _window_end)
      )
  );
$$;


--
-- Name: client_schedule_exceptions_waitlist_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_schedule_exceptions_waitlist_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _s public.client_schedules%ROWTYPE;
  _start time without time zone;
  _end time without time zone;
BEGIN
  SELECT * INTO _s FROM public.client_schedules WHERE id = NEW.client_schedule_id;
  IF _s.id IS NULL THEN RETURN NEW; END IF;
  _start := COALESCE(NEW.start_time, _s.start_time);
  _end := COALESCE(NEW.end_time, _s.end_time);
  PERFORM public.process_court_waitlist_releases(NEW.exception_date, _start, _end);
  RETURN NEW;
END; $$;


--
-- Name: client_schedule_notify_client_on_create(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_schedule_notify_client_on_create() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _weekdays TEXT[] := ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  _body TEXT;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu WHERE cpu.client_id = NEW.client_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.responsible_client_id IS NOT NULL
      AND c.id = NEW.client_id
      AND EXISTS (SELECT 1 FROM public.client_portal_users cpu2 WHERE cpu2.client_id = c.responsible_client_id)
  ) THEN
    RETURN NEW;
  END IF;

  _body := 'Toda ' || _weekdays[NEW.weekday + 1]
    || ' às ' || to_char(NEW.start_time, 'HH24:MI')
    || COALESCE(' — ' || public._court_short(NEW.court), '');

  INSERT INTO public.app_notifications (kind, client_id, title, body, requires_ack, metadata)
  VALUES (
    'fixed_schedule_created',
    NEW.client_id,
    'Horário fixo cadastrado',
    _body,
    true,
    jsonb_build_object('schedule_id', NEW.id)
  );

  RETURN NEW;
END;
$$;


--
-- Name: client_schedule_notify_teacher_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_schedule_notify_teacher_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _weekdays TEXT[] := ARRAY['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  _client_name TEXT;
  _old_desc TEXT;
  _new_desc TEXT;
  _body TEXT;
  _changed BOOLEAN;
BEGIN
  _changed := (
    OLD.weekday IS DISTINCT FROM NEW.weekday
    OR OLD.start_time IS DISTINCT FROM NEW.start_time
    OR OLD.end_time IS DISTINCT FROM NEW.end_time
    OR OLD.court IS DISTINCT FROM NEW.court
    OR OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
  );

  IF NOT _changed THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO _client_name FROM public.clients WHERE id = NEW.client_id;

  _old_desc := _weekdays[OLD.weekday + 1] || ' '
    || to_char(OLD.start_time, 'HH24:MI') || '-' || to_char(OLD.end_time, 'HH24:MI')
    || COALESCE(' ' || public._court_short(OLD.court), '');

  _new_desc := _weekdays[NEW.weekday + 1] || ' '
    || to_char(NEW.start_time, 'HH24:MI') || '-' || to_char(NEW.end_time, 'HH24:MI')
    || COALESCE(' ' || public._court_short(NEW.court), '');

  _body := COALESCE(_client_name, 'Cliente') || ' — ' || _old_desc || ' → ' || _new_desc;

  -- Notifica o novo professor (se houver)
  IF NEW.teacher_id IS NOT NULL THEN
    INSERT INTO public.app_notifications (kind, client_id, title, body, requires_ack, metadata)
    VALUES (
      'schedule_changed_teacher',
      NEW.client_id,
      CASE WHEN OLD.teacher_id IS DISTINCT FROM NEW.teacher_id AND OLD.teacher_id IS NOT NULL
        THEN 'Novo horário atribuído'
        ELSE 'Horário do aluno alterado'
      END,
      _body,
      true,
      jsonb_build_object(
        'teacher_id', NEW.teacher_id,
        'schedule_id', NEW.id,
        'client_id', NEW.client_id
      )
    );
  END IF;

  -- Se trocou de professor, notifica o antigo também
  IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id AND OLD.teacher_id IS NOT NULL THEN
    INSERT INTO public.app_notifications (kind, client_id, title, body, requires_ack, metadata)
    VALUES (
      'schedule_changed_teacher',
      NEW.client_id,
      'Você foi removido de um horário',
      COALESCE(_client_name, 'Cliente') || ' — ' || _old_desc || ' foi transferido.',
      true,
      jsonb_build_object(
        'teacher_id', OLD.teacher_id,
        'schedule_id', NEW.id,
        'client_id', NEW.client_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: client_schedule_valid_on(date, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_schedule_valid_on(_valid_from date, _valid_until date, _date date) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT (_valid_from IS NULL OR _valid_from <= _date)
     AND (_valid_until IS NULL OR _valid_until >= _date);
$$;


--
-- Name: clients_guard_linked_teacher(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_guard_linked_teacher() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.linked_teacher_id IS NOT DISTINCT FROM
     (CASE WHEN TG_OP = 'UPDATE' THEN OLD.linked_teacher_id ELSE NULL END) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'diretoria'::public.app_role) THEN
    RAISE EXCEPTION 'Só admin ou diretoria podem alterar o vínculo "cadastro do professor".';
  END IF;

  IF NEW.linked_teacher_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.teachers t
    JOIN auth.users u ON u.id = t.user_id
    WHERE t.id = NEW.linked_teacher_id
      AND lower(btrim(u.email)) = 'davi@squashtenniscenter.com.br'
  ) THEN
    RAISE EXCEPTION 'O cadastro do Davi Barros não pode ser vinculado como cadastro de professor.';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: clients_gympass_exception_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_gympass_exception_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _actor UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NEW.is_gympass AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_gympass, false)) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.debt_limit_exceptions WHERE client_id = NEW.id AND active
    ) THEN
      PERFORM public._debt_limit_add_exception_internal(NEW.id, 'Gympass', _actor);
    END IF;
  ELSIF NOT NEW.is_gympass AND TG_OP = 'UPDATE' AND COALESCE(OLD.is_gympass, false) THEN
    UPDATE public.debt_limit_exceptions
      SET active = false, deactivated_by = _actor, deactivated_at = now()
      WHERE client_id = NEW.id AND active AND reason = 'Gympass';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: clients_open_debt(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_open_debt(_client_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(client_id uuid, debt_amount numeric, geral_debt numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH per_client AS (
    SELECT
      ae.client_id,
      SUM(CASE WHEN ae.entry_type = 'credito' THEN ae.amount ELSE -ae.amount END) AS total,
      SUM(CASE WHEN ae.bucket = 'geral'
               THEN CASE WHEN ae.entry_type = 'credito' THEN ae.amount ELSE -ae.amount END
               ELSE 0 END) AS geral
    FROM public.account_entries ae
    WHERE _client_ids IS NULL OR ae.client_id = ANY(_client_ids)
    GROUP BY ae.client_id
  )
  SELECT pc.client_id, (-pc.total)::numeric, GREATEST(0, -pc.geral)::numeric
  FROM per_client pc
  JOIN public.clients c ON c.id = pc.client_id
  WHERE pc.total < 0
    AND c.active
    AND NOT EXISTS (
      SELECT 1 FROM public.debt_limit_exceptions e
      WHERE e.client_id = pc.client_id AND e.active
    )
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
      OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
    );
$$;


--
-- Name: cobranca_assignees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_assignees() RETURNS TABLE(user_id uuid, full_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT ur.user_id, COALESCE(p.full_name, 'Sem nome')
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  WHERE public._cobranca_is_staff(auth.uid())
    AND ur.role IN ('admin'::public.app_role, 'diretoria'::public.app_role)
  ORDER BY 2;
$$;


--
-- Name: cobranca_exceptions_watch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_exceptions_watch() RETURNS TABLE(client_id uuid, client_name text, client_phone text, is_gympass boolean, exception_reason text, balance numeric, last_payment_on date, days_without_payment integer, usual_max_gap integer, largest_payment numeric, has_history boolean, out_of_pattern boolean, why text, followup_id uuid, assigned_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  WITH watched AS (
    SELECT c.id, c.full_name, c.phone, c.is_gympass, x.reason
    FROM public.clients c
    LEFT JOIN public.debt_limit_exceptions x ON x.client_id = c.id AND x.active
    WHERE public._cobranca_is_staff(auth.uid())
      AND c.active
      AND (c.is_gympass OR x.id IS NOT NULL)
  ),
  bal AS (
    SELECT w.*, public.client_account_balance(w.id) AS balance
    FROM watched w
  ),
  owing AS (
    SELECT * FROM bal WHERE balance < 0
  ),
  pay_days AS (
    SELECT ae.client_id, ae.entry_date, SUM(ae.amount) AS total
    FROM public.account_entries ae
    JOIN owing o ON o.id = ae.client_id
    WHERE ae.entry_type = 'credito'
      AND ae.entry_date >= CURRENT_DATE - 365
    GROUP BY ae.client_id, ae.entry_date
  ),
  gaps AS (
    SELECT client_id,
           entry_date - LAG(entry_date) OVER (PARTITION BY client_id ORDER BY entry_date) AS gap
    FROM pay_days
  ),
  stats AS (
    SELECT o.id,
           (SELECT MAX(entry_date) FROM public.account_entries ae
             WHERE ae.client_id = o.id AND ae.entry_type = 'credito') AS last_payment_on,
           (SELECT MIN(entry_date) FROM public.account_entries ae
             WHERE ae.client_id = o.id AND ae.entry_type = 'debito') AS first_debit_on,
           (SELECT MAX(gap) FROM gaps g WHERE g.client_id = o.id) AS max_gap,
           (SELECT COUNT(gap) FROM gaps g WHERE g.client_id = o.id) AS gap_count,
           (SELECT MAX(total) FROM pay_days p WHERE p.client_id = o.id) AS largest_payment
    FROM owing o
  ),
  judged AS (
    SELECT o.*, s.last_payment_on, s.max_gap, s.largest_payment,
           (s.gap_count >= 3) AS has_history,
           (CURRENT_DATE - COALESCE(s.last_payment_on, s.first_debit_on, CURRENT_DATE))::integer AS days_without
    FROM owing o
    JOIN stats s ON s.id = o.id
  )
  SELECT
    j.id, j.full_name, j.phone, j.is_gympass, j.reason, j.balance,
    j.last_payment_on, j.days_without, j.max_gap, j.largest_payment, j.has_history,
    CASE
      WHEN j.has_history THEN
        j.days_without > j.max_gap + 5
        OR (j.largest_payment > 0 AND -j.balance > 1.5 * j.largest_payment)
      ELSE j.days_without > 35
    END,
    CASE
      WHEN j.has_history AND j.days_without > j.max_gap + 5 THEN
        format('%s dias sem pagar; o maior intervalo dele foi %s dias', j.days_without, j.max_gap)
      WHEN j.has_history AND j.largest_payment > 0 AND -j.balance > 1.5 * j.largest_payment THEN
        format('dívida de R$ %s, acima de 1,5x o maior pagamento dele (R$ %s)',
               to_char(-j.balance, 'FM999G999D00'), to_char(j.largest_payment, 'FM999G999D00'))
      WHEN NOT j.has_history AND j.days_without > 35 THEN
        format('%s dias sem pagar (sem histórico suficiente; teto de 35 dias)', j.days_without)
      ELSE NULL
    END,
    f.id, pa.full_name
  FROM judged j
  LEFT JOIN public.cobranca_followups f ON f.client_id = j.id AND f.status = 'active'
  LEFT JOIN public.profiles pa ON pa.id = f.assigned_to
  ORDER BY j.balance ASC;
$_$;


--
-- Name: cobranca_followup_add_note(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followup_add_note(_followup_id uuid, _note text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
BEGIN
  IF NOT public._cobranca_is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  IF NULLIF(trim(_note), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escreva a anotação.');
  END IF;

  SELECT client_id INTO _client_id FROM public.cobranca_followups WHERE id = _followup_id;
  IF _client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Follow-up não encontrado.');
  END IF;

  INSERT INTO public.cobranca_followup_events
    (followup_id, event_type, actor, note, balance_at_event)
  VALUES (_followup_id, 'note', _uid, trim(_note), public.client_account_balance(_client_id));

  UPDATE public.cobranca_followups SET updated_at = now() WHERE id = _followup_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: cobranca_followup_assign(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text DEFAULT NULL::text, _context text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _balance numeric;
  _followup_id uuid;
BEGIN
  IF NOT public._cobranca_is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  IF NOT (
    public.has_role(_assignee, 'admin'::public.app_role)
    OR public.has_role(_assignee, 'diretoria'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Só dá para repassar para admin ou diretoria.');
  END IF;

  _balance := public.client_account_balance(_client_id);

  SELECT id INTO _followup_id
  FROM public.cobranca_followups
  WHERE client_id = _client_id AND status = 'active'
  FOR UPDATE;

  IF _followup_id IS NULL THEN
    IF _balance >= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cliente não tem saldo em aberto.');
    END IF;

    INSERT INTO public.cobranca_followups
      (client_id, last_context, last_sent_at, last_sent_by, send_count, balance_at_last_send)
    VALUES (_client_id, COALESCE(_context, 'fora_do_padrao'), now(), _uid, 0, _balance)
    RETURNING id INTO _followup_id;

    INSERT INTO public.cobranca_followup_events
      (followup_id, event_type, actor, context, balance_at_event)
    VALUES (_followup_id, 'created', _uid, COALESCE(_context, 'fora_do_padrao'), _balance);
  END IF;

  UPDATE public.cobranca_followups
  SET assigned_to = _assignee, assigned_at = now(), assigned_by = _uid,
      kept_at = NULL, kept_by = NULL,
      updated_at = now()
  WHERE id = _followup_id;

  INSERT INTO public.cobranca_followup_events
    (followup_id, event_type, actor, note, balance_at_event)
  VALUES (_followup_id, 'assigned', _uid, NULLIF(trim(_note), ''), _balance);

  RETURN jsonb_build_object('ok', true, 'followup_id', _followup_id);
END;
$$;


--
-- Name: cobranca_followup_keep(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followup_keep(_followup_id uuid, _note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
BEGIN
  IF NOT public._cobranca_is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT client_id INTO _client_id
  FROM public.cobranca_followups
  WHERE id = _followup_id AND status = 'active'
  FOR UPDATE;
  IF _client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Follow-up não encontrado ou já resolvido.');
  END IF;

  UPDATE public.cobranca_followups
  SET kept_at = now(), kept_by = _uid,
      assigned_to = NULL, assigned_at = NULL, assigned_by = NULL,
      updated_at = now()
  WHERE id = _followup_id;

  INSERT INTO public.cobranca_followup_events
    (followup_id, event_type, actor, note, balance_at_event)
  VALUES (_followup_id, 'kept', _uid, NULLIF(trim(_note), ''),
          public.client_account_balance(_client_id));

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: cobranca_followup_register_send(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followup_register_send(_client_id uuid, _context text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _balance numeric;
  _followup_id uuid;
BEGIN
  IF NOT (
    public.has_role(_uid, 'admin'::public.app_role)
    OR public.has_role(_uid, 'diretoria'::public.app_role)
    OR public.has_role(_uid, 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  _balance := public.client_account_balance(_client_id);

  SELECT id INTO _followup_id
  FROM public.cobranca_followups
  WHERE client_id = _client_id AND status = 'active';

  IF _followup_id IS NULL THEN
    INSERT INTO public.cobranca_followups
      (client_id, last_context, last_sent_at, last_sent_by, send_count, balance_at_last_send)
    VALUES (_client_id, _context, now(), _uid, 1, _balance)
    RETURNING id INTO _followup_id;

    INSERT INTO public.cobranca_followup_events
      (followup_id, event_type, actor, context, balance_at_event)
    VALUES (_followup_id, 'created', _uid, _context, _balance);
  ELSE
    UPDATE public.cobranca_followups
    SET last_context = _context,
        last_sent_at = now(),
        last_sent_by = _uid,
        send_count = send_count + 1,
        balance_at_last_send = _balance,
        updated_at = now()
    WHERE id = _followup_id;

    INSERT INTO public.cobranca_followup_events
      (followup_id, event_type, actor, context, balance_at_event)
    VALUES (_followup_id, 'sent', _uid, _context, _balance);
  END IF;

  RETURN jsonb_build_object('ok', true, 'followup_id', _followup_id);
END;
$$;


--
-- Name: cobranca_followup_reopen(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followup_reopen(_followup_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
BEGIN
  IF NOT (
    public.has_role(_uid, 'admin'::public.app_role)
    OR public.has_role(_uid, 'diretoria'::public.app_role)
    OR public.has_role(_uid, 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT client_id INTO _client_id
  FROM public.cobranca_followups
  WHERE id = _followup_id AND status = 'resolved';

  IF _client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Follow-up não encontrado ou não está resolvido.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cobranca_followups WHERE client_id = _client_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Já existe um follow-up ativo para este cliente.');
  END IF;

  UPDATE public.cobranca_followups
  SET status = 'active', resolved_by = NULL, resolved_at = NULL, resolved_note = NULL, updated_at = now()
  WHERE id = _followup_id;

  INSERT INTO public.cobranca_followup_events (followup_id, event_type, actor)
  VALUES (_followup_id, 'reopened', _uid);

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: cobranca_followup_resolve(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followup_resolve(_followup_id uuid, _note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _balance numeric;
BEGIN
  IF NOT (
    public.has_role(_uid, 'admin'::public.app_role)
    OR public.has_role(_uid, 'diretoria'::public.app_role)
    OR public.has_role(_uid, 'recepcionista'::public.app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;

  SELECT client_id INTO _client_id
  FROM public.cobranca_followups
  WHERE id = _followup_id AND status = 'active';

  IF _client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Follow-up não encontrado ou já resolvido.');
  END IF;

  _balance := public.client_account_balance(_client_id);

  UPDATE public.cobranca_followups
  SET status = 'resolved', resolved_by = _uid, resolved_at = now(), resolved_note = _note, updated_at = now()
  WHERE id = _followup_id;

  INSERT INTO public.cobranca_followup_events (followup_id, event_type, actor, note, balance_at_event)
  VALUES (_followup_id, 'resolved', _uid, _note, _balance);

  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: cobranca_followups_auto_resolve(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followups_auto_resolve() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row record;
  _balance numeric;
  _count integer := 0;
BEGIN
  FOR _row IN
    SELECT f.id, f.client_id
    FROM public.cobranca_followups f
    WHERE f.status = 'active'
      AND COALESCE((
        SELECT e.event_type
        FROM public.cobranca_followup_events e
        WHERE e.followup_id = f.id
        ORDER BY e.created_at DESC
        LIMIT 1
      ), '') <> 'reopened'
    FOR UPDATE OF f SKIP LOCKED
  LOOP
    _balance := public.client_account_balance(_row.client_id);
    IF _balance >= 0 THEN
      UPDATE public.cobranca_followups
      SET status = 'resolved',
          resolved_by = NULL,
          resolved_at = now(),
          resolved_note = 'Pago — baixa automática (saldo em dia).',
          updated_at = now()
      WHERE id = _row.id;

      INSERT INTO public.cobranca_followup_events
        (followup_id, event_type, actor, note, balance_at_event)
      VALUES (_row.id, 'resolved', NULL, 'Baixa automática: saldo em dia.', _balance);

      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$$;


--
-- Name: cobranca_followups_list(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobranca_followups_list(_status text DEFAULT 'active'::text) RETURNS TABLE(id uuid, client_id uuid, client_name text, client_phone text, client_active boolean, status text, last_context text, last_sent_at timestamp with time zone, send_count integer, balance_at_last_send numeric, current_balance numeric, created_at timestamp with time zone, resolved_at timestamp with time zone, resolved_note text, assigned_to uuid, assigned_name text, assigned_at timestamp with time zone, last_note text, last_note_at timestamp with time zone, last_note_by text, kept_at timestamp with time zone, kept_by_name text, client_exception text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
#variable_conflict use_column
BEGIN
  IF NOT public._cobranca_is_staff(auth.uid()) THEN
    RETURN;
  END IF;

  PERFORM public.cobranca_followups_auto_resolve();

  RETURN QUERY
  SELECT
    f.id, f.client_id, c.full_name, c.phone, c.active, f.status, f.last_context, f.last_sent_at,
    f.send_count, f.balance_at_last_send, public.client_account_balance(f.client_id),
    f.created_at, f.resolved_at, f.resolved_note,
    f.assigned_to, pa.full_name, f.assigned_at,
    n.note, n.created_at, pn.full_name,
    f.kept_at, pk.full_name,
    CASE
      WHEN c.is_gympass THEN 'Gympass'
      WHEN EXISTS (
        SELECT 1 FROM public.debt_limit_exceptions x
        WHERE x.client_id = c.id AND x.active
      ) THEN 'Exceção'
      ELSE NULL
    END
  FROM public.cobranca_followups f
  JOIN public.clients c ON c.id = f.client_id
  LEFT JOIN public.profiles pa ON pa.id = f.assigned_to
  LEFT JOIN public.profiles pk ON pk.id = f.kept_by
  LEFT JOIN LATERAL (
    SELECT e.note, e.created_at, e.actor
    FROM public.cobranca_followup_events e
    WHERE e.followup_id = f.id
      AND e.event_type IN ('note', 'assigned', 'kept')
      AND e.note IS NOT NULL
    ORDER BY e.created_at DESC
    LIMIT 1
  ) n ON true
  LEFT JOIN public.profiles pn ON pn.id = n.actor
  WHERE (_status = 'todos' OR f.status = _status)
  ORDER BY f.last_sent_at DESC;
END;
$$;


--
-- Name: court_booking_fulfill_waitlist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_booking_fulfill_waitlist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL AND NEW.teacher_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.court_waitlist w
    SET status = 'fulfilled',
        resulting_booking_id = COALESCE(w.resulting_booking_id, NEW.id),
        updated_at = now()
  WHERE w.desired_date = NEW.booking_date
    AND w.status IN ('waiting', 'notified', 'contacted', 'awaiting_confirmation')
    AND w.start_time < NEW.end_time
    AND w.end_time > NEW.start_time
    -- a própria reserva que o cliente quer trocar não conta como atendimento
    AND w.source_booking_id IS DISTINCT FROM NEW.id
    AND (
      (w.client_id IS NOT NULL AND w.client_id = NEW.client_id)
      OR (w.client_id IS NULL AND w.teacher_id IS NOT NULL AND w.teacher_id = NEW.teacher_id)
    );

  RETURN NEW;
END;
$$;


--
-- Name: court_booking_notify_client_on_create(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_booking_notify_client_on_create() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name TEXT;
  _weekdays TEXT[] := ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  _wd INT;
  _body TEXT;
BEGIN
  IF NEW.client_id IS NULL OR NEW.cancelled_at IS NOT NULL OR NEW.hold_expires_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu WHERE cpu.client_id = NEW.client_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.responsible_client_id IS NOT NULL
      AND c.id = NEW.client_id
      AND EXISTS (SELECT 1 FROM public.client_portal_users cpu2 WHERE cpu2.client_id = c.responsible_client_id)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO _client_name FROM public.clients WHERE id = NEW.client_id;
  _wd := EXTRACT(DOW FROM NEW.booking_date)::int;

  _body := _weekdays[_wd + 1] || ', ' || to_char(NEW.booking_date, 'DD/MM')
    || ' às ' || to_char(NEW.start_time, 'HH24:MI')
    || ' — ' || public._court_short(NEW.court);

  INSERT INTO public.app_notifications (kind, client_id, title, body, requires_ack, metadata)
  VALUES (
    'booking_created',
    NEW.client_id,
    'Reserva confirmada',
    _body,
    true,
    jsonb_build_object('booking_id', NEW.id, 'source', 'avulsa')
  );

  RETURN NEW;
END;
$$;


--
-- Name: court_bookings_check_recepcionista_category(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_bookings_check_recepcionista_category() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _cat_name TEXT;
  _cat_norm TEXT;
BEGIN
  IF NEW.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NEW;
  END IF;

  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_role(auth.uid(), 'recepcionista'::public.app_role)
     OR public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
  THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _cat_name FROM public.client_categories WHERE id = NEW.category_id;
  _cat_norm := lower(btrim(translate(
    COALESCE(_cat_name, ''),
    'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  )));


  RETURN NEW;
END;
$$;


--
-- Name: court_bookings_portal_update_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_bookings_portal_update_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _is_portal boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu
    WHERE cpu.user_id = auth.uid()
      AND cpu.client_id = OLD.client_id
  ) INTO _is_portal;

  IF NOT _is_portal THEN
    RETURN NEW;
  END IF;

  -- Staff bypass
  IF has_role(auth.uid(), 'admin'::app_role)
     OR has_role(auth.uid(), 'diretoria'::app_role)
     OR has_role(auth.uid(), 'recepcionista'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Portal só pode alterar campos ligados ao cancelamento.
  IF NEW.court            IS DISTINCT FROM OLD.court
     OR NEW.booking_date  IS DISTINCT FROM OLD.booking_date
     OR NEW.start_time    IS DISTINCT FROM OLD.start_time
     OR NEW.end_time      IS DISTINCT FROM OLD.end_time
     OR NEW.source        IS DISTINCT FROM OLD.source
     OR NEW.client_id     IS DISTINCT FROM OLD.client_id
     OR NEW.guest_name    IS DISTINCT FROM OLD.guest_name
     OR NEW.guest_type    IS DISTINCT FROM OLD.guest_type
     OR NEW.teacher_id    IS DISTINCT FROM OLD.teacher_id
     OR NEW.category_id   IS DISTINCT FROM OLD.category_id
     OR NEW.created_by    IS DISTINCT FROM OLD.created_by
     OR NEW.notes         IS DISTINCT FROM OLD.notes
     OR NEW.charge_applied    IS DISTINCT FROM OLD.charge_applied
     OR NEW.charge_id         IS DISTINCT FROM OLD.charge_id THEN
    RAISE EXCEPTION 'Portal só pode cancelar reservas, não alterar outros campos.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: court_bookings_professor_cancel_fee(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_bookings_professor_cancel_fee() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name text;
  _teacher_name text;
BEGIN
  IF NEW.cancelled_at IS NULL OR OLD.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_role(NEW.cancelled_by, 'professor'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO _client_name FROM public.clients WHERE id = NEW.client_id;
  SELECT name INTO _teacher_name FROM public.teachers WHERE user_id = NEW.cancelled_by;

  -- Aviso ao cliente (mantido como era).
  INSERT INTO public.app_notifications(kind, client_id, title, body)
  VALUES (
    'professor_cancel',
    NEW.client_id,
    'Aula cancelada pelo professor',
    COALESCE(_teacher_name, 'Professor') || ' cancelou aula de '
      || COALESCE(_client_name, 'cliente') || ' em '
      || to_char(NEW.booking_date, 'DD/MM') || ' às '
      || to_char(NEW.start_time, 'HH24:MI')
      || ' (' || public._court_short(NEW.court) || ')'
  );

  IF public.professor_cancel_is_late(NEW.booking_date, NEW.start_time, NEW.cancelled_at) THEN
    PERFORM public._notify_professor_late_cancel(
      'booking:' || NEW.id::text,
      NEW.client_id, _teacher_name, NEW.court,
      NEW.booking_date, NEW.start_time, NEW.end_time,
      NEW.cancelled_at, false, NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: court_bookings_restrict_portal_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_bookings_restrict_portal_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _is_portal BOOLEAN;
  _is_staff BOOLEAN;
BEGIN
  -- Staff/roles bypass this restriction
  _is_staff := public.has_role(auth.uid(),'admin'::public.app_role)
            OR public.has_role(auth.uid(),'diretoria'::public.app_role)
            OR public.has_role(auth.uid(),'recepcionista'::public.app_role)
            OR public.has_role(auth.uid(),'professor'::public.app_role);
  IF _is_staff THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu
    WHERE cpu.user_id = auth.uid() AND cpu.client_id = OLD.client_id
  ) INTO _is_portal;

  IF NOT _is_portal THEN
    RETURN NEW;
  END IF;

  -- Portal client: allow only cancellation-related fields to change
  IF NEW.court IS DISTINCT FROM OLD.court
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
     OR NEW.guest_type IS DISTINCT FROM OLD.guest_type
     OR NEW.guest_name IS DISTINCT FROM OLD.guest_name
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.charge_id IS DISTINCT FROM OLD.charge_id
     OR NEW.charge_applied IS DISTINCT FROM OLD.charge_applied
  THEN
    RAISE EXCEPTION 'Portal clients may only cancel bookings, not edit other fields';
  END IF;

  IF NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'Portal clients may only cancel bookings';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: court_bookings_validate_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_bookings_validate_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _slot_ts        TIMESTAMPTZ;
  _slot_end_ts    TIMESTAMPTZ;
  _now_recife     TIMESTAMP;
  _slot_local     TIMESTAMP;
  _slot_end_local TIMESTAMP;
  _now_date       DATE;
  _slot_date      DATE;
  _delta_days     INT;
  _now_wd         INT;
  _start_hour     INT;
  _end_hour       INT;
  _release_hour   INT;
  _special_hours  INT[];
  _in_special     BOOLEAN;
  _allowed_source booking_source;
  _is_staff       BOOLEAN;
BEGIN
  -- Libera preventivamente qualquer pré-reserva já expirada nesse exato
  -- horário, evitando erro de índice único caso o cron de limpeza ainda
  -- não tenha passado (janela de até 1 minuto).
  UPDATE public.court_bookings
  SET cancelled_at = now()
  WHERE court = NEW.court
    AND booking_date = NEW.booking_date
    AND start_time = NEW.start_time
    AND cancelled_at IS NULL
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at <= now();

  IF NEW.hold_expires_at IS NULL THEN
    -- Inserindo uma reserva de verdade (não é pré-reserva).
    IF EXISTS (
      SELECT 1 FROM public.court_bookings
      WHERE court = NEW.court AND booking_date = NEW.booking_date AND start_time = NEW.start_time
        AND cancelled_at IS NULL AND hold_expires_at IS NOT NULL AND hold_expires_at > now()
    ) THEN
      _is_staff := (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
        OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
      );
      IF _is_staff THEN
        -- Recepção confirmando a reserva: cancela a pré-reserva pra liberar o slot.
        UPDATE public.court_bookings
        SET cancelled_at = now()
        WHERE court = NEW.court AND booking_date = NEW.booking_date AND start_time = NEW.start_time
          AND cancelled_at IS NULL AND hold_expires_at IS NOT NULL AND hold_expires_at > now();
      ELSE
        RAISE EXCEPTION 'Este horário está com uma pré-reserva aguardando confirmação da secretaria. Tente novamente em alguns minutos ou escolha outro horário.';
      END IF;
    END IF;
  ELSE
    -- Inserindo uma NOVA pré-reserva: não pode sobrepor reserva/pré-reserva já ativa.
    IF EXISTS (
      SELECT 1 FROM public.court_bookings
      WHERE court = NEW.court AND booking_date = NEW.booking_date AND start_time = NEW.start_time
        AND cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Este horário já está ocupado ou com outra pré-reserva em andamento.';
    END IF;
  END IF;


  _slot_ts     := (NEW.booking_date::text || ' ' || NEW.start_time::text)::timestamp
                  AT TIME ZONE 'America/Recife';
  _slot_end_ts := (NEW.booking_date::text || ' ' || NEW.end_time::text)::timestamp
                  AT TIME ZONE 'America/Recife';


  RETURN NEW;
END;
$$;


--
-- Name: court_bookings_waitlist_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.court_bookings_waitlist_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.process_court_waitlist_releases(OLD.booking_date, OLD.start_time, OLD.end_time);
    RETURN OLD;
  END IF;

  IF NEW.cancelled_at IS NOT NULL AND (OLD.cancelled_at IS NULL) THEN
    PERFORM public.process_court_waitlist_releases(NEW.booking_date, NEW.start_time, NEW.end_time);
    RETURN NEW;
  END IF;

  IF NEW.cancelled_at IS NULL AND (
       OLD.start_time IS DISTINCT FROM NEW.start_time
    OR OLD.end_time   IS DISTINCT FROM NEW.end_time
    OR OLD.court      IS DISTINCT FROM NEW.court
    OR OLD.booking_date IS DISTINCT FROM NEW.booking_date
  ) THEN
    PERFORM public.process_court_waitlist_releases(OLD.booking_date, OLD.start_time, OLD.end_time);
    IF OLD.booking_date IS DISTINCT FROM NEW.booking_date THEN
      PERFORM public.process_court_waitlist_releases(NEW.booking_date, NEW.start_time, NEW.end_time);
    END IF;
  END IF;

  RETURN NEW;
END; $$;


--
-- Name: create_substitute_schedule(uuid, uuid, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_substitute_schedule(p_original_schedule_id uuid, p_substitute_client_id uuid, p_valid_from date, p_valid_until date, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_orig  public.client_schedules%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'recepcionista'::app_role) OR
    public.has_role(auth.uid(), 'diretoria'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;

  IF p_valid_from IS NULL OR p_valid_until IS NULL OR p_valid_until < p_valid_from THEN
    RAISE EXCEPTION 'Intervalo de datas inválido';
  END IF;

  SELECT * INTO v_orig FROM public.client_schedules WHERE id = p_original_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Horário fixo original não encontrado';
  END IF;

  -- Marca o titular como liberado no período (exceção dia-inteiro por intervalo)
  INSERT INTO public.client_schedule_exceptions
    (client_schedule_id, exception_date, range_end, reason, created_by)
  VALUES
    (p_original_schedule_id, p_valid_from, p_valid_until, 'Substituição temporária', auth.uid());

  -- Cria o fixo do substituto restrito ao período
  INSERT INTO public.client_schedules
    (client_id, teacher_id, weekday, start_time, end_time, court, notes,
     valid_from, valid_until)
  VALUES
    (p_substitute_client_id, v_orig.teacher_id, v_orig.weekday,
     v_orig.start_time, v_orig.end_time, v_orig.court,
     COALESCE(p_notes, 'Substituto de ' || v_orig.client_id::text),
     p_valid_from, p_valid_until)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;


--
-- Name: debt_limit_account_entries_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_account_entries_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.debt_limit_check_and_alert(COALESCE(NEW.client_id, OLD.client_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: debt_limit_add_exception(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_add_exception(_client_id uuid, _reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'diretoria'::public.app_role) THEN
    RAISE EXCEPTION 'Somente Diretoria pode gerenciar exceções do limite de débito';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.debt_limit_exceptions WHERE client_id = _client_id AND active) THEN
    RAISE EXCEPTION 'Cliente já está na lista de exceções';
  END IF;

  RETURN public._debt_limit_add_exception_internal(
    _client_id, NULLIF(btrim(COALESCE(_reason, '')), ''), auth.uid()
  );
END;
$$;


--
-- Name: debt_limit_alerts_list(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_alerts_list() RETURNS TABLE(alert_id uuid, client_id uuid, full_name text, phone text, debt_amount numeric, reached_date date, created_at timestamp with time zone, category_name text, has_fixed_schedule boolean, next_booking_id uuid, next_booking_date date, next_booking_start_time time without time zone, next_booking_end_time time without time zone, next_booking_court smallint, next_fixed_schedule_id uuid, next_fixed_date date, next_fixed_start_time time without time zone, next_fixed_end_time time without time zone, next_fixed_court smallint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _c RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  FOR _c IN
    SELECT cs.client_id AS id
    FROM public.client_schedules cs
    WHERE (cs.valid_from IS NULL OR cs.valid_from <= public.recife_today())
      AND (cs.valid_until IS NULL OR cs.valid_until >= public.recife_today())
      AND NOT EXISTS (
        SELECT 1 FROM public.debt_limit_exceptions e WHERE e.client_id = cs.client_id AND e.active
      )
    UNION
    SELECT c.id
    FROM public.clients c
    JOIN public.client_categories cc ON cc.id = c.category_id
    WHERE c.active
      AND lower(cc.name) = 'mensalista'
      AND NOT EXISTS (
        SELECT 1 FROM public.debt_limit_exceptions e WHERE e.client_id = c.id AND e.active
      )
  LOOP
    PERFORM public.debt_limit_check_and_alert(_c.id);
  END LOOP;

  RETURN QUERY
  SELECT
    a.id,
    c.id,
    c.full_name,
    c.phone,
    -public.client_account_balance(c.id),
    a.reached_date,
    a.created_at,
    cc.name,
    EXISTS (
      SELECT 1 FROM public.client_schedules cs
      WHERE cs.client_id = c.id
        AND (cs.valid_from IS NULL OR cs.valid_from <= public.recife_today())
        AND (cs.valid_until IS NULL OR cs.valid_until >= public.recife_today())
    ),
    nb.id,
    nb.booking_date,
    nb.start_time,
    nb.end_time,
    nb.court,
    nf.id,
    nf.next_date,
    nf.start_time,
    nf.end_time,
    nf.court
  FROM public.debt_limit_alerts a
  JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.client_categories cc ON cc.id = c.category_id
  LEFT JOIN LATERAL (
    SELECT cb.id, cb.booking_date, cb.start_time, cb.end_time, cb.court
    FROM public.court_bookings cb
    WHERE cb.client_id = c.id
      AND cb.cancelled_at IS NULL
      AND cb.booking_date >= public.recife_today()
    ORDER BY cb.booking_date, cb.start_time
    LIMIT 1
  ) nb ON true
  LEFT JOIN LATERAL (
    SELECT
      cs.id,
      cs.start_time,
      cs.end_time,
      cs.court,
      (public.recife_today() + ((cs.weekday - EXTRACT(DOW FROM public.recife_today())::int + 7) % 7))::date AS next_date
    FROM public.client_schedules cs
    WHERE cs.client_id = c.id
      AND (cs.valid_from IS NULL OR cs.valid_from <= public.recife_today())
      AND (cs.valid_until IS NULL OR cs.valid_until >= public.recife_today())
    ORDER BY ((cs.weekday - EXTRACT(DOW FROM public.recife_today())::int + 7) % 7), cs.start_time
    LIMIT 1
  ) nf ON nb.id IS NULL
  WHERE a.status = 'active'
  ORDER BY (-public.client_account_balance(c.id)) DESC;
END;
$$;


--
-- Name: debt_limit_cancel_fixed_occurrence(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_cancel_fixed_occurrence(_client_schedule_id uuid, _date date, _reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT client_id INTO _client_id FROM public.client_schedules WHERE id = _client_schedule_id;
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'Horário fixo não encontrado';
  END IF;

  DELETE FROM public.client_schedule_exceptions
    WHERE client_schedule_id = _client_schedule_id
      AND exception_date = _date
      AND start_time IS NULL
      AND end_time IS NULL;

  INSERT INTO public.client_schedule_exceptions (client_schedule_id, exception_date, reason, created_by)
  VALUES (_client_schedule_id, _date, NULLIF(btrim(COALESCE(_reason, '')), ''), auth.uid());

  RETURN true;
END;
$$;


--
-- Name: debt_limit_check_and_alert(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_check_and_alert(_client_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _settings public.debt_limit_settings%ROWTYPE;
  _has_fixed_schedule boolean;
  _is_mensalista_category boolean;
  _balance numeric;
  _alert_id uuid;
  _u RECORD;
BEGIN
  SELECT * INTO _settings FROM public.debt_limit_settings WHERE id = true;
  IF _settings.id IS NULL OR public.recife_today() < _settings.rule_start_date THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_schedules cs
    WHERE cs.client_id = _client_id
      AND (cs.valid_from IS NULL OR cs.valid_from <= public.recife_today())
      AND (cs.valid_until IS NULL OR cs.valid_until >= public.recife_today())
  ) INTO _has_fixed_schedule;

  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.client_categories cc ON cc.id = c.category_id
    WHERE c.id = _client_id AND lower(cc.name) = 'mensalista'
  ) INTO _is_mensalista_category;

  IF NOT (_has_fixed_schedule OR _is_mensalista_category) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.debt_limit_exceptions
    WHERE client_id = _client_id AND active
  ) THEN
    RETURN false;
  END IF;

  _balance := public.client_account_balance(_client_id);
  IF _balance > -_settings.limit_amount THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.debt_limit_alerts WHERE client_id = _client_id AND status = 'active'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.debt_limit_alerts (client_id, debt_at_creation, reached_date, created_by)
  VALUES (_client_id, -_balance, public.recife_today(), auth.uid())
  ON CONFLICT (client_id) WHERE status = 'active' DO NOTHING
  RETURNING id INTO _alert_id;

  IF _alert_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.debt_limit_alert_events (alert_id, event_type, actor, debt_at_event)
  VALUES (_alert_id, 'created', auth.uid(), -_balance);

  INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
  SELECT
    'debt_limit_alert_created',
    _client_id,
    ur.user_id,
    'Limite de débito atingido',
    (SELECT full_name FROM public.clients WHERE id = _client_id)
      || ' atingiu débito de ' || to_char(-_balance, 'FM999999990.00') || ' (limite: '
      || to_char(_settings.limit_amount, 'FM999999990.00') || ')',
    false,
    jsonb_build_object('alert_id', _alert_id, 'client_id', _client_id),
    'debt_limit_alert_created:' || _alert_id::text || ':' || ur.user_id::text
  FROM public.user_roles ur
  WHERE ur.role IN ('admin'::public.app_role, 'diretoria'::public.app_role, 'recepcionista'::public.app_role)
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN true;
END;
$$;


--
-- Name: debt_limit_excepted_client_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_excepted_client_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT client_id FROM public.debt_limit_exceptions WHERE active;
$$;


--
-- Name: debt_limit_is_client_excepted(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_is_client_excepted(_client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.debt_limit_exceptions WHERE client_id = _client_id AND active
  );
$$;


--
-- Name: debt_limit_notify_tomorrow_bookings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_notify_tomorrow_bookings() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tomorrow DATE := public.recife_today() + 1;
  _b RECORD;
  _u RECORD;
  _title TEXT;
  _body TEXT;
BEGIN
  FOR _b IN
    SELECT
      cb.id AS booking_id, cb.client_id, cb.court, cb.start_time, cb.end_time,
      c.full_name, -public.client_account_balance(c.id) AS debt_amount
    FROM public.court_bookings cb
    JOIN public.clients c ON c.id = cb.client_id
    JOIN public.debt_limit_alerts a ON a.client_id = cb.client_id AND a.status = 'active'
    WHERE cb.cancelled_at IS NULL
      AND cb.booking_date = _tomorrow
  LOOP
    _title := 'Cliente acima do limite tem locação amanhã';
    _body := format(
      '%s está com débito de %s e tem Q%s %s-%s amanhã. Considere avisar hoje.',
      _b.full_name,
      to_char(_b.debt_amount, 'FM999999990.00'),
      _b.court,
      to_char(_b.start_time, 'HH24:MI'),
      to_char(_b.end_time, 'HH24:MI')
    );

    FOR _u IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin'::public.app_role, 'diretoria'::public.app_role, 'recepcionista'::public.app_role)
    LOOP
      INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
      VALUES (
        'debt_limit_booking_tomorrow',
        _b.client_id,
        _u.user_id,
        _title,
        _body,
        false,
        jsonb_build_object('booking_id', _b.booking_id, 'client_id', _b.client_id, 'debt_amount', _b.debt_amount),
        'debt_limit_booking_tomorrow:' || _b.booking_id::text || ':' || _u.user_id::text || ':' || _tomorrow::text
      )
      ON CONFLICT (dedup_key) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;


--
-- Name: debt_limit_regularization_breakdown(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_regularization_breakdown(_client_id uuid) RETURNS TABLE(debt_amount numeric, remaining_sessions integer, remaining_sessions_amount numeric, total_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _sessions RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _sessions FROM public._client_remaining_sessions_amount(_client_id);

  RETURN QUERY SELECT
    -public.client_account_balance(_client_id),
    _sessions.session_count,
    _sessions.session_amount,
    (-public.client_account_balance(_client_id)) + _sessions.session_amount;
END;
$$;


--
-- Name: debt_limit_remove_exception(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_remove_exception(_exception_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'diretoria'::public.app_role) THEN
    RAISE EXCEPTION 'Somente Diretoria pode gerenciar exceções do limite de débito';
  END IF;

  UPDATE public.debt_limit_exceptions
    SET active = false, deactivated_by = auth.uid(), deactivated_at = now()
    WHERE id = _exception_id AND active = true;

  RETURN FOUND;
END;
$$;


--
-- Name: debt_limit_reopen_alert(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_reopen_alert(_alert_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT client_id INTO _client_id FROM public.debt_limit_alerts
    WHERE id = _alert_id AND status = 'resolved';
  IF _client_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.debt_limit_alerts WHERE client_id = _client_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Já existe um alerta ativo para este cliente';
  END IF;

  UPDATE public.debt_limit_alerts
    SET status = 'active', reopened_by = auth.uid(), reopened_at = now()
    WHERE id = _alert_id;

  INSERT INTO public.debt_limit_alert_events (alert_id, event_type, actor)
  VALUES (_alert_id, 'reopened', auth.uid());

  RETURN true;
END;
$$;


--
-- Name: debt_limit_resolve_alert(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_resolve_alert(_alert_id uuid, _note text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_id uuid;
  _balance numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
    OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  UPDATE public.debt_limit_alerts
    SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
        resolved_note = NULLIF(btrim(COALESCE(_note, '')), '')
    WHERE id = _alert_id AND status = 'active'
    RETURNING client_id INTO _client_id;

  IF _client_id IS NULL THEN
    RETURN false;
  END IF;

  _balance := public.client_account_balance(_client_id);

  INSERT INTO public.debt_limit_alert_events (alert_id, event_type, actor, note, debt_at_event)
  VALUES (_alert_id, 'resolved', auth.uid(), NULLIF(btrim(COALESCE(_note, '')), ''), -_balance);

  RETURN true;
END;
$$;


--
-- Name: debt_limit_slot_price(smallint, smallint, time without time zone, time without time zone, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debt_limit_slot_price(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _category_id uuid, _ref_date date) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _start_min INT := EXTRACT(HOUR FROM _start)::int * 60 + EXTRACT(MINUTE FROM _start)::int;
  _end_min INT := EXTRACT(HOUR FROM _end)::int * 60 + EXTRACT(MINUTE FROM _end)::int;
  _minute INT;
  _best_price NUMERIC;
  _total NUMERIC := 0;
BEGIN
  IF _end_min <= _start_min THEN
    RETURN 0;
  END IF;

  FOR _minute IN _start_min .. (_end_min - 1) LOOP
    SELECT pt.price_per_hour INTO _best_price
    FROM public.price_table pt
    WHERE pt.weekday = _weekday
      AND pt.starts_on IS NULL
      AND pt.ends_on IS NULL
      AND (pt.categories IS NULL OR array_length(pt.categories, 1) IS NULL OR _category_id = ANY(pt.categories))
      AND (pt.courts IS NULL OR array_length(pt.courts, 1) IS NULL OR _court = ANY(pt.courts))
      AND (EXTRACT(HOUR FROM pt.start_time)::int * 60 + EXTRACT(MINUTE FROM pt.start_time)::int) <= _minute
      AND (EXTRACT(HOUR FROM pt.end_time)::int * 60 + EXTRACT(MINUTE FROM pt.end_time)::int) > _minute
    ORDER BY
      array_length(pt.courts, 1) ASC NULLS LAST,
      array_length(pt.categories, 1) ASC NULLS LAST,
      (EXTRACT(HOUR FROM pt.end_time)::int * 60 + EXTRACT(MINUTE FROM pt.end_time)::int)
        - (EXTRACT(HOUR FROM pt.start_time)::int * 60 + EXTRACT(MINUTE FROM pt.start_time)::int) ASC,
      pt.price_per_hour ASC
    LIMIT 1;

    IF _best_price IS NOT NULL THEN
      _total := _total + _best_price / 60.0;
    END IF;
  END LOOP;

  RETURN ROUND(_total, 2);
END;
$$;


--
-- Name: enforce_portal_cancel_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_portal_cancel_only() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  is_staff boolean;
  is_portal_owner boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','diretoria','recepcionista','professor')
  ) INTO is_staff;

  IF is_staff THEN
    RETURN NEW;
  END IF;

  -- Only enforce cancel-only rule against portal owners of this specific booking.
  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users cpu
    WHERE cpu.user_id = auth.uid() AND cpu.client_id = OLD.client_id
  ) INTO is_portal_owner;

  IF NOT is_portal_owner THEN
    RETURN NEW;
  END IF;

  IF NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'Portal só pode cancelar reservas';
  END IF;

  IF NEW.court IS DISTINCT FROM OLD.court
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
     OR NEW.guest_type IS DISTINCT FROM OLD.guest_type
     OR NEW.guest_name IS DISTINCT FROM OLD.guest_name
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.charge_id IS DISTINCT FROM OLD.charge_id
     OR NEW.charge_applied IS DISTINCT FROM OLD.charge_applied
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Portal só pode alterar campos de cancelamento';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_recep_account_entries_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_recep_account_entries_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- UPDATE em cascata vindo do trigger de payments (payment_update_account_entry):
  -- o entry_type/client_id computados lá são a fonte da verdade pro
  -- lançamento ligado ao pagamento, não devem ser revertidos aqui.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Skip enforcement for admin/diretoria (full privilege)
  IF public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'diretoria'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Preserve audit / structural fields for recepcionista updates
  NEW.recorded_by := OLD.recorded_by;
  NEW.created_at  := OLD.created_at;
  NEW.client_id   := OLD.client_id;
  NEW.entry_type  := OLD.entry_type;

  -- Basic amount sanity, mirroring insert-time expectations
  IF NEW.amount IS NULL OR NEW.amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount on account_entries update';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_recep_payments_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_recep_payments_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'diretoria'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Preserve audit and commission attribution set at creation time
  NEW.recorded_by        := OLD.recorded_by;
  NEW.created_at         := OLD.created_at;
  NEW.commission_user_id := OLD.commission_user_id;
  NEW.client_id          := OLD.client_id;
  NEW.charge_id          := OLD.charge_id;

  IF NEW.amount IS NULL OR NEW.amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount on payments update';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: fixed_schedule_conflicts(integer, date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_schedules cs
    WHERE cs.court = _court
      AND cs.weekday = EXTRACT(DOW FROM _date)::int
      AND cs.start_time < _end
      AND cs.end_time > _start
      AND public.client_schedule_valid_on(cs.valid_from, cs.valid_until, _date)
      AND NOT public.client_schedule_exception_covers(cs.id, _date, _start, _end)
  );
$$;


--
-- Name: fixed_waitlist_assign(uuid, uuid, date, integer, text, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_assign(_entry_id uuid, _teacher_id uuid DEFAULT NULL::uuid, _valid_from date DEFAULT NULL::date, _valid_months integer DEFAULT NULL::integer, _notes text DEFAULT NULL::text, _court smallint DEFAULT NULL::smallint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry public.fixed_court_waitlist%ROWTYPE;
  _target SMALLINT;
  _vf DATE;
  _vu DATE;
  _new_schedule_id UUID;
  _wd_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretoria')
    OR public.has_role(auth.uid(),'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _entry FROM public.fixed_court_waitlist WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada.');
  END IF;
  IF _entry.status NOT IN ('waiting','notified','contacted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Essa solicitação não está mais aguardando.');
  END IF;
  IF _entry.client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação sem cliente vinculado.');
  END IF;

  IF _entry.court IS NULL OR _entry.court = 0 THEN
    _target := _court;
  ELSE
    _target := COALESCE(_court, _entry.court);
  END IF;

  IF _target IS NULL OR _target < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escolha a quadra que vagou.');
  END IF;
  IF _entry.court = 0 AND _target = 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Essa inscrição é só para pickleball — a quadra 1 é a de tênis.');
  END IF;
  IF _entry.court > 0 AND _target <> _entry.court THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Essa inscrição é para a Quadra ' || _entry.court || '.');
  END IF;
  -- Só existem as quadras 1 a 4 (1 = tênis, 2 a 4 = pickleball).
  IF _target > 4 THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Quadra ' || _target || ' ainda não está habilitada pra reservas no sistema — libere-a antes de atribuir este horário.');
  END IF;
  IF NOT public._fixed_court_free(_target, _entry.desired_weekday, _entry.start_time, _entry.end_time) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'A Quadra ' || _target || ' já tem fixo nesse dia/horário — escolha uma quadra livre.');
  END IF;

  _vf := COALESCE(_valid_from, public.recife_today());
  _vu := CASE WHEN _valid_months IS NULL THEN NULL
    ELSE (_vf + (_valid_months || ' months')::interval)::date END;

  INSERT INTO public.client_schedules (
    client_id, teacher_id, weekday, start_time, end_time, court, notes, valid_from, valid_until
  ) VALUES (
    _entry.client_id, COALESCE(_teacher_id, _entry.requested_by_teacher_id), _entry.desired_weekday,
    _entry.start_time, _entry.end_time, _target, _notes, _vf, _vu
  )
  RETURNING id INTO _new_schedule_id;

  UPDATE public.fixed_court_waitlist
  SET status = 'fulfilled', resulting_schedule_id = _new_schedule_id, confirmed_at = now(), updated_at = now()
  WHERE id = _entry_id;

  IF _entry.user_id IS NOT NULL THEN
    _wd_name := (ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[_entry.desired_weekday + 1];
    INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'fixed_waitlist_assigned',
      _entry.client_id,
      _entry.user_id,
      'Horário fixo atribuído!',
      'Seu horário fixo (Quadra ' || _target || ', ' || _wd_name || ' ' ||
        to_char(_entry.start_time,'HH24:MI') || '–' || to_char(_entry.end_time,'HH24:MI') || ') foi confirmado.',
      false,
      jsonb_build_object('entry_id', _entry.id, 'schedule_id', _new_schedule_id),
      'fixed_waitlist_assigned:' || _entry.id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  PERFORM public._notify_fixed_waitlist_position_changed(
    _entry.court, _entry.desired_weekday, _entry.start_time, _entry.end_time, _entry.id, _entry.id
  );

  RETURN jsonb_build_object('ok', true, 'schedule_id', _new_schedule_id, 'valid_until', _vu);
END;
$$;


--
-- Name: fixed_waitlist_free_matches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_free_matches() RETURNS TABLE(entry_id uuid, person_name text, desired_weekday smallint, start_time time without time zone, end_time time without time zone, pref smallint, free_courts smallint[], called boolean, slot_free smallint[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretoria')
    OR public.has_role(auth.uid(),'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  RETURN QUERY SELECT * FROM public._fixed_waitlist_free_matches();
END;
$$;


--
-- Name: fixed_waitlist_join(smallint, smallint, time without time zone, time without time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_join(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _self_client_id UUID;
  _teacher_id UUID;
  _beneficiary_client_id UUID;
  _req_teacher_id UUID;
  _src TEXT;
  _open TIME;
  _close TIME;
  _existing public.fixed_court_waitlist%ROWTYPE;
  _inserted public.fixed_court_waitlist%ROWTYPE;
  _pos RECORD;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authenticated');
  END IF;

  IF _start IS NULL OR _end IS NULL OR _end - _start <> interval '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'O horário deve ter duração de 1 hora.');
  END IF;

  SELECT open_time, close_time INTO _open, _close
  FROM public.fixed_waitlist_court_hours
  WHERE court = _court AND weekday = _weekday;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Essa quadra não tem horário configurado para esse dia da semana.');
  END IF;

  IF _start < _open OR _end > _close THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Horário fora do funcionamento dessa quadra nesse dia.');
  END IF;

  IF MOD(EXTRACT(EPOCH FROM (_start - _open))::int, 3600) <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esse horário não bate com a grade de horários dessa quadra.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.fixed_waitlist_court_settings s
    WHERE s.court = _court AND s.active
      AND public.recife_today() BETWEEN s.opens_on AND s.closes_on
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A fila dessa quadra não está aberta no momento.');
  END IF;

  SELECT c.id INTO _self_client_id
  FROM public.client_portal_users cpu
  JOIN public.clients c ON c.id = cpu.client_id
  WHERE cpu.user_id = _uid
  LIMIT 1;

  SELECT t.id INTO _teacher_id FROM public.teachers t WHERE t.user_id = _uid LIMIT 1;

  IF _teacher_id IS NOT NULL THEN
    IF _client_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Selecione o aluno.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _client_id AND (
        EXISTS (SELECT 1 FROM public.client_schedules cs WHERE cs.client_id = c.id AND cs.teacher_id = _teacher_id)
        OR EXISTS (SELECT 1 FROM public.court_bookings cb WHERE cb.client_id = c.id AND cb.teacher_id = _teacher_id)
      )
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Esse aluno não está vinculado a você.');
    END IF;
    _beneficiary_client_id := _client_id;
    _req_teacher_id := _teacher_id;
    _src := 'portal_professor';
  ELSIF _self_client_id IS NOT NULL THEN
    _beneficiary_client_id := _self_client_id;
    _req_teacher_id := NULL;
    _src := 'portal_cliente';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário sem vínculo de cliente ou professor.');
  END IF;

  SELECT * INTO _existing
  FROM public.fixed_court_waitlist w
  WHERE w.court = _court AND w.desired_weekday = _weekday
    AND w.start_time = _start AND w.end_time = _end
    AND w.client_id = _beneficiary_client_id
    AND w.status IN ('waiting','notified','contacted')
  ORDER BY w.created_at ASC, w.id ASC
  LIMIT 1;

  IF FOUND THEN
    SELECT * INTO _pos FROM public._fixed_waitlist_position(_existing.id);
    RETURN jsonb_build_object('ok', true, 'already', true, 'id', _existing.id, 'position', _pos.queue_position, 'total', _pos.total, 'tied', _pos.tied);
  END IF;

  INSERT INTO public.fixed_court_waitlist (
    client_id, desired_weekday, start_time, end_time, court,
    requested_by_teacher_id, user_id, source, status, created_by
  ) VALUES (
    _beneficiary_client_id, _weekday, _start, _end, _court,
    _req_teacher_id, _uid, _src, 'waiting'::public.waitlist_status, _uid
  )
  RETURNING * INTO _inserted;

  SELECT * INTO _pos FROM public._fixed_waitlist_position(_inserted.id);
  RETURN jsonb_build_object('ok', true, 'already', false, 'id', _inserted.id, 'position', _pos.queue_position, 'total', _pos.total, 'tied', _pos.tied);
END;
$$;


--
-- Name: fixed_waitlist_leave(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_leave(_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row public.fixed_court_waitlist%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.fixed_court_waitlist WHERE id = _id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT (
    _row.user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretoria')
    OR public.has_role(auth.uid(),'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF _row.status NOT IN ('waiting','notified','contacted') THEN
    RETURN false;
  END IF;

  UPDATE public.fixed_court_waitlist
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = 'Cancelado pelo solicitante', updated_at = now()
  WHERE id = _id;

  PERFORM public._notify_fixed_waitlist_position_changed(
    _row.court, _row.desired_weekday, _row.start_time, _row.end_time, _row.id, _row.id
  );

  RETURN true;
END;
$$;


--
-- Name: fixed_waitlist_notify_expiring_schedules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_notify_expiring_schedules() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _today DATE := public.recife_today();
  _s RECORD;
  _u RECORD;
  _title TEXT;
  _body TEXT;
  _wd_name TEXT;
BEGIN
  FOR _s IN
    SELECT cs.id AS schedule_id, cs.client_id, cs.court, cs.weekday, cs.start_time, cs.end_time,
      cs.valid_until, c.full_name
    FROM public.client_schedules cs
    JOIN public.clients c ON c.id = cs.client_id
    WHERE cs.valid_until IS NOT NULL
      AND cs.valid_until BETWEEN _today AND _today + 14
      AND EXISTS (
        SELECT 1 FROM public.fixed_court_waitlist w WHERE w.resulting_schedule_id = cs.id
      )
  LOOP
    _wd_name := (ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[_s.weekday + 1];
    _title := 'Horário fixo (fila) vencendo';
    _body := format(
      '%s — Quadra %s, %s %s-%s — vigência termina em %s. Reveja se renova.',
      _s.full_name, _s.court, _wd_name,
      to_char(_s.start_time,'HH24:MI'), to_char(_s.end_time,'HH24:MI'),
      to_char(_s.valid_until, 'DD/MM/YYYY')
    );

    FOR _u IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin'::public.app_role,'diretoria'::public.app_role,'recepcionista'::public.app_role)
    LOOP
      INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
      VALUES (
        'fixed_schedule_expiring', _s.client_id, _u.user_id, _title, _body, false,
        jsonb_build_object('schedule_id', _s.schedule_id, 'valid_until', _s.valid_until),
        'fixed_schedule_expiring:' || _s.schedule_id::text || ':' || _u.user_id::text || ':' || _today::text
      )
      ON CONFLICT (dedup_key) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;


--
-- Name: fixed_waitlist_notify_free_slots(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_notify_free_slots() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _today DATE := public.recife_today();
  _lines TEXT[];
  _ids TEXT;
  _n INT;
  _title TEXT;
  _body TEXT;
  _u RECORD;
BEGIN
  SELECT
    array_agg(
      format('• %s %s–%s — %s (%s): %s',
        initcap((ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[m.desired_weekday + 1]),
        to_char(m.start_time,'HH24:MI'), to_char(m.end_time,'HH24:MI'),
        m.person_name,
        CASE WHEN m.pref IS NULL THEN 'qualquer' WHEN m.pref = 0 THEN 'pickleball' ELSE public._court_short(m.pref) END,
        (SELECT string_agg(public._court_short(f), ', ') FROM unnest(m.free_courts) f)
      )
      ORDER BY (m.desired_weekday + 6) % 7, m.start_time
    ),
    string_agg(m.entry_id::text || ':' || array_to_string(m.free_courts, ','), '|' ORDER BY m.entry_id),
    COUNT(*)
  INTO _lines, _ids, _n
  FROM public._fixed_waitlist_free_matches() m
  WHERE m.called AND m.free_courts[1] <> 10;

  IF COALESCE(_n, 0) = 0 THEN
    RETURN;
  END IF;

  _title := CASE WHEN _n = 1
    THEN 'Quadra livre para a fila fixa: 1 cliente para chamar'
    ELSE format('Quadras livres para a fila fixa: %s clientes para chamar', _n)
  END;
  _body := array_to_string(_lines, E'\n')
    || E'\nFale com o cliente e, se ele quiser, clique em Atribuir na Lista de espera > Fixa.';

  FOR _u IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    WHERE ur.role IN ('admin'::public.app_role,'diretoria'::public.app_role,'recepcionista'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'fixed_waitlist_free_slot', NULL, _u.user_id, _title, _body, false,
      jsonb_build_object('count', _n),
      'fixed_waitlist_free_slot:' || _u.user_id::text || ':' || _today::text || ':' || md5(_ids)
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$$;


--
-- Name: fixed_waitlist_position(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_position(_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row public.fixed_court_waitlist%ROWTYPE;
  _pos RECORD;
BEGIN
  SELECT * INTO _row FROM public.fixed_court_waitlist WHERE id = _id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not found');
  END IF;

  IF NOT (
    _row.user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretoria')
    OR public.has_role(auth.uid(),'recepcionista')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão');
  END IF;

  SELECT * INTO _pos FROM public._fixed_waitlist_position(_id);
  RETURN jsonb_build_object('ok', true, 'position', _pos.queue_position, 'total', _pos.total, 'tied', _pos.tied, 'status', _row.status);
END;
$$;


--
-- Name: fixed_waitlist_remove(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fixed_waitlist_remove(_entry_id uuid, _reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry public.fixed_court_waitlist%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretoria')
    OR public.has_role(auth.uid(),'recepcionista')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _entry FROM public.fixed_court_waitlist WHERE id = _entry_id;
  IF NOT FOUND OR _entry.status NOT IN ('waiting','notified','contacted') THEN
    RETURN false;
  END IF;

  UPDATE public.fixed_court_waitlist
  SET status = 'declined', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = COALESCE(_reason, 'Removido pela equipe'), updated_at = now()
  WHERE id = _entry_id;

  PERFORM public._notify_fixed_waitlist_position_changed(
    _entry.court, _entry.desired_weekday, _entry.start_time, _entry.end_time, _entry.id, _entry.id
  );

  RETURN true;
END;
$$;


--
-- Name: get_court_waitlist_counts_for_date(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_court_waitlist_counts_for_date(_date date) RETURNS TABLE(court integer, start_time time without time zone, end_time time without time zone, total integer, mine boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NULL::int AS court,
         w.start_time,
         w.end_time,
         COUNT(*)::int AS total,
         BOOL_OR(w.user_id = auth.uid()) AS mine
    FROM public.court_waitlist w
   WHERE w.desired_date = _date
     AND w.status IN ('waiting','notified','contacted')
   GROUP BY w.start_time, w.end_time;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );
  RETURN NEW;
END;
$$;


--
-- Name: has_page_access(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_page_access(_user_id uuid, _page_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    -- Admin sempre tem acesso total
    public.has_role(_user_id, 'admin')
    OR (
      -- Diretoria/Recepcionista: default true, salvo bloqueio explícito
      (public.has_role(_user_id, 'diretoria') OR public.has_role(_user_id, 'recepcionista'))
      AND COALESCE(
        (SELECT granted FROM public.user_permissions
          WHERE user_id = _user_id AND page_key = _page_key),
        true
      )
    )
    OR (
      -- Não-staff: acesso apenas a 'mapa' e apenas se for professor
      -- (ou tiver liberação explícita para 'mapa')
      NOT (
        public.has_role(_user_id, 'admin')
        OR public.has_role(_user_id, 'diretoria')
        OR public.has_role(_user_id, 'recepcionista')
      )
      AND _page_key = 'mapa'
      AND (
        public.has_role(_user_id, 'professor')
        OR COALESCE(
          (SELECT granted FROM public.user_permissions
            WHERE user_id = _user_id AND page_key = _page_key),
          false
        )
      )
    );
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: is_portal_client_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_portal_client_of(_client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users
    WHERE user_id = auth.uid() AND client_id = _client_id
  );
$$;


--
-- Name: is_ranking_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_ranking_booking(_booking_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT public.is_ranking_category(b.category_id)
  FROM public.court_bookings b
  WHERE b.id = _booking_id;
$$;


--
-- Name: is_ranking_category(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_ranking_category(_category_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_categories cc
    WHERE cc.id = _category_id
      AND lower(cc.name) IN ('ranking masculino', 'ranking feminino')
  );
$$;


--
-- Name: list_my_commission_sales(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone) RETURNS TABLE(id uuid, amount numeric, paid_at timestamp with time zone, recorded_by uuid, commission_user_id uuid, category_id uuid, client_id uuid, client_name text, category_name text, commission_percent numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id, p.amount, p.paid_at, p.recorded_by, p.commission_user_id,
         p.category_id, p.client_id, c.full_name, cat.name, cat.commission_percent
  FROM public.payments p
  LEFT JOIN public.clients c ON c.id = p.client_id
  LEFT JOIN public.client_categories cat ON cat.id = p.category_id
  WHERE p.is_new_plan_sale = true
    AND p.paid_at >= _from
    AND p.paid_at <= _to
    AND COALESCE(p.commission_user_id, p.recorded_by) = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
      OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
    )
  ORDER BY p.paid_at DESC;
$$;


--
-- Name: list_recepcionista_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_recepcionista_ids() RETURNS TABLE(user_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role = 'recepcionista'::public.app_role
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'diretoria'::public.app_role)
      OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)
    );
$$;


--
-- Name: log_audit_event(text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _name TEXT;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _action NOT IN ('create','update','delete') THEN
    RAISE EXCEPTION 'Invalid audit action: %', _action;
  END IF;
  IF _entity IS NULL OR length(btrim(_entity)) = 0 OR length(_entity) > 100 THEN
    RAISE EXCEPTION 'Invalid entity';
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.audit_logs(entity, entity_id, action, actor_id, actor_email, actor_name, details)
  VALUES (_entity, _entity_id, _action, _uid, _email, _name, COALESCE(_details, '{}'::jsonb));
END;
$$;


--
-- Name: mark_charge_paid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_charge_paid() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.charge_id IS NOT NULL THEN
    UPDATE public.monthly_charges
    SET status = 'paga', paid_at = NEW.paid_at
    WHERE id = NEW.charge_id AND status <> 'paga';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: move_booking_today(uuid, smallint, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _b public.court_bookings%ROWTYPE;
  _occ public.court_bookings%ROWTYPE;
  _og uuid[];
  _who text;
  _swapped_fixed jsonb := '[]'::jsonb;
BEGIN
  IF NOT (
    public.has_role(_uid, 'admin')
    OR public.has_role(_uid, 'diretoria')
    OR public.has_role(_uid, 'recepcionista')
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

  PERFORM pg_advisory_xact_lock(hashtext('move_fixed_today'), hashtext(_b.booking_date::text));

  SELECT array_agg(s.id) INTO _og
  FROM public.client_schedules s
  WHERE s.weekday = EXTRACT(DOW FROM _b.booking_date)::integer
    AND s.court = _court
    AND (s.valid_from IS NULL OR s.valid_from <= _b.booking_date)
    AND (s.valid_until IS NULL OR s.valid_until >= _b.booking_date)
    AND s.start_time < _end_time
    AND s.end_time > _start_time
    AND s.is_demo = _b.is_demo
    AND NOT public._fixed_is_off_today(s.id, _b.booking_date);

  SELECT * INTO _occ FROM public.court_bookings
  WHERE court = _court AND booking_date = _b.booking_date AND start_time = _start_time
    AND cancelled_at IS NULL AND id <> _b.id
  LIMIT 1;

  BEGIN
    PERFORM public.move_or_swap_booking(_booking_id, _court, _start_time, _end_time);

    IF _og IS NOT NULL THEN
      SELECT COALESCE(c.full_name, _b.guest_name, 'cliente') INTO _who
      FROM (SELECT 1) x LEFT JOIN public.clients c ON c.id = _b.client_id;

      INSERT INTO public.client_schedule_exceptions (
        client_schedule_id, exception_date, start_time, end_time, reason, created_by
      )
      SELECT s.id, _b.booking_date, NULL, NULL,
        'Trocado com ' || _who || ' (' || public._court_label(_court) || ' '
          || public._hhmi(_start_time) || '–' || public._hhmi(_end_time) || ')',
        _uid
      FROM public.client_schedules s WHERE s.id = ANY(_og);

      PERFORM public._materialize_swapped_fixed(
        _og, _b.booking_date, _b.court, _court, _occ.client_id, _occ.start_time
      );

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'client_id', s.client_id, 'name', COALESCE(c.full_name, 'cliente'),
        'start_time', s.start_time, 'end_time', s.end_time
      )), '[]'::jsonb) INTO _swapped_fixed
      FROM public.client_schedules s LEFT JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = ANY(_og);
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Não deu para mover: o destino ficaria com duas locações no mesmo horário. Nada foi alterado — confira o mapa e tente de novo.';
  END;

  RETURN jsonb_build_object(
    'from_court', _b.court,
    'to_court', _court,
    'swapped_fixed', _swapped_fixed
  );
END;
$$;


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


--
-- Name: teacher_map_schedules(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_map_schedules(_weekday integer, _date date DEFAULT NULL::date) RETURNS jsonb
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
      s.valid_from, s.valid_until,
      ((s.teacher_id IN (SELECT id FROM my_teacher))
        OR (c.teacher_id IN (SELECT id FROM my_teacher))) AS is_own,
      s.client_id,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'full_name', c.full_name) END AS clients,
      s.teacher_id,
      CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'name', t.name) END AS teachers,
      CASE WHEN (s.teacher_id IN (SELECT id FROM my_teacher))
             OR (c.teacher_id IN (SELECT id FROM my_teacher))
           THEN s.notes END AS notes
    FROM public.client_schedules s
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.teachers t ON t.id = s.teacher_id
    WHERE s.weekday = _weekday
      AND (_date IS NULL OR public.client_schedule_valid_on(s.valid_from, s.valid_until, _date))
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: validate_payment_court(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_payment_court() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.court IS NOT NULL AND (NEW.court < 1 OR NEW.court > 4) THEN
    RAISE EXCEPTION 'Quadra deve estar entre 1 e 4';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: visualizador_map_bookings(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.visualizador_map_bookings(_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'visualizador'::public.app_role)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      b.id, b.court, b.booking_date, b.start_time, b.end_time, b.source,
      b.client_id, b.teacher_id, b.guest_type, b.guest_name, b.notes,
      b.category_id, cat.name AS category_name, cat.color AS category_color,
      b.cancelled_at, b.cancel_reason,
      
      jsonb_build_object('id', c.id, 'full_name', c.full_name) AS clients,
      jsonb_build_object('id', t.id, 'name', t.name) AS teachers,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('client_id', p.client_id, 'full_name', pc.full_name))
        FROM public.court_booking_participants p
        JOIN public.clients pc ON pc.id = p.client_id
        WHERE p.booking_id = b.id
      ), '[]'::jsonb) AS participants
    FROM public.court_bookings b
    LEFT JOIN public.clients c ON c.id = b.client_id
    LEFT JOIN public.client_categories cat ON cat.id = b.category_id
    LEFT JOIN public.teachers t ON t.id = b.teacher_id
    WHERE b.booking_date = _date
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: visualizador_map_schedule_exceptions(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.visualizador_map_schedule_exceptions(_date date, _weekday integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'visualizador'::public.app_role)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      e.id, e.client_schedule_id, e.reason, e.start_time, e.end_time,
      e.exception_date, e.range_end, e.created_by, e.created_at
    FROM public.client_schedule_exceptions e
    JOIN public.client_schedules s ON s.id = e.client_schedule_id
    WHERE e.exception_date <= _date
      AND COALESCE(e.range_end, e.exception_date) >= _date
      AND s.weekday = _weekday
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: visualizador_map_schedules(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.visualizador_map_schedules(_weekday integer, _date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'visualizador'::public.app_role)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) FROM (
    SELECT
      s.id, s.client_id, s.teacher_id, s.weekday, s.start_time, s.end_time,
      s.court, s.notes, s.valid_from, s.valid_until,
      jsonb_build_object('id', c.id, 'full_name', c.full_name) AS clients,
      jsonb_build_object('id', t.id, 'name', t.name) AS teachers
    FROM public.client_schedules s
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.teachers t ON t.id = s.teacher_id
    WHERE s.weekday = _weekday
      AND (_date IS NULL OR (s.valid_from IS NULL OR s.valid_from <= _date))
      AND (_date IS NULL OR (s.valid_until IS NULL OR s.valid_until >= _date))
      AND EXISTS (SELECT 1 FROM gate)
  ) x;
$$;


--
-- Name: waitlist_acknowledge(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_acknowledge(_waitlist_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _name TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_uid,'admin'::public.app_role)
       OR public.has_role(_uid,'diretoria'::public.app_role)
       OR public.has_role(_uid,'recepcionista'::public.app_role)) THEN
    RAISE EXCEPTION 'sem permissao';
  END IF;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;
  INSERT INTO public.waitlist_acknowledgements (waitlist_id, user_id, actor_name)
  VALUES (_waitlist_id, _uid, _name)
  ON CONFLICT (waitlist_id, user_id) DO NOTHING;
END;
$$;


--
-- Name: waitlist_book_on_court(uuid, integer, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_book_on_court(_waitlist_id uuid, _court integer, _teacher_id uuid DEFAULT NULL::uuid, _teacher_set boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _w public.court_waitlist%ROWTYPE;
  _booking_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _w FROM public.court_waitlist WHERE id = _waitlist_id FOR UPDATE;
  IF _w.id IS NULL THEN
    RAISE EXCEPTION 'Pedido na lista de espera não encontrado';
  END IF;
  IF _w.status NOT IN ('waiting', 'notified', 'contacted', 'awaiting_confirmation') THEN
    RAISE EXCEPTION 'Este pedido não está mais ativo na fila';
  END IF;

  IF NOT (_court = ANY (public.waitlist_free_courts_for_entry(_waitlist_id))) THEN
    RAISE EXCEPTION 'A Q% não está livre de % a % — atualize a fila e escolha outra quadra',
      _court, to_char(_w.start_time, 'HH24:MI'), to_char(_w.end_time, 'HH24:MI');
  END IF;

  INSERT INTO public.court_bookings (
    court, booking_date, start_time, end_time, source,
    client_id, teacher_id, guest_name, created_by
  ) VALUES (
    _court, _w.desired_date, _w.start_time, _w.end_time, 'avulsa',
    _w.client_id, public.waitlist_resolve_teacher(_w, _teacher_id, _teacher_set),
    _w.guest_name, auth.uid()
  ) RETURNING id INTO _booking_id;

  -- Pedido de troca/antecipação: cancela a reserva original (mesma regra
  -- do waitlist_mark_and_book), senão o cliente fica com as duas.
  IF _w.source_booking_id IS NOT NULL THEN
    UPDATE public.court_bookings
      SET cancelled_at = now(),
          cancelled_by = auth.uid(),
          cancel_reason = 'Antecipação/troca de horário via lista de espera'
      WHERE id = _w.source_booking_id
        AND cancelled_at IS NULL;
  END IF;

  UPDATE public.court_waitlist
    SET status = 'fulfilled', resulting_booking_id = _booking_id, updated_at = now()
    WHERE id = _waitlist_id;

  RETURN _booking_id;
END;
$$;


--
-- Name: waitlist_court_block_is_free(date, integer, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_court_block_is_free(_date date, _court integer, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    exists (
      select 1
      from public.court_availability_overrides o
      where o.availability_date = _date
        and o.court = _court
        and o.active = true
        and o.cancelled_at is null
        and o.start_time <= _start
        and o.end_time >= _end
    )
    or (
      not exists (
        select 1
        from public.court_bookings b
        where b.booking_date = _date
          and b.court = _court
          and b.cancelled_at is null
          and b.start_time < _end
          and b.end_time > _start
      )
      and not exists (
        select 1
        from public.client_schedules s
        where s.court = _court
          and s.weekday = extract(dow from _date)::integer
          and public.client_schedule_valid_on(s.valid_from, s.valid_until, _date)
          and s.start_time < _end
          and s.end_time > _start
          and not public.client_schedule_exception_covers(
            s.id, _date, greatest(_start, s.start_time), least(_end, s.end_time)
          )
      )
    );
$$;


--
-- Name: waitlist_decline(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_decline(_waitlist_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _w public.court_waitlist%ROWTYPE;
  _title text;
  _body text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  UPDATE public.court_waitlist
    SET status='declined', updated_at=now()
    WHERE id = _waitlist_id
    RETURNING * INTO _w;

  IF _w.id IS NULL THEN
    RETURN;
  END IF;

  -- Avisa quem pediu (cliente ou professor) que o pedido não vai ser
  -- atendido desta vez, pra não ficar tentando de novo às cegas sem
  -- nenhum retorno.
  IF _w.client_id IS NOT NULL OR _w.teacher_id IS NOT NULL THEN
    _title := 'Sua vaga na lista de espera não foi atendida';
    _body := to_char(_w.desired_date, 'DD/MM/YYYY') || ', das ' ||
             to_char(_w.start_time, 'HH24:MI') || ' às ' || to_char(_w.end_time, 'HH24:MI') ||
             ' — desta vez não foi possível confirmar essa quadra pra você. Você pode entrar na lista de espera novamente se ainda tiver interesse.';

    INSERT INTO public.app_notifications
      (kind, client_id, title, body, requires_ack, metadata)
    VALUES (
      'waitlist_declined',
      _w.client_id,
      _title,
      _body,
      false,
      jsonb_build_object(
        'for_first', true,
        'waitlist_id', _w.id,
        'teacher_id', _w.teacher_id,
        'date', _w.desired_date,
        'start_time', _w.start_time::text,
        'end_time', _w.end_time::text
      )
    );
  END IF;
END;
$$;


--
-- Name: waitlist_free_courts_for_entry(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_free_courts_for_entry(_waitlist_id uuid) RETURNS integer[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _w public.court_waitlist%ROWTYPE;
  _result integer[];
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _w FROM public.court_waitlist WHERE id = _waitlist_id;
  IF _w.id IS NULL THEN
    RAISE EXCEPTION 'Pedido na lista de espera não encontrado';
  END IF;

  -- court NULL = qualquer quadra; 0 = pickleball (2 a 4); 1..4 = quadra específica
  SELECT COALESCE(array_agg(c ORDER BY c), '{}') INTO _result
  FROM generate_series(1, 4) c
  WHERE (_w.court IS NULL OR (_w.court = 0 AND c BETWEEN 2 AND 4) OR c = _w.court)
    AND public.waitlist_court_block_is_free(_w.desired_date, c, _w.start_time, _w.end_time)
    AND NOT EXISTS (
      SELECT 1 FROM public.court_bookings b
      WHERE b.booking_date = _w.desired_date
        AND b.court = c
        AND b.cancelled_at IS NULL
        AND b.start_time < _w.end_time
        AND b.end_time > _w.start_time
    );

  RETURN _result;
END;
$$;


--
-- Name: waitlist_fulfill(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_fulfill(_waitlist_id uuid, _booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  UPDATE public.court_waitlist
    SET status='fulfilled', resulting_booking_id=_booking_id, updated_at=now()
    WHERE id = _waitlist_id;
END; $$;


--
-- Name: waitlist_mark_and_book(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_mark_and_book(_waitlist_id uuid, _teacher_id uuid DEFAULT NULL::uuid, _teacher_set boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _w public.court_waitlist%ROWTYPE;
  _r record;
  _first_booking_id uuid;
  _booking_id uuid;
  _teacher uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO _w FROM public.court_waitlist WHERE id = _waitlist_id;
  IF _w.id IS NULL THEN
    RAISE EXCEPTION 'Pedido na lista de espera não encontrado';
  END IF;
  IF _w.status = 'fulfilled' THEN
    RAISE EXCEPTION 'Este pedido já foi atendido';
  END IF;
  IF _w.availability_plan IS NULL OR jsonb_array_length(_w.availability_plan) = 0 THEN
    RAISE EXCEPTION 'Sem plano de quadras disponível — atualize a lista de espera antes de marcar';
  END IF;

  _teacher := public.waitlist_resolve_teacher(_w, _teacher_id, _teacher_set);

  -- Agrupa blocos consecutivos (por horário) da MESMA quadra numa única
  -- reserva, em vez de criar uma linha de 1h por bloco do plano.
  FOR _r IN
    WITH blocks AS (
      SELECT (b->>'court')::integer AS court,
             (b->>'start')::time AS bstart,
             (b->>'end')::time AS bend,
             row_number() over (order by (b->>'start')::time) AS rn
      FROM jsonb_array_elements(_w.availability_plan) b
    ),
    grp AS (
      SELECT court, bstart, bend,
             rn - row_number() over (partition by court order by bstart) AS grp_key
      FROM blocks
    )
    SELECT court, min(bstart) AS bstart, max(bend) AS bend
    FROM grp
    GROUP BY court, grp_key
    ORDER BY bstart
  LOOP
    -- Revalida no momento do clique — o plano pode ter sido calculado
    -- minutos antes e a quadra pode já não estar mais livre.
    IF NOT public.waitlist_court_block_is_free(_w.desired_date, _r.court, _r.bstart, _r.bend) THEN
      RAISE EXCEPTION 'A Q% não está mais livre às %–% — atualize a lista de espera antes de marcar',
        _r.court, to_char(_r.bstart, 'HH24:MI'), to_char(_r.bend, 'HH24:MI');
    END IF;

    INSERT INTO public.court_bookings (
      court, booking_date, start_time, end_time, source,
      client_id, teacher_id, guest_name, created_by
    ) VALUES (
      _r.court, _w.desired_date, _r.bstart, _r.bend, 'avulsa',
      _w.client_id, _teacher, _w.guest_name, auth.uid()
    ) RETURNING id INTO _booking_id;

    IF _first_booking_id IS NULL THEN
      _first_booking_id := _booking_id;
    END IF;
  END LOOP;

  -- Pedido de troca/antecipação de uma reserva existente: cancela a
  -- reserva original no mesmo passo, senão o cliente fica com as duas
  -- (a nova + a antiga sobreposta) e cobrança duplicada.
  IF _w.source_booking_id IS NOT NULL THEN
    UPDATE public.court_bookings
      SET cancelled_at = now(),
          cancelled_by = auth.uid(),
          cancel_reason = 'Antecipação/troca de horário via lista de espera'
      WHERE id = _w.source_booking_id
        AND cancelled_at IS NULL;
  END IF;

  UPDATE public.court_waitlist
    SET status = 'fulfilled', resulting_booking_id = _first_booking_id, updated_at = now()
    WHERE id = _waitlist_id;

  RETURN _first_booking_id;
END;
$$;


--
-- Name: court_waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.court_waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    guest_name text,
    requested_by_teacher_id uuid,
    desired_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    court smallint,
    priority integer DEFAULT 0 NOT NULL,
    notes text,
    status public.waitlist_status DEFAULT 'waiting'::public.waitlist_status NOT NULL,
    resulting_booking_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    teacher_id uuid,
    notified_at timestamp with time zone,
    contacted_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    booking_id_created uuid,
    source text DEFAULT 'staff'::text,
    source_booking_id uuid,
    court_continuity text DEFAULT 'same_court'::text NOT NULL,
    availability_plan jsonb,
    CONSTRAINT court_waitlist_check CHECK ((start_time < end_time)),
    CONSTRAINT court_waitlist_continuity_chk CHECK ((court_continuity = ANY (ARRAY['same_court'::text, 'allow_court_change'::text]))),
    CONSTRAINT court_waitlist_requester_check CHECK (((client_id IS NOT NULL) OR (teacher_id IS NOT NULL) OR ((guest_name IS NOT NULL) AND (length(btrim(guest_name)) > 0))))
);


--
-- Name: waitlist_resolve_teacher(public.court_waitlist, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_resolve_teacher(_w public.court_waitlist, _teacher_id uuid, _teacher_set boolean) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN _teacher_set THEN _teacher_id
    ELSE COALESCE(
      _w.teacher_id,
      (SELECT c.teacher_id FROM public.clients c WHERE c.id = _w.client_id)
    )
  END;
$$;


--
-- Name: waitlist_set_awaiting(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waitlist_set_awaiting(_waitlist_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'diretoria')
       OR public.has_role(auth.uid(),'recepcionista')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  UPDATE public.court_waitlist SET status='awaiting_confirmation', updated_at=now()
    WHERE id = _waitlist_id AND status IN ('waiting','awaiting_confirmation');
END; $$;


--
-- Name: account_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    entry_type public.account_entry_type NOT NULL,
    amount numeric(12,2) NOT NULL,
    description text NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    payment_id uuid,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bucket text DEFAULT 'geral'::text NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT account_entries_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT account_entries_bucket_check CHECK ((bucket = 'geral'::text))
);

ALTER TABLE ONLY public.account_entries REPLICA IDENTITY FULL;


--
-- Name: app_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    client_id uuid,
    title text NOT NULL,
    body text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    requires_ack boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid,
    dedup_key text
);

ALTER TABLE ONLY public.app_notifications REPLICA IDENTITY FULL;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity text NOT NULL,
    entity_id uuid,
    action text NOT NULL,
    actor_id uuid,
    actor_email text,
    actor_name text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.audit_logs REPLICA IDENTITY FULL;


--
-- Name: booking_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    schedule_id uuid,
    booking_date date NOT NULL,
    status text DEFAULT 'notified'::text NOT NULL,
    notified_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cash_closings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_closings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    closing_date date NOT NULL,
    closed_by uuid NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    totals_system jsonb DEFAULT '{}'::jsonb NOT NULL,
    totals_counted jsonb DEFAULT '{}'::jsonb NOT NULL,
    differences jsonb DEFAULT '{}'::jsonb NOT NULL,
    pending_resolved jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stock_report jsonb,
    cash_user_id uuid,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: cleaning_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cleaning_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    supplier_id uuid,
    min_stock numeric DEFAULT 0 NOT NULL,
    current_stock numeric DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cleaning_products_unit_check CHECK ((unit = ANY (ARRAY['5_litros'::text, 'unitario'::text, 'pacote'::text, 'rolo'::text])))
);


--
-- Name: cleaning_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cleaning_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    supplier_id uuid,
    quantity numeric NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    total_price numeric(12,2) GENERATED ALWAYS AS ((quantity * unit_price)) STORED,
    purchase_date date NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stock_week_start date NOT NULL,
    CONSTRAINT cleaning_purchases_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT cleaning_purchases_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: cleaning_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cleaning_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    contact_name text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cleaning_weekly_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cleaning_weekly_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    week_start date NOT NULL,
    initial_qty numeric DEFAULT 0 NOT NULL,
    used_qty numeric DEFAULT 0 NOT NULL,
    balance_qty numeric GENERATED ALWAYS AS ((initial_qty - used_qty)) STORED,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    default_amount numeric(10,2) DEFAULT 0 NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    commission_percent numeric DEFAULT 0 NOT NULL,
    cancel_fee_amount numeric DEFAULT 0 NOT NULL,
    color text,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: client_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_followups (
    client_id uuid NOT NULL,
    message_sent boolean DEFAULT false NOT NULL,
    followup_date date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: client_portal_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_portal_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    email text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone text
);


--
-- Name: client_schedule_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_schedule_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_schedule_id uuid NOT NULL,
    attendance_date date NOT NULL,
    status text NOT NULL,
    payment_id uuid,
    amount numeric(12,2),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT client_schedule_attendance_status_check CHECK ((status = ANY (ARRAY['came'::text, 'no_show'::text, 'cancelled_ok'::text, 'cancelled_late_charged'::text, 'cancelled_late_waived'::text])))
);


--
-- Name: client_schedule_day_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_schedule_day_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_schedule_id uuid NOT NULL,
    note_date date NOT NULL,
    notes text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.client_schedule_day_notes REPLICA IDENTITY FULL;


--
-- Name: client_schedule_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_schedule_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_schedule_id uuid NOT NULL,
    exception_date date NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    range_end date,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT client_schedule_exceptions_range_check CHECK (((range_end IS NULL) OR (range_end >= exception_date)))
);

ALTER TABLE ONLY public.client_schedule_exceptions REPLICA IDENTITY FULL;


--
-- Name: client_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    teacher_id uuid,
    weekday smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    court smallint,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    valid_from date,
    valid_until date,
    created_by uuid DEFAULT auth.uid(),
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT client_schedules_check CHECK ((end_time > start_time)),
    CONSTRAINT client_schedules_court_check CHECK (((court >= 1) AND (court <= 4))),
    CONSTRAINT client_schedules_valid_range_check CHECK (((valid_until IS NULL) OR (valid_from IS NULL) OR (valid_until >= valid_from))),
    CONSTRAINT client_schedules_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: client_teacher_link_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_teacher_link_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    client_id uuid NOT NULL,
    action text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    requested_by uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_teacher_link_requests_action_check CHECK ((action = ANY (ARRAY['vincular'::text, 'desvincular'::text]))),
    CONSTRAINT client_teacher_link_requests_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovada'::text, 'recusada'::text, 'cancelada'::text])))
);


--
-- Name: client_teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    category_id uuid,
    custom_amount numeric(10,2),
    due_day integer,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    financial_responsible text,
    is_gympass boolean DEFAULT false NOT NULL,
    default_discount_percent numeric(5,2) DEFAULT 0 NOT NULL,
    responsible_client_id uuid,
    teacher_id uuid,
    profile_photo_path text,
    profile_photo_updated_at timestamp with time zone,
    profile_photo_consent_at timestamp with time zone,
    profile_photo_updated_by uuid,
    birth_day smallint,
    birth_month smallint,
    tennis_class text,
    linked_teacher_id uuid,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT clients_birth_day_check CHECK (((birth_day IS NULL) OR ((birth_day >= 1) AND (birth_day <= 31)))),
    CONSTRAINT clients_birth_month_check CHECK (((birth_month IS NULL) OR ((birth_month >= 1) AND (birth_month <= 12)))),
    CONSTRAINT clients_birth_valid_check CHECK (((birth_day IS NULL) OR (birth_month IS NULL) OR
CASE birth_month
    WHEN 2 THEN (birth_day <= 29)
    WHEN 4 THEN (birth_day <= 30)
    WHEN 6 THEN (birth_day <= 30)
    WHEN 9 THEN (birth_day <= 30)
    WHEN 11 THEN (birth_day <= 30)
    ELSE (birth_day <= 31)
END)),
    CONSTRAINT clients_default_discount_percent_check CHECK (((default_discount_percent >= (0)::numeric) AND (default_discount_percent <= (100)::numeric))),
    CONSTRAINT clients_due_day_check CHECK (((due_day >= 1) AND (due_day <= 31))),
    CONSTRAINT clients_tennis_class_check CHECK (((tennis_class IS NULL) OR (tennis_class = ANY (ARRAY['iniciante'::text, '5_classe'::text, '4_classe'::text, '3_classe'::text, '2_classe'::text, '1_classe'::text]))))
);

ALTER TABLE ONLY public.clients REPLICA IDENTITY FULL;


--
-- Name: cobranca_followup_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cobranca_followup_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    followup_id uuid NOT NULL,
    event_type text NOT NULL,
    actor uuid,
    context text,
    note text,
    balance_at_event numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cobranca_followup_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'sent'::text, 'resolved'::text, 'reopened'::text, 'assigned'::text, 'note'::text, 'kept'::text])))
);


--
-- Name: cobranca_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cobranca_followups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_context text,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_by uuid,
    send_count integer DEFAULT 1 NOT NULL,
    balance_at_last_send numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolved_note text,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    assigned_by uuid,
    kept_at timestamp with time zone,
    kept_by uuid,
    CONSTRAINT cobranca_followups_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text])))
);


--
-- Name: court_availability_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.court_availability_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    court smallint NOT NULL,
    availability_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    hourly_price numeric(10,2) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_by uuid,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT court_availability_overrides_court_check CHECK (((court >= 1) AND (court <= 4))),
    CONSTRAINT court_availability_overrides_hourly_price_check CHECK ((hourly_price >= (0)::numeric))
);


--
-- Name: court_booking_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.court_booking_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: court_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.court_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    court smallint NOT NULL,
    booking_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    source public.booking_source NOT NULL,
    client_id uuid,
    teacher_id uuid,
    guest_type public.booking_guest_type,
    guest_name text,
    notes text,
    created_by uuid,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    charge_applied boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category_id uuid,
    charge_id uuid,
    companion_type text,
    hold_expires_at timestamp with time zone,
    prepaid_at_booking boolean DEFAULT false NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT court_bookings_check CHECK ((end_time > start_time)),
    CONSTRAINT court_bookings_companion_type_check CHECK ((companion_type = ANY (ARRAY['aluno'::text, 'convidado'::text, 'batedor'::text]))),
    CONSTRAINT court_bookings_court_check CHECK (((court >= 1) AND (court <= 4)))
);

ALTER TABLE ONLY public.court_bookings REPLICA IDENTITY FULL;


--
-- Name: debt_limit_alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_limit_alert_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_id uuid NOT NULL,
    event_type text NOT NULL,
    actor uuid,
    note text,
    debt_at_event numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT debt_limit_alert_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'resolved'::text, 'reopened'::text])))
);


--
-- Name: debt_limit_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_limit_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    debt_at_creation numeric(12,2) NOT NULL,
    reached_date date NOT NULL,
    created_by uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolved_note text,
    reopened_by uuid,
    reopened_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT debt_limit_alerts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text])))
);

ALTER TABLE ONLY public.debt_limit_alerts REPLICA IDENTITY FULL;


--
-- Name: debt_limit_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_limit_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    reason text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deactivated_by uuid,
    deactivated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: debt_limit_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_limit_settings (
    id boolean DEFAULT true NOT NULL,
    limit_amount numeric(12,2) DEFAULT 210.00 NOT NULL,
    rule_start_date date DEFAULT '2026-08-01'::date NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT debt_limit_settings_id_check CHECK (id),
    CONSTRAINT debt_limit_settings_limit_amount_check CHECK ((limit_amount > (0)::numeric))
);


--
-- Name: fixed_court_waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixed_court_waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    guest_name text,
    desired_weekday smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    court smallint,
    priority integer DEFAULT 0 NOT NULL,
    notes text,
    status public.waitlist_status DEFAULT 'waiting'::public.waitlist_status NOT NULL,
    notified_at timestamp with time zone,
    contacted_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    resulting_schedule_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_by_teacher_id uuid,
    user_id uuid,
    source text DEFAULT 'staff'::text NOT NULL,
    CONSTRAINT fixed_court_waitlist_court_check CHECK (((court IS NULL) OR ((court >= 0) AND (court <= 4)))),
    CONSTRAINT fixed_court_waitlist_desired_weekday_check CHECK (((desired_weekday >= 0) AND (desired_weekday <= 6))),
    CONSTRAINT fixed_court_waitlist_person_check CHECK (((client_id IS NOT NULL) OR (NULLIF(btrim(COALESCE(guest_name, ''::text)), ''::text) IS NOT NULL))),
    CONSTRAINT fixed_court_waitlist_source_check CHECK ((source = ANY (ARRAY['staff'::text, 'portal_cliente'::text, 'portal_professor'::text]))),
    CONSTRAINT fixed_court_waitlist_time_check CHECK ((start_time < end_time))
);


--
-- Name: fixed_waitlist_court_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixed_waitlist_court_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    court smallint NOT NULL,
    weekday smallint NOT NULL,
    open_time time without time zone NOT NULL,
    close_time time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fixed_waitlist_court_hours_court_check CHECK (((court >= 1) AND (court <= 4))),
    CONSTRAINT fixed_waitlist_court_hours_time_check CHECK ((close_time > open_time)),
    CONSTRAINT fixed_waitlist_court_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: fixed_waitlist_court_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixed_waitlist_court_settings (
    court smallint NOT NULL,
    opens_on date NOT NULL,
    closes_on date NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fixed_waitlist_court_settings_court_check CHECK (((court >= 1) AND (court <= 4))),
    CONSTRAINT fixed_waitlist_court_settings_range_check CHECK ((closes_on >= opens_on))
);


--
-- Name: idea_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idea_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idea_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ideas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ideas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text,
    status text DEFAULT 'rascunho'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: monthly_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    reference_month date NOT NULL,
    amount numeric(10,2) NOT NULL,
    due_date date NOT NULL,
    status public.charge_status DEFAULT 'aberta'::public.charge_status NOT NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.monthly_charges REPLICA IDENTITY FULL;


--
-- Name: neurochat_message_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.neurochat_message_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    booking_id uuid,
    message_type text NOT NULL,
    phone text,
    request_payload jsonb,
    response_payload jsonb,
    external_message_id text,
    session_id text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    failure_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: online_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.online_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    client_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    mp_preference_id text,
    mp_payment_id text,
    mp_status_detail text,
    payment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT online_payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'cancelled'::text, 'approved_conflict'::text])))
);


--
-- Name: open_debt_reminder_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_debt_reminder_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    reminder_date date NOT NULL,
    action text NOT NULL,
    acted_by uuid DEFAULT auth.uid(),
    acted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_debt_reminder_actions_action_check CHECK ((action = ANY (ARRAY['sent'::text, 'skipped'::text])))
);


--
-- Name: payment_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    entry_id uuid,
    payment_id uuid,
    file_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    charge_id uuid,
    amount numeric(10,2) NOT NULL,
    method public.payment_method NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category_id uuid,
    start_time time without time zone,
    end_time time without time zone,
    received boolean DEFAULT true NOT NULL,
    to_account boolean DEFAULT false NOT NULL,
    court smallint,
    account_direction text,
    updated_by uuid,
    updated_at timestamp with time zone,
    is_new_plan_sale boolean DEFAULT false NOT NULL,
    commission_user_id uuid,
    passthrough_amount numeric DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    is_pending_payment boolean DEFAULT false NOT NULL,
    booking_id uuid,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT payments_account_direction_check CHECK ((account_direction = ANY (ARRAY['credito'::text, 'debito'::text]))),
    CONSTRAINT payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payments_quantity_check CHECK ((quantity >= 1))
);

ALTER TABLE ONLY public.payments REPLICA IDENTITY FULL;


--
-- Name: pending_client_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_client_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_client_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pending_client_signups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'linked'::text, 'created'::text])))
);


--
-- Name: pending_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_signups (
    user_id uuid NOT NULL,
    kind text NOT NULL,
    full_name text,
    email text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pending_signups_kind_check CHECK ((kind = 'professor'::text))
);


--
-- Name: portal_booking_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_booking_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    client_id uuid,
    booking_date date,
    court smallint,
    start_hour smallint,
    stage text NOT NULL,
    message text NOT NULL,
    error_code text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT portal_booking_failures_stage_check CHECK ((stage = ANY (ARRAY['regra_horario'::text, 'categoria'::text, 'servidor'::text, 'carregamento'::text])))
);


--
-- Name: portal_signup_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_signup_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    client_id uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    used_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_table (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    weekday smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    price_per_hour numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    courts smallint[],
    categories uuid[],
    starts_on date,
    ends_on date,
    discount_percent numeric(5,2),
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT price_table_check CHECK ((end_time > start_time)),
    CONSTRAINT price_table_discount_percent_check CHECK (((discount_percent IS NULL) OR ((discount_percent > (0)::numeric) AND (discount_percent < (100)::numeric) AND ((starts_on IS NOT NULL) OR (ends_on IS NOT NULL))))),
    CONSTRAINT price_table_price_per_hour_check CHECK ((price_per_hour >= (0)::numeric)),
    CONSTRAINT price_table_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nav_menu_order jsonb
);


--
-- Name: racket_loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.racket_loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    racket smallint NOT NULL,
    holder_name text NOT NULL,
    client_id uuid,
    booking_id uuid,
    notes text,
    lent_at timestamp with time zone DEFAULT now() NOT NULL,
    lent_by uuid DEFAULT auth.uid(),
    returned_at timestamp with time zone,
    returned_by uuid,
    return_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT racket_loans_holder_name_check CHECK ((length(btrim(holder_name)) > 0)),
    CONSTRAINT racket_loans_racket_check CHECK (((racket >= 1) AND (racket <= 4)))
);


--
-- Name: stock_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    current_quantity integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    movement_type public.stock_movement_type NOT NULL,
    quantity integer NOT NULL,
    notes text,
    payment_id uuid,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: task_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    assigned_to uuid NOT NULL,
    created_by uuid NOT NULL,
    status public.task_status DEFAULT 'pendente'::public.task_status NOT NULL,
    priority public.task_priority DEFAULT 'media'::public.task_priority NOT NULL,
    next_followup_at date,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    recurrence public.task_recurrence DEFAULT 'none'::public.task_recurrence NOT NULL,
    recurrence_interval integer DEFAULT 1 NOT NULL,
    parent_task_id uuid,
    CONSTRAINT tasks_recurrence_interval_positive CHECK ((recurrence_interval > 0))
);


--
-- Name: teacher_signup_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_signup_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    teacher_id uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    used_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    phone text,
    can_book_directly boolean DEFAULT false NOT NULL,
    map_color_as_avulsa boolean DEFAULT false NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    page_key text NOT NULL,
    granted boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waitlist_acknowledgements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist_acknowledgements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waitlist_id uuid NOT NULL,
    user_id uuid NOT NULL,
    actor_name text,
    acknowledged_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_by uuid,
    context text
);

ALTER TABLE ONLY public.whatsapp_notifications REPLICA IDENTITY FULL;


--
-- Name: work_task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: work_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'pendente'::text NOT NULL,
    due_date date,
    assigned_to text,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: works; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.works (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'planejamento'::text NOT NULL,
    start_date date,
    expected_end_date date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: account_entries account_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entries
    ADD CONSTRAINT account_entries_pkey PRIMARY KEY (id);


--
-- Name: app_notifications app_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notifications
    ADD CONSTRAINT app_notifications_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: booking_confirmations booking_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_confirmations
    ADD CONSTRAINT booking_confirmations_pkey PRIMARY KEY (id);


--
-- Name: cash_closings cash_closings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_pkey PRIMARY KEY (id);


--
-- Name: cleaning_products cleaning_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_products
    ADD CONSTRAINT cleaning_products_pkey PRIMARY KEY (id);


--
-- Name: cleaning_purchases cleaning_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_purchases
    ADD CONSTRAINT cleaning_purchases_pkey PRIMARY KEY (id);


--
-- Name: cleaning_suppliers cleaning_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_suppliers
    ADD CONSTRAINT cleaning_suppliers_pkey PRIMARY KEY (id);


--
-- Name: cleaning_weekly_usage cleaning_weekly_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_weekly_usage
    ADD CONSTRAINT cleaning_weekly_usage_pkey PRIMARY KEY (id);


--
-- Name: cleaning_weekly_usage cleaning_weekly_usage_product_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_weekly_usage
    ADD CONSTRAINT cleaning_weekly_usage_product_id_week_start_key UNIQUE (product_id, week_start);


--
-- Name: client_categories client_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_categories
    ADD CONSTRAINT client_categories_name_key UNIQUE (name);


--
-- Name: client_categories client_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_categories
    ADD CONSTRAINT client_categories_pkey PRIMARY KEY (id);


--
-- Name: client_followups client_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_followups
    ADD CONSTRAINT client_followups_pkey PRIMARY KEY (client_id);


--
-- Name: client_portal_users client_portal_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_users
    ADD CONSTRAINT client_portal_users_pkey PRIMARY KEY (id);


--
-- Name: client_portal_users client_portal_users_user_client_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_users
    ADD CONSTRAINT client_portal_users_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: client_schedule_attendance client_schedule_attendance_client_schedule_id_attendance_da_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_attendance
    ADD CONSTRAINT client_schedule_attendance_client_schedule_id_attendance_da_key UNIQUE (client_schedule_id, attendance_date);


--
-- Name: client_schedule_attendance client_schedule_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_attendance
    ADD CONSTRAINT client_schedule_attendance_pkey PRIMARY KEY (id);


--
-- Name: client_schedule_day_notes client_schedule_day_notes_client_schedule_id_note_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_day_notes
    ADD CONSTRAINT client_schedule_day_notes_client_schedule_id_note_date_key UNIQUE (client_schedule_id, note_date);


--
-- Name: client_schedule_day_notes client_schedule_day_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_day_notes
    ADD CONSTRAINT client_schedule_day_notes_pkey PRIMARY KEY (id);


--
-- Name: client_schedule_exceptions client_schedule_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_exceptions
    ADD CONSTRAINT client_schedule_exceptions_pkey PRIMARY KEY (id);


--
-- Name: client_schedules client_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedules
    ADD CONSTRAINT client_schedules_pkey PRIMARY KEY (id);


--
-- Name: client_teacher_link_requests client_teacher_link_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teacher_link_requests
    ADD CONSTRAINT client_teacher_link_requests_pkey PRIMARY KEY (id);


--
-- Name: client_teachers client_teachers_client_id_teacher_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teachers
    ADD CONSTRAINT client_teachers_client_id_teacher_id_key UNIQUE (client_id, teacher_id);


--
-- Name: client_teachers client_teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teachers
    ADD CONSTRAINT client_teachers_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: cobranca_followup_events cobranca_followup_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cobranca_followup_events
    ADD CONSTRAINT cobranca_followup_events_pkey PRIMARY KEY (id);


--
-- Name: cobranca_followups cobranca_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cobranca_followups
    ADD CONSTRAINT cobranca_followups_pkey PRIMARY KEY (id);


--
-- Name: court_availability_overrides court_availability_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_availability_overrides
    ADD CONSTRAINT court_availability_overrides_pkey PRIMARY KEY (id);


--
-- Name: court_booking_participants court_booking_participants_booking_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_booking_participants
    ADD CONSTRAINT court_booking_participants_booking_id_client_id_key UNIQUE (booking_id, client_id);


--
-- Name: court_booking_participants court_booking_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_booking_participants
    ADD CONSTRAINT court_booking_participants_pkey PRIMARY KEY (id);


--
-- Name: court_bookings court_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_pkey PRIMARY KEY (id);


--
-- Name: court_waitlist court_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_pkey PRIMARY KEY (id);


--
-- Name: debt_limit_alert_events debt_limit_alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_alert_events
    ADD CONSTRAINT debt_limit_alert_events_pkey PRIMARY KEY (id);


--
-- Name: debt_limit_alerts debt_limit_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_alerts
    ADD CONSTRAINT debt_limit_alerts_pkey PRIMARY KEY (id);


--
-- Name: debt_limit_exceptions debt_limit_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_exceptions
    ADD CONSTRAINT debt_limit_exceptions_pkey PRIMARY KEY (id);


--
-- Name: debt_limit_settings debt_limit_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_settings
    ADD CONSTRAINT debt_limit_settings_pkey PRIMARY KEY (id);


--
-- Name: fixed_court_waitlist fixed_court_waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_court_waitlist
    ADD CONSTRAINT fixed_court_waitlist_pkey PRIMARY KEY (id);


--
-- Name: fixed_waitlist_court_hours fixed_waitlist_court_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_waitlist_court_hours
    ADD CONSTRAINT fixed_waitlist_court_hours_pkey PRIMARY KEY (id);


--
-- Name: fixed_waitlist_court_hours fixed_waitlist_court_hours_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_waitlist_court_hours
    ADD CONSTRAINT fixed_waitlist_court_hours_uidx UNIQUE (court, weekday);


--
-- Name: fixed_waitlist_court_settings fixed_waitlist_court_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_waitlist_court_settings
    ADD CONSTRAINT fixed_waitlist_court_settings_pkey PRIMARY KEY (court);


--
-- Name: idea_comments idea_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_comments
    ADD CONSTRAINT idea_comments_pkey PRIMARY KEY (id);


--
-- Name: ideas ideas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideas
    ADD CONSTRAINT ideas_pkey PRIMARY KEY (id);


--
-- Name: monthly_charges monthly_charges_client_id_reference_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_charges
    ADD CONSTRAINT monthly_charges_client_id_reference_month_key UNIQUE (client_id, reference_month);


--
-- Name: monthly_charges monthly_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_charges
    ADD CONSTRAINT monthly_charges_pkey PRIMARY KEY (id);


--
-- Name: neurochat_message_logs neurochat_message_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.neurochat_message_logs
    ADD CONSTRAINT neurochat_message_logs_pkey PRIMARY KEY (id);


--
-- Name: online_payments online_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_payments
    ADD CONSTRAINT online_payments_pkey PRIMARY KEY (id);


--
-- Name: open_debt_reminder_actions open_debt_reminder_actions_client_id_reminder_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_debt_reminder_actions
    ADD CONSTRAINT open_debt_reminder_actions_client_id_reminder_date_key UNIQUE (client_id, reminder_date);


--
-- Name: open_debt_reminder_actions open_debt_reminder_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_debt_reminder_actions
    ADD CONSTRAINT open_debt_reminder_actions_pkey PRIMARY KEY (id);


--
-- Name: payment_receipts payment_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pending_client_signups pending_client_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_client_signups
    ADD CONSTRAINT pending_client_signups_pkey PRIMARY KEY (id);


--
-- Name: pending_client_signups pending_client_signups_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_client_signups
    ADD CONSTRAINT pending_client_signups_user_id_key UNIQUE (user_id);


--
-- Name: pending_signups pending_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_signups
    ADD CONSTRAINT pending_signups_pkey PRIMARY KEY (user_id);


--
-- Name: portal_booking_failures portal_booking_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_booking_failures
    ADD CONSTRAINT portal_booking_failures_pkey PRIMARY KEY (id);


--
-- Name: portal_signup_tokens portal_signup_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_signup_tokens
    ADD CONSTRAINT portal_signup_tokens_pkey PRIMARY KEY (id);


--
-- Name: portal_signup_tokens portal_signup_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_signup_tokens
    ADD CONSTRAINT portal_signup_tokens_token_key UNIQUE (token);


--
-- Name: price_table price_table_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_table
    ADD CONSTRAINT price_table_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: racket_loans racket_loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.racket_loans
    ADD CONSTRAINT racket_loans_pkey PRIMARY KEY (id);


--
-- Name: stock_items stock_items_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_name_key UNIQUE (name);


--
-- Name: stock_items stock_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: task_updates task_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_updates
    ADD CONSTRAINT task_updates_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: teacher_client_change_requests teacher_client_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_pkey PRIMARY KEY (id);


--
-- Name: teacher_signup_tokens teacher_signup_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_signup_tokens
    ADD CONSTRAINT teacher_signup_tokens_pkey PRIMARY KEY (id);


--
-- Name: teacher_signup_tokens teacher_signup_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_signup_tokens
    ADD CONSTRAINT teacher_signup_tokens_token_key UNIQUE (token);


--
-- Name: teachers teachers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_name_key UNIQUE (name);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_user_id_key UNIQUE (user_id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_page_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_page_key_key UNIQUE (user_id, page_key);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: waitlist_acknowledgements waitlist_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_acknowledgements
    ADD CONSTRAINT waitlist_acknowledgements_pkey PRIMARY KEY (id);


--
-- Name: waitlist_acknowledgements waitlist_acknowledgements_waitlist_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_acknowledgements
    ADD CONSTRAINT waitlist_acknowledgements_waitlist_id_user_id_key UNIQUE (waitlist_id, user_id);


--
-- Name: whatsapp_notifications whatsapp_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_notifications
    ADD CONSTRAINT whatsapp_notifications_pkey PRIMARY KEY (id);


--
-- Name: work_task_comments work_task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_task_comments
    ADD CONSTRAINT work_task_comments_pkey PRIMARY KEY (id);


--
-- Name: work_tasks work_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_pkey PRIMARY KEY (id);


--
-- Name: works works_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_pkey PRIMARY KEY (id);


--
-- Name: app_notifications_dedup_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_notifications_dedup_key_uidx ON public.app_notifications USING btree (dedup_key);


--
-- Name: cash_closings_closing_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_closings_closing_date_idx ON public.cash_closings USING btree (closing_date DESC);


--
-- Name: cbp_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cbp_booking_idx ON public.court_booking_participants USING btree (booking_id);


--
-- Name: client_portal_users_phone_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_portal_users_phone_key ON public.client_portal_users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: cobranca_followups_active_client_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cobranca_followups_active_client_uidx ON public.cobranca_followups USING btree (client_id) WHERE (status = 'active'::text);


--
-- Name: court_bookings_active_holds_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX court_bookings_active_holds_idx ON public.court_bookings USING btree (court, booking_date, start_time) WHERE ((hold_expires_at IS NOT NULL) AND (cancelled_at IS NULL));


--
-- Name: court_bookings_client_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX court_bookings_client_date_idx ON public.court_bookings USING btree (client_id, booking_date);


--
-- Name: court_bookings_date_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX court_bookings_date_court_idx ON public.court_bookings USING btree (booking_date, court);


--
-- Name: court_bookings_teacher_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX court_bookings_teacher_date_idx ON public.court_bookings USING btree (teacher_id, booking_date);


--
-- Name: court_bookings_unique_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX court_bookings_unique_slot ON public.court_bookings USING btree (court, booking_date, start_time) WHERE (cancelled_at IS NULL);


--
-- Name: court_waitlist_one_active_change_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX court_waitlist_one_active_change_per_booking ON public.court_waitlist USING btree (source_booking_id) WHERE ((source_booking_id IS NOT NULL) AND (status = ANY (ARRAY['waiting'::public.waitlist_status, 'notified'::public.waitlist_status, 'contacted'::public.waitlist_status])));


--
-- Name: debt_limit_alerts_active_client_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX debt_limit_alerts_active_client_uidx ON public.debt_limit_alerts USING btree (client_id) WHERE (status = 'active'::text);


--
-- Name: debt_limit_exceptions_active_client_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX debt_limit_exceptions_active_client_uidx ON public.debt_limit_exceptions USING btree (client_id) WHERE active;


--
-- Name: fixed_court_waitlist_active_dedup_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fixed_court_waitlist_active_dedup_uidx ON public.fixed_court_waitlist USING btree (client_id, desired_weekday, court, start_time, end_time) WHERE ((status = 'waiting'::public.waitlist_status) AND (client_id IS NOT NULL) AND (court IS NOT NULL));


--
-- Name: idx_account_entries_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_entries_client ON public.account_entries USING btree (client_id, entry_date DESC);


--
-- Name: idx_account_entries_client_bucket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_entries_client_bucket ON public.account_entries USING btree (client_id, bucket);


--
-- Name: idx_account_entries_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_entries_payment ON public.account_entries USING btree (payment_id);


--
-- Name: idx_app_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_notifications_unread ON public.app_notifications USING btree (created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_app_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_notifications_user_id ON public.app_notifications USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_audit_logs_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_actor ON public.audit_logs USING btree (actor_id, created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity, entity_id, created_at DESC);


--
-- Name: idx_booking_confirmations_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_booking_confirmations_booking ON public.booking_confirmations USING btree (booking_id) WHERE (booking_id IS NOT NULL);


--
-- Name: idx_booking_confirmations_schedule_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_booking_confirmations_schedule_date ON public.booking_confirmations USING btree (schedule_id, booking_date) WHERE (schedule_id IS NOT NULL);


--
-- Name: idx_charges_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charges_client ON public.monthly_charges USING btree (client_id);


--
-- Name: idx_charges_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charges_due ON public.monthly_charges USING btree (due_date);


--
-- Name: idx_charges_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charges_status ON public.monthly_charges USING btree (status);


--
-- Name: idx_cleaning_purchases_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cleaning_purchases_date ON public.cleaning_purchases USING btree (purchase_date DESC);


--
-- Name: idx_cleaning_purchases_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cleaning_purchases_product ON public.cleaning_purchases USING btree (product_id, purchase_date DESC);


--
-- Name: idx_cleaning_weekly_usage_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cleaning_weekly_usage_product ON public.cleaning_weekly_usage USING btree (product_id, week_start DESC);


--
-- Name: idx_client_portal_users_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_portal_users_client_id ON public.client_portal_users USING btree (client_id);


--
-- Name: idx_client_portal_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_portal_users_user_id ON public.client_portal_users USING btree (user_id);


--
-- Name: idx_client_schedule_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_schedule_attendance_date ON public.client_schedule_attendance USING btree (attendance_date);


--
-- Name: idx_client_schedule_attendance_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_schedule_attendance_payment ON public.client_schedule_attendance USING btree (payment_id);


--
-- Name: idx_client_schedules_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_schedules_client ON public.client_schedules USING btree (client_id);


--
-- Name: idx_client_schedules_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_schedules_teacher ON public.client_schedules USING btree (teacher_id);


--
-- Name: idx_client_schedules_validity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_schedules_validity ON public.client_schedules USING btree (valid_from, valid_until);


--
-- Name: idx_client_teacher_link_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_teacher_link_requests_status ON public.client_teacher_link_requests USING btree (status);


--
-- Name: idx_client_teacher_link_requests_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_teacher_link_requests_teacher ON public.client_teacher_link_requests USING btree (teacher_id);


--
-- Name: idx_client_teachers_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_teachers_client ON public.client_teachers USING btree (client_id);


--
-- Name: idx_client_teachers_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_teachers_teacher ON public.client_teachers USING btree (teacher_id);


--
-- Name: idx_clients_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_active ON public.clients USING btree (active);


--
-- Name: idx_clients_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_category ON public.clients USING btree (category_id);


--
-- Name: idx_clients_responsible_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_responsible_client_id ON public.clients USING btree (responsible_client_id);


--
-- Name: idx_clients_teacher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_teacher_id ON public.clients USING btree (teacher_id);


--
-- Name: idx_cobranca_followup_events_followup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cobranca_followup_events_followup ON public.cobranca_followup_events USING btree (followup_id);


--
-- Name: idx_cobranca_followups_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cobranca_followups_assigned ON public.cobranca_followups USING btree (assigned_to) WHERE (status = 'active'::text);


--
-- Name: idx_cobranca_followups_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cobranca_followups_client ON public.cobranca_followups USING btree (client_id);


--
-- Name: idx_cobranca_followups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cobranca_followups_status ON public.cobranca_followups USING btree (status);


--
-- Name: idx_court_avail_over_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_avail_over_date ON public.court_availability_overrides USING btree (availability_date, court);


--
-- Name: idx_court_waitlist_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_waitlist_client ON public.court_waitlist USING btree (client_id);


--
-- Name: idx_court_waitlist_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_waitlist_date_status ON public.court_waitlist USING btree (desired_date, status);


--
-- Name: idx_court_waitlist_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_waitlist_lookup ON public.court_waitlist USING btree (desired_date, court, status);


--
-- Name: idx_court_waitlist_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_waitlist_slot ON public.court_waitlist USING btree (desired_date, court, start_time, end_time, status);


--
-- Name: idx_court_waitlist_source_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_waitlist_source_booking ON public.court_waitlist USING btree (source_booking_id);


--
-- Name: idx_court_waitlist_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_court_waitlist_time ON public.court_waitlist USING btree (desired_date, start_time, end_time, status);


--
-- Name: idx_csx_sched_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csx_sched_range ON public.client_schedule_exceptions USING btree (client_schedule_id, exception_date, range_end);


--
-- Name: idx_csx_schedule_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csx_schedule_date ON public.client_schedule_exceptions USING btree (client_schedule_id, exception_date);


--
-- Name: idx_debt_limit_alert_events_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_limit_alert_events_alert ON public.debt_limit_alert_events USING btree (alert_id, created_at);


--
-- Name: idx_debt_limit_alerts_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_limit_alerts_client ON public.debt_limit_alerts USING btree (client_id, created_at DESC);


--
-- Name: idx_debt_limit_exceptions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_limit_exceptions_client ON public.debt_limit_exceptions USING btree (client_id);


--
-- Name: idx_fixed_court_waitlist_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixed_court_waitlist_client ON public.fixed_court_waitlist USING btree (client_id);


--
-- Name: idx_fixed_court_waitlist_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixed_court_waitlist_slot ON public.fixed_court_waitlist USING btree (court, desired_weekday, start_time, end_time, status);


--
-- Name: idx_fixed_court_waitlist_weekday_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixed_court_waitlist_weekday_status ON public.fixed_court_waitlist USING btree (desired_weekday, status);


--
-- Name: idx_idea_comments_idea_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idea_comments_idea_id ON public.idea_comments USING btree (idea_id);


--
-- Name: idx_neurochat_logs_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_neurochat_logs_booking ON public.neurochat_message_logs USING btree (booking_id);


--
-- Name: idx_neurochat_logs_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_neurochat_logs_client ON public.neurochat_message_logs USING btree (client_id);


--
-- Name: idx_neurochat_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_neurochat_logs_created ON public.neurochat_message_logs USING btree (created_at DESC);


--
-- Name: idx_online_payments_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_payments_booking ON public.online_payments USING btree (booking_id);


--
-- Name: idx_online_payments_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_payments_client ON public.online_payments USING btree (client_id);


--
-- Name: idx_online_payments_mp_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_online_payments_mp_payment_id ON public.online_payments USING btree (mp_payment_id) WHERE (mp_payment_id IS NOT NULL);


--
-- Name: idx_payment_receipts_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_receipts_client ON public.payment_receipts USING btree (client_id);


--
-- Name: idx_payment_receipts_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_receipts_payment_id ON public.payment_receipts USING btree (payment_id);


--
-- Name: idx_payments_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking ON public.payments USING btree (booking_id);


--
-- Name: idx_payments_charge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_charge ON public.payments USING btree (charge_id);


--
-- Name: idx_payments_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_client ON public.payments USING btree (client_id);


--
-- Name: idx_payments_new_plan_sale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_new_plan_sale ON public.payments USING btree (is_new_plan_sale) WHERE (is_new_plan_sale = true);


--
-- Name: idx_payments_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_paid_at ON public.payments USING btree (paid_at);


--
-- Name: idx_payments_recorded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_recorded_by ON public.payments USING btree (recorded_by);


--
-- Name: idx_pending_client_signups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_client_signups_status ON public.pending_client_signups USING btree (status);


--
-- Name: idx_portal_signup_tokens_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_signup_tokens_client ON public.portal_signup_tokens USING btree (client_id);


--
-- Name: idx_portal_signup_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_signup_tokens_token ON public.portal_signup_tokens USING btree (token);


--
-- Name: idx_price_table_categories; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_table_categories ON public.price_table USING gin (categories);


--
-- Name: idx_price_table_promo_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_table_promo_range ON public.price_table USING btree (starts_on, ends_on) WHERE ((starts_on IS NOT NULL) OR (ends_on IS NOT NULL));


--
-- Name: idx_price_table_weekday; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_table_weekday ON public.price_table USING btree (weekday);


--
-- Name: idx_sched_exc_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sched_exc_date ON public.client_schedule_exceptions USING btree (exception_date);


--
-- Name: idx_sched_exc_sched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sched_exc_sched ON public.client_schedule_exceptions USING btree (client_schedule_id);


--
-- Name: idx_task_updates_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_updates_task ON public.task_updates USING btree (task_id);


--
-- Name: idx_tasks_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned_to ON public.tasks USING btree (assigned_to);


--
-- Name: idx_tasks_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_created_by ON public.tasks USING btree (created_by);


--
-- Name: idx_tasks_parent_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_parent_task_id ON public.tasks USING btree (parent_task_id);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tccr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tccr_status ON public.teacher_client_change_requests USING btree (status, created_at DESC);


--
-- Name: idx_tccr_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tccr_teacher ON public.teacher_client_change_requests USING btree (teacher_id, created_at DESC);


--
-- Name: idx_teacher_signup_tokens_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_signup_tokens_teacher ON public.teacher_signup_tokens USING btree (teacher_id);


--
-- Name: idx_teacher_signup_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_signup_tokens_token ON public.teacher_signup_tokens USING btree (token);


--
-- Name: idx_work_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_task_comments_task ON public.work_task_comments USING btree (task_id);


--
-- Name: idx_work_tasks_work_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_tasks_work_id ON public.work_tasks USING btree (work_id);


--
-- Name: portal_booking_failures_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_booking_failures_client_idx ON public.portal_booking_failures USING btree (client_id, created_at DESC);


--
-- Name: portal_booking_failures_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_booking_failures_created_at_idx ON public.portal_booking_failures USING btree (created_at DESC);


--
-- Name: racket_loans_one_open_per_racket; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX racket_loans_one_open_per_racket ON public.racket_loans USING btree (racket) WHERE (returned_at IS NULL);


--
-- Name: racket_loans_racket_lent_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX racket_loans_racket_lent_at_idx ON public.racket_loans USING btree (racket, lent_at DESC);


--
-- Name: stock_movements_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_item_id_idx ON public.stock_movements USING btree (item_id, created_at DESC);


--
-- Name: stock_movements_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_payment_id_idx ON public.stock_movements USING btree (payment_id);


--
-- Name: uniq_court_waitlist_active_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_court_waitlist_active_user ON public.court_waitlist USING btree (user_id, desired_date, start_time, end_time) WHERE ((status = ANY (ARRAY['waiting'::public.waitlist_status, 'notified'::public.waitlist_status, 'contacted'::public.waitlist_status])) AND (user_id IS NOT NULL));


--
-- Name: whatsapp_notifications_client_context_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_notifications_client_context_sent_idx ON public.whatsapp_notifications USING btree (client_id, context, sent_at DESC);


--
-- Name: whatsapp_notifications_client_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_notifications_client_sent_idx ON public.whatsapp_notifications USING btree (client_id, sent_at DESC);


--
-- Name: account_entries ae_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ae_set_updated_at BEFORE UPDATE ON public.account_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cash_closings cash_closings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closings_updated_at BEFORE UPDATE ON public.cash_closings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_followups cf_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cf_set_updated_at BEFORE UPDATE ON public.client_followups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_schedules client_schedules_fixed_waitlist_free_slots; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER client_schedules_fixed_waitlist_free_slots AFTER DELETE OR UPDATE ON public.client_schedules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public._trg_fixed_waitlist_notify_free_slots();


--
-- Name: clients clients_guard_linked_teacher; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clients_guard_linked_teacher BEFORE INSERT OR UPDATE OF linked_teacher_id ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_guard_linked_teacher();


--
-- Name: court_bookings court_booking_fulfill_waitlist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER court_booking_fulfill_waitlist AFTER INSERT OR UPDATE OF client_id, teacher_id, booking_date, start_time, end_time, cancelled_at ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_booking_fulfill_waitlist();


--
-- Name: client_schedule_day_notes csdn_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER csdn_set_updated_at BEFORE UPDATE ON public.client_schedule_day_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: debt_limit_alerts debt_limit_alerts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER debt_limit_alerts_updated_at BEFORE UPDATE ON public.debt_limit_alerts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: debt_limit_exceptions debt_limit_exceptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER debt_limit_exceptions_updated_at BEFORE UPDATE ON public.debt_limit_exceptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: debt_limit_settings debt_limit_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER debt_limit_settings_updated_at BEFORE UPDATE ON public.debt_limit_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: court_bookings enforce_portal_cancel_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_portal_cancel_only BEFORE UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_cancel_only();


--
-- Name: fixed_court_waitlist fixed_court_waitlist_free_slots; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER fixed_court_waitlist_free_slots AFTER INSERT ON public.fixed_court_waitlist DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public._trg_fixed_waitlist_notify_free_slots();


--
-- Name: payments payments_sync_stock_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_sync_stock_del AFTER DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payment_sync_stock();


--
-- Name: payments payments_sync_stock_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_sync_stock_ins AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payment_sync_stock();


--
-- Name: payments payments_sync_stock_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_sync_stock_upd AFTER UPDATE OF category_id, client_id ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payment_sync_stock();


--
-- Name: racket_loans racket_loans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER racket_loans_updated_at BEFORE UPDATE ON public.racket_loans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_portal_users set_client_portal_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_client_portal_users_updated_at BEFORE UPDATE ON public.client_portal_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: work_task_comments set_work_task_comments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_work_task_comments_updated_at BEFORE UPDATE ON public.work_task_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: work_tasks set_work_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_work_tasks_updated_at BEFORE UPDATE ON public.work_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: works set_works_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_works_updated_at BEFORE UPDATE ON public.works FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: stock_items stock_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stock_items_updated_at BEFORE UPDATE ON public.stock_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks tasks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: app_notifications trg_app_notifications_skip_cancel_during_swap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_notifications_skip_cancel_during_swap BEFORE INSERT ON public.app_notifications FOR EACH ROW EXECUTE FUNCTION public.app_notifications_skip_cancel_during_swap();


--
-- Name: client_schedule_exceptions trg_audit_client_schedule_exceptions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_client_schedule_exceptions AFTER INSERT OR DELETE OR UPDATE ON public.client_schedule_exceptions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('client_schedule_exception');


--
-- Name: client_schedules trg_audit_client_schedules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_client_schedules AFTER INSERT OR DELETE OR UPDATE ON public.client_schedules FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('client_schedule');


--
-- Name: court_bookings trg_audit_court_bookings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_court_bookings AFTER INSERT OR DELETE OR UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('court_booking');


--
-- Name: client_categories trg_categories_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON public.client_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: monthly_charges trg_charges_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_charges_updated BEFORE UPDATE ON public.monthly_charges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cleaning_products trg_cleaning_notify_low_stock_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cleaning_notify_low_stock_insert AFTER INSERT ON public.cleaning_products FOR EACH ROW EXECUTE FUNCTION public.cleaning_notify_low_stock();


--
-- Name: cleaning_products trg_cleaning_notify_low_stock_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cleaning_notify_low_stock_update AFTER UPDATE OF current_stock ON public.cleaning_products FOR EACH ROW EXECUTE FUNCTION public.cleaning_notify_low_stock();


--
-- Name: cleaning_weekly_usage trg_cleaning_recompute_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cleaning_recompute_stock AFTER INSERT OR DELETE OR UPDATE ON public.cleaning_weekly_usage FOR EACH ROW EXECUTE FUNCTION public.cleaning_recompute_current_stock();


--
-- Name: clients trg_client_revoke_portal_access; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_revoke_portal_access BEFORE DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.client_revoke_portal_access();


--
-- Name: client_schedule_exceptions trg_client_schedule_exceptions_waitlist_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_schedule_exceptions_waitlist_notify AFTER INSERT ON public.client_schedule_exceptions FOR EACH ROW EXECUTE FUNCTION public.client_schedule_exceptions_waitlist_notify();


--
-- Name: client_schedules trg_client_schedule_notify_client_on_create; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_schedule_notify_client_on_create AFTER INSERT ON public.client_schedules FOR EACH ROW EXECUTE FUNCTION public.client_schedule_notify_client_on_create();


--
-- Name: client_schedules trg_client_schedule_notify_teacher_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_schedule_notify_teacher_change AFTER UPDATE ON public.client_schedules FOR EACH ROW EXECUTE FUNCTION public.client_schedule_notify_teacher_change();


--
-- Name: client_schedules trg_client_schedules_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_schedules_updated BEFORE UPDATE ON public.client_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: clients trg_clients_gympass_exception_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_gympass_exception_sync AFTER INSERT OR UPDATE OF is_gympass ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_gympass_exception_sync();


--
-- Name: clients trg_clients_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: court_bookings trg_court_booking_notify_client_on_create; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_booking_notify_client_on_create AFTER INSERT ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_booking_notify_client_on_create();


--
-- Name: court_bookings trg_court_bookings_check_recepcionista_category; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_check_recepcionista_category BEFORE INSERT OR UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_bookings_check_recepcionista_category();


--
-- Name: court_bookings trg_court_bookings_portal_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_portal_update_guard BEFORE UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_bookings_portal_update_guard();


--
-- Name: court_bookings trg_court_bookings_professor_cancel_fee; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_professor_cancel_fee BEFORE UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_bookings_professor_cancel_fee();


--
-- Name: court_bookings trg_court_bookings_restrict_portal_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_restrict_portal_update BEFORE UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_bookings_restrict_portal_update();


--
-- Name: court_bookings trg_court_bookings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_updated_at BEFORE UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: court_bookings trg_court_bookings_validate_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_validate_insert BEFORE INSERT ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_bookings_validate_insert();


--
-- Name: court_bookings trg_court_bookings_waitlist_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_bookings_waitlist_notify AFTER UPDATE ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.court_bookings_waitlist_notify();


--
-- Name: court_waitlist trg_court_waitlist_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_court_waitlist_touch BEFORE UPDATE ON public.court_waitlist FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_entries trg_debt_limit_check_on_account_entries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_debt_limit_check_on_account_entries AFTER INSERT OR DELETE OR UPDATE ON public.account_entries FOR EACH ROW EXECUTE FUNCTION public.debt_limit_account_entries_trigger();


--
-- Name: account_entries trg_enforce_recep_account_entries_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_recep_account_entries_update BEFORE UPDATE ON public.account_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_recep_account_entries_update();


--
-- Name: payments trg_enforce_recep_payments_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_recep_payments_update BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.enforce_recep_payments_update();


--
-- Name: fixed_court_waitlist trg_fixed_court_waitlist_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fixed_court_waitlist_touch BEFORE UPDATE ON public.fixed_court_waitlist FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: fixed_waitlist_court_hours trg_fixed_waitlist_court_hours_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fixed_waitlist_court_hours_touch BEFORE UPDATE ON public.fixed_waitlist_court_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: fixed_waitlist_court_settings trg_fixed_waitlist_court_settings_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fixed_waitlist_court_settings_touch BEFORE UPDATE ON public.fixed_waitlist_court_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: court_bookings trg_notify_portal_booking_cancel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_portal_booking_cancel AFTER UPDATE OF cancelled_at ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.notify_portal_booking_cancel();


--
-- Name: client_schedule_exceptions trg_notify_portal_schedule_cancel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_portal_schedule_cancel AFTER INSERT ON public.client_schedule_exceptions FOR EACH ROW EXECUTE FUNCTION public.notify_portal_schedule_cancel();


--
-- Name: court_bookings trg_notify_staff_booking_reactivate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_staff_booking_reactivate AFTER UPDATE OF cancelled_at ON public.court_bookings FOR EACH ROW EXECUTE FUNCTION public.notify_staff_booking_reactivate();


--
-- Name: fixed_court_waitlist trg_notify_staff_fixed_waitlist_joined; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_staff_fixed_waitlist_joined AFTER INSERT ON public.fixed_court_waitlist FOR EACH ROW EXECUTE FUNCTION public.notify_staff_fixed_waitlist_joined();


--
-- Name: client_schedule_exceptions trg_notify_staff_schedule_reactivate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_staff_schedule_reactivate AFTER DELETE ON public.client_schedule_exceptions FOR EACH ROW EXECUTE FUNCTION public.notify_staff_schedule_reactivate();


--
-- Name: court_waitlist trg_notify_staff_waitlist_joined; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_staff_waitlist_joined AFTER INSERT ON public.court_waitlist FOR EACH ROW EXECUTE FUNCTION public.notify_staff_waitlist_joined();


--
-- Name: court_waitlist trg_notify_staff_waitlist_left; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_staff_waitlist_left AFTER UPDATE ON public.court_waitlist FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION public.notify_staff_waitlist_left();


--
-- Name: online_payments trg_online_payments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_online_payments_updated BEFORE UPDATE ON public.online_payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payments trg_payment_marks_charge; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_marks_charge AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.mark_charge_paid();


--
-- Name: payments trg_payment_to_account_entry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_to_account_entry AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payment_to_account_entry();


--
-- Name: payments trg_payment_update_account_entry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_update_account_entry AFTER UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payment_update_account_entry();


--
-- Name: price_table trg_price_table_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_price_table_updated_at BEFORE UPDATE ON public.price_table FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles trg_profiles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teacher_client_change_requests trg_tccr_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tccr_before_insert BEFORE INSERT ON public.teacher_client_change_requests FOR EACH ROW EXECUTE FUNCTION public.teacher_client_change_requests_before_insert();


--
-- Name: teacher_client_change_requests trg_tccr_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tccr_updated_at BEFORE UPDATE ON public.teacher_client_change_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teachers trg_teachers_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teachers_updated BEFORE UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_permissions trg_user_permissions_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_permissions_updated BEFORE UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payments trg_validate_payment_court; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_payment_court BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.validate_payment_court();


--
-- Name: court_availability_overrides update_court_availability_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_court_availability_overrides_updated_at BEFORE UPDATE ON public.court_availability_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ideas update_ideas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ideas_updated_at BEFORE UPDATE ON public.ideas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: neurochat_message_logs update_neurochat_logs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_neurochat_logs_updated_at BEFORE UPDATE ON public.neurochat_message_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_entries account_entries_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entries
    ADD CONSTRAINT account_entries_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: account_entries account_entries_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entries
    ADD CONSTRAINT account_entries_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: app_notifications app_notifications_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notifications
    ADD CONSTRAINT app_notifications_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: booking_confirmations booking_confirmations_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_confirmations
    ADD CONSTRAINT booking_confirmations_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.court_bookings(id) ON DELETE CASCADE;


--
-- Name: booking_confirmations booking_confirmations_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_confirmations
    ADD CONSTRAINT booking_confirmations_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.client_schedules(id) ON DELETE CASCADE;


--
-- Name: cash_closings cash_closings_cash_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_cash_user_id_fkey FOREIGN KEY (cash_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: cash_closings cash_closings_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: cleaning_products cleaning_products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_products
    ADD CONSTRAINT cleaning_products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.cleaning_suppliers(id) ON DELETE SET NULL;


--
-- Name: cleaning_purchases cleaning_purchases_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_purchases
    ADD CONSTRAINT cleaning_purchases_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.cleaning_products(id) ON DELETE CASCADE;


--
-- Name: cleaning_purchases cleaning_purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_purchases
    ADD CONSTRAINT cleaning_purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.cleaning_suppliers(id) ON DELETE SET NULL;


--
-- Name: cleaning_weekly_usage cleaning_weekly_usage_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_weekly_usage
    ADD CONSTRAINT cleaning_weekly_usage_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.cleaning_products(id) ON DELETE CASCADE;


--
-- Name: client_portal_users client_portal_users_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_users
    ADD CONSTRAINT client_portal_users_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_schedule_attendance client_schedule_attendance_client_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_attendance
    ADD CONSTRAINT client_schedule_attendance_client_schedule_id_fkey FOREIGN KEY (client_schedule_id) REFERENCES public.client_schedules(id) ON DELETE CASCADE;


--
-- Name: client_schedule_attendance client_schedule_attendance_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_attendance
    ADD CONSTRAINT client_schedule_attendance_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: client_schedule_day_notes client_schedule_day_notes_client_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_day_notes
    ADD CONSTRAINT client_schedule_day_notes_client_schedule_id_fkey FOREIGN KEY (client_schedule_id) REFERENCES public.client_schedules(id) ON DELETE CASCADE;


--
-- Name: client_schedule_day_notes client_schedule_day_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_day_notes
    ADD CONSTRAINT client_schedule_day_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: client_schedule_exceptions client_schedule_exceptions_client_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_exceptions
    ADD CONSTRAINT client_schedule_exceptions_client_schedule_id_fkey FOREIGN KEY (client_schedule_id) REFERENCES public.client_schedules(id) ON DELETE CASCADE;


--
-- Name: client_schedule_exceptions client_schedule_exceptions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedule_exceptions
    ADD CONSTRAINT client_schedule_exceptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: client_schedules client_schedules_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedules
    ADD CONSTRAINT client_schedules_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_schedules client_schedules_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_schedules
    ADD CONSTRAINT client_schedules_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: client_teacher_link_requests client_teacher_link_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teacher_link_requests
    ADD CONSTRAINT client_teacher_link_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_teacher_link_requests client_teacher_link_requests_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teacher_link_requests
    ADD CONSTRAINT client_teacher_link_requests_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: client_teachers client_teachers_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teachers
    ADD CONSTRAINT client_teachers_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_teachers client_teachers_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_teachers
    ADD CONSTRAINT client_teachers_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: clients clients_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.client_categories(id) ON DELETE SET NULL;


--
-- Name: clients clients_linked_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_linked_teacher_id_fkey FOREIGN KEY (linked_teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: clients clients_responsible_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_responsible_client_id_fkey FOREIGN KEY (responsible_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: clients clients_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: cobranca_followup_events cobranca_followup_events_followup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cobranca_followup_events
    ADD CONSTRAINT cobranca_followup_events_followup_id_fkey FOREIGN KEY (followup_id) REFERENCES public.cobranca_followups(id) ON DELETE CASCADE;


--
-- Name: cobranca_followups cobranca_followups_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cobranca_followups
    ADD CONSTRAINT cobranca_followups_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: court_availability_overrides court_availability_overrides_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_availability_overrides
    ADD CONSTRAINT court_availability_overrides_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: court_availability_overrides court_availability_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_availability_overrides
    ADD CONSTRAINT court_availability_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: court_booking_participants court_booking_participants_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_booking_participants
    ADD CONSTRAINT court_booking_participants_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.court_bookings(id) ON DELETE CASCADE;


--
-- Name: court_booking_participants court_booking_participants_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_booking_participants
    ADD CONSTRAINT court_booking_participants_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: court_bookings court_bookings_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: court_bookings court_bookings_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.client_categories(id) ON DELETE SET NULL;


--
-- Name: court_bookings court_bookings_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.monthly_charges(id) ON DELETE SET NULL;


--
-- Name: court_bookings court_bookings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: court_bookings court_bookings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: court_bookings court_bookings_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_bookings
    ADD CONSTRAINT court_bookings_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: court_waitlist court_waitlist_booking_id_created_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_booking_id_created_fkey FOREIGN KEY (booking_id_created) REFERENCES public.court_bookings(id) ON DELETE SET NULL;


--
-- Name: court_waitlist court_waitlist_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: court_waitlist court_waitlist_requested_by_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_requested_by_teacher_id_fkey FOREIGN KEY (requested_by_teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: court_waitlist court_waitlist_resulting_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_resulting_booking_id_fkey FOREIGN KEY (resulting_booking_id) REFERENCES public.court_bookings(id) ON DELETE SET NULL;


--
-- Name: court_waitlist court_waitlist_source_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_source_booking_id_fkey FOREIGN KEY (source_booking_id) REFERENCES public.court_bookings(id) ON DELETE SET NULL;


--
-- Name: court_waitlist court_waitlist_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.court_waitlist
    ADD CONSTRAINT court_waitlist_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: debt_limit_alert_events debt_limit_alert_events_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_alert_events
    ADD CONSTRAINT debt_limit_alert_events_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.debt_limit_alerts(id) ON DELETE CASCADE;


--
-- Name: debt_limit_alerts debt_limit_alerts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_alerts
    ADD CONSTRAINT debt_limit_alerts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: debt_limit_exceptions debt_limit_exceptions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_limit_exceptions
    ADD CONSTRAINT debt_limit_exceptions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: fixed_court_waitlist fixed_court_waitlist_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_court_waitlist
    ADD CONSTRAINT fixed_court_waitlist_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fixed_court_waitlist fixed_court_waitlist_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_court_waitlist
    ADD CONSTRAINT fixed_court_waitlist_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: fixed_court_waitlist fixed_court_waitlist_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_court_waitlist
    ADD CONSTRAINT fixed_court_waitlist_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fixed_court_waitlist fixed_court_waitlist_requested_by_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_court_waitlist
    ADD CONSTRAINT fixed_court_waitlist_requested_by_teacher_id_fkey FOREIGN KEY (requested_by_teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: fixed_court_waitlist fixed_court_waitlist_resulting_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_court_waitlist
    ADD CONSTRAINT fixed_court_waitlist_resulting_schedule_id_fkey FOREIGN KEY (resulting_schedule_id) REFERENCES public.client_schedules(id) ON DELETE SET NULL;


--
-- Name: fixed_waitlist_court_settings fixed_waitlist_court_settings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_waitlist_court_settings
    ADD CONSTRAINT fixed_waitlist_court_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: idea_comments idea_comments_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_comments
    ADD CONSTRAINT idea_comments_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.ideas(id) ON DELETE CASCADE;


--
-- Name: monthly_charges monthly_charges_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_charges
    ADD CONSTRAINT monthly_charges_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: neurochat_message_logs neurochat_message_logs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.neurochat_message_logs
    ADD CONSTRAINT neurochat_message_logs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: neurochat_message_logs neurochat_message_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.neurochat_message_logs
    ADD CONSTRAINT neurochat_message_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: online_payments online_payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_payments
    ADD CONSTRAINT online_payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.court_bookings(id) ON DELETE CASCADE;


--
-- Name: online_payments online_payments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_payments
    ADD CONSTRAINT online_payments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: online_payments online_payments_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_payments
    ADD CONSTRAINT online_payments_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: open_debt_reminder_actions open_debt_reminder_actions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_debt_reminder_actions
    ADD CONSTRAINT open_debt_reminder_actions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: payment_receipts payment_receipts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: payment_receipts payment_receipts_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.account_entries(id) ON DELETE SET NULL;


--
-- Name: payment_receipts payment_receipts_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.court_bookings(id) ON DELETE SET NULL;


--
-- Name: payments payments_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.client_categories(id) ON DELETE SET NULL;


--
-- Name: payments payments_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.monthly_charges(id) ON DELETE SET NULL;


--
-- Name: payments payments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: payments payments_commission_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_commission_user_id_fkey FOREIGN KEY (commission_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: payments payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: pending_client_signups pending_client_signups_resolved_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_client_signups
    ADD CONSTRAINT pending_client_signups_resolved_client_id_fkey FOREIGN KEY (resolved_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: pending_client_signups pending_client_signups_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_client_signups
    ADD CONSTRAINT pending_client_signups_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pending_signups pending_signups_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_signups
    ADD CONSTRAINT pending_signups_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: portal_booking_failures portal_booking_failures_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_booking_failures
    ADD CONSTRAINT portal_booking_failures_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: portal_signup_tokens portal_signup_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_signup_tokens
    ADD CONSTRAINT portal_signup_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: portal_signup_tokens portal_signup_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_signup_tokens
    ADD CONSTRAINT portal_signup_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: racket_loans racket_loans_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.racket_loans
    ADD CONSTRAINT racket_loans_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.court_bookings(id) ON DELETE SET NULL;


--
-- Name: racket_loans racket_loans_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.racket_loans
    ADD CONSTRAINT racket_loans_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: racket_loans racket_loans_lent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.racket_loans
    ADD CONSTRAINT racket_loans_lent_by_fkey FOREIGN KEY (lent_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: racket_loans racket_loans_returned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.racket_loans
    ADD CONSTRAINT racket_loans_returned_by_fkey FOREIGN KEY (returned_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stock_items(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id);


--
-- Name: task_updates task_updates_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_updates
    ADD CONSTRAINT task_updates_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_parent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.court_bookings(id) ON DELETE CASCADE;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_current_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_current_client_id_fkey FOREIGN KEY (current_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_new_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_new_client_id_fkey FOREIGN KEY (new_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.client_schedules(id) ON DELETE CASCADE;


--
-- Name: teacher_client_change_requests teacher_client_change_requests_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_client_change_requests
    ADD CONSTRAINT teacher_client_change_requests_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: teacher_signup_tokens teacher_signup_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_signup_tokens
    ADD CONSTRAINT teacher_signup_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: teacher_signup_tokens teacher_signup_tokens_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_signup_tokens
    ADD CONSTRAINT teacher_signup_tokens_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: teachers teachers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: waitlist_acknowledgements waitlist_acknowledgements_waitlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_acknowledgements
    ADD CONSTRAINT waitlist_acknowledgements_waitlist_id_fkey FOREIGN KEY (waitlist_id) REFERENCES public.court_waitlist(id) ON DELETE CASCADE;


--
-- Name: work_task_comments work_task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_task_comments
    ADD CONSTRAINT work_task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.work_tasks(id) ON DELETE CASCADE;


--
-- Name: work_tasks work_tasks_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE CASCADE;


--
-- Name: cash_closings Admin and diretoria can view cash closings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin and diretoria can view cash closings" ON public.cash_closings FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: stock_movements Admin and recepcionista can create stock movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin and recepcionista can create stock movements" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: stock_items Admin and recepcionista can update stock items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin and recepcionista can update stock items" ON public.stock_items FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: cash_closings Admin can delete cash closings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete cash closings" ON public.cash_closings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: racket_loans Admin can delete racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete racket loans" ON public.racket_loans FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: cash_closings Admin can update cash closings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update cash closings" ON public.cash_closings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ideas Admins can manage all ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all ideas" ON public.ideas TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: stock_items Admins manage stock items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage stock items" ON public.stock_items TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: stock_movements Admins manage stock movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage stock movements" ON public.stock_movements TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: court_availability_overrides Authenticated can read active availability overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read active availability overrides" ON public.court_availability_overrides FOR SELECT TO authenticated USING (((active = true) AND (cancelled_at IS NULL)));


--
-- Name: ideas Diretoria can create ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Diretoria can create ideas" ON public.ideas FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: ideas Diretoria can delete own ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Diretoria can delete own ideas" ON public.ideas FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: ideas Diretoria can update own ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Diretoria can update own ideas" ON public.ideas FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: account_entries Portal client reads account entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal client reads account entries" ON public.account_entries FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: monthly_charges Portal client reads monthly charges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal client reads monthly charges" ON public.monthly_charges FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: client_portal_users Portal client reads own link; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal client reads own link" ON public.client_portal_users FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: app_notifications Portal clients can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal clients can update own notifications" ON public.app_notifications FOR UPDATE TO authenticated USING (((client_id IS NOT NULL) AND (client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id))))) WITH CHECK (((client_id IS NOT NULL) AND (client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id)))));


--
-- Name: app_notifications Portal clients can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal clients can view own notifications" ON public.app_notifications FOR SELECT TO authenticated USING (((client_id IS NOT NULL) AND (client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id)))));


--
-- Name: court_waitlist Portal owner select own waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal owner select own waitlist" ON public.court_waitlist FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: app_notifications Staff can delete app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can delete app notifications" ON public.app_notifications FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: app_notifications Staff can insert app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can insert app notifications" ON public.app_notifications FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: cash_closings Staff can insert cash closings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can insert cash closings" ON public.cash_closings FOR INSERT TO authenticated WITH CHECK (((closed_by = auth.uid()) AND ((cash_user_id IS NULL) OR public.auth_user_exists(cash_user_id)) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: racket_loans Staff can insert racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can insert racket loans" ON public.racket_loans FOR INSERT TO authenticated WITH CHECK (((lent_by = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: court_availability_overrides Staff can manage availability overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can manage availability overrides" ON public.court_availability_overrides TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: app_notifications Staff can update app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update app notifications" ON public.app_notifications FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: racket_loans Staff can update racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update racket loans" ON public.racket_loans FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: app_notifications Staff can view app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view app notifications" ON public.app_notifications FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: neurochat_message_logs Staff can view neurochat logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view neurochat logs" ON public.neurochat_message_logs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: racket_loans Staff can view racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view racket loans" ON public.racket_loans FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: waitlist_acknowledgements Staff insert own ack; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff insert own ack" ON public.waitlist_acknowledgements FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))));


--
-- Name: client_portal_users Staff manage portal users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage portal users" ON public.client_portal_users TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: court_waitlist Staff manage waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage waitlist" ON public.court_waitlist TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: waitlist_acknowledgements Staff view acks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff view acks" ON public.waitlist_acknowledgements FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: app_notifications Targeted user can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Targeted user can update own notifications" ON public.app_notifications FOR UPDATE TO authenticated USING (((user_id IS NOT NULL) AND (user_id = auth.uid()))) WITH CHECK (((user_id IS NOT NULL) AND (user_id = auth.uid())));


--
-- Name: app_notifications Targeted user can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Targeted user can view own notifications" ON public.app_notifications FOR SELECT TO authenticated USING (((user_id IS NOT NULL) AND (user_id = auth.uid())));


--
-- Name: app_notifications Teachers can insert app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers can insert app notifications" ON public.app_notifications FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_id IS NOT NULL) AND (kind = ANY (ARRAY['professor_cancel'::text, 'professor_note'::text, 'aula_remarcada'::text])) AND (requires_ack IS NOT TRUE) AND ((client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cs.client_id IS NOT NULL)))) OR (client_id IN ( SELECT cb.client_id
   FROM (public.court_bookings cb
     JOIN public.teachers t ON ((t.id = cb.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cb.client_id IS NOT NULL)))))));


--
-- Name: court_waitlist Teachers delete own waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers delete own waitlist" ON public.court_waitlist FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: court_waitlist Teachers insert waitlist for own students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers insert waitlist for own students" ON public.court_waitlist FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM public.clients c
  WHERE (c.teacher_id IN ( SELECT teachers.id
           FROM public.teachers
          WHERE (teachers.user_id = auth.uid()))))))));


--
-- Name: court_waitlist Teachers update own waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers update own waitlist" ON public.court_waitlist FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))))) WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: court_waitlist Teachers view waitlist for own students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers view waitlist for own students" ON public.court_waitlist FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM public.clients c
  WHERE (c.teacher_id IN ( SELECT teachers.id
           FROM public.teachers
          WHERE (teachers.user_id = auth.uid()))))))));


--
-- Name: account_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: account_entries ae_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_admin_all ON public.account_entries TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: account_entries ae_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_recep_delete ON public.account_entries FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: account_entries ae_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_recep_insert ON public.account_entries FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: account_entries ae_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_recep_update ON public.account_entries FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: account_entries ae_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_select_staff ON public.account_entries FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: app_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_admin_write ON public.app_settings TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: app_settings app_settings_public_or_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_public_or_staff_read ON public.app_settings FOR SELECT TO authenticated USING ((public.app_settings_is_public_key(key) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_delete_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_delete_staff ON public.client_schedule_attendance FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_insert_staff ON public.client_schedule_attendance FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_select_staff ON public.client_schedule_attendance FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_select_teacher_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_select_teacher_own ON public.client_schedule_attendance FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: client_schedule_attendance attendance_update_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_update_staff ON public.client_schedule_attendance FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_select_staff ON public.audit_logs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: booking_confirmations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_confirmations ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_closings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_closings ENABLE ROW LEVEL SECURITY;

--
-- Name: client_categories cat_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cat_admin_all ON public.client_categories TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: client_categories cat_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cat_select_staff ON public.client_categories FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: court_booking_participants cbp_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cbp_staff_all ON public.court_booking_participants TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: court_booking_participants cbp_teacher_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cbp_teacher_own ON public.court_booking_participants FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (booking_id IN ( SELECT b.id
   FROM public.court_bookings b
  WHERE ((b.teacher_id IN ( SELECT teachers.id
           FROM public.teachers
          WHERE (teachers.user_id = auth.uid()))) OR (b.client_id IN ( SELECT cs.client_id
           FROM (public.client_schedules cs
             JOIN public.teachers t ON ((t.id = cs.teacher_id)))
          WHERE (t.user_id = auth.uid()))))))));


--
-- Name: client_followups cf_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_admin_all ON public.client_followups TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: client_followups cf_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_recep_delete ON public.client_followups FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: client_followups cf_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_recep_insert ON public.client_followups FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: client_followups cf_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_recep_update ON public.client_followups FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: client_followups cf_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_select_staff ON public.client_followups FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: monthly_charges chg_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chg_admin_all ON public.monthly_charges TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: monthly_charges chg_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chg_recep_update ON public.monthly_charges FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: monthly_charges chg_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chg_select_staff ON public.monthly_charges FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: cleaning_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_products ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_products cleaning_products_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_products_diretoria_all ON public.cleaning_products TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: cleaning_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_purchases cleaning_purchases_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_purchases_diretoria_all ON public.cleaning_purchases TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: cleaning_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_suppliers cleaning_suppliers_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_suppliers_diretoria_all ON public.cleaning_suppliers TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: cleaning_weekly_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_weekly_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_weekly_usage cleaning_weekly_usage_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_weekly_usage_diretoria_all ON public.cleaning_weekly_usage TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: clients cli_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_admin_all ON public.clients TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: clients cli_diretoria_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_diretoria_delete ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'diretoria'::public.app_role));


--
-- Name: clients cli_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_recep_delete ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: clients cli_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_recep_insert ON public.clients FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: clients cli_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_recep_update ON public.clients FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: clients cli_select_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_select_portal ON public.clients FOR SELECT TO authenticated USING (public.portal_can_view_client(id));


--
-- Name: clients cli_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_select_staff ON public.clients FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: client_followups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_followups ENABLE ROW LEVEL SECURITY;

--
-- Name: client_portal_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedule_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_day_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedule_day_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedule_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: client_teacher_link_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_teacher_link_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: client_teacher_link_requests client_teacher_link_requests_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teacher_link_requests_staff_all ON public.client_teacher_link_requests TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_teacher_link_requests client_teacher_link_requests_teacher_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teacher_link_requests_teacher_insert_own ON public.client_teacher_link_requests FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) AND (requested_by = auth.uid()) AND (status = 'pendente'::text)));


--
-- Name: client_teacher_link_requests client_teacher_link_requests_teacher_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teacher_link_requests_teacher_select_own ON public.client_teacher_link_requests FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: client_teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: client_teachers client_teachers_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teachers_staff_all ON public.client_teachers TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_teachers client_teachers_teacher_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teachers_teacher_select_own ON public.client_teachers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: cobranca_followup_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cobranca_followup_events ENABLE ROW LEVEL SECURITY;

--
-- Name: cobranca_followups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cobranca_followups ENABLE ROW LEVEL SECURITY;

--
-- Name: court_availability_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_availability_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: court_booking_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_booking_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: court_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: court_waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_waitlist ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_day_notes csdn_professor_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY csdn_professor_select ON public.client_schedule_day_notes FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (EXISTS ( SELECT 1
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE ((cs.id = client_schedule_day_notes.client_schedule_id) AND (t.user_id = auth.uid()))))));


--
-- Name: client_schedule_day_notes csdn_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY csdn_staff_all ON public.client_schedule_day_notes TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: debt_limit_alert_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_alert_events ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_alert_events debt_limit_alert_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_alert_events_select ON public.debt_limit_alert_events FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: debt_limit_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_alerts debt_limit_alerts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_alerts_select ON public.debt_limit_alerts FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: debt_limit_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_exceptions debt_limit_exceptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_exceptions_select ON public.debt_limit_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: debt_limit_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_settings debt_limit_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_settings_select ON public.debt_limit_settings FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: debt_limit_settings debt_limit_settings_update_diretoria_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_settings_update_diretoria_only ON public.debt_limit_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'diretoria'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'diretoria'::public.app_role));


--
-- Name: fixed_court_waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_court_waitlist ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_waitlist_court_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_waitlist_court_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_waitlist_court_hours fixed_waitlist_court_hours_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_hours_select ON public.fixed_waitlist_court_hours FOR SELECT TO authenticated USING (true);


--
-- Name: fixed_waitlist_court_hours fixed_waitlist_court_hours_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_hours_staff_write ON public.fixed_waitlist_court_hours TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_waitlist_court_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_waitlist_court_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_waitlist_court_settings fixed_waitlist_court_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_settings_select ON public.fixed_waitlist_court_settings FOR SELECT TO authenticated USING (true);


--
-- Name: fixed_waitlist_court_settings fixed_waitlist_court_settings_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_settings_staff_write ON public.fixed_waitlist_court_settings TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_portal_client_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_portal_client_select ON public.fixed_court_waitlist FOR SELECT TO authenticated USING ((client_id IN ( SELECT client_portal_users.client_id
   FROM public.client_portal_users
  WHERE (client_portal_users.user_id = auth.uid()))));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_delete ON public.fixed_court_waitlist FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_insert ON public.fixed_court_waitlist FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_select ON public.fixed_court_waitlist FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_update ON public.fixed_court_waitlist FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_teacher_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_teacher_select ON public.fixed_court_waitlist FOR SELECT TO authenticated USING ((requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))));


--
-- Name: idea_comments ic_delete_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ic_delete_own_or_admin ON public.idea_comments FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: idea_comments ic_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ic_insert_own ON public.idea_comments FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: idea_comments ic_select_diretoria_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ic_select_diretoria_admin ON public.idea_comments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: idea_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idea_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: ideas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;

--
-- Name: ideas ideas_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ideas_select_scoped ON public.ideas FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (created_by = auth.uid())));


--
-- Name: monthly_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: neurochat_message_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.neurochat_message_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: open_debt_reminder_actions odra_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY odra_insert_staff ON public.open_debt_reminder_actions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: open_debt_reminder_actions odra_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY odra_select_staff ON public.open_debt_reminder_actions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: open_debt_reminder_actions odra_update_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY odra_update_staff ON public.open_debt_reminder_actions FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: online_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.online_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: online_payments online_payments_client_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY online_payments_client_select_own ON public.online_payments FOR SELECT TO authenticated USING ((client_id IN ( SELECT client_portal_users.client_id
   FROM public.client_portal_users
  WHERE (client_portal_users.user_id = auth.uid()))));


--
-- Name: online_payments online_payments_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY online_payments_staff_all ON public.online_payments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: open_debt_reminder_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_debt_reminder_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_signups own pending row visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own pending row visible" ON public.pending_signups FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: pending_client_signups own pending signup visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own pending signup visible" ON public.pending_client_signups FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: payments pay_admin_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_delete ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments pay_admin_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_insert ON public.payments FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) AND ((commission_user_id IS NULL) OR (public.auth_user_exists(commission_user_id) AND (public.has_role(commission_user_id, 'admin'::public.app_role) OR public.has_role(commission_user_id, 'recepcionista'::public.app_role) OR public.has_role(commission_user_id, 'diretoria'::public.app_role) OR public.has_role(commission_user_id, 'professor'::public.app_role))))));


--
-- Name: payments pay_admin_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_select ON public.payments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments pay_admin_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_update ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments pay_portal_client_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_portal_client_select ON public.payments FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: payments pay_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_recep_delete ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: payments pay_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_recep_insert ON public.payments FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'recepcionista'::public.app_role) AND (recorded_by = auth.uid()) AND ((commission_user_id IS NULL) OR (public.auth_user_exists(commission_user_id) AND (public.has_role(commission_user_id, 'admin'::public.app_role) OR public.has_role(commission_user_id, 'recepcionista'::public.app_role) OR public.has_role(commission_user_id, 'diretoria'::public.app_role) OR public.has_role(commission_user_id, 'professor'::public.app_role))))));


--
-- Name: payments pay_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_recep_update ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: payments pay_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_select_staff ON public.payments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: payment_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_client_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_client_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions perms_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY perms_admin_all ON public.user_permissions TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_permissions perms_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY perms_select_own ON public.user_permissions FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: portal_booking_failures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_booking_failures ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_booking_failures portal_booking_failures_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_booking_failures_staff_select ON public.portal_booking_failures FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: court_bookings portal_cancel_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_cancel_own_bookings ON public.court_bookings FOR UPDATE TO authenticated USING (((client_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.client_portal_users cpu
  WHERE ((cpu.user_id = auth.uid()) AND (cpu.client_id = court_bookings.client_id)))))) WITH CHECK ((cancelled_at IS NOT NULL));


--
-- Name: court_bookings portal_select_bookings_for_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_bookings_for_map ON public.court_bookings FOR SELECT TO authenticated USING ((client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id))));


--
-- Name: court_bookings portal_select_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_own_bookings ON public.court_bookings FOR SELECT TO authenticated USING (((client_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.client_portal_users cpu
  WHERE ((cpu.user_id = auth.uid()) AND (cpu.client_id = court_bookings.client_id))))));


--
-- Name: client_schedule_exceptions portal_select_schedule_exceptions_for_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_schedule_exceptions_for_map ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.client_schedules cs
  WHERE ((cs.id = client_schedule_exceptions.client_schedule_id) AND (cs.client_id IN ( SELECT portal_owned_client_ids.client_id
           FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id)))))));


--
-- Name: client_schedules portal_select_schedules_for_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_schedules_for_map ON public.client_schedules FOR SELECT TO authenticated USING ((client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id))));


--
-- Name: portal_signup_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_signup_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: price_table; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_table ENABLE ROW LEVEL SECURITY;

--
-- Name: price_table price_table_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_table_admin_all ON public.price_table TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: price_table price_table_select_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_table_select_portal ON public.price_table FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.client_portal_users cpu
  WHERE (cpu.user_id = auth.uid()))));


--
-- Name: price_table price_table_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_table_select_staff ON public.price_table FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_admin_all ON public.profiles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles profiles_select_self_or_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_self_or_staff ON public.profiles FOR SELECT TO authenticated USING (((auth.uid() = id) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--
-- Name: racket_loans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.racket_loans ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_receipts receipts_delete_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_delete_auth ON public.payment_receipts FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: payment_receipts receipts_insert_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_insert_auth ON public.payment_receipts FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: payment_receipts receipts_select_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_select_portal ON public.payment_receipts FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: payment_receipts receipts_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_select_staff ON public.payment_receipts FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: user_roles roles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_admin_all ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles roles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_select_own ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: client_schedule_exceptions sched_exc_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_delete ON public.client_schedule_exceptions FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_exceptions sched_exc_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_insert ON public.client_schedule_exceptions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_exceptions sched_exc_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_select ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_exceptions sched_exc_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_update ON public.client_schedule_exceptions FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedules sched_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_delete ON public.client_schedules FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedules sched_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_insert ON public.client_schedules FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedules sched_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_select ON public.client_schedules FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedules sched_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_update ON public.client_schedules FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: pending_signups staff deletes pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff deletes pending" ON public.pending_signups FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: portal_signup_tokens staff manage signup tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff manage signup tokens" ON public.portal_signup_tokens TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: teacher_signup_tokens staff manage teacher signup tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff manage teacher signup tokens" ON public.teacher_signup_tokens TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: pending_signups staff sees all pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff sees all pending" ON public.pending_signups FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: pending_client_signups staff sees all pending client signups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff sees all pending client signups" ON public.pending_client_signups FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: teacher_client_change_requests staff update requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff update requests" ON public.teacher_client_change_requests FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR ((requested_by = auth.uid()) AND (status = 'pendente'::text)))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR ((requested_by = auth.uid()) AND (status = ANY (ARRAY['pendente'::text, 'cancelada'::text])))));


--
-- Name: court_bookings staff_full_access_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_full_access_bookings ON public.court_bookings TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: booking_confirmations staff_manage_booking_confirmations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_manage_booking_confirmations ON public.booking_confirmations TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: stock_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_items stock_items_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_items_select_staff ON public.stock_items FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements stock_movements_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_select_staff ON public.stock_movements FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: task_updates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: task_updates task_updates_delete_author_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_updates_delete_author_admin ON public.task_updates FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: task_updates task_updates_insert_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_updates_insert_scoped ON public.task_updates FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_updates.task_id) AND ((t.created_by = auth.uid()) OR (t.assigned_to = auth.uid()))))))));


--
-- Name: task_updates task_updates_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_updates_select_scoped ON public.task_updates FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_updates.task_id) AND ((t.created_by = auth.uid()) OR (t.assigned_to = auth.uid())))))));


--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks tasks_delete_owner_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_delete_owner_admin ON public.tasks FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: tasks tasks_insert_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert_auth ON public.tasks FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: tasks tasks_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_scoped ON public.tasks FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (created_by = auth.uid()) OR (assigned_to = auth.uid())));


--
-- Name: tasks tasks_update_owner_assignee_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_update_owner_assignee_admin ON public.tasks FOR UPDATE TO authenticated USING (((created_by = auth.uid()) OR (assigned_to = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: teacher_client_change_requests teacher own requests insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "teacher own requests insert" ON public.teacher_client_change_requests FOR INSERT TO authenticated WITH CHECK (((requested_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.teachers t
  WHERE ((t.id = teacher_client_change_requests.teacher_id) AND (t.user_id = auth.uid()))))));


--
-- Name: teacher_client_change_requests teacher own requests select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "teacher own requests select" ON public.teacher_client_change_requests FOR SELECT TO authenticated USING (((requested_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: teacher_client_change_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_client_change_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: court_bookings teacher_delete_own_cancelled_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_delete_own_cancelled_bookings ON public.court_bookings FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (cancelled_at IS NOT NULL) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: client_schedule_exceptions teacher_delete_own_sched_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_delete_own_sched_exceptions ON public.client_schedule_exceptions FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM ((public.client_schedules cs
     LEFT JOIN public.clients c ON ((c.id = cs.client_id)))
     JOIN public.teachers t ON (((t.id = cs.teacher_id) OR (t.id = c.teacher_id))))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: court_bookings teacher_insert_cancel_booking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_insert_cancel_booking ON public.court_bookings FOR INSERT TO authenticated WITH CHECK (((cancelled_at IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.teachers t
  WHERE ((t.id = court_bookings.teacher_id) AND (t.user_id = auth.uid())))) AND ((client_id IS NULL) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t2 ON ((t2.id = cs.teacher_id)))
  WHERE (t2.user_id = auth.uid()))))));


--
-- Name: client_schedule_exceptions teacher_insert_own_schedule_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_insert_own_schedule_exceptions ON public.client_schedule_exceptions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM ((public.client_schedules cs
     LEFT JOIN public.clients c ON ((c.id = cs.client_id)))
     JOIN public.teachers t ON (((t.id = cs.teacher_id) OR (t.id = c.teacher_id))))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: court_bookings teacher_select_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_bookings ON public.court_bookings FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid()))))));


--
-- Name: clients teacher_select_own_clients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_clients ON public.clients FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cs.client_id IS NOT NULL)))) OR (id IN ( SELECT cb.client_id
   FROM (public.court_bookings cb
     JOIN public.teachers t ON ((t.id = cb.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cb.client_id IS NOT NULL)))) OR (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (id IN ( SELECT ct.client_id
   FROM (public.client_teachers ct
     JOIN public.teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.user_id = auth.uid()))))));


--
-- Name: client_schedule_exceptions teacher_select_own_sched_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_sched_exceptions ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM ((public.client_schedules cs
     LEFT JOIN public.clients c ON ((c.id = cs.client_id)))
     JOIN public.teachers t ON (((t.id = cs.teacher_id) OR (t.id = c.teacher_id))))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: client_schedule_exceptions teacher_select_own_schedule_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_schedule_exceptions ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: client_schedules teacher_select_own_schedules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_schedules ON public.client_schedules FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: teachers teacher_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_self ON public.teachers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (user_id = auth.uid())));


--
-- Name: teacher_signup_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_signup_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: court_bookings teacher_toggle_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_toggle_own_bookings ON public.court_bookings FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM (public.clients c
     JOIN public.teachers t ON ((t.id = c.teacher_id)))
  WHERE (t.user_id = auth.uid())))))) WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM (public.clients c
     JOIN public.teachers t ON ((t.id = c.teacher_id)))
  WHERE (t.user_id = auth.uid()))))));


--
-- Name: teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: teachers teachers_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_delete ON public.teachers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: teachers teachers_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_insert ON public.teachers FOR INSERT TO authenticated WITH CHECK (((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)) AND ((user_id IS NULL) OR public.auth_user_exists(user_id))));


--
-- Name: teachers teachers_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_select ON public.teachers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: teachers teachers_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_update ON public.teachers FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_acknowledgements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist_acknowledgements ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_notifications wn_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wn_admin_delete ON public.whatsapp_notifications FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: whatsapp_notifications wn_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wn_insert_staff ON public.whatsapp_notifications FOR INSERT TO authenticated WITH CHECK (((sent_by = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: whatsapp_notifications wn_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wn_select_staff ON public.whatsapp_notifications FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: work_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: works; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;

--
-- Name: works works_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_admin_all ON public.works TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: works works_diretoria_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_diretoria_delete ON public.works FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: works works_diretoria_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_diretoria_insert ON public.works FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: works works_diretoria_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_diretoria_update ON public.works FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: works works_select_diretoria_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_select_diretoria_admin ON public.works FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_tasks wt_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_admin_all ON public.work_tasks TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: work_tasks wt_diretoria_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_diretoria_delete ON public.work_tasks FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: work_tasks wt_diretoria_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_diretoria_insert ON public.work_tasks FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: work_tasks wt_diretoria_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_diretoria_update ON public.work_tasks FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: work_tasks wt_select_diretoria_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_select_diretoria_admin ON public.work_tasks FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_task_comments wtc_delete_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_delete_own_or_admin ON public.work_task_comments FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: work_task_comments wtc_insert_admin_diretoria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_insert_admin_diretoria ON public.work_task_comments FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: work_task_comments wtc_select_admin_diretoria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_select_admin_diretoria ON public.work_task_comments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_task_comments wtc_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_update_own ON public.work_task_comments FOR UPDATE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: TABLE teacher_client_change_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teacher_client_change_requests TO authenticated;
GRANT ALL ON TABLE public.teacher_client_change_requests TO service_role;


--
-- Name: FUNCTION _apply_client_change_request(r public.teacher_client_change_requests); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._apply_client_change_request(r public.teacher_client_change_requests) FROM PUBLIC;


--
-- Name: FUNCTION _client_belongs_to_teacher(_client_id uuid, _teacher_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._client_belongs_to_teacher(_client_id uuid, _teacher_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION _client_change_slot_occupant(_court integer, _date date, _start time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._client_change_slot_occupant(_court integer, _date date, _start time without time zone) FROM PUBLIC;


--
-- Name: FUNCTION _cobranca_is_staff(_uid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._cobranca_is_staff(_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._cobranca_is_staff(_uid uuid) TO authenticated;


--
-- Name: FUNCTION _fixed_is_off_today(_schedule_id uuid, _date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._fixed_is_off_today(_schedule_id uuid, _date date) FROM PUBLIC;


--
-- Name: FUNCTION _fixed_waitlist_free_matches(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._fixed_waitlist_free_matches() FROM PUBLIC;


--
-- Name: FUNCTION _materialize_swapped_fixed(_ids uuid[], _date date, _to_court smallint, _from_court smallint, _mirror_client uuid, _mirror_start time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._materialize_swapped_fixed(_ids uuid[], _date date, _to_court smallint, _from_court smallint, _mirror_client uuid, _mirror_start time without time zone) FROM PUBLIC;


--
-- Name: FUNCTION _notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION admin_save_client_schedule(_id uuid, _client_id uuid, _weekday integer, _start_time time without time zone, _end_time time without time zone, _court integer, _teacher_id uuid, _notes text, _valid_from date, _valid_until date, _group_ids uuid[], _replace_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_save_client_schedule(_id uuid, _client_id uuid, _weekday integer, _start_time time without time zone, _end_time time without time zone, _court integer, _teacher_id uuid, _notes text, _valid_from date, _valid_until date, _group_ids uuid[], _replace_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION app_settings_is_public_key(_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_settings_is_public_key(_key text) TO authenticated;
GRANT ALL ON FUNCTION public.app_settings_is_public_key(_key text) TO anon;


--
-- Name: FUNCTION approve_client_change_request(_request_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_client_change_request(_request_id uuid) TO authenticated;


--
-- Name: FUNCTION approve_pending_signup(target_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_pending_signup(target_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_pending_signup(target_user uuid) TO authenticated;


--
-- Name: FUNCTION can_access_client_photo(_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_client_photo(_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_client_photo(_name text) TO service_role;
GRANT ALL ON FUNCTION public.can_access_client_photo(_name text) TO supabase_storage_admin;


--
-- Name: FUNCTION cleaning_delete_purchase(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleaning_delete_purchase(_id uuid) TO authenticated;


--
-- Name: FUNCTION cleaning_register_purchase(_product_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleaning_register_purchase(_product_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text) TO authenticated;


--
-- Name: FUNCTION cleaning_update_purchase(_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleaning_update_purchase(_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text) TO authenticated;


--
-- Name: FUNCTION client_account_balance(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_account_balance(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_account_balance(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_account_balances(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_account_balances(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_account_balances(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_family_month_end_projection(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_family_month_end_projection(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_month_end_projection(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_month_end_projection(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_next_month_projection(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_next_month_projection(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_open_debt_items(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_open_debt_items(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_open_debt_items(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) TO service_role;


--
-- Name: FUNCTION client_schedule_valid_on(_valid_from date, _valid_until date, _date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_schedule_valid_on(_valid_from date, _valid_until date, _date date) TO authenticated;
GRANT ALL ON FUNCTION public.client_schedule_valid_on(_valid_from date, _valid_until date, _date date) TO service_role;


--
-- Name: FUNCTION clients_open_debt(_client_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clients_open_debt(_client_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clients_open_debt(_client_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION cobranca_assignees(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_assignees() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_assignees() TO authenticated;


--
-- Name: FUNCTION cobranca_exceptions_watch(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_exceptions_watch() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_exceptions_watch() TO authenticated;


--
-- Name: FUNCTION cobranca_followup_add_note(_followup_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followup_add_note(_followup_id uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followup_add_note(_followup_id uuid, _note text) TO authenticated;


--
-- Name: FUNCTION cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text, _context text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text, _context text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text, _context text) TO authenticated;


--
-- Name: FUNCTION cobranca_followup_keep(_followup_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followup_keep(_followup_id uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followup_keep(_followup_id uuid, _note text) TO authenticated;


--
-- Name: FUNCTION cobranca_followups_auto_resolve(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followups_auto_resolve() FROM PUBLIC;


--
-- Name: FUNCTION cobranca_followups_list(_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followups_list(_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followups_list(_status text) TO authenticated;


--
-- Name: FUNCTION create_substitute_schedule(p_original_schedule_id uuid, p_substitute_client_id uuid, p_valid_from date, p_valid_until date, p_notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_substitute_schedule(p_original_schedule_id uuid, p_substitute_client_id uuid, p_valid_from date, p_valid_until date, p_notes text) TO authenticated;


--
-- Name: FUNCTION debt_limit_add_exception(_client_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_add_exception(_client_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION debt_limit_alerts_list(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_alerts_list() TO authenticated;


--
-- Name: FUNCTION debt_limit_cancel_fixed_occurrence(_client_schedule_id uuid, _date date, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_cancel_fixed_occurrence(_client_schedule_id uuid, _date date, _reason text) TO authenticated;


--
-- Name: FUNCTION debt_limit_check_and_alert(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_check_and_alert(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_excepted_client_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_excepted_client_ids() TO authenticated;


--
-- Name: FUNCTION debt_limit_is_client_excepted(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_is_client_excepted(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_notify_tomorrow_bookings(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_notify_tomorrow_bookings() TO authenticated;


--
-- Name: FUNCTION debt_limit_regularization_breakdown(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_regularization_breakdown(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_remove_exception(_exception_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_remove_exception(_exception_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_reopen_alert(_alert_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_reopen_alert(_alert_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_resolve_alert(_alert_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_resolve_alert(_alert_id uuid, _note text) TO authenticated;


--
-- Name: FUNCTION debt_limit_slot_price(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _category_id uuid, _ref_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_slot_price(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _category_id uuid, _ref_date date) TO authenticated;


--
-- Name: FUNCTION fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) TO service_role;


--
-- Name: FUNCTION fixed_waitlist_assign(_entry_id uuid, _teacher_id uuid, _valid_from date, _valid_months integer, _notes text, _court smallint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_assign(_entry_id uuid, _teacher_id uuid, _valid_from date, _valid_months integer, _notes text, _court smallint) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_free_matches(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_free_matches() TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_join(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_join(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_leave(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_leave(_id uuid) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_notify_expiring_schedules(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_notify_expiring_schedules() TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_notify_free_slots(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fixed_waitlist_notify_free_slots() FROM PUBLIC;


--
-- Name: FUNCTION fixed_waitlist_position(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_position(_id uuid) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_remove(_entry_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_remove(_entry_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


--
-- Name: FUNCTION has_page_access(_user_id uuid, _page_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_page_access(_user_id uuid, _page_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_page_access(_user_id uuid, _page_key text) TO authenticated;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;


--
-- Name: FUNCTION is_portal_client_of(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_portal_client_of(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION list_recepcionista_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_recepcionista_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_recepcionista_ids() TO authenticated;


--
-- Name: FUNCTION log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb) TO authenticated;


--
-- Name: FUNCTION mark_charge_paid(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_charge_paid() FROM PUBLIC;


--
-- Name: FUNCTION move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) TO authenticated;


--
-- Name: FUNCTION move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid) TO authenticated;


--
-- Name: FUNCTION move_or_swap_booking(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.move_or_swap_booking(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) TO authenticated;


--
-- Name: FUNCTION open_debt_report(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_debt_report(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_debt_report(_from date, _to date) TO authenticated;


--
-- Name: FUNCTION payment_to_account_entry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payment_to_account_entry() FROM PUBLIC;


--
-- Name: FUNCTION payment_update_account_entry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payment_update_account_entry() FROM PUBLIC;


--
-- Name: FUNCTION portal_can_view_client(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_can_view_client(_client_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_can_view_client(_client_id uuid) TO service_role;


--
-- Name: FUNCTION portal_cancel_booking(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_cancel_booking(_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_cancel_booking(_booking_id uuid) TO service_role;


--
-- Name: FUNCTION portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text) TO authenticated;


--
-- Name: FUNCTION portal_create_paid_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_create_paid_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_get_category_names(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_get_category_names(_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION portal_join_court_waitlist(_date date, _start time without time zone, _end time without time zone, _source_booking_id uuid, _court_continuity text, _court smallint, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_join_court_waitlist(_date date, _start time without time zone, _end time without time zone, _source_booking_id uuid, _court_continuity text, _court smallint, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_leave_court_waitlist(_waitlist_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_leave_court_waitlist(_waitlist_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text, _details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text, _details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text, _details jsonb) TO authenticated;


--
-- Name: FUNCTION portal_map_bookings(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_bookings(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_bookings(_date date) TO authenticated;


--
-- Name: FUNCTION portal_map_price_bands(_weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_price_bands(_weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_price_bands(_weekday integer) TO authenticated;
GRANT ALL ON FUNCTION public.portal_map_price_bands(_weekday integer) TO service_role;


--
-- Name: FUNCTION portal_map_schedule_exceptions(_date date, _weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_schedule_exceptions(_date date, _weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_schedule_exceptions(_date date, _weekday integer) TO authenticated;


--
-- Name: FUNCTION portal_map_schedules(_weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_schedules(_weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_schedules(_weekday integer) TO authenticated;


--
-- Name: FUNCTION portal_owned_client_ids(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_owned_client_ids(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_owned_client_ids(_user_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_remove_profile_photo(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_remove_profile_photo(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_remove_profile_photo(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_set_profile_photo(_client_id uuid, _photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_set_profile_photo(_client_id uuid, _photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_set_profile_photo(_client_id uuid, _photo_path text) TO authenticated;


--
-- Name: FUNCTION portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone) TO authenticated;


--
-- Name: FUNCTION portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text) TO authenticated;


--
-- Name: FUNCTION portal_waitlist_position_by_id(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_waitlist_position_by_id(_id uuid) TO authenticated;


--
-- Name: FUNCTION professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean) TO authenticated;


--
-- Name: FUNCTION professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone) TO authenticated;


--
-- Name: FUNCTION professor_late_cancel_resolve(_notification_id uuid, _outcome text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_late_cancel_resolve(_notification_id uuid, _outcome text) TO authenticated;


--
-- Name: FUNCTION professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone) TO authenticated;


--
-- Name: FUNCTION professor_reactivate_booking(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_reactivate_booking(_booking_id uuid) TO authenticated;


--
-- Name: FUNCTION professor_reactivate_fixed_occurrence(_schedule_id uuid, _occurrence_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_reactivate_fixed_occurrence(_schedule_id uuid, _occurrence_date date) TO authenticated;


--
-- Name: FUNCTION reject_client_change_request(_request_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_client_change_request(_request_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION request_court_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _label text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.request_court_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _label text) TO authenticated;


--
-- Name: FUNCTION resolve_portal_email_by_phone(_phone text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_portal_email_by_phone(_phone text) TO anon;
GRANT ALL ON FUNCTION public.resolve_portal_email_by_phone(_phone text) TO authenticated;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION staff_confirm_waitlist_booking(_waitlist_id uuid, _booking_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_confirm_waitlist_booking(_waitlist_id uuid, _booking_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_create_client_for_pending_signup(_pending_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_create_client_for_pending_signup(_pending_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_link_pending_client_signup(_pending_id uuid, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_link_pending_client_signup(_pending_id uuid, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_mark_waitlist_contacted(_waitlist_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_mark_waitlist_contacted(_waitlist_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_search_clients_for_signup_match(_query text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_search_clients_for_signup_match(_query text) TO authenticated;


--
-- Name: FUNCTION staff_skip_waitlist_entry(_waitlist_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_skip_waitlist_entry(_waitlist_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION swap_booking_courts(_booking_id_a uuid, _booking_id_b uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.swap_booking_courts(_booking_id_a uuid, _booking_id_b uuid) TO authenticated;


--
-- Name: FUNCTION teacher_agenda_range(_start_date date, _end_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.teacher_agenda_range(_start_date date, _end_date date) TO authenticated;


--
-- Name: FUNCTION teacher_map_bookings(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_bookings(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_bookings(_date date) TO authenticated;


--
-- Name: FUNCTION teacher_map_schedule_exceptions(_date date, _weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_schedule_exceptions(_date date, _weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_schedule_exceptions(_date date, _weekday integer) TO authenticated;


--
-- Name: FUNCTION teacher_map_schedules(_weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_schedules(_weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_schedules(_weekday integer) TO authenticated;


--
-- Name: FUNCTION teacher_map_schedules(_weekday integer, _date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_schedules(_weekday integer, _date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_schedules(_weekday integer, _date date) TO authenticated;


--
-- Name: FUNCTION validate_payment_court(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_payment_court() FROM PUBLIC;


--
-- Name: FUNCTION visualizador_map_bookings(_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visualizador_map_bookings(_date date) TO authenticated;


--
-- Name: FUNCTION visualizador_map_schedule_exceptions(_date date, _weekday integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visualizador_map_schedule_exceptions(_date date, _weekday integer) TO authenticated;


--
-- Name: FUNCTION visualizador_map_schedules(_weekday integer, _date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visualizador_map_schedules(_weekday integer, _date date) TO authenticated;


--
-- Name: FUNCTION waitlist_book_on_court(_waitlist_id uuid, _court integer, _teacher_id uuid, _teacher_set boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.waitlist_book_on_court(_waitlist_id uuid, _court integer, _teacher_id uuid, _teacher_set boolean) TO authenticated;


--
-- Name: FUNCTION waitlist_free_courts_for_entry(_waitlist_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.waitlist_free_courts_for_entry(_waitlist_id uuid) TO authenticated;


--
-- Name: FUNCTION waitlist_mark_and_book(_waitlist_id uuid, _teacher_id uuid, _teacher_set boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.waitlist_mark_and_book(_waitlist_id uuid, _teacher_id uuid, _teacher_set boolean) TO authenticated;


--
-- Name: TABLE court_waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_waitlist TO authenticated;
GRANT ALL ON TABLE public.court_waitlist TO service_role;


--
-- Name: FUNCTION waitlist_resolve_teacher(_w public.court_waitlist, _teacher_id uuid, _teacher_set boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.waitlist_resolve_teacher(_w public.court_waitlist, _teacher_id uuid, _teacher_set boolean) FROM PUBLIC;


--
-- Name: TABLE app_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_notifications TO authenticated;
GRANT ALL ON TABLE public.app_notifications TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.app_settings TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE booking_confirmations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.booking_confirmations TO authenticated;
GRANT ALL ON TABLE public.booking_confirmations TO service_role;


--
-- Name: TABLE cash_closings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cash_closings TO authenticated;
GRANT ALL ON TABLE public.cash_closings TO service_role;


--
-- Name: TABLE cleaning_purchases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cleaning_purchases TO authenticated;
GRANT ALL ON TABLE public.cleaning_purchases TO service_role;


--
-- Name: TABLE client_portal_users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_portal_users TO authenticated;
GRANT ALL ON TABLE public.client_portal_users TO service_role;


--
-- Name: TABLE client_schedule_attendance; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedule_attendance TO authenticated;
GRANT ALL ON TABLE public.client_schedule_attendance TO service_role;


--
-- Name: TABLE client_schedule_day_notes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedule_day_notes TO authenticated;
GRANT ALL ON TABLE public.client_schedule_day_notes TO service_role;


--
-- Name: TABLE client_schedule_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedule_exceptions TO authenticated;
GRANT ALL ON TABLE public.client_schedule_exceptions TO service_role;


--
-- Name: TABLE client_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedules TO authenticated;
GRANT ALL ON TABLE public.client_schedules TO service_role;


--
-- Name: TABLE client_teacher_link_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.client_teacher_link_requests TO authenticated;
GRANT ALL ON TABLE public.client_teacher_link_requests TO service_role;


--
-- Name: TABLE client_teachers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_teachers TO authenticated;
GRANT ALL ON TABLE public.client_teachers TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.clients TO authenticated;


--
-- Name: TABLE court_availability_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_availability_overrides TO authenticated;
GRANT ALL ON TABLE public.court_availability_overrides TO service_role;


--
-- Name: TABLE court_booking_participants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_booking_participants TO authenticated;
GRANT ALL ON TABLE public.court_booking_participants TO service_role;


--
-- Name: TABLE court_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_bookings TO authenticated;
GRANT ALL ON TABLE public.court_bookings TO service_role;


--
-- Name: TABLE debt_limit_alert_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.debt_limit_alert_events TO authenticated;
GRANT ALL ON TABLE public.debt_limit_alert_events TO service_role;


--
-- Name: TABLE debt_limit_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.debt_limit_alerts TO authenticated;
GRANT ALL ON TABLE public.debt_limit_alerts TO service_role;


--
-- Name: TABLE debt_limit_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.debt_limit_exceptions TO authenticated;
GRANT ALL ON TABLE public.debt_limit_exceptions TO service_role;


--
-- Name: TABLE debt_limit_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,UPDATE ON TABLE public.debt_limit_settings TO authenticated;
GRANT ALL ON TABLE public.debt_limit_settings TO service_role;


--
-- Name: TABLE fixed_court_waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fixed_court_waitlist TO authenticated;
GRANT ALL ON TABLE public.fixed_court_waitlist TO service_role;


--
-- Name: TABLE fixed_waitlist_court_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.fixed_waitlist_court_hours TO authenticated;
GRANT ALL ON TABLE public.fixed_waitlist_court_hours TO service_role;


--
-- Name: TABLE fixed_waitlist_court_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.fixed_waitlist_court_settings TO authenticated;
GRANT ALL ON TABLE public.fixed_waitlist_court_settings TO service_role;


--
-- Name: TABLE neurochat_message_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.neurochat_message_logs TO authenticated;
GRANT ALL ON TABLE public.neurochat_message_logs TO service_role;


--
-- Name: TABLE pending_client_signups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.pending_client_signups TO authenticated;
GRANT ALL ON TABLE public.pending_client_signups TO service_role;


--
-- Name: TABLE pending_signups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,DELETE ON TABLE public.pending_signups TO authenticated;
GRANT ALL ON TABLE public.pending_signups TO service_role;


--
-- Name: TABLE portal_booking_failures; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.portal_booking_failures TO authenticated;


--
-- Name: TABLE portal_signup_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_signup_tokens TO authenticated;
GRANT ALL ON TABLE public.portal_signup_tokens TO service_role;


--
-- Name: TABLE price_table; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.price_table TO authenticated;
GRANT ALL ON TABLE public.price_table TO service_role;


--
-- Name: TABLE racket_loans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.racket_loans TO authenticated;
GRANT ALL ON TABLE public.racket_loans TO service_role;


--
-- Name: TABLE stock_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_items TO authenticated;
GRANT ALL ON TABLE public.stock_items TO service_role;


--
-- Name: TABLE stock_movements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_movements TO authenticated;
GRANT ALL ON TABLE public.stock_movements TO service_role;


--
-- Name: TABLE teacher_signup_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teacher_signup_tokens TO authenticated;
GRANT ALL ON TABLE public.teacher_signup_tokens TO service_role;


--
-- Name: TABLE teachers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teachers TO authenticated;
GRANT ALL ON TABLE public.teachers TO service_role;


--
-- Name: TABLE waitlist_acknowledgements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.waitlist_acknowledgements TO authenticated;
GRANT ALL ON TABLE public.waitlist_acknowledgements TO service_role;


--
-- Name: TABLE work_task_comments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.work_task_comments TO authenticated;
GRANT ALL ON TABLE public.work_task_comments TO service_role;


--
-- PostgreSQL database dump complete
--




-- =====================================================================
-- Stadium Rackets: regras de cancelamento tardio (24h na quadra de tênis)
-- =====================================================================
SET search_path = public, extensions;
--
-- Stadium Rackets — cancelamento tardio
--
-- • Quadra de TÊNIS (quadra 1): é a única quadra de tênis, então a locação
--   precisa ser cancelada com pelo menos 24h de antecedência (dá tempo de
--   alugar o horário pra outra pessoa). Vale para QUALQUER cancelamento de
--   locação com cliente — recepção, portal do cliente ou professor.
-- • Quadras de PICKLEBALL: mantém a regra do professor (3h antes).
--
-- Cancelou depois do prazo → a recepção e a diretoria recebem o aviso
-- "Cancelamento com menos de Xh" (pop-up com "Lançar no caixa" / "Não
-- cobrar"), igual ao fluxo que já existia para o professor.
--

CREATE OR REPLACE FUNCTION public.court_cancel_window_hours(_court integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN _court = 1 THEN 24 ELSE 3 END
$$;

CREATE OR REPLACE FUNCTION public.court_cancel_is_late(_court integer, _date date, _start time without time zone, _cancelled_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT date_trunc('minute', _cancelled_at)
         > ((_date::text || ' ' || _start::text)::timestamp AT TIME ZONE 'America/Recife')
           - make_interval(hours => public.court_cancel_window_hours(_court));
$$;

-- A regra vale pra todo mundo na quadra de tênis; nas demais, só pro professor.
CREATE OR REPLACE FUNCTION public.court_late_cancel_applies(_court integer, _user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _court = 1 OR public.has_role(_user, 'professor'::public.app_role)
$$;

-- Nome de quem cancelou, para o texto do aviso.
CREATE OR REPLACE FUNCTION public._canceller_label(_user uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT name FROM public.teachers WHERE user_id = _user LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM public.client_portal_users WHERE user_id = _user)
              AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user)
         THEN 'O cliente (pelo portal)' END,
    (SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = _user),
    'Alguém'
  )
$$;

-- Mantida por compatibilidade (regra de 3h do professor).
CREATE OR REPLACE FUNCTION public.professor_cancel_is_late(_date date, _start time without time zone, _cancelled_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT public.court_cancel_is_late(NULL, _date, _start, _cancelled_at);
$$;

CREATE OR REPLACE FUNCTION public._notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name text;
  _staff record;
  _hours integer := public.court_cancel_window_hours(_court);
  _title text;
  _body text;
BEGIN
  SELECT full_name INTO _client_name FROM public.clients WHERE id = _client_id;
  _title := 'Cancelamento com menos de ' || _hours || 'h';

  _body := COALESCE(_teacher_name, 'Alguém') || ' cancelou '
    || CASE WHEN _is_fixed THEN 'o horário fixo' ELSE 'a locação' END
    || ' de ' || COALESCE(_client_name, 'cliente')
    || ' — ' || to_char(_date, 'DD/MM') || ' às ' || to_char(_start, 'HH24:MI')
    || '–' || to_char(_end, 'HH24:MI')
    || COALESCE(' (' || public._court_short(_court) || ')', '')
    || ', às ' || to_char(_cancelled_at AT TIME ZONE 'America/Recife', 'DD/MM HH24:MI')
    || CASE WHEN _court = 1
         THEN '. Quadra de tênis: o cancelamento sem custo é até 24h antes — a quadra deve ser lançada no caixa (débito na conta do cliente).'
         ELSE '. Pela regra (até ' || _hours || 'h antes), a quadra deve ser lançada como débito na conta do cliente.'
       END;

  FOR _staff IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('recepcionista'::public.app_role, 'diretoria'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications
      (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'professor_late_cancel',
      _client_id,
      _staff.user_id,
      _title,
      _body,
      true,
      jsonb_build_object(
        'event_key', _event_key,
        'client_id', _client_id,
        'client_name', _client_name,
        'teacher_name', _teacher_name,
        'court', _court,
        'date', _date,
        'start_time', _start::text,
        'end_time', _end::text,
        'cancelled_at', _cancelled_at,
        'is_fixed', _is_fixed,
        'booking_id', _booking_id,
        'window_hours', _hours
      ),
      'professor_late_cancel|' || _event_key || '|' || _staff.user_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._notify_professor_late_cancel(text, uuid, text, integer, date, time without time zone, time without time zone, timestamp with time zone, boolean, uuid) FROM PUBLIC;

-- Trigger de cancelamento de locação (court_bookings): aviso ao cliente quando
-- é o professor que cancela, e aviso de cobrança quando passou do prazo.
CREATE OR REPLACE FUNCTION public.court_bookings_professor_cancel_fee() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name text;
  _who text;
  _is_prof boolean;
BEGIN
  IF NEW.cancelled_at IS NULL OR OLD.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Pré-reserva (hold) que expirou não é cancelamento de verdade.
  IF NEW.hold_expires_at IS NOT NULL AND NEW.cancelled_by IS NULL THEN
    RETURN NEW;
  END IF;

  _is_prof := NEW.cancelled_by IS NOT NULL
              AND public.has_role(NEW.cancelled_by, 'professor'::public.app_role);
  _who := public._canceller_label(NEW.cancelled_by);

  IF _is_prof THEN
    SELECT full_name INTO _client_name FROM public.clients WHERE id = NEW.client_id;
    -- Aviso ao cliente (mantido como era).
    INSERT INTO public.app_notifications(kind, client_id, title, body)
    VALUES (
      'professor_cancel',
      NEW.client_id,
      'Aula cancelada pelo professor',
      _who || ' cancelou aula de '
        || COALESCE(_client_name, 'cliente') || ' em '
        || to_char(NEW.booking_date, 'DD/MM') || ' às '
        || to_char(NEW.start_time, 'HH24:MI')
        || ' (' || public._court_short(NEW.court) || ')'
    );
  END IF;

  IF (NEW.court = 1 OR _is_prof)
     AND public.court_cancel_is_late(NEW.court, NEW.booking_date, NEW.start_time, NEW.cancelled_at) THEN
    PERFORM public._notify_professor_late_cancel(
      'booking:' || NEW.id::text,
      NEW.client_id, _who, NEW.court,
      NEW.booking_date, NEW.start_time, NEW.end_time,
      NEW.cancelled_at, false, NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _b public.court_bookings%ROWTYPE;
BEGIN
  SELECT * INTO _b FROM public.court_bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.client_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.court_late_cancel_applies(_b.court, auth.uid()) THEN
    RETURN false;
  END IF;
  IF NOT public.court_cancel_is_late(_b.court, _b.booking_date, _start, now()) THEN
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

  PERFORM public._notify_professor_late_cancel(
    'partial:' || _b.id::text || ':' || _start::text,
    _b.client_id, public._canceller_label(auth.uid()), _b.court,
    _b.booking_date, _start, _end, now(), false, _b.id
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _s record;
  _count integer := 0;
  _who text := public._canceller_label(auth.uid());
BEGIN
  FOR _s IN
    SELECT cs.id, cs.client_id, cs.court
    FROM public.client_schedules cs
    WHERE cs.id = ANY (_schedule_ids)
      AND cs.client_id IS NOT NULL
      AND public.court_late_cancel_applies(cs.court, auth.uid())
      AND public.court_cancel_is_late(cs.court, _date, _start, now())
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
      _s.client_id, _who, _s.court,
      _date, _start, _end, now(), true, NULL
    );
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

-- Cliente cancelando o próprio horário fixo pelo portal: na quadra de tênis
-- com menos de 24h, a recepção também recebe o aviso de cobrança.
CREATE OR REPLACE FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text DEFAULT 'Cancelado pelo cliente'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _cs public.client_schedules%ROWTYPE;
  _exc_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO _cs FROM public.client_schedules WHERE id = _schedule_id;
  IF _cs.client_id IS NULL THEN
    RAISE EXCEPTION 'schedule not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.portal_owned_client_ids(auth.uid()) p
    WHERE p.client_id = _cs.client_id
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

  IF _cs.court = 1 AND public.court_cancel_is_late(_cs.court, _date, _cs.start_time, now()) THEN
    PERFORM public._notify_professor_late_cancel(
      'fixed:' || _cs.id::text || ':' || _date::text || ':' || _cs.start_time::text,
      _cs.client_id, 'O cliente (pelo portal)', _cs.court,
      _date, _cs.start_time, _cs.end_time, now(), true, NULL
    );
  END IF;

  RETURN _exc_id;
END;
$$;

GRANT ALL ON FUNCTION public.court_cancel_window_hours(integer) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.court_cancel_is_late(integer, date, time without time zone, timestamp with time zone) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public._court_short(integer) TO anon, authenticated, service_role;

--
-- RLS: a política "teacher_select_own_clients" (clients) lia court_bookings,
-- e as políticas de court_bookings leem clients — ciclo que o Postgres
-- recusa ("infinite recursion detected in policy"). A lista de clientes do
-- professor passa a vir de uma função SECURITY DEFINER (sem RLS por dentro),
-- quebrando o ciclo sem mudar quem enxerga o quê.
--
CREATE OR REPLACE FUNCTION public.teacher_visible_client_ids(_uid uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT cs.client_id
    FROM public.client_schedules cs JOIN public.teachers t ON t.id = cs.teacher_id
   WHERE t.user_id = _uid AND cs.client_id IS NOT NULL
  UNION
  SELECT cb.client_id
    FROM public.court_bookings cb JOIN public.teachers t ON t.id = cb.teacher_id
   WHERE t.user_id = _uid AND cb.client_id IS NOT NULL
  UNION
  SELECT c.id
    FROM public.clients c JOIN public.teachers t ON t.id = c.teacher_id
   WHERE t.user_id = _uid
  UNION
  SELECT ct.client_id
    FROM public.client_teachers ct JOIN public.teachers t ON t.id = ct.teacher_id
   WHERE t.user_id = _uid
$$;
REVOKE ALL ON FUNCTION public.teacher_visible_client_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_visible_client_ids(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS teacher_select_own_clients ON public.clients;
CREATE POLICY teacher_select_own_clients ON public.clients FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'professor'::public.app_role)
    AND id IN (SELECT public.teacher_visible_client_ids(auth.uid()))
  );


-- =====================================================================
-- Login → perfil (auth.users)
-- =====================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- Realtime (mapa de quadras, caixa, avisos ao vivo)
-- =====================================================================
DO $rt$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['clients', 'monthly_charges', 'payments', 'account_entries', 'audit_logs', 'whatsapp_notifications', 'client_schedules', 'app_notifications', 'court_bookings', 'client_schedule_exceptions', 'client_schedule_attendance', 'court_booking_participants', 'court_waitlist', 'court_availability_overrides', 'waitlist_acknowledgements', 'debt_limit_alerts', 'client_schedule_day_notes']::text[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$rt$;
ALTER TABLE public.court_bookings REPLICA IDENTITY FULL;
ALTER TABLE public.client_schedule_exceptions REPLICA IDENTITY FULL;

-- =====================================================================
-- Storage: comprovantes de pagamento e fotos de clientes
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false),
       ('client-profile-photos', 'client-profile-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_storage_insert" ON storage.objects;
CREATE POLICY "receipts_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "receipts_storage_delete" ON storage.objects;
CREATE POLICY "receipts_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "receipts_storage_update" ON storage.objects;
CREATE POLICY "receipts_storage_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)))
  WITH CHECK (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "Staff can read payment receipts" ON storage.objects;
CREATE POLICY "Staff can read payment receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "Portal users can read own receipts" ON storage.objects;
CREATE POLICY "Portal users can read own receipts" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'payment-receipts' AND EXISTS (
    SELECT 1 FROM public.payment_receipts pr
    WHERE pr.file_path = objects.name AND pr.client_id IS NOT NULL AND public.portal_can_view_client(pr.client_id)));
DROP POLICY IF EXISTS "client photos: read" ON storage.objects;
CREATE POLICY "client photos: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));
DROP POLICY IF EXISTS "client photos: insert" ON storage.objects;
CREATE POLICY "client photos: insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));
DROP POLICY IF EXISTS "client photos: update" ON storage.objects;
CREATE POLICY "client photos: update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name))
  WITH CHECK (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));
DROP POLICY IF EXISTS "client photos: delete" ON storage.objects;
CREATE POLICY "client photos: delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));

-- =====================================================================
-- Rotinas agendadas (pg_cron)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $cron$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'debt_limit_notify_tomorrow_bookings', 'fixed_waitlist_notify_expiring_schedules',
    'expire_court_booking_holds', 'portal_booking_failures_cleanup',
    'cobranca_followups_auto_resolve', 'fixed_waitlist_notify_free_slots'
  ] LOOP
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j;
  END LOOP;
END
$cron$;
SELECT cron.schedule('debt_limit_notify_tomorrow_bookings', '0 12 * * *', $$ SELECT public.debt_limit_notify_tomorrow_bookings(); $$);
SELECT cron.schedule('fixed_waitlist_notify_expiring_schedules', '0 12 * * *', $$ SELECT public.fixed_waitlist_notify_expiring_schedules(); $$);
SELECT cron.schedule('expire_court_booking_holds', '* * * * *', $$
  UPDATE public.court_bookings SET cancelled_at = now()
  WHERE hold_expires_at IS NOT NULL AND hold_expires_at <= now() AND cancelled_at IS NULL;
$$);
SELECT cron.schedule('portal_booking_failures_cleanup', '10 3 * * *', $$ DELETE FROM public.portal_booking_failures WHERE created_at < now() - INTERVAL '90 days'; $$);
SELECT cron.schedule('cobranca_followups_auto_resolve', '*/10 * * * *', $$ SELECT public.cobranca_followups_auto_resolve(); $$);
SELECT cron.schedule('fixed_waitlist_notify_free_slots', '0 12 * * *', $$ SELECT public.fixed_waitlist_notify_free_slots(); $$);

-- =====================================================================
-- Dados iniciais (configuração)
-- =====================================================================
INSERT INTO public.client_categories (name, default_amount, active) VALUES
  ('Avulso', 0, true),
  ('Mensalista', 0, true),
  ('Débito avulso', 0, true),
  ('Pendência avulsa', 0, true),
  ('Saldo anterior', 0, true),
  ('Estorno', 0, true),
  ('Crédito Gympass', 0, true),
  ('Aula (professor)', 0, true),
  ('Locação de professor', 0, true),
  ('Ranking Masculino', 0, true),
  ('Ranking Feminino', 0, true),
  ('Manutenção', 0, true),
  ('Grip', 0, true),
  ('Terno de bola', 0, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.stock_items (name, current_quantity) VALUES
  ('Terno de bola', 0),
  ('Grip', 0)
ON CONFLICT DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES
  ('whatsapp_reservations_number', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.debt_limit_settings (id, limit_amount, rule_start_date)
VALUES (true, 210, CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;

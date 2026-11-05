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



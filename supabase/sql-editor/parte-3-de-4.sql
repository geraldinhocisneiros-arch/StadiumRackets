-- Stadium Rackets — parte 3 de 4 (rode depois da parte 2)
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



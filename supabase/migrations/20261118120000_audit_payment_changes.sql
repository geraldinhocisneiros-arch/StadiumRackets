-- Histórico de alterações dos lançamentos do caixa (payments).
--
-- O log gravado pelo app (logAction) só guardava valor e cliente, então
-- não dava pra saber quem trocou um lançamento de Débito para Crédito em
-- conta, ou marcou como recebido. Este gatilho grava "de → para" dos
-- campos relevantes em toda EDIÇÃO e EXCLUSÃO, venha de qualquer tela.
-- Criação continua registrada pelo app (evita entrada duplicada).

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
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
  ELSIF _entity = 'payment' THEN
    _cols := ARRAY['client_id','category_id','amount','method','received','to_account',
                   'account_direction','paid_at','court','start_time','end_time',
                   'is_pending_payment','booking_id','notes'];
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

  -- Lançamento do caixa: guarda o cliente pra achar no histórico dele
  IF _entity = 'payment' THEN
    _details := _details || jsonb_build_object(
      'client_id', COALESCE((NEW).client_id, (OLD).client_id),
      'source', 'trigger'
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

DROP TRIGGER IF EXISTS trg_audit_payments ON public.payments;
CREATE TRIGGER trg_audit_payments
  AFTER UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('payment');

-- Play Pickleball: pacote de 4 plays no mês por R$ 80, para alunos da
-- Escolinha Pickleball.
--
-- Regras (definidas pelo gerente):
--   * O aluno compra o Play do mês no Caixa (categoria "Play Pickleball",
--     com o mês de referência) — sozinho ou junto com a mensalidade.
--   * Cada pacote dá 4 plays no mês. O que sobra NÃO passa pro mês seguinte.
--   * Um play é uma locação comum de quadra de pickleball: o valor da quadra
--     é dividido pelo número de pessoas que jogaram. Cada aluno com play
--     disponível não paga a sua parte (gasta 1 play); os demais (convidados,
--     alunos sem play ou que já usaram os 4) pagam a sua parte.
--
-- Pacote comprado = pagamento na categoria Play Pickleball com
-- reference_month do mês. Play usado = linha em pickleball_play_usage
-- ligada à locação (some se a locação for apagada; locação cancelada não
-- conta).

UPDATE public.client_categories
   SET default_amount = 80
 WHERE lower(btrim(name)) = 'play pickleball'
   AND COALESCE(default_amount, 0) = 0;

CREATE TABLE IF NOT EXISTS public.pickleball_play_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.court_bookings(id) ON DELETE CASCADE,
  reference_month date NOT NULL CHECK (EXTRACT(DAY FROM reference_month) = 1),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_play_usage_client_month
  ON public.pickleball_play_usage (client_id, reference_month);

ALTER TABLE public.pickleball_play_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pickleball_play_usage_select ON public.pickleball_play_usage;
CREATE POLICY pickleball_play_usage_select ON public.pickleball_play_usage
  FOR SELECT TO authenticated USING (public._is_class_staff(auth.uid()));

DROP POLICY IF EXISTS pickleball_play_usage_insert ON public.pickleball_play_usage;
CREATE POLICY pickleball_play_usage_insert ON public.pickleball_play_usage
  FOR INSERT TO authenticated WITH CHECK (public._is_class_staff(auth.uid()));

DROP POLICY IF EXISTS pickleball_play_usage_delete ON public.pickleball_play_usage;
CREATE POLICY pickleball_play_usage_delete ON public.pickleball_play_usage
  FOR DELETE TO authenticated USING (public._is_class_staff(auth.uid()));

-- Plays do mês por cliente: total comprado (4 por pacote pago) e usados.
CREATE OR REPLACE FUNCTION public.pickleball_play_balance(_client_ids uuid[], _month date)
RETURNS TABLE(client_id uuid, plays_total integer, plays_used integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _m date := date_trunc('month', _month)::date;
BEGIN
  IF NOT public._is_class_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN QUERY
  SELECT ids.id,
    (4 * (SELECT count(*) FROM public.payments p
          JOIN public.client_categories cc ON cc.id = p.category_id
          WHERE p.client_id = ids.id
            AND p.reference_month = _m
            AND lower(btrim(cc.name)) = 'play pickleball'))::int,
    (SELECT count(*) FROM public.pickleball_play_usage u
     JOIN public.court_bookings b ON b.id = u.booking_id
     WHERE u.client_id = ids.id
       AND u.reference_month = _m
       AND b.cancelled_at IS NULL)::int
  FROM unnest(_client_ids) AS ids(id);
END;
$$;
REVOKE ALL ON FUNCTION public.pickleball_play_balance(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickleball_play_balance(uuid[], date) TO authenticated;

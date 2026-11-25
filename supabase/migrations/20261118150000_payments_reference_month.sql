-- Mês de referência da mensalidade (escolinha de tênis/pickleball).
--
-- Sem turma cadastrada, a mensalidade é lançada direto no Caixa como
-- pagamento na categoria da escolinha. Este campo diz DE QUAL MÊS ela é,
-- pra saber quem já quitou cada mês e não lançar o mesmo mês duas vezes.
-- Sempre o dia 1º do mês (ex.: 2026-11-01 = novembro/26).

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reference_month date
    CHECK (reference_month IS NULL OR EXTRACT(DAY FROM reference_month) = 1);

CREATE INDEX IF NOT EXISTS idx_payments_reference_month
  ON public.payments (reference_month, client_id)
  WHERE reference_month IS NOT NULL;

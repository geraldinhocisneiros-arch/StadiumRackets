-- Cliente que entra na divisão da quadra avulsa mas não paga a sua parte
-- (ex.: a dona da academia joga com clientes). A parte dela conta no
-- rateio — os outros pagam total/N — mas nenhum lançamento é gerado no
-- nome dela.
alter table public.clients
  add column if not exists court_fee_exempt boolean not null default false;

comment on column public.clients.court_fee_exempt is
  'Entra na divisão da locação avulsa, mas a parte dela não é lançada no caixa.';


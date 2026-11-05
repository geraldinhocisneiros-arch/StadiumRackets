# Stadium Rackets — Sistema de gestão

Sistema da Stadium Rackets (1 quadra de tênis de saibro + 3 quadras de pickleball),
derivado do sistema do Squash Tennis Center.

- **Frontend/servidor:** TanStack Start (React) publicado no **Cloudflare Workers**
- **Banco, login e arquivos:** **Supabase**

## Quadras

| Nº no banco (`court`) | Nome no sistema |
| --- | --- |
| 1 | Tênis (saibro) |
| 2 | Pickleball 1 (PB1) |
| 3 | Pickleball 2 (PB2) |
| 4 | Pickleball 3 (PB3) |

Nas listas de espera, `court = 0` significa "qualquer quadra de pickleball" e
`court = null` significa "qualquer quadra".

## Regras específicas da Stadium

- **Cancelamento da quadra de tênis:** sem custo até **24h antes**. Depois disso, a
  recepção e a diretoria recebem o aviso "Cancelamento com menos de 24h" com os botões
  **Lançar no caixa** / **Não cobrar**. Vale para qualquer cancelamento (recepção, portal
  do cliente ou professor).
- **Pickleball:** mantém a regra do professor (cancelamento sem custo até 3h antes).
- **Professor é opcional na locação.** Quando houver (Johny, Guel ou um professor que
  aluga a quadra), selecione-o: a locação fica com o responsável registrado e entra em
  **Relatórios → Fat. quadra → Por professor**.

## O que foi retirado em relação ao Squash Tennis Center

Boleiro (e ranking de boleiros), Clube do Tênis / Mini Clube / benefício DBT,
liberações de pagamento (pré-pagamento de cliente novo), anexos, reuniões, controle de
placares, manutenção/remanejamento de quadras e a Quadra 10 exclusiva da equipe.

## Implantação

### 1. Banco (Supabase)

Aplique `supabase/migrations/20261105000000_stadium_rackets_baseline.sql` no projeto
(SQL Editor do Supabase ou `supabase db push`). Ela cria todas as tabelas, funções,
políticas de segurança, buckets de arquivos, rotinas agendadas (pg_cron) e as categorias
iniciais.

Depois crie o primeiro administrador: Authentication → Users → **Add user**, e rode no
SQL Editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'SEU_EMAIL';
```

### 2. Cloudflare (deploy automático pelo GitHub)

Em **GitHub → Settings → Secrets and variables → Actions**, cadastre:

| Segredo | Onde pegar |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → modelo "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages (lado direito) |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → `anon` / publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` / secret |

A cada push na `main`, o GitHub Actions roda a checagem de tipos, o build e publica o
Worker `stadium-rackets`.

### 3. Ajustes pendentes de configuração

- `src/lib/open-debt.ts` → `CLUB_PIX_KEY`: chave Pix (CNPJ) da Stadium para as mensagens
  de cobrança (enquanto vazia, as mensagens saem sem a linha do Pix).
- `src/lib/operating-hours.ts`: horário de funcionamento online (hoje igual ao do Squash).
- Usuários → Configurações: número oficial de WhatsApp de reservas.
- Tabela de preços: cadastrar preços de **Tênis** e **Pickleball** separadamente.

## Desenvolvimento

```bash
bun install
bun run dev
bun run typecheck
bun run build
```

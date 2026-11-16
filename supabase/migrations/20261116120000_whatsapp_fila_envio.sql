-- Fila de envio de WhatsApp (mensagem igual, com o nome de cada um).
--
-- O WhatsApp não permite enviar em massa pelo número comum sem risco de
-- bloqueio, então o envio continua manual: o sistema monta a fila e, a cada
-- clique, abre o WhatsApp com a mensagem pronta para a próxima pessoa. O
-- clique marca a pessoa como "enviado", e dá para parar e retomar depois.
--
-- Origem dos destinatários (fixada no momento em que a lista é criada):
-- categorias de cliente (e/ou "sem categoria") + opcionalmente professores.
-- (Replicado do Squash Tennis Center, sem o envio a partir de comunicados.)
--
-- Telefones repetidos (ex.: responsável com dois dependentes) recebem uma
-- mensagem só. Quem não tem telefone entra como "sem_telefone", para a
-- equipe corrigir o cadastro.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) > 0),
  mensagem text NOT NULL CHECK (length(btrim(mensagem)) > 0),
  categoria_ids uuid[] NOT NULL DEFAULT '{}',
  sem_categoria boolean NOT NULL DEFAULT false,
  professores boolean NOT NULL DEFAULT false,
  arquivada boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_campanha_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.whatsapp_campanhas(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  nome text NOT NULL,
  telefone text,
  ordem integer NOT NULL,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'enviado', 'pulado', 'sem_telefone')),
  atualizado_em timestamptz,
  atualizado_por uuid
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_campanha_envios_campanha
  ON public.whatsapp_campanha_envios(campanha_id, status, ordem);

-- ---------------------------------------------------------------------------
-- RLS — equipe (admin, diretoria, recepção). Gravação de envios só via RPC.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._is_whatsapp_staff(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'diretoria'::public.app_role)
      OR public.has_role(_uid, 'recepcionista'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public._is_whatsapp_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_whatsapp_staff(uuid) TO authenticated;

ALTER TABLE public.whatsapp_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campanha_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_campanhas_select ON public.whatsapp_campanhas;
CREATE POLICY whatsapp_campanhas_select ON public.whatsapp_campanhas
  FOR SELECT TO authenticated USING (public._is_whatsapp_staff(auth.uid()));

-- Editar a mensagem / arquivar.
DROP POLICY IF EXISTS whatsapp_campanhas_update ON public.whatsapp_campanhas;
CREATE POLICY whatsapp_campanhas_update ON public.whatsapp_campanhas
  FOR UPDATE TO authenticated
  USING (public._is_whatsapp_staff(auth.uid()))
  WITH CHECK (public._is_whatsapp_staff(auth.uid()));

DROP POLICY IF EXISTS whatsapp_campanhas_delete ON public.whatsapp_campanhas;
CREATE POLICY whatsapp_campanhas_delete ON public.whatsapp_campanhas
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'diretoria'::public.app_role));

DROP POLICY IF EXISTS whatsapp_campanha_envios_select ON public.whatsapp_campanha_envios;
CREATE POLICY whatsapp_campanha_envios_select ON public.whatsapp_campanha_envios
  FOR SELECT TO authenticated USING (public._is_whatsapp_staff(auth.uid()));

-- ---------------------------------------------------------------------------
-- Destinatários
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._whatsapp_normaliza_telefone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN d
    WHEN length(d) IN (10, 11) THEN '55' || d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(_phone, ''), '\D', '', 'g') AS d) x;
$$;

CREATE OR REPLACE FUNCTION public._whatsapp_destinatarios(
  _categoria_ids uuid[],
  _sem_categoria boolean,
  _professores boolean
)
RETURNS TABLE (client_id uuid, teacher_id uuid, nome text, telefone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH brutos AS (
    -- Clientes ativos das categorias escolhidas (e/ou sem categoria).
    SELECT c.id AS client_id, NULL::uuid AS teacher_id, c.full_name AS nome, c.phone,
           (c.responsible_client_id IS NULL) AS titular
      FROM public.clients c
     WHERE c.active
       AND NOT COALESCE(c.is_demo, false)
       AND (c.category_id = ANY(COALESCE(_categoria_ids, '{}'))
            OR (COALESCE(_sem_categoria, false) AND c.category_id IS NULL))
    UNION ALL
    -- Professores ativos.
    SELECT NULL, t.id, t.name, t.phone, true
      FROM public.teachers t
     WHERE COALESCE(_professores, false)
       AND t.active AND NOT COALESCE(t.is_demo, false)
  ),
  norm AS (
    SELECT b.client_id, b.teacher_id, btrim(b.nome) AS nome,
           public._whatsapp_normaliza_telefone(b.phone) AS telefone, b.titular
      FROM brutos b
  ),
  dedup AS (
    -- Telefone repetido (ex.: responsável com dois dependentes) recebe uma só.
    SELECT n.*,
           row_number() OVER (
             PARTITION BY COALESCE(n.telefone, n.client_id::text, n.teacher_id::text, n.nome)
             ORDER BY n.titular DESC, n.nome
           ) AS rn
      FROM norm n
  )
  SELECT d.client_id, d.teacher_id, d.nome, d.telefone
    FROM dedup d
   WHERE d.rn = 1;
$$;

REVOKE ALL ON FUNCTION public._whatsapp_destinatarios(uuid[], boolean, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Quantos vão receber, antes de criar a lista.
CREATE OR REPLACE FUNCTION public.whatsapp_campanha_previa(
  _categoria_ids uuid[],
  _sem_categoria boolean,
  _professores boolean
)
RETURNS TABLE (com_telefone bigint, sem_telefone bigint, exemplo_nome text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_whatsapp_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN QUERY
  SELECT count(*) FILTER (WHERE d.telefone IS NOT NULL),
         count(*) FILTER (WHERE d.telefone IS NULL),
         (array_agg(d.nome ORDER BY d.nome) FILTER (WHERE d.telefone IS NOT NULL))[1]
    FROM public._whatsapp_destinatarios(_categoria_ids, _sem_categoria, _professores) d;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_campanha_previa(uuid[], boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_campanha_previa(uuid[], boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.whatsapp_campanha_criar(
  _titulo text,
  _mensagem text,
  _categoria_ids uuid[],
  _sem_categoria boolean,
  _professores boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _n integer;
BEGIN
  IF NOT public._is_whatsapp_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  INSERT INTO public.whatsapp_campanhas (
    titulo, mensagem, categoria_ids, sem_categoria, professores, created_by
  ) VALUES (
    btrim(_titulo), _mensagem, COALESCE(_categoria_ids, '{}'),
    COALESCE(_sem_categoria, false), COALESCE(_professores, false), auth.uid()
  ) RETURNING id INTO _id;

  INSERT INTO public.whatsapp_campanha_envios (
    campanha_id, client_id, teacher_id, nome, telefone, ordem, status
  )
  SELECT _id, d.client_id, d.teacher_id, d.nome, d.telefone,
         row_number() OVER (ORDER BY d.nome),
         CASE WHEN d.telefone IS NULL THEN 'sem_telefone' ELSE 'pendente' END
    FROM public._whatsapp_destinatarios(_categoria_ids, _sem_categoria, _professores) d;

  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN
    RAISE EXCEPTION 'Nenhum destinatário encontrado com esses filtros.';
  END IF;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_campanha_criar(text, text, uuid[], boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_campanha_criar(text, text, uuid[], boolean, boolean) TO authenticated;

-- Lista de envios com o placar.
CREATE OR REPLACE FUNCTION public.whatsapp_campanhas_lista()
RETURNS TABLE (
  id uuid, titulo text, mensagem text, arquivada boolean,
  created_at timestamptz, pendentes bigint, enviados bigint, pulados bigint, sem_telefone bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_whatsapp_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN QUERY
  SELECT w.id, w.titulo, w.mensagem, w.arquivada, w.created_at,
         count(e.id) FILTER (WHERE e.status = 'pendente'),
         count(e.id) FILTER (WHERE e.status = 'enviado'),
         count(e.id) FILTER (WHERE e.status = 'pulado'),
         count(e.id) FILTER (WHERE e.status = 'sem_telefone')
    FROM public.whatsapp_campanhas w
    LEFT JOIN public.whatsapp_campanha_envios e ON e.campanha_id = w.id
   GROUP BY w.id
   ORDER BY w.arquivada, w.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_campanhas_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_campanhas_lista() TO authenticated;

-- Marca um envio (enviado / pulado / de volta para pendente). Envio para
-- cliente também entra no histórico de WhatsApp da ficha (whatsapp_notifications).
CREATE OR REPLACE FUNCTION public.whatsapp_envio_marcar(_envio_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e public.whatsapp_campanha_envios%ROWTYPE;
BEGIN
  IF NOT public._is_whatsapp_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF _status NOT IN ('pendente', 'enviado', 'pulado') THEN
    RAISE EXCEPTION 'Situação inválida.';
  END IF;

  SELECT * INTO _e FROM public.whatsapp_campanha_envios WHERE id = _envio_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Envio não encontrado.';
  END IF;
  IF _e.status = 'sem_telefone' THEN
    RAISE EXCEPTION 'Este contato está sem telefone.';
  END IF;

  UPDATE public.whatsapp_campanha_envios
     SET status = _status, atualizado_em = now(), atualizado_por = auth.uid()
   WHERE id = _envio_id;

  IF _status = 'enviado' AND _e.status <> 'enviado' AND _e.client_id IS NOT NULL THEN
    INSERT INTO public.whatsapp_notifications (client_id, sent_by, context)
    VALUES (_e.client_id, auth.uid(), 'campanha');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_envio_marcar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_envio_marcar(uuid, text) TO authenticated;

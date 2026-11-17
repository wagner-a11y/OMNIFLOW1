-- =====================================================================
-- BID EM LOTE — HISTÓRICO POR NOME E POR RODADA
--
-- Três tabelas NOVAS. Nenhuma tabela existente é alterada.
--
--   bid               a "pasta": nome único (entre os não excluídos), cliente
--   bid_rodada        Rodada 1, 2, 3... com status e os parâmetros da rodada
--   bid_rodada_linha  cada linha: ENTRADA (para continuar editando) e
--                     RESULTADO calculado completo (para o histórico ser fiel)
--
-- REGRAS GARANTIDAS NO BANCO, não só na tela:
--   * rodada fechada não aceita UPDATE nos parâmetros nem INSERT/UPDATE em
--     linhas (trigger, erro RODADA_FECHADA);
--   * reabrir rodada fechada e excluir/restaurar bid: só is_master() (trigger,
--     erro SO_MASTER). Policy de RLS não enxerga OLD x NEW, por isso trigger;
--   * só a ÚLTIMA rodada pode ser reaberta (erro RODADA_ANTIGA);
--   * linha só pode ser apagada com a rodada em rascunho (erro RODADA_FECHADA);
--   * nova rodada só quando a última está fechada; o número é dado pelo banco;
--   * autoria (criado_por, atualizado_por, fechada_por, deleted_by) e datas
--     vêm de auth.uid()/now() no banco — o cliente não consegue forjar;
--   * bid e bid_rodada sem DELETE (sem policy e privilégio revogado);
--     bid_rodada_linha aceita DELETE só em rodada em rascunho.
--
-- CONFLITO DE EDIÇÃO: `bid_rodada.versao` (inteiro, +1 a cada UPDATE, pelo
-- trigger) é a versão da rodada. As funções de gravação só escrevem se a
-- versão que o cliente abriu ainda é a atual; senão devolvem quem alterou e
-- quando, e não escrevem nada. `atualizado_em` é só para exibição.
--
-- As funções são SECURITY INVOKER: rodam com o papel de quem chama, então a
-- RLS e os triggers valem igual a um INSERT/UPDATE direto.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bid (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            text NOT NULL CHECK (length(btrim(nome)) > 0),
    cliente         text,
    observacao      text,
    criado_por      uuid REFERENCES auth.users(id),
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_por  uuid REFERENCES auth.users(id),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    deleted_by      uuid REFERENCES auth.users(id)
);

-- Nome único entre os NÃO excluídos, ignorando maiúsculas e espaços nas pontas.
CREATE UNIQUE INDEX IF NOT EXISTS bid_nome_unico_ativo
    ON public.bid (lower(btrim(nome))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.bid_rodada (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id          uuid NOT NULL REFERENCES public.bid(id),
    numero          integer NOT NULL CHECK (numero >= 1),
    status          text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'fechada')),
    parametros      jsonb NOT NULL DEFAULT '{}'::jsonb,
    fechada_por     uuid REFERENCES auth.users(id),
    fechada_em      timestamptz,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_por  uuid REFERENCES auth.users(id),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    versao          bigint NOT NULL DEFAULT 1,
    UNIQUE (bid_id, numero)
);
CREATE INDEX IF NOT EXISTS bid_rodada_bid_id ON public.bid_rodada (bid_id);

CREATE TABLE IF NOT EXISTS public.bid_rodada_linha (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rodada_id       uuid NOT NULL REFERENCES public.bid_rodada(id),
    ordem           integer NOT NULL,
    chave_linha     text NOT NULL,
    entrada         jsonb NOT NULL,
    resultado       jsonb,
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rodada_id, chave_linha)
);
CREATE INDEX IF NOT EXISTS bid_rodada_linha_rodada_id ON public.bid_rodada_linha (rodada_id);

COMMENT ON TABLE public.bid IS 'Bid em Lote: a pasta do bid. Exclusão lógica (deleted_at), só master.';
COMMENT ON TABLE public.bid_rodada IS 'Rodadas do bid. Fechada = somente leitura, garantido por trigger.';
COMMENT ON TABLE public.bid_rodada_linha IS 'Linhas da rodada: entrada (editável) e resultado calculado (histórico fiel).';
COMMENT ON COLUMN public.bid_rodada.versao IS 'Versão da rodada (+1 a cada UPDATE) para detecção de conflito de edição.';
COMMENT ON COLUMN public.bid_rodada.atualizado_em IS 'Última alteração, só para exibição. O conflito usa versao.';
COMMENT ON COLUMN public.bid_rodada_linha.chave_linha IS 'Chave estável da linha, copiada para a rodada seguinte (comparação de preço).';

-- ---------------------------------------------------------------------
-- 2. Triggers: autoria, trava de rodada fechada, regras de master
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bid_antes_gravar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    NEW.nome := btrim(NEW.nome);
    IF TG_OP = 'INSERT' THEN
        NEW.criado_por := auth.uid();
        NEW.criado_em := now();
        NEW.deleted_at := NULL;
        NEW.deleted_by := NULL;
    ELSE
        NEW.criado_por := OLD.criado_por;
        NEW.criado_em := OLD.criado_em;
        IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
            IF NOT public.is_master() THEN
                RAISE EXCEPTION 'SO_MASTER: só o master exclui ou restaura um bid.';
            END IF;
            NEW.deleted_by := CASE WHEN NEW.deleted_at IS NULL THEN NULL ELSE auth.uid() END;
        ELSE
            NEW.deleted_by := OLD.deleted_by;
        END IF;
    END IF;
    NEW.atualizado_por := auth.uid();
    NEW.atualizado_em := now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bid_antes_gravar ON public.bid;
CREATE TRIGGER bid_antes_gravar BEFORE INSERT OR UPDATE ON public.bid
    FOR EACH ROW EXECUTE FUNCTION public.bid_antes_gravar();

CREATE OR REPLACE FUNCTION public.bid_rodada_antes_gravar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Trava a pasta: duas "Nova rodada" simultâneas não pegam o mesmo número.
        PERFORM 1 FROM public.bid WHERE id = NEW.bid_id AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'BID_INEXISTENTE: bid não encontrado ou excluído.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.bid_rodada WHERE bid_id = NEW.bid_id AND status = 'rascunho') THEN
            RAISE EXCEPTION 'RODADA_ABERTA: feche a última rodada antes de abrir uma nova.';
        END IF;
        NEW.numero := COALESCE((SELECT max(numero) FROM public.bid_rodada WHERE bid_id = NEW.bid_id), 0) + 1;
        NEW.status := 'rascunho';
        NEW.fechada_por := NULL;
        NEW.fechada_em := NULL;
        NEW.criado_em := now();
        NEW.versao := 1;
    ELSE
        NEW.bid_id := OLD.bid_id;
        NEW.numero := OLD.numero;
        NEW.criado_em := OLD.criado_em;
        IF OLD.status = 'fechada' THEN
            -- Fechada só aceita UMA mudança: o master reabrir, sem mexer em nada mais.
            IF NEW.status <> 'rascunho' THEN
                RAISE EXCEPTION 'RODADA_FECHADA: rodada fechada é somente leitura.';
            END IF;
            IF NOT public.is_master() THEN
                RAISE EXCEPTION 'SO_MASTER: só o master reabre uma rodada fechada.';
            END IF;
            IF EXISTS (SELECT 1 FROM public.bid_rodada WHERE bid_id = OLD.bid_id AND numero > OLD.numero) THEN
                RAISE EXCEPTION 'RODADA_ANTIGA: só a última rodada do bid pode ser reaberta.';
            END IF;
            IF NEW.parametros IS DISTINCT FROM OLD.parametros THEN
                RAISE EXCEPTION 'RODADA_FECHADA: reabrir não altera parâmetros.';
            END IF;
            NEW.fechada_por := NULL;
            NEW.fechada_em := NULL;
        ELSIF NEW.status = 'fechada' THEN
            NEW.fechada_por := auth.uid();
            NEW.fechada_em := now();
        ELSE
            NEW.fechada_por := OLD.fechada_por;
            NEW.fechada_em := OLD.fechada_em;
        END IF;
        -- A versão é do banco: o cliente não escolhe, só compara.
        NEW.versao := OLD.versao + 1;
    END IF;
    NEW.atualizado_por := auth.uid();
    NEW.atualizado_em := now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bid_rodada_antes_gravar ON public.bid_rodada;
CREATE TRIGGER bid_rodada_antes_gravar BEFORE INSERT OR UPDATE ON public.bid_rodada
    FOR EACH ROW EXECUTE FUNCTION public.bid_rodada_antes_gravar();

-- Mexeu numa rodada -> a pasta registra "última alteração" e "quem alterou".
CREATE OR REPLACE FUNCTION public.bid_rodada_depois_gravar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    UPDATE public.bid SET atualizado_em = now() WHERE id = NEW.bid_id;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS bid_rodada_depois_gravar ON public.bid_rodada;
CREATE TRIGGER bid_rodada_depois_gravar AFTER INSERT OR UPDATE ON public.bid_rodada
    FOR EACH ROW EXECUTE FUNCTION public.bid_rodada_depois_gravar();

CREATE OR REPLACE FUNCTION public.bid_rodada_linha_antes_gravar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_status text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        NEW.rodada_id := OLD.rodada_id;      -- linha não muda de rodada
        NEW.chave_linha := OLD.chave_linha;  -- a chave é estável
    END IF;
    -- FOR SHARE: um "Fechar rodada" concorrente espera esta gravação terminar.
    SELECT status INTO v_status FROM public.bid_rodada WHERE id = NEW.rodada_id FOR SHARE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'RODADA_INEXISTENTE: rodada não encontrada.';
    END IF;
    IF v_status = 'fechada' THEN
        RAISE EXCEPTION 'RODADA_FECHADA: rodada fechada é somente leitura.';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bid_rodada_linha_antes_gravar ON public.bid_rodada_linha;
CREATE TRIGGER bid_rodada_linha_antes_gravar BEFORE INSERT OR UPDATE ON public.bid_rodada_linha
    FOR EACH ROW EXECUTE FUNCTION public.bid_rodada_linha_antes_gravar();

-- Apagar linha: só com a rodada em rascunho.
CREATE OR REPLACE FUNCTION public.bid_rodada_linha_antes_apagar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM public.bid_rodada WHERE id = OLD.rodada_id FOR SHARE;
    IF v_status = 'fechada' THEN
        RAISE EXCEPTION 'RODADA_FECHADA: rodada fechada é somente leitura.';
    END IF;
    RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS bid_rodada_linha_antes_apagar ON public.bid_rodada_linha;
CREATE TRIGGER bid_rodada_linha_antes_apagar BEFORE DELETE ON public.bid_rodada_linha
    FOR EACH ROW EXECUTE FUNCTION public.bid_rodada_linha_antes_apagar();

-- ---------------------------------------------------------------------
-- 3. RLS: SELECT, INSERT e UPDATE para authenticated. DELETE só em linhas
--    (e o trigger acima só deixa em rodada em rascunho). Master-only
--    (exclusão lógica, reabertura) fica nos triggers acima.
-- ---------------------------------------------------------------------
ALTER TABLE public.bid              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_rodada       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_rodada_linha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bid_sel ON public.bid;
DROP POLICY IF EXISTS bid_ins ON public.bid;
DROP POLICY IF EXISTS bid_upd ON public.bid;
CREATE POLICY bid_sel ON public.bid FOR SELECT TO authenticated USING (true);
CREATE POLICY bid_ins ON public.bid FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY bid_upd ON public.bid FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bid_rodada_sel ON public.bid_rodada;
DROP POLICY IF EXISTS bid_rodada_ins ON public.bid_rodada;
DROP POLICY IF EXISTS bid_rodada_upd ON public.bid_rodada;
CREATE POLICY bid_rodada_sel ON public.bid_rodada FOR SELECT TO authenticated USING (true);
CREATE POLICY bid_rodada_ins ON public.bid_rodada FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY bid_rodada_upd ON public.bid_rodada FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bid_rodada_linha_sel ON public.bid_rodada_linha;
DROP POLICY IF EXISTS bid_rodada_linha_ins ON public.bid_rodada_linha;
DROP POLICY IF EXISTS bid_rodada_linha_upd ON public.bid_rodada_linha;
DROP POLICY IF EXISTS bid_rodada_linha_del ON public.bid_rodada_linha;
CREATE POLICY bid_rodada_linha_sel ON public.bid_rodada_linha FOR SELECT TO authenticated USING (true);
CREATE POLICY bid_rodada_linha_ins ON public.bid_rodada_linha FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY bid_rodada_linha_upd ON public.bid_rodada_linha FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY bid_rodada_linha_del ON public.bid_rodada_linha FOR DELETE TO authenticated USING (true);

-- bid e bid_rodada: sem DELETE. TRUNCATE ignora RLS e trigger de linha, então
-- sai das três. anon não tem policy nenhuma; o REVOKE deixa explícito.
REVOKE DELETE ON public.bid, public.bid_rodada FROM authenticated;
REVOKE TRUNCATE ON public.bid, public.bid_rodada, public.bid_rodada_linha FROM authenticated;
GRANT DELETE ON public.bid_rodada_linha TO authenticated;
REVOKE ALL ON public.bid, public.bid_rodada, public.bid_rodada_linha FROM anon;

-- ---------------------------------------------------------------------
-- 4. Funções de gravação (SECURITY INVOKER: RLS e triggers valem igual)
-- ---------------------------------------------------------------------

-- Monta a resposta de conflito: quem alterou a rodada e quando.
CREATE OR REPLACE FUNCTION public.bid_conflito(p_rodada_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'ok', false,
        'conflito', true,
        'status', r.status,
        'versao', r.versao,
        'atualizado_em', r.atualizado_em,
        'atualizado_por', r.atualizado_por,
        'atualizado_por_nome', p.name
    )
    FROM public.bid_rodada r
    LEFT JOIN public.profiles p ON p.id = r.atualizado_por
    WHERE r.id = p_rodada_id;
$$;

-- Novo bid + Rodada 1 vazia, numa transação só.
CREATE OR REPLACE FUNCTION public.bid_criar(p_nome text, p_cliente text, p_observacao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_bid uuid;
    v_rodada uuid;
BEGIN
    INSERT INTO public.bid (nome, cliente, observacao)
        VALUES (p_nome, NULLIF(btrim(p_cliente), ''), NULLIF(btrim(p_observacao), ''))
        RETURNING id INTO v_bid;
    INSERT INTO public.bid_rodada (bid_id) VALUES (v_bid) RETURNING id INTO v_rodada;
    RETURN jsonb_build_object('bid_id', v_bid, 'rodada_id', v_rodada);
END $$;

-- Autosalvamento: parâmetros + SÓ as linhas alteradas (e as removidas),
-- se a versão bater. Tudo numa transação.
-- p_linhas: [{ "chave_linha": "...", "ordem": 1, "entrada": {...}, "resultado": {...} }]
-- p_remover: chaves de linha a apagar
CREATE OR REPLACE FUNCTION public.bid_salvar_rodada(
    p_rodada_id uuid, p_versao bigint, p_parametros jsonb, p_linhas jsonb, p_remover text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_nova bigint;
BEGIN
    UPDATE public.bid_rodada
       SET parametros = COALESCE(p_parametros, parametros)
     WHERE id = p_rodada_id AND versao = p_versao
     RETURNING versao INTO v_nova;
    IF NOT FOUND THEN
        RETURN public.bid_conflito(p_rodada_id);
    END IF;

    DELETE FROM public.bid_rodada_linha
     WHERE rodada_id = p_rodada_id AND chave_linha = ANY (COALESCE(p_remover, '{}'::text[]));

    INSERT INTO public.bid_rodada_linha (rodada_id, ordem, chave_linha, entrada, resultado)
    SELECT p_rodada_id, (l->>'ordem')::int, l->>'chave_linha', l->'entrada', l->'resultado'
      FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) AS l
    ON CONFLICT (rodada_id, chave_linha) DO UPDATE
       SET ordem = EXCLUDED.ordem, entrada = EXCLUDED.entrada, resultado = EXCLUDED.resultado;

    RETURN jsonb_build_object('ok', true, 'versao', v_nova);
END $$;

-- Reimportar planilha: troca TODAS as linhas da rodada em rascunho, atômico.
CREATE OR REPLACE FUNCTION public.bid_substituir_linhas(
    p_rodada_id uuid, p_versao bigint, p_parametros jsonb, p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_nova bigint;
BEGIN
    UPDATE public.bid_rodada
       SET parametros = COALESCE(p_parametros, parametros)
     WHERE id = p_rodada_id AND versao = p_versao
     RETURNING versao INTO v_nova;
    IF NOT FOUND THEN
        RETURN public.bid_conflito(p_rodada_id);
    END IF;

    DELETE FROM public.bid_rodada_linha WHERE rodada_id = p_rodada_id;

    INSERT INTO public.bid_rodada_linha (rodada_id, ordem, chave_linha, entrada, resultado)
    SELECT p_rodada_id, (l->>'ordem')::int, l->>'chave_linha', l->'entrada', l->'resultado'
      FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) AS l;

    RETURN jsonb_build_object('ok', true, 'versao', v_nova);
END $$;

-- Fechar (rascunho -> fechada) ou reabrir (fechada -> rascunho, só master,
-- só a última rodada).
CREATE OR REPLACE FUNCTION public.bid_mudar_status_rodada(
    p_rodada_id uuid, p_versao bigint, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_nova bigint;
BEGIN
    UPDATE public.bid_rodada SET status = p_status
     WHERE id = p_rodada_id AND versao = p_versao
     RETURNING versao INTO v_nova;
    IF NOT FOUND THEN
        RETURN public.bid_conflito(p_rodada_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'versao', v_nova);
END $$;

-- Nova rodada: copia parâmetros e linhas (entrada E resultado, com os dados
-- de rota que estão na entrada). Não consulta nada. O trigger recusa se a
-- última rodada não estiver fechada.
CREATE OR REPLACE FUNCTION public.bid_nova_rodada(p_bid_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ant record;
    v_nova uuid;
    v_numero integer;
BEGIN
    SELECT id, parametros INTO v_ant
      FROM public.bid_rodada WHERE bid_id = p_bid_id ORDER BY numero DESC LIMIT 1;
    IF v_ant.id IS NULL THEN
        RAISE EXCEPTION 'BID_INEXISTENTE: bid sem rodadas.';
    END IF;
    INSERT INTO public.bid_rodada (bid_id, parametros) VALUES (p_bid_id, v_ant.parametros)
        RETURNING id, numero INTO v_nova, v_numero;
    INSERT INTO public.bid_rodada_linha (rodada_id, ordem, chave_linha, entrada, resultado)
    SELECT v_nova, ordem, chave_linha, entrada, resultado
      FROM public.bid_rodada_linha WHERE rodada_id = v_ant.id;
    RETURN jsonb_build_object('rodada_id', v_nova, 'numero', v_numero, 'rodada_anterior_id', v_ant.id);
END $$;

REVOKE ALL ON FUNCTION public.bid_conflito(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.bid_criar(text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.bid_salvar_rodada(uuid, bigint, jsonb, jsonb, text[]) FROM anon, public;
REVOKE ALL ON FUNCTION public.bid_substituir_linhas(uuid, bigint, jsonb, jsonb) FROM anon, public;
REVOKE ALL ON FUNCTION public.bid_mudar_status_rodada(uuid, bigint, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.bid_nova_rodada(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bid_conflito(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_criar(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_salvar_rodada(uuid, bigint, jsonb, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_substituir_linhas(uuid, bigint, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_mudar_status_rodada(uuid, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_nova_rodada(uuid) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- 5. Conferência (rodar depois de aplicar): RLS ligada nas três -> true
-- ---------------------------------------------------------------------
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relnamespace = 'public'::regnamespace
--    AND relname IN ('bid', 'bid_rodada', 'bid_rodada_linha') ORDER BY relname;

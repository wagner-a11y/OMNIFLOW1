-- =====================================================================
-- Prova por simulação da RLS — qualp_health (log de saúde do Qualp)
-- =====================================================================
-- Roda ANTES de aplicar migrations_qualp_health.sql: a tabela é criada AQUI
-- DENTRO, com exatamente o mesmo DDL da migration, testada, e a transação
-- termina em ROLLBACK. Nada é gravado — nem a tabela, nem as linhas de teste.
--
-- Impersona os papéis reais alternando SET LOCAL ROLE + request.jwt.claims,
-- exatamente como o PostgREST faz.
--
-- Regras provadas:
--   1. service_role (a Edge Function) insere o log            -> PASS
--   2. Operador autenticado LÊ os logs (transparência)        -> PASS
--   3. Master LÊ os logs                                      -> PASS
--   4. anon NÃO lê (dado operacional, não é o Painel TV)      -> bloqueado
--   5. anon NÃO insere                                        -> bloqueado
--   6. Operador NÃO insere direto (só a Edge Function grava)  -> bloqueado
--   7. Operador NÃO faz UPDATE                                -> bloqueado
--   8. Master NÃO faz UPDATE                                  -> bloqueado
--   9. Nem o postgres faz UPDATE (trigger de imutabilidade)   -> bloqueado
--  10. Operador NÃO faz DELETE                                -> bloqueado
--  11. service_role FAZ delete (retenção/poda)                -> PASS
-- =====================================================================
BEGIN;

-- ---------- DDL idêntico ao de migrations_qualp_health.sql ----------
CREATE TABLE public.qualp_health (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    criado_em     timestamptz NOT NULL DEFAULT now(),
    ok            boolean     NOT NULL,
    status_http   int,
    erro          text,
    latencia_ms   int,
    tentativas    smallint,
    origem        text,
    destino       text,
    eixos         smallint,
    freight_load  text,
    distancia_km  numeric(10,3),
    pedagio_cheio numeric(12,2),
    piso_antt     numeric(12,2),
    id_transacao  text
);

CREATE INDEX idx_qualp_health_criado ON public.qualp_health (criado_em DESC);
CREATE INDEX idx_qualp_health_falhas ON public.qualp_health (criado_em DESC) WHERE ok = false;

CREATE OR REPLACE FUNCTION public.qualp_health_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'qualp_health e imutavel: UPDATE bloqueado (log de saude)';
END;
$fn$;

CREATE TRIGGER qualp_health_sem_update
    BEFORE UPDATE ON public.qualp_health
    FOR EACH ROW EXECUTE FUNCTION public.qualp_health_imutavel();

REVOKE ALL ON public.qualp_health FROM anon, authenticated;
GRANT SELECT ON public.qualp_health TO authenticated;

ALTER TABLE public.qualp_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY qualp_health_sel_auth ON public.qualp_health FOR SELECT TO authenticated
    USING (true);

-- ---------- Coleta dos resultados (RAISE NOTICE não volta pela API) ----------
CREATE TEMP TABLE _res (n int, caso text, esperado text, obtido text, veredito text);

DO $do$
DECLARE
    m uuid; a uuid; linha uuid; n int; bypass boolean;
    bloqueou boolean;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role = 'master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role = 'operador' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Simulacao precisa de >=1 master e >=1 operador em profiles (m=%, a=%)', m, a;
    END IF;

    SELECT rolbypassrls INTO bypass FROM pg_roles WHERE rolname = 'service_role';
    INSERT INTO _res VALUES (0, 'diagnostico: service_role tem BYPASSRLS?', 'true',
        coalesce(bypass::text, 'role inexistente'),
        CASE WHEN bypass THEN 'ok' ELSE 'ATENCAO' END);

    -- 1. service_role (Edge Function) insere o log
    SET LOCAL ROLE service_role;
    INSERT INTO public.qualp_health (ok, status_http, latencia_ms, tentativas, origem, destino, eixos, freight_load, distancia_km, pedagio_cheio, piso_antt)
        VALUES (true, 200, 812, 1, 'SIM-Sao Paulo, SP', 'SIM-Rio de Janeiro, RJ', 5, 'geral', 437.345, 328.50, 3573.14)
        RETURNING id INTO linha;
    RESET ROLE;
    INSERT INTO _res VALUES (1, 'service_role insere o log', 'insere', 'inseriu id=' || linha,
        CASE WHEN linha IS NOT NULL THEN 'PASS' ELSE 'FALHOU' END);

    -- 2. Operador autenticado lê (transparência)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.qualp_health WHERE id = linha;
    RESET ROLE;
    INSERT INTO _res VALUES (2, 'operador LE os logs', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 3. Master lê
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.qualp_health WHERE id = linha;
    RESET ROLE;
    INSERT INTO _res VALUES (3, 'master LE os logs', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 4. anon NÃO lê
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE anon;
    bloqueou := false;
    BEGIN
        SELECT count(*) INTO n FROM public.qualp_health WHERE id = linha;
        IF n = 0 THEN bloqueou := true; END IF;   -- RLS filtrou
    EXCEPTION WHEN insufficient_privilege THEN
        bloqueou := true; n := -1;                 -- GRANT barrou antes da RLS
    END;
    RESET ROLE;
    INSERT INTO _res VALUES (4, 'anon NAO le', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 5. anon NÃO insere
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE anon;
    bloqueou := false;
    BEGIN
        INSERT INTO public.qualp_health (ok, origem, destino, eixos) VALUES (true, 'SIM-anon', 'SIM-anon', 5);
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _res VALUES (5, 'anon NAO insere', 'bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (inseriu!)' END);

    -- 6. Operador NÃO insere direto
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN
        INSERT INTO public.qualp_health (ok, origem, destino, eixos) VALUES (true, 'SIM-op', 'SIM-op', 5);
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _res VALUES (6, 'operador NAO insere direto', 'bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (inseriu!)' END);

    -- 7. Operador NÃO faz UPDATE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        UPDATE public.qualp_health SET erro = 'adulterado' WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _res VALUES (7, 'operador NAO faz UPDATE', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied / trigger' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (editou!)' END);

    -- 8. Master NÃO faz UPDATE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        UPDATE public.qualp_health SET erro = 'adulterado pelo master' WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _res VALUES (8, 'master NAO faz UPDATE', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied / trigger' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (editou!)' END);

    -- 9. Nem o postgres faz UPDATE (trigger de imutabilidade)
    bloqueou := false;
    BEGIN
        UPDATE public.qualp_health SET erro = 'adulterado pelo superuser' WHERE id = linha;
    EXCEPTION WHEN raise_exception THEN bloqueou := true;
    END;
    INSERT INTO _res VALUES (9, 'nem o postgres faz UPDATE (trigger)', 'bloqueado',
        CASE WHEN bloqueou THEN 'trigger levantou excecao' ELSE 'EDITOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (editou!)' END);

    -- 10. Operador NÃO faz DELETE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.qualp_health WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _res VALUES (10, 'operador NAO faz DELETE', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou!)' END);

    -- 11. service_role FAZ delete (retenção)
    SET LOCAL ROLE service_role;
    DELETE FROM public.qualp_health WHERE id = linha;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _res VALUES (11, 'service_role apaga (retencao)', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

SELECT n AS "#", caso, esperado, obtido, veredito FROM _res ORDER BY n;

ROLLBACK;

-- =====================================================================
-- Prova por simulação da RLS — chave de emergência do Qualp
-- =====================================================================
-- Roda ANTES de aplicar migrations_emergencia_qualp.sql: as tabelas são criadas
-- AQUI DENTRO, com o mesmo DDL, testadas, e a transação termina em ROLLBACK.
-- Nada é gravado — nem as tabelas, nem as linhas de teste.
--
-- O ponto central: a trava de master é de SERVIDOR. Um operador que chame a API
-- direto, sem passar pela tela, tem que ser barrado do mesmo jeito.
--
-- Regras provadas:
--   1. Master LIGA a emergência (UPDATE)                    -> PASS
--   2. Operador NÃO liga (UPDATE) — trava de servidor        -> bloqueado
--   3. Operador LÊ o estado (precisa, para ver o banner)     -> PASS
--   4. anon NÃO lê o estado                                  -> bloqueado
--   5. Ninguém cria uma segunda linha de config (INSERT)     -> bloqueado
--   6. Ninguém apaga a linha de config (DELETE)              -> bloqueado
--   7. Master registra no log em nome próprio                -> PASS
--   8. Operador NÃO registra no log                          -> bloqueado
--   9. Master NÃO registra no nome de outro (spoof)          -> bloqueado
--  10. Operador NÃO lê o log (só master)                     -> bloqueado
--  11. Master NÃO edita o log (imutável)                     -> bloqueado
--  12. Nem o postgres edita o log (trigger)                  -> bloqueado
--  13. Master NÃO apaga o log                                -> bloqueado
--  14. Master DESLIGA a emergência (UPDATE de volta)         -> PASS
-- =====================================================================
BEGIN;

-- ---------- DDL idêntico ao de migrations_emergencia_qualp.sql ----------
CREATE TABLE public.emergencia_config (
    id                boolean PRIMARY KEY DEFAULT true CHECK (id),
    ligada            boolean     NOT NULL DEFAULT false,
    alterado_por      uuid REFERENCES public.profiles(id),
    alterado_por_nome text,
    alterado_em       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.emergencia_config (id, ligada) VALUES (true, false);

CREATE TABLE public.emergencia_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    acao       text NOT NULL CHECK (acao IN ('ligou', 'desligou')),
    autor_id   uuid NOT NULL REFERENCES public.profiles(id),
    autor_nome text,
    criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_emergencia_log_quando ON public.emergencia_log (criado_em DESC);

CREATE OR REPLACE FUNCTION public.emergencia_log_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'emergencia_log e imutavel: UPDATE/DELETE bloqueado';
END;
$fn$;

CREATE TRIGGER emergencia_log_sem_alteracao
    BEFORE UPDATE OR DELETE ON public.emergencia_log
    FOR EACH ROW EXECUTE FUNCTION public.emergencia_log_imutavel();

REVOKE ALL ON public.emergencia_config FROM anon, authenticated;
REVOKE ALL ON public.emergencia_log    FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.emergencia_config TO authenticated;
GRANT SELECT, INSERT ON public.emergencia_log    TO authenticated;

ALTER TABLE public.emergencia_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergencia_log    ENABLE ROW LEVEL SECURITY;

CREATE POLICY emerg_cfg_sel_auth ON public.emergencia_config FOR SELECT TO authenticated
    USING (true);
CREATE POLICY emerg_cfg_upd_master ON public.emergencia_config FOR UPDATE TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());
CREATE POLICY emerg_log_sel_master ON public.emergencia_log FOR SELECT TO authenticated
    USING (public.is_master());
CREATE POLICY emerg_log_ins_master ON public.emergencia_log FOR INSERT TO authenticated
    WITH CHECK (public.is_master() AND autor_id = auth.uid());

-- ---------- Coleta dos resultados ----------
CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text);

DO $do$
DECLARE
    m uuid; a uuid; n int; bloqueou boolean; linha uuid; estado boolean;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role = 'master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role = 'operador' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Simulacao precisa de >=1 master e >=1 operador em profiles';
    END IF;

    -- 1. Master liga
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.emergencia_config SET ligada = true, alterado_por = m, alterado_em = now() WHERE id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (1, 'master LIGA a emergencia', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 2. Operador tenta ligar/desligar -> trava de SERVIDOR
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        UPDATE public.emergencia_config SET ligada = false WHERE id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (2, 'operador NAO liga/desliga (servidor)', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (mudou!)' END);

    -- 3. Operador lê o estado (precisa, para o banner)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT ligada INTO estado FROM public.emergencia_config WHERE id;
    RESET ROLE;
    INSERT INTO _r VALUES (3, 'operador LE o estado (banner)', 'le true', coalesce(estado::text, 'nao leu'),
        CASE WHEN estado THEN 'PASS' ELSE 'FALHOU' END);

    -- 4. anon não lê
    SET LOCAL ROLE anon;
    bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.emergencia_config;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (4, 'anon NAO le o estado', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 5. Ninguém cria segunda linha de config
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN
        INSERT INTO public.emergencia_config (id, ligada) VALUES (true, false);
    EXCEPTION WHEN insufficient_privilege OR unique_violation OR check_violation THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (5, 'nem master cria 2a linha de config', 'bloqueado',
        CASE WHEN bloqueou THEN 'barrado' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 6. Ninguém apaga a linha de config
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.emergencia_config WHERE id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (6, 'nem master apaga a linha de config', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou!)' END);

    -- 7. Master registra no log em nome próprio
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.emergencia_log (acao, autor_id, autor_nome) VALUES ('ligou', m, 'Master')
        RETURNING id INTO linha;
    RESET ROLE;
    INSERT INTO _r VALUES (7, 'master registra no log', 'insere', 'inseriu',
        CASE WHEN linha IS NOT NULL THEN 'PASS' ELSE 'FALHOU' END);

    -- 8. Operador não registra
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN
        INSERT INTO public.emergencia_log (acao, autor_id, autor_nome) VALUES ('ligou', a, 'Operador');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (8, 'operador NAO registra no log', 'bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 9. Master não registra no nome de outro (spoof)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN
        INSERT INTO public.emergencia_log (acao, autor_id, autor_nome) VALUES ('ligou', a, 'Operador');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (9, 'master NAO registra por outro (spoof)', 'bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (spoof passou!)' END);

    -- 10. Operador não lê o log
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.emergencia_log;
    RESET ROLE;
    INSERT INTO _r VALUES (10, 'operador NAO le o log (so master)', '0 linhas', n || ' linha(s)',
        CASE WHEN n = 0 THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 11. Master não edita o log
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        UPDATE public.emergencia_log SET acao = 'desligou' WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (11, 'master NAO edita o log', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied / trigger' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 12. Nem o postgres edita (trigger)
    bloqueou := false;
    BEGIN
        UPDATE public.emergencia_log SET acao = 'desligou' WHERE id = linha;
    EXCEPTION WHEN raise_exception THEN bloqueou := true;
    END;
    INSERT INTO _r VALUES (12, 'nem o postgres edita o log (trigger)', 'bloqueado',
        CASE WHEN bloqueou THEN 'trigger levantou excecao' ELSE 'EDITOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 13. Master não apaga o log
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.emergencia_log WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (13, 'master NAO apaga o log', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied / trigger' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 14. Master desliga de volta
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.emergencia_config SET ligada = false, alterado_por = m, alterado_em = now() WHERE id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (14, 'master DESLIGA a emergencia', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

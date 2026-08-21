-- =====================================================================
-- Prova por simulação da RLS — cadastro_log
-- =====================================================================
-- Roda ANTES de aplicar migrations_cadastro_log.sql: a tabela é criada AQUI
-- DENTRO com o mesmo DDL, testada, e a transação termina em ROLLBACK.
--
-- Regras provadas:
--   1. Operador REGISTRA em nome próprio                     -> PASS
--   2. Operador NÃO registra no nome de outro (spoof)        -> bloqueado
--   3. Operador LÊ o log do time (transparência)             -> PASS
--   4. Master LÊ o log                                       -> PASS
--   5. anon NÃO lê                                           -> bloqueado
--   6. anon NÃO registra                                     -> bloqueado
--   7. Operador NÃO altera o log (sem policy de UPDATE)      -> bloqueado
--   8. Operador NÃO apaga o log (sem policy de DELETE)       -> bloqueado
--   9. CHECK barra tipo fora do vocabulário                  -> bloqueado
-- =====================================================================
BEGIN;

CREATE TABLE public.cadastro_log (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo          text        NOT NULL DEFAULT 'motorista',
    cpf           text,
    nome          text,
    cod_pessoa    text,
    ja_existia    boolean     NOT NULL DEFAULT false,
    anexado       boolean     NOT NULL DEFAULT false,
    sucesso       boolean     NOT NULL DEFAULT true,
    erro          text,
    criado_por      uuid REFERENCES public.profiles(id),
    criado_por_nome text,
    criado_em     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cadastro_log
    ADD CONSTRAINT cadastro_log_tipo_check CHECK (tipo IN ('motorista', 'veiculo'));

REVOKE ALL ON public.cadastro_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.cadastro_log TO authenticated;
ALTER TABLE public.cadastro_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY cadastro_log_sel_auth ON public.cadastro_log FOR SELECT TO authenticated USING (true);
CREATE POLICY cadastro_log_ins_proprio ON public.cadastro_log FOR INSERT TO authenticated
    WITH CHECK (criado_por = auth.uid());

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text);

DO $do$
DECLARE m uuid; a uuid; n int; bloqueou boolean; linha bigint;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role='master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role='operador' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN RAISE EXCEPTION 'Precisa de >=1 master e >=1 operador'; END IF;

    -- 1. Operador registra em nome próprio
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.cadastro_log (tipo, cpf, nome, cod_pessoa, criado_por, criado_por_nome)
        VALUES ('motorista','00000000191','SIM Teste','9999', a, 'Operador') RETURNING id INTO linha;
    RESET ROLE;
    INSERT INTO _r VALUES (1,'operador REGISTRA em nome proprio','1 linha',
        CASE WHEN linha IS NOT NULL THEN 'inseriu' ELSE 'nao inseriu' END,
        CASE WHEN linha IS NOT NULL THEN 'PASS' ELSE 'FALHOU' END);

    -- 2. Operador tenta registrar no nome de outro
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN
        INSERT INTO public.cadastro_log (tipo, cpf, criado_por, criado_por_nome)
            VALUES ('motorista','11111111111', m, 'spoof');
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (2,'operador NAO registra por outro (spoof)','bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (spoof passou!)' END);

    -- 3. Operador lê
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.cadastro_log WHERE id = linha;
    RESET ROLE;
    INSERT INTO _r VALUES (3,'operador LE o log','1 linha', n||' linha(s)',
        CASE WHEN n=1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 4. Master lê
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.cadastro_log WHERE id = linha;
    RESET ROLE;
    INSERT INTO _r VALUES (4,'master LE o log','1 linha', n||' linha(s)',
        CASE WHEN n=1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 5. anon não lê
    SET LOCAL ROLE anon;
    bloqueou := false; n := 0;
    BEGIN SELECT count(*) INTO n FROM public.cadastro_log; IF n=0 THEN bloqueou:=true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou:=true; n:=-1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (5,'anon NAO le','bloqueado',
        CASE WHEN n=-1 THEN 'permission denied' ELSE n||' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 6. anon não registra
    SET LOCAL ROLE anon;
    bloqueou := false;
    BEGIN INSERT INTO public.cadastro_log (tipo, cpf) VALUES ('motorista','22222222222');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou:=true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (6,'anon NAO registra','bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 7. Operador não altera
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        UPDATE public.cadastro_log SET cod_pessoa='hack' WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n=0 THEN bloqueou:=true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou:=true; n:=-1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (7,'operador NAO altera o log','bloqueado',
        CASE WHEN n=-1 THEN 'permission denied' ELSE n||' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (alterou!)' END);

    -- 8. Operador não apaga
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.cadastro_log WHERE id = linha;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n=0 THEN bloqueou:=true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou:=true; n:=-1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (8,'operador NAO apaga o log','bloqueado',
        CASE WHEN n=-1 THEN 'permission denied' ELSE n||' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou!)' END);

    -- 9. CHECK barra tipo inválido
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN INSERT INTO public.cadastro_log (tipo, cpf, criado_por) VALUES ('qualquer','333', a);
    EXCEPTION WHEN check_violation THEN bloqueou:=true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (9,'CHECK barra tipo invalido','bloqueado',
        CASE WHEN bloqueou THEN 'check_violation' ELSE 'ACEITOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);
END;
$do$;

SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

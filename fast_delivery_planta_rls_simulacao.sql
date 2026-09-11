-- =====================================================================
-- Prova por simulação — de-para de PLANTA (origem das Demais Plantas)
-- =====================================================================
-- Roda no SQL Editor e termina em ROLLBACK: nada sobrevive.
--
-- RODA ANTES **OU** DEPOIS DA MIGRATION, indiferente. Se a tabela ainda não
-- existe, ela é criada aqui dentro com o DDL da migration; se já existe, o
-- teste usa a REAL, com as policies reais. Foi o "relation already exists" da
-- simulação da carroceria que ensinou isso — um arquivo de prova não pode
-- depender da ordem em que alguém o executa.
--
-- O QUE SE PROVA. Classificar planta é decisão de master, como classificar
-- equipamento: a origem define a distância, e a distância define o piso ANTT.
-- Operador LÊ (precisa ver a origem da carga dele) e não escreve.
--
-- O QUE PROTEGE OS DADOS REAIS
--   - ROLLBACK no fim; erro no meio aborta a transação e também desfaz.
--   - Os códigos de teste usam o prefixo 'SIM-', que não colide com código do
--     OTM (FAB_*). Nenhum UPDATE/DELETE mira linha real.
--   - O caso 9 confere, com EXCEPT, que nenhuma planta real mudou.
--
-- Casos:
--    0. Estrutura pronta (criada aqui ou ja existente)        -> PASS
--    1. Operador NAO cadastra planta nova                     -> bloqueado
--    2. Operador NAO altera planta existente                  -> bloqueado
--    3. Master CADASTRA planta                                -> PASS
--    4. Master CORRIGE a cidade de uma planta                 -> PASS
--    5. Operador LE a planta (precisa, para ver a origem)     -> PASS
--    6. anon NAO le                                           -> bloqueado
--    7. PK barra codigo de planta repetido                    -> bloqueado
--    8. CHECK barra UF invalida                               -> bloqueado
--    9. Nenhuma planta real foi alterada                      -> PASS
--   10. Linhas de teste criadas (o ROLLBACK desfaz)           -> PASS
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Caso 0 — garante a estrutura, criando-a só se faltar.
-- ---------------------------------------------------------------------
DO $cria$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'fast_delivery_planta'
    ) THEN
        EXECUTE $ddl$
            CREATE TABLE public.fast_delivery_planta (
                codigo_planta text PRIMARY KEY,
                cidade        text NOT NULL,
                uf            text NOT NULL,
                cod_ibge      integer,
                observacao    text,
                atualizado_em timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT fast_delivery_planta_uf_valida CHECK (char_length(uf) = 2)
            )$ddl$;
        EXECUTE 'ALTER TABLE public.fast_delivery_planta ENABLE ROW LEVEL SECURITY';
        EXECUTE 'REVOKE ALL ON public.fast_delivery_planta FROM anon, authenticated';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.fast_delivery_planta TO authenticated';
        EXECUTE 'CREATE POLICY fd_planta_sel ON public.fast_delivery_planta FOR SELECT TO authenticated USING (true)';
        EXECUTE 'CREATE POLICY fd_planta_wri ON public.fast_delivery_planta FOR ALL TO authenticated
                 USING (public.is_master()) WITH CHECK (public.is_master())';
    END IF;
END;
$cria$;

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text) ON COMMIT DROP;

CREATE TEMP TABLE _antes ON COMMIT DROP AS
    SELECT codigo_planta, cidade, uf, cod_ibge
      FROM public.fast_delivery_planta
     WHERE codigo_planta NOT LIKE 'SIM-%';

DO $do$
DECLARE
    m uuid; a uuid; n int; bloqueou boolean; txt text;
    reais_antes int; divergentes int;
BEGIN
    SELECT count(*) INTO reais_antes FROM _antes;
    INSERT INTO _r VALUES (0, 'estrutura pronta', 'sem erro',
        reais_antes || ' planta(s) real(is) ja cadastrada(s)', 'PASS');

    SELECT id INTO m FROM public.profiles WHERE role = 'master' ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role IS DISTINCT FROM 'master' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Precisa de >=1 master e >=1 usuario nao-master em public.profiles';
    END IF;

    -- Semente como dono da tabela (fora das policies): uma planta "já cadastrada".
    INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf, cod_ibge)
        VALUES ('SIM-PLANTA-1', 'Cidade Teste', 'SP', NULL);

    -- 1. Operador tenta cadastrar planta nova
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf)
            VALUES ('SIM-PLANTA-NOVA', 'Inventada', 'RJ');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (1,'operador NAO cadastra planta','bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'CADASTROU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (operador definiu origem!)' END);

    -- 2. Operador tenta corrigir a cidade de uma planta existente. É o caminho
    --    mais provável de abuso: a linha já existe e "só" se muda um texto —
    --    que por acaso muda a distância e o piso ANTT de toda carga da planta.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        UPDATE public.fast_delivery_planta SET cidade = 'Outra Cidade'
         WHERE codigo_planta = 'SIM-PLANTA-1';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (2,'operador NAO altera planta existente','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (mudou a origem!)' END);

    -- 3. Master cadastra
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf, cod_ibge)
            VALUES ('SIM-PLANTA-2', 'Suzano', 'SP', 3552502);
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (3,'master CADASTRA planta','criou',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'criou' END,
        CASE WHEN bloqueou THEN 'FALHOU' ELSE 'PASS' END);

    -- 4. Master corrige
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    UPDATE public.fast_delivery_planta SET cidade = 'Mogi das Cruzes', cod_ibge = 3530607
     WHERE codigo_planta = 'SIM-PLANTA-1';
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (4,'master CORRIGE a cidade','1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 5. Operador lê. Tem de ler: é a origem da carga que ele vai cotar.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT cidade INTO txt FROM public.fast_delivery_planta WHERE codigo_planta = 'SIM-PLANTA-1';
    RESET ROLE;
    INSERT INTO _r VALUES (5,'operador LE a planta','Mogi das Cruzes', coalesce(txt,'(nulo)'),
        CASE WHEN txt = 'Mogi das Cruzes' THEN 'PASS' ELSE 'FALHOU' END);

    -- 6. anon nao le
    SET LOCAL ROLE anon; bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.fast_delivery_planta;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (6,'anon NAO le o de-para de planta','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 7. PK barra codigo repetido: a mesma planta nao pode ter duas cidades.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf)
            VALUES ('SIM-PLANTA-1', 'Cidade Duplicada', 'MG');
    EXCEPTION WHEN unique_violation THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (7,'PK barra planta repetida','bloqueado',
        CASE WHEN bloqueou THEN 'unique_violation' ELSE 'DUPLICOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 8. CHECK barra UF invalida. "Sao Paulo" no campo UF passaria batido e
    --    quebraria o casamento com o IBGE la na frente.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf)
            VALUES ('SIM-PLANTA-3', 'Qualquer', 'Sao Paulo');
    EXCEPTION WHEN check_violation THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (8,'CHECK barra UF invalida','bloqueado',
        CASE WHEN bloqueou THEN 'check_violation' ELSE 'GRAVOU "Sao Paulo"' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 9. Nenhuma planta REAL mudou.
    SELECT count(*) INTO divergentes FROM (
        SELECT codigo_planta, cidade, uf, cod_ibge FROM _antes
        EXCEPT
        SELECT codigo_planta, cidade, uf, cod_ibge
          FROM public.fast_delivery_planta WHERE codigo_planta NOT LIKE 'SIM-%'
    ) d;
    INSERT INTO _r VALUES (9,'nenhuma planta real foi alterada','0 divergencia(s)',
        divergentes || ' divergencia(s)',
        CASE WHEN divergentes = 0 THEN 'PASS' ELSE 'FALHOU (mexeu em dado real!)' END);

    -- 10. O que o ROLLBACK desfaz. Esperado 2: SIM-PLANTA-1 (semente) e
    --     SIM-PLANTA-2 (master). A do operador foi barrada (caso 1), a repetida
    --     pela PK (7) e a de UF invalida pela CHECK (8).
    SELECT count(*) INTO n FROM public.fast_delivery_planta WHERE codigo_planta LIKE 'SIM-%';
    INSERT INTO _r VALUES (10,'linhas de teste criadas (o ROLLBACK desfaz)','2 linha(s)', n || ' linha(s)',
        CASE WHEN n = 2 THEN 'PASS' ELSE 'FALHOU (uma trava nao segurou)' END);
END;
$do$;

-- ÚLTIMA query do arquivo: é esta que o SQL Editor mostra.
SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

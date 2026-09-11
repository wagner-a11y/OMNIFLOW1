-- =====================================================================
-- Prova por simulação — vínculo planta × cliente do Pipefy
-- =====================================================================
-- Roda ANTES ou DEPOIS da migration, indiferente: as colunas são criadas aqui
-- dentro se faltarem. Termina em ROLLBACK — nada sobrevive, nem as colunas.
--
-- Roda contra public.fast_delivery_planta DE VERDADE, com as policies reais
-- (fd_planta_sel / fd_planta_wri). Vincular cliente é a mesma classe de decisão
-- que definir a cidade da planta: só master.
--
-- Casos:
--    0. Estrutura pronta (colunas criadas aqui ou ja existentes)  -> PASS
--    1. Operador NAO vincula cliente                              -> bloqueado
--    2. Operador NAO troca o vinculo de uma planta                -> bloqueado
--    3. Master VINCULA cliente                                    -> PASS
--    4. Master TROCA o vinculo (registro renomeado la)            -> PASS
--    5. Operador LE o vinculo (precisa, para enviar o card)       -> PASS
--    6. anon NAO le                                               -> bloqueado
--    7. Planta SEM vinculo continua valida (nulo e "falta")       -> PASS
--    8. Nenhuma planta real foi alterada                          -> PASS
--    9. Linhas de teste criadas (o ROLLBACK desfaz)               -> PASS
-- =====================================================================
BEGIN;

DO $cria$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'fast_delivery_planta'
           AND column_name = 'pipefy_cliente_id'
    ) THEN
        EXECUTE 'ALTER TABLE public.fast_delivery_planta
                   ADD COLUMN IF NOT EXISTS pipefy_cliente_id   text,
                   ADD COLUMN IF NOT EXISTS pipefy_cliente_nome text';
    END IF;
END;
$cria$;

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text) ON COMMIT DROP;

CREATE TEMP TABLE _antes ON COMMIT DROP AS
    SELECT codigo_planta, cidade, uf, pipefy_cliente_id, pipefy_cliente_nome
      FROM public.fast_delivery_planta
     WHERE codigo_planta NOT LIKE 'SIM-%';

DO $do$
DECLARE
    m uuid; a uuid; n int; bloqueou boolean; txt text;
    reais_antes int; divergentes int;
BEGIN
    SELECT count(*) INTO reais_antes FROM _antes;
    INSERT INTO _r VALUES (0, 'estrutura pronta', 'sem erro',
        reais_antes || ' planta(s) real(is)', 'PASS');

    SELECT id INTO m FROM public.profiles WHERE role = 'master' ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role IS DISTINCT FROM 'master' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Precisa de >=1 master e >=1 usuario nao-master em public.profiles';
    END IF;

    -- Semente: planta já cadastrada e JÁ vinculada, como as três da migration.
    INSERT INTO public.fast_delivery_planta
        (codigo_planta, cidade, uf, cod_ibge, pipefy_cliente_id, pipefy_cliente_nome)
        VALUES ('SIM-PL-VINC', 'Cidade Teste', 'SP', NULL, '999999', 'Suzano Teste');

    -- Semente: planta SEM vínculo, como Imperatriz e Mogi hoje.
    INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf)
        VALUES ('SIM-PL-SEM', 'Sem Vinculo', 'MG');

    -- 1. Operador tenta vincular
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        UPDATE public.fast_delivery_planta
           SET pipefy_cliente_id = '111', pipefy_cliente_nome = 'Inventado'
         WHERE codigo_planta = 'SIM-PL-SEM';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (1,'operador NAO vincula cliente','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (vinculou!)' END);

    -- 2. Operador tenta TROCAR um vínculo existente. É o abuso mais plausível:
    --    a linha já existe e "só" se troca um id — que redireciona todo card
    --    daquela planta para outro cliente no Pipefy.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        UPDATE public.fast_delivery_planta SET pipefy_cliente_id = '000'
         WHERE codigo_planta = 'SIM-PL-VINC';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (2,'operador NAO troca o vinculo','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (redirecionou o cliente!)' END);

    -- 3. Master vincula
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    UPDATE public.fast_delivery_planta
       SET pipefy_cliente_id = '1151687193', pipefy_cliente_nome = 'Suzano Mucuri/BA'
     WHERE codigo_planta = 'SIM-PL-SEM';
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (3,'master VINCULA cliente','1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 4. Master troca (o registro foi renomeado no Pipefy)
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    UPDATE public.fast_delivery_planta
       SET pipefy_cliente_nome = 'Suzano Mucuri' WHERE codigo_planta = 'SIM-PL-VINC';
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (4,'master TROCA o vinculo','1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 5. Operador lê. Tem de ler: é ele quem manda o card.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT pipefy_cliente_id INTO txt FROM public.fast_delivery_planta WHERE codigo_planta = 'SIM-PL-SEM';
    RESET ROLE;
    INSERT INTO _r VALUES (5,'operador LE o vinculo','1151687193', coalesce(txt,'(nulo)'),
        CASE WHEN txt = '1151687193' THEN 'PASS' ELSE 'FALHOU' END);

    -- 6. anon nao le
    SET LOCAL ROLE anon; bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.fast_delivery_planta;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (6,'anon NAO le','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 7. Planta sem vínculo continua válida. Imperatriz e Mogi estão assim hoje
    --    e precisam continuar cotando — o que falta é o cliente do card.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf)
            VALUES ('SIM-PL-NOVA', 'Nova Sem Vinculo', 'PR');
    EXCEPTION WHEN not_null_violation OR check_violation THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (7,'planta SEM vinculo e valida','criou',
        CASE WHEN bloqueou THEN 'recusou' ELSE 'criou' END,
        CASE WHEN bloqueou THEN 'FALHOU (exigiu vinculo)' ELSE 'PASS' END);

    -- 8. Nenhuma planta REAL mudou.
    SELECT count(*) INTO divergentes FROM (
        SELECT codigo_planta, cidade, uf, pipefy_cliente_id, pipefy_cliente_nome FROM _antes
        EXCEPT
        SELECT codigo_planta, cidade, uf, pipefy_cliente_id, pipefy_cliente_nome
          FROM public.fast_delivery_planta WHERE codigo_planta NOT LIKE 'SIM-%'
    ) d;
    INSERT INTO _r VALUES (8,'nenhuma planta real foi alterada','0 divergencia(s)',
        divergentes || ' divergencia(s)',
        CASE WHEN divergentes = 0 THEN 'PASS' ELSE 'FALHOU (mexeu em dado real!)' END);

    -- 9. O que o ROLLBACK desfaz.
    SELECT count(*) INTO n FROM public.fast_delivery_planta WHERE codigo_planta LIKE 'SIM-%';
    INSERT INTO _r VALUES (9,'linhas de teste criadas (o ROLLBACK desfaz)','3 linha(s)', n || ' linha(s)',
        CASE WHEN n = 3 THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

-- ÚLTIMA query do arquivo: é esta que o SQL Editor mostra.
SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

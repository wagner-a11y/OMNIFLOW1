-- =====================================================================
-- Prova por simulação — coluna calc_mode em vehicle_configs
-- =====================================================================
-- A coluna é ADITIVA e não cria policy nenhuma: herda o controle de
-- vehicle_configs (leitura por authenticated, escrita só master). O que precisa
-- ser provado é que ela NÃO ABRIU BURACO e que a regra de escrita continua de pé
-- com o campo novo no meio.
--
-- Transacional, termina em ROLLBACK: nem a coluna nem as alterações ficam.
--
-- Casos:
--   1. Master GRAVA calc_mode='KM' com a tarifa                 -> PASS
--   2. Operador LÊ o calc_mode (a calculadora precisa ler)      -> PASS
--   3. Operador NÃO altera calc_mode (escrita é só master)      -> bloqueado
--   4. anon NÃO lê vehicle_configs                              -> bloqueado
--   5. anon NÃO altera calc_mode                                -> bloqueado
--   6. CHECK barra modo fora do vocabulário                     -> bloqueado
--   7. Operador NÃO apaga veículo (DELETE segue só master)      -> bloqueado
--   8. Veículo não tocado permanece 'ANTT' (default)            -> PASS
-- =====================================================================
BEGIN;

ALTER TABLE public.vehicle_configs
    ADD COLUMN IF NOT EXISTS calc_mode text NOT NULL DEFAULT 'ANTT';
ALTER TABLE public.vehicle_configs
    DROP CONSTRAINT IF EXISTS vehicle_configs_calc_mode_check;
ALTER TABLE public.vehicle_configs
    ADD CONSTRAINT vehicle_configs_calc_mode_check
    CHECK (calc_mode IN ('KM', 'ANTT', 'FREE'));

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text);

DO $do$
DECLARE
    m uuid; a uuid; n int; bloqueou boolean; modo text; fator numeric;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role = 'master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role = 'operador' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Simulacao precisa de >=1 master e >=1 operador em profiles';
    END IF;

    -- 1. Master grava o modo KM com a tarifa
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.vehicle_configs SET calc_mode = 'KM', factor = 1.50 WHERE vehicle_type = 'Fiorino';
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (1, 'master GRAVA calc_mode=KM + tarifa', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 2. Operador lê (a calculadora precisa do modo e da tarifa)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT calc_mode, factor INTO modo, fator FROM public.vehicle_configs WHERE vehicle_type = 'Fiorino';
    RESET ROLE;
    INSERT INTO _r VALUES (2, 'operador LE calc_mode e tarifa', 'KM / 1.50',
        coalesce(modo,'null') || ' / ' || coalesce(fator::text,'null'),
        CASE WHEN modo = 'KM' AND fator = 1.50 THEN 'PASS' ELSE 'FALHOU' END);

    -- 3. Operador NÃO altera (escrita é só master)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        UPDATE public.vehicle_configs SET calc_mode = 'ANTT', factor = 99 WHERE vehicle_type = 'Fiorino';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (3, 'operador NAO altera calc_mode', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (alterou!)' END);

    -- 4. anon NÃO lê
    SET LOCAL ROLE anon;
    bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.vehicle_configs;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (4, 'anon NAO le vehicle_configs', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 5. anon NÃO altera
    SET LOCAL ROLE anon;
    bloqueou := false;
    BEGIN
        UPDATE public.vehicle_configs SET calc_mode = 'KM' WHERE vehicle_type = 'Van';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (5, 'anon NAO altera calc_mode', 'bloqueado',
        CASE WHEN bloqueou THEN 'barrado' ELSE 'ALTEROU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 6. CHECK barra modo inválido
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false;
    BEGIN
        UPDATE public.vehicle_configs SET calc_mode = 'QUALQUER' WHERE vehicle_type = 'Van';
    EXCEPTION WHEN check_violation THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (6, 'CHECK barra modo invalido', 'bloqueado',
        CASE WHEN bloqueou THEN 'check_violation' ELSE 'ACEITOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 7. Operador NÃO apaga veículo
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.vehicle_configs WHERE vehicle_type = 'Van';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (7, 'operador NAO apaga veiculo', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou!)' END);

    -- 8. Veículo não tocado fica no default 'ANTT'
    SELECT calc_mode INTO modo FROM public.vehicle_configs WHERE vehicle_type = 'truck';
    INSERT INTO _r VALUES (8, 'veiculo nao tocado fica ANTT (default)', 'ANTT', coalesce(modo,'null'),
        CASE WHEN modo = 'ANTT' THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

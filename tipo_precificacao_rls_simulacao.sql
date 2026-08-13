-- =====================================================================
-- Prova por simulação da RLS — coluna tipo_precificacao
-- =====================================================================
-- A coluna é ADITIVA numa tabela existente e não cria policy nenhuma: ela herda
-- o controle de acesso de freight_calculations. Por isso o que precisa ser
-- provado NÃO é "a coluna tem RLS", e sim que ela NÃO ABRIU BURACO:
--   - quem já podia ler/gravar cotação continua podendo, agora com o campo;
--   - quem NÃO podia (anon) continua barrado;
--   - a regra de DELETE (só master) segue de pé com a coluna presente.
--
-- Roda com a coluna já adicionada (a migration é idempotente e é aplicada aqui
-- dentro, dentro da transação). É transacional e termina em ROLLBACK: nem a
-- coluna nem as linhas de teste ficam.
--
-- Casos:
--   1. Operador GRAVA cotação tabelada (tipo_precificacao='tabelado')  -> PASS
--   2. Operador LÊ de volta o campo gravado                            -> PASS
--   3. Operador GRAVA cotação normal (tipo_precificacao NULL)          -> PASS
--   4. anon NÃO lê cotação (com a coluna presente)                     -> bloqueado
--   5. anon NÃO grava cotação tabelada                                 -> bloqueado
--   6. Operador NÃO apaga (DELETE segue só master)                     -> bloqueado
--   7. Master APAGA (regra preservada)                                 -> PASS
--   8. Operador EDITA o tipo_precificacao de uma cotação               -> PASS
--   9. O filtro de controle enxerga só as tabeladas                    -> PASS
-- =====================================================================
BEGIN;

-- DDL idêntico ao de migrations_tipo_precificacao.sql
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS tipo_precificacao text;
CREATE INDEX IF NOT EXISTS idx_fc_tipo_precificacao_tabelado
    ON public.freight_calculations (created_at DESC)
    WHERE tipo_precificacao = 'tabelado';

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text);

DO $do$
DECLARE
    m uuid; a uuid; n int; bloqueou boolean; tp text; cli text;
    id_tab text := 'SIM-TABELADO-1';
    id_nor text := 'SIM-NORMAL-1';
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role = 'master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role = 'operador' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Simulacao precisa de >=1 master e >=1 operador em profiles';
    END IF;
    -- customer_id tem FK para customers: usa um cliente real (a simulacao da rollback).
    SELECT id INTO cli FROM public.customers ORDER BY created_at LIMIT 1;
    IF cli IS NULL THEN RAISE EXCEPTION 'Simulacao precisa de >=1 cliente em customers'; END IF;

    -- 1. Operador grava cotação TABELADA
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.freight_calculations
        (id, proposal_number, origin, destination, distance_km, vehicle_type, merchandise_type,
         weight, customer_id, suggested_freight, base_freight, tolls, extra_costs, goods_value,
         insurance_percent, ad_valorem, profit_margin, icms_percent, pis_percent, cofins_percent,
         csll_percent, irpj_percent, total_freight, created_at, disponibilidade, status,
         created_by, tipo_precificacao)
        VALUES (id_tab, 'SIM-T1', 'Vitória, ES', 'Serra, ES', 0, 'Truck', 'Diversos',
         0, cli, 0, 5000, 0, 0, 0, 0, 0, 20, 12, 0.65, 3, 1.08, 1.2, 7852.98,
         (extract(epoch from now())*1000)::bigint, 'Imediato', 'pending', a, 'tabelado');
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (1, 'operador GRAVA cotacao tabelada', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 2. Operador lê de volta o campo
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT tipo_precificacao INTO tp FROM public.freight_calculations WHERE id = id_tab;
    RESET ROLE;
    INSERT INTO _r VALUES (2, 'operador LE o tipo_precificacao', 'tabelado', coalesce(tp, '(null)'),
        CASE WHEN tp = 'tabelado' THEN 'PASS' ELSE 'FALHOU' END);

    -- 3. Operador grava cotação NORMAL (coluna nula)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.freight_calculations
        (id, proposal_number, origin, destination, distance_km, vehicle_type, merchandise_type,
         weight, customer_id, suggested_freight, base_freight, tolls, extra_costs, goods_value,
         insurance_percent, ad_valorem, profit_margin, icms_percent, pis_percent, cofins_percent,
         csll_percent, irpj_percent, total_freight, created_at, disponibilidade, status, created_by)
        VALUES (id_nor, 'SIM-N1', 'São Paulo, SP', 'Rio de Janeiro, RJ', 437.345, 'Truck', 'Diversos',
         0, cli, 3573.14, 5000, 328.50, 0, 0, 0, 0, 20, 12, 0.65, 3, 1.08, 1.2, 7852.98,
         (extract(epoch from now())*1000)::bigint, 'Imediato', 'pending', a);
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT tipo_precificacao INTO tp FROM public.freight_calculations WHERE id = id_nor;
    RESET ROLE;
    INSERT INTO _r VALUES (3, 'operador GRAVA cotacao normal (campo nulo)', '1 linha, null',
        n || ' linha(s), ' || coalesce(tp, 'null'),
        CASE WHEN n = 1 AND tp IS NULL THEN 'PASS' ELSE 'FALHOU' END);

    -- 4. anon NÃO lê
    SET LOCAL ROLE anon;
    bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.freight_calculations WHERE id = id_tab;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (4, 'anon NAO le cotacao', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 5. anon NÃO grava
    SET LOCAL ROLE anon;
    bloqueou := false;
    BEGIN
        INSERT INTO public.freight_calculations (id, proposal_number, origin, destination, distance_km,
            vehicle_type, merchandise_type, weight, customer_id, suggested_freight, base_freight, tolls,
            extra_costs, goods_value, insurance_percent, ad_valorem, profit_margin, icms_percent,
            pis_percent, cofins_percent, csll_percent, irpj_percent, total_freight, created_at,
            disponibilidade, status, tipo_precificacao)
            VALUES ('SIM-ANON', 'SIM-A', 'x', 'y', 0, 'Truck', '', 0, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0,
             0, 0, 0, 0, 0, (extract(epoch from now())*1000)::bigint, 'Imediato', 'pending', 'tabelado');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (5, 'anon NAO grava tabelada', 'bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (inseriu!)' END);

    -- 6. Operador NÃO apaga (DELETE é só master — regra anterior preservada)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.freight_calculations WHERE id = id_tab;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1;
    END;
    RESET ROLE;
    INSERT INTO _r VALUES (6, 'operador NAO apaga (DELETE so master)', 'bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou!)' END);

    -- 7. Master apaga (regra preservada)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.freight_calculations WHERE id = id_nor;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (7, 'master APAGA (regra preservada)', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 8. Operador edita o campo
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.freight_calculations SET tipo_precificacao = NULL WHERE id = id_tab;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.freight_calculations SET tipo_precificacao = 'tabelado' WHERE id = id_tab;
    RESET ROLE;
    INSERT INTO _r VALUES (8, 'operador EDITA o tipo_precificacao', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 9. O filtro de controle enxerga só as tabeladas
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.freight_calculations WHERE tipo_precificacao = 'tabelado' AND id = id_tab;
    RESET ROLE;
    INSERT INTO _r VALUES (9, 'filtro de controle acha a tabelada', '1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

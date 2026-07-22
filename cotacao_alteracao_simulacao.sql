-- Prova de IMUTABILIDADE + RLS da auditoria (cotacao_alteracao). Transacional -> ROLLBACK.
-- Casos:
--  1. Operador insere como ELE MESMO                         -> PASS
--  2. Operador NÃO insere com alterado_por de outro (spoof)  -> bloqueado (WITH CHECK)
--  3. Operador NÃO lê (não é master)                         -> 0 linhas
--  4. Master LÊ                                              -> vê
--  5. Operador NÃO faz UPDATE (sem policy)                   -> 0 linhas
--  6. Master NÃO faz UPDATE (sem policy)                     -> 0 linhas
--  7. Operador NÃO faz DELETE                                -> 0 linhas
--  8. Master NÃO faz DELETE                                  -> 0 linhas
--  9. Superuser/API NÃO faz UPDATE (trigger)                 -> EXCEPTION
-- 10. Superuser/API NÃO faz DELETE (trigger)                 -> EXCEPTION
BEGIN;
CREATE TEMP TABLE sim_out(n int, caso text, resultado text) ON COMMIT DROP;

DO $$
DECLARE m uuid; a uuid; b uuid; seed uuid; n int; pass boolean;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role='master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role='operador' ORDER BY created_at LIMIT 1;
    SELECT id INTO b FROM public.profiles WHERE role='operador' AND id<>a ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN RAISE EXCEPTION 'precisa de >=1 master e >=1 operador'; END IF;

    -- seed como superuser (insert é permitido; só update/delete são bloqueados)
    seed := gen_random_uuid();
    INSERT INTO public.cotacao_alteracao (id, cotacao_id, alterado_por, alterado_por_nome, status_no_momento, mudancas)
        VALUES (seed, 'SIM-COT', a, 'Operador A', 'won', '[{"campo":"status","de":"pending","para":"won"}]'::jsonb);

    -- 1. operador insere como ele mesmo
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.cotacao_alteracao (cotacao_id, alterado_por, alterado_por_nome, mudancas)
        VALUES ('SIM-COT', a, 'Operador A', '[{"campo":"baseFreight","de":100,"para":200}]'::jsonb);
    RESET ROLE;
    INSERT INTO sim_out VALUES (1,'Operador insere como ele mesmo','PASS');

    -- 2. operador tenta inserir com alterado_por = master (spoof)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; pass:=false;
    BEGIN
        INSERT INTO public.cotacao_alteracao (cotacao_id, alterado_por, mudancas)
            VALUES ('SIM-COT', m, '[{"campo":"x"}]'::jsonb);
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN pass:=true; END;
    RESET ROLE;
    INSERT INTO sim_out VALUES (2,'Operador NAO insere com autor forjado', CASE WHEN pass THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 3. operador nao le
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM public.cotacao_alteracao; RESET ROLE;
    INSERT INTO sim_out VALUES (3,'Operador NAO le (nao master)', CASE WHEN n=0 THEN 'PASS (0 linhas)' ELSE 'FALHOU ('||n||')' END);

    -- 4. master le
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM public.cotacao_alteracao; RESET ROLE;
    INSERT INTO sim_out VALUES (4,'Master LE', CASE WHEN n>=1 THEN 'PASS (le '||n||')' ELSE 'FALHOU' END);

    -- 5. operador update -> 0 linhas (sem policy)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.cotacao_alteracao SET mudancas='[]'::jsonb WHERE id=seed; GET DIAGNOSTICS n=ROW_COUNT;
    RESET ROLE;
    INSERT INTO sim_out VALUES (5,'Operador NAO faz UPDATE', CASE WHEN n=0 THEN 'PASS (0 linhas)' ELSE 'FALHOU ('||n||')' END);

    -- 6. master update -> 0 linhas (sem policy)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.cotacao_alteracao SET mudancas='[]'::jsonb WHERE id=seed; GET DIAGNOSTICS n=ROW_COUNT;
    RESET ROLE;
    INSERT INTO sim_out VALUES (6,'Master NAO faz UPDATE (sem policy)', CASE WHEN n=0 THEN 'PASS (0 linhas)' ELSE 'FALHOU ('||n||')' END);

    -- 7. operador delete -> 0 linhas
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.cotacao_alteracao WHERE id=seed; GET DIAGNOSTICS n=ROW_COUNT;
    RESET ROLE;
    INSERT INTO sim_out VALUES (7,'Operador NAO faz DELETE', CASE WHEN n=0 THEN 'PASS (0 linhas)' ELSE 'FALHOU ('||n||')' END);

    -- 8. master delete -> 0 linhas
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.cotacao_alteracao WHERE id=seed; GET DIAGNOSTICS n=ROW_COUNT;
    RESET ROLE;
    INSERT INTO sim_out VALUES (8,'Master NAO faz DELETE (sem policy)', CASE WHEN n=0 THEN 'PASS (0 linhas)' ELSE 'FALHOU ('||n||')' END);

    -- 9. superuser/API UPDATE -> trigger RAISE
    pass:=false;
    BEGIN
        UPDATE public.cotacao_alteracao SET mudancas='[]'::jsonb WHERE id=seed;
    EXCEPTION WHEN others THEN pass:=true; END;
    INSERT INTO sim_out VALUES (9,'Superuser/API NAO faz UPDATE (trigger)', CASE WHEN pass THEN 'PASS (exception)' ELSE 'FALHOU (passou!)' END);

    -- 10. superuser/API DELETE -> trigger RAISE
    pass:=false;
    BEGIN
        DELETE FROM public.cotacao_alteracao WHERE id=seed;
    EXCEPTION WHEN others THEN pass:=true; END;
    INSERT INTO sim_out VALUES (10,'Superuser/API NAO faz DELETE (trigger)', CASE WHEN pass THEN 'PASS (exception)' ELSE 'FALHOU (passou!)' END);
END $$;

SELECT n, caso, resultado FROM sim_out ORDER BY n;
ROLLBACK;

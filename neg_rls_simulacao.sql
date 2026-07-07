-- =====================================================================
-- Prova por simulação da RLS — Acompanhamento de Negociações (Camada 1)
-- =====================================================================
-- Roda no SQL Editor do Supabase DEPOIS de aplicar migrations_neg_acompanhamento_c1.sql.
-- É transacional e termina em ROLLBACK: NÃO grava nada, só imprime PASS/FAIL.
--
-- Impersona 3 usuários reais de profiles (1 master, 2 operadores) alternando
-- request.jwt.claims + role authenticated, exatamente como o PostgREST faz.
-- Regras provadas:
--   1. Operador A insere a própria negociação (dono=A)            -> PASS
--   2. Operador A NÃO consegue inserir com dono=B (spoof)         -> bloqueado
--   3. Operador B LÊ a negociação de A (transparência de time)    -> PASS
--   4. Operador B NÃO edita a negociação de A (0 linhas)          -> bloqueado
--   5. Operador A edita a própria negociação (1 linha)            -> PASS
--   6. Operador B NÃO registra follow-up na negociação de A       -> bloqueado
--   7. Operador A registra follow-up na própria                  -> PASS
--   8. Master edita a negociação de A                            -> PASS
--   9. Operador B LÊ o follow-up (transparência)                 -> PASS
-- =====================================================================
BEGIN;
DO $$
DECLARE
    m uuid; a uuid; b uuid; neg uuid; n int;
    pass boolean;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role = 'master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role = 'operador' ORDER BY created_at LIMIT 1;
    SELECT id INTO b FROM public.profiles WHERE role = 'operador' AND id <> a ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL OR b IS NULL THEN
        RAISE EXCEPTION 'Simulação precisa de >=1 master e >=2 operadores em profiles (m=%, a=%, b=%)', m, a, b;
    END IF;
    RAISE NOTICE '== atores: master=% operadorA=% operadorB=% ==', m, a, b;

    -- ---- 1. A insere a própria negociação (dono=A) ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.neg_negociacao (cotacao_id, dono_id, dono_nome, proximo_contato)
        VALUES ('SIM-COT-1', a, 'Operador A', current_date) RETURNING id INTO neg;
    RESET ROLE;
    RAISE NOTICE '1) A insere propria negociacao ............ PASS (id=%)', neg;

    -- ---- 2. A tenta inserir com dono=B (spoof) -> deve ser BLOQUEADO ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    pass := false;
    BEGIN
        INSERT INTO public.neg_negociacao (cotacao_id, dono_id, dono_nome, proximo_contato)
            VALUES ('SIM-COT-SPOOF', b, 'Operador B', current_date);
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        pass := true;  -- RLS WITH CHECK barrou
    END;
    RESET ROLE;
    RAISE NOTICE '2) A NAO insere com dono=B (spoof) ........ %', CASE WHEN pass THEN 'PASS (bloqueado)' ELSE 'FALHOU (deixou passar!)' END;

    -- ---- 3. B lê a negociação de A (transparência) ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.neg_negociacao WHERE id = neg;
    RESET ROLE;
    RAISE NOTICE '3) B le a negociacao de A ................. %', CASE WHEN n = 1 THEN 'PASS (le)' ELSE 'FALHOU (nao viu)' END;

    -- ---- 4. B tenta editar a negociação de A -> 0 linhas (RLS USING) ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.neg_negociacao SET fechada_motivo = 'hack' WHERE id = neg;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE '4) B NAO edita a negociacao de A .......... %', CASE WHEN n = 0 THEN 'PASS (0 linhas)' ELSE 'FALHOU (editou!)' END;

    -- ---- 5. A edita a própria negociação -> 1 linha ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.neg_negociacao SET proximo_contato = current_date + 1 WHERE id = neg;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE '5) A edita a propria negociacao ........... %', CASE WHEN n = 1 THEN 'PASS (1 linha)' ELSE 'FALHOU' END;

    -- ---- 6. B tenta follow-up na negociação de A -> BLOQUEADO ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    pass := false;
    BEGIN
        INSERT INTO public.neg_followup (negociacao_id, autor_id, autor_nome, descricao)
            VALUES (neg, b, 'Operador B', 'tentativa indevida');
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        pass := true;
    END;
    RESET ROLE;
    RAISE NOTICE '6) B NAO faz follow-up na de A ............ %', CASE WHEN pass THEN 'PASS (bloqueado)' ELSE 'FALHOU (deixou passar!)' END;

    -- ---- 7. A registra follow-up na própria -> PASS ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.neg_followup (negociacao_id, autor_id, autor_nome, descricao, proximo_contato)
        VALUES (neg, a, 'Operador A', 'Liguei, retomar semana que vem', current_date + 3);
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE '7) A faz follow-up na propria ............. %', CASE WHEN n = 1 THEN 'PASS (1 linha)' ELSE 'FALHOU' END;

    -- ---- 8. Master edita a negociação de A -> PASS ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.neg_negociacao SET status = 'ganha', fechada_em = now(), fechada_origem = 'manual' WHERE id = neg;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE '8) Master edita a negociacao de A ......... %', CASE WHEN n = 1 THEN 'PASS (1 linha)' ELSE 'FALHOU' END;

    -- ---- 9. B lê o follow-up (transparência) ----
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.neg_followup WHERE negociacao_id = neg;
    RESET ROLE;
    RAISE NOTICE '9) B le o follow-up (transparencia) ....... %', CASE WHEN n >= 1 THEN 'PASS (le)' ELSE 'FALHOU' END;

    RAISE NOTICE '== fim da simulacao (ROLLBACK a seguir, nada foi gravado) ==';
END $$;
ROLLBACK;

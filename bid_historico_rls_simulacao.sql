-- =====================================================================
-- Prova por simulação da RLS e das travas — Bid em Lote, histórico
-- =====================================================================
-- Roda no SQL Editor do Supabase DEPOIS de aplicar migrations_bid_historico.sql.
--
-- O SQL Editor só mostra o resultado do ÚLTIMO comando, então o último
-- comando é um SELECT que devolve UMA LINHA POR CASO (01 a 22), mais o total
-- e a conferência de relrowsecurity.
--
-- NADA FICA GRAVADO: os casos rodam dentro de um bloco que termina num erro
-- proposital (SIMULACAO_DESFEITA). O PL/pgSQL desfaz a subtransação inteira
-- — inserts, updates, trocas de papel — e só as variáveis com o resultado
-- sobrevivem para o SELECT. A função é TEMPORÁRIA (pg_temp): some sozinha
-- quando a sessão do SQL Editor fecha.
--
-- Um erro INESPERADO (não previsto em nenhum caso) não é engolido: aparece
-- como erro no SQL Editor e, do mesmo jeito, nada fica gravado.
--
-- Impersona usuários reais de profiles (1 master, 2 operadores) trocando
-- request.jwt.claims + role, exatamente como o PostgREST faz, e também anon.
-- =====================================================================
CREATE OR REPLACE FUNCTION pg_temp.bid_simulacao()
RETURNS TABLE (ordem int, resultado text)
LANGUAGE plpgsql AS $$
DECLARE
    m uuid; a uuid; b uuid;
    r jsonb; v_bid uuid; v_rod1 uuid; v_rod2 uuid;
    v_versao bigint; v_versao_velha bigint;
    n int; ok boolean; nome_teste text := 'SIM Bid Histórico ' || gen_random_uuid();
    res text[] := '{}';
BEGIN
    BEGIN
        SELECT id INTO m FROM public.profiles WHERE role = 'master'   ORDER BY created_at LIMIT 1;
        SELECT id INTO a FROM public.profiles WHERE role = 'operador' ORDER BY created_at LIMIT 1;
        SELECT id INTO b FROM public.profiles WHERE role = 'operador' AND id <> a ORDER BY created_at LIMIT 1;
        IF m IS NULL OR a IS NULL OR b IS NULL THEN
            RAISE EXCEPTION 'Simulação precisa de >=1 master e >=2 operadores em profiles (m=%, a=%, b=%)', m, a, b;
        END IF;
        res := res || format('== atores: master=%s operadorA=%s operadorB=%s ==', m, a, b);

        -- ---- 01. A cria bid + Rodada 1 ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        r := public.bid_criar(nome_teste, 'Cliente SIM', 'obs');
        v_bid := (r->>'bid_id')::uuid; v_rod1 := (r->>'rodada_id')::uuid;
        SELECT count(*) INTO n FROM public.bid WHERE id = v_bid AND criado_por = a AND atualizado_por = a;
        SELECT versao INTO v_versao FROM public.bid_rodada WHERE id = v_rod1;
        RESET ROLE;
        res := res || format('01) A cria bid + Rodada 1 (autoria A, versão 1) ..... %s', CASE WHEN n = 1 AND v_versao = 1 THEN 'PASS' ELSE 'FALHOU' END);

        -- ---- 02. B cria bid com o mesmo nome em MAIÚSCULAS -> recusado ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            PERFORM public.bid_criar('  ' || upper(nome_teste) || ' ', NULL, NULL);
        EXCEPTION WHEN unique_violation THEN ok := true;
        END;
        RESET ROLE;
        res := res || format('02) Nome duplicado (maiúsculas/espaços) recusado .... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU (deixou passar!)' END);

        -- ---- 03. B tenta forjar criado_por = A num insert direto -> banco corrige ----
        SET LOCAL ROLE authenticated;
        INSERT INTO public.bid (nome, criado_por, atualizado_por) VALUES (nome_teste || ' spoof', a, a);
        SELECT count(*) INTO n FROM public.bid WHERE nome = nome_teste || ' spoof' AND criado_por = b;
        RESET ROLE;
        res := res || format('03) Autoria forjada é sobrescrita por auth.uid() .... %s', CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

        -- ---- 04. A salva a Rodada 1 com a versão certa (3 linhas) ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        v_versao_velha := v_versao;  -- a versão que A e B abriram
        r := public.bid_salvar_rodada(v_rod1, v_versao, '{"margem": 15}'::jsonb,
            '[{"chave_linha":"linha-2","ordem":1,"entrada":{"origem":"São Paulo, SP"},"resultado":{"precoOfertado":5501.34}},
              {"chave_linha":"linha-3","ordem":2,"entrada":{"origem":"Campinas, SP"},"resultado":{"precoOfertado":4836.36}},
              {"chave_linha":"linha-4","ordem":3,"entrada":{"origem":"Santos, SP"},"resultado":{"precoOfertado":1000}}]'::jsonb,
            '{}'::text[]);
        SELECT count(*) INTO n FROM public.bid_rodada_linha WHERE rodada_id = v_rod1;
        v_versao := (r->>'versao')::bigint;
        RESET ROLE;
        res := res || format('04) A salva rodada (versão 1 -> 2, 3 linhas) ........ %s', CASE WHEN (r->>'ok')::boolean AND n = 3 AND v_versao = 2 THEN 'PASS' ELSE 'FALHOU ' || r::text END);

        -- ---- 05. B salva com a versão INTEIRA velha (1) -> conflito, nada gravado ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        r := public.bid_salvar_rodada(v_rod1, v_versao_velha, '{"margem": 99}'::jsonb,
            '[{"chave_linha":"linha-2","ordem":1,"entrada":{"origem":"SOBRESCRITO"},"resultado":{}}]'::jsonb,
            ARRAY['linha-3']);
        SELECT count(*) INTO n FROM public.bid_rodada_linha
         WHERE rodada_id = v_rod1 AND (entrada->>'origem' = 'SOBRESCRITO' OR chave_linha = 'linha-3');
        RESET ROLE;
        res := res || format('05) Conflito com versão velha: nada sobrescrito ...... %s',
            CASE WHEN r->>'conflito' = 'true' AND n = 1 AND (r->>'atualizado_por')::uuid = a AND (r->>'versao')::bigint = 2
                 THEN 'PASS (alterada por ' || coalesce(r->>'atualizado_por_nome', '?') || ', versão ' || (r->>'versao') || ')' ELSE 'FALHOU ' || r::text END);

        -- ---- 06. A remove uma linha da rodada em rascunho (pelo salvar) ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        r := public.bid_salvar_rodada(v_rod1, v_versao, NULL, '[]'::jsonb, ARRAY['linha-4']);
        v_versao := (r->>'versao')::bigint;
        SELECT count(*) INTO n FROM public.bid_rodada_linha WHERE rodada_id = v_rod1;
        RESET ROLE;
        res := res || format('06) Apagar linha em rascunho (salvar) ............... %s', CASE WHEN (r->>'ok')::boolean AND n = 2 THEN 'PASS' ELSE 'FALHOU ' || r::text END);

        -- ---- 07. DELETE direto de linha em rascunho -> passa ----
        SET LOCAL ROLE authenticated;
        INSERT INTO public.bid_rodada_linha (rodada_id, ordem, chave_linha, entrada) VALUES (v_rod1, 9, 'linha-9', '{}'::jsonb);
        DELETE FROM public.bid_rodada_linha WHERE rodada_id = v_rod1 AND chave_linha = 'linha-9';
        GET DIAGNOSTICS n = ROW_COUNT;
        RESET ROLE;
        res := res || format('07) DELETE direto de linha em rascunho .............. %s', CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

        -- ---- 08. Reimportar: substitui TODAS as linhas, atômico ----
        SET LOCAL ROLE authenticated;
        r := public.bid_substituir_linhas(v_rod1, v_versao, NULL,
            '[{"chave_linha":"linha-2","ordem":1,"entrada":{"origem":"Vitória, ES"},"resultado":{"precoOfertado":3000}},
              {"chave_linha":"linha-3","ordem":2,"entrada":{"origem":"Serra, ES"},"resultado":{"precoOfertado":3100}}]'::jsonb);
        v_versao := (r->>'versao')::bigint;
        SELECT count(*) INTO n FROM public.bid_rodada_linha WHERE rodada_id = v_rod1 AND entrada->>'origem' IN ('Vitória, ES', 'Serra, ES');
        RESET ROLE;
        res := res || format('08) Reimportar substitui todas as linhas ............ %s', CASE WHEN (r->>'ok')::boolean AND n = 2 THEN 'PASS' ELSE 'FALHOU ' || r::text END);

        -- ---- 09. Nova rodada com a Rodada 1 ainda em rascunho -> recusado ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            PERFORM public.bid_nova_rodada(v_bid);
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_ABERTA%';
        END;
        RESET ROLE;
        res := res || format('09) Nova rodada com a última em rascunho: recusada .. %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 10. A fecha a Rodada 1 ----
        SET LOCAL ROLE authenticated;
        r := public.bid_mudar_status_rodada(v_rod1, v_versao, 'fechada');
        v_versao := (r->>'versao')::bigint;
        SELECT count(*) INTO n FROM public.bid_rodada WHERE id = v_rod1 AND status = 'fechada' AND fechada_por = a AND fechada_em IS NOT NULL;
        RESET ROLE;
        res := res || format('10) A fecha a rodada (fechada_por = A) .............. %s', CASE WHEN (r->>'ok')::boolean AND n = 1 THEN 'PASS' ELSE 'FALHOU ' || r::text END);

        -- ---- 11. Linha da rodada fechada: UPDATE direto -> recusado ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            UPDATE public.bid_rodada_linha SET entrada = '{"origem":"x"}'::jsonb WHERE rodada_id = v_rod1;
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_FECHADA%';
        END;
        RESET ROLE;
        res := res || format('11) UPDATE em linha de rodada fechada: recusado ..... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 12. Linha nova na rodada fechada -> recusado ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            INSERT INTO public.bid_rodada_linha (rodada_id, ordem, chave_linha, entrada) VALUES (v_rod1, 9, 'linha-9', '{}'::jsonb);
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_FECHADA%';
        END;
        RESET ROLE;
        res := res || format('12) INSERT de linha em rodada fechada: recusado ..... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 13. Apagar linha da rodada fechada (direto, pelo salvar e reimportando) -> recusado ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            DELETE FROM public.bid_rodada_linha WHERE rodada_id = v_rod1;
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_FECHADA%';
        END;
        IF ok THEN
            ok := false;
            BEGIN
                PERFORM public.bid_salvar_rodada(v_rod1, v_versao, NULL, '[]'::jsonb, ARRAY['linha-2']);
            EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_FECHADA%';
            END;
        END IF;
        IF ok THEN
            ok := false;
            BEGIN
                PERFORM public.bid_substituir_linhas(v_rod1, v_versao, NULL, '[]'::jsonb);
            EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_FECHADA%';
            END;
        END IF;
        SELECT count(*) INTO n FROM public.bid_rodada_linha WHERE rodada_id = v_rod1;
        RESET ROLE;
        res := res || format('13) Apagar linha de rodada fechada: recusado ........ %s', CASE WHEN ok AND n = 2 THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 14. Parâmetros da rodada fechada -> recusado ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            UPDATE public.bid_rodada SET parametros = '{"margem": 1}'::jsonb WHERE id = v_rod1;
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_FECHADA%';
        END;
        RESET ROLE;
        res := res || format('14) Parâmetros de rodada fechada: recusados ......... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 15. Operador tenta reabrir -> recusado ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            PERFORM public.bid_mudar_status_rodada(v_rod1, v_versao, 'rascunho');
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'SO_MASTER%';
        END;
        RESET ROLE;
        res := res || format('15) Operador reabre rodada fechada: recusado ........ %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 16. A abre a Rodada 2: cópia fiel de parâmetros e linhas ----
        SET LOCAL ROLE authenticated;
        r := public.bid_nova_rodada(v_bid);
        v_rod2 := (r->>'rodada_id')::uuid;
        SELECT count(*) INTO n FROM public.bid_rodada_linha l2
          JOIN public.bid_rodada_linha l1 ON l1.rodada_id = v_rod1 AND l1.chave_linha = l2.chave_linha
         WHERE l2.rodada_id = v_rod2 AND l2.entrada = l1.entrada AND l2.resultado = l1.resultado AND l2.ordem = l1.ordem;
        ok := n = 2 AND (r->>'numero')::int = 2
            AND (SELECT parametros FROM public.bid_rodada WHERE id = v_rod2) = (SELECT parametros FROM public.bid_rodada WHERE id = v_rod1);
        RESET ROLE;
        res := res || format('16) Rodada 2 = cópia fiel (linhas, parâmetros) ...... %s', CASE WHEN ok THEN 'PASS' ELSE 'FALHOU ' || r::text END);

        -- ---- 17. Master tenta reabrir a Rodada 1 (existe a 2) -> RODADA_ANTIGA ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            PERFORM public.bid_mudar_status_rodada(v_rod1, v_versao, 'rascunho');
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'RODADA_ANTIGA%';
        END;
        RESET ROLE;
        res := res || format('17) Master reabre rodada ANTIGA: recusado ........... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 18. A fecha a Rodada 2; master reabre a Rodada 2 (a última) ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        SELECT versao INTO v_versao FROM public.bid_rodada WHERE id = v_rod2;
        r := public.bid_mudar_status_rodada(v_rod2, v_versao, 'fechada');
        v_versao := (r->>'versao')::bigint;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        r := public.bid_mudar_status_rodada(v_rod2, v_versao, 'rascunho');
        SELECT count(*) INTO n FROM public.bid_rodada WHERE id = v_rod2 AND status = 'rascunho' AND fechada_por IS NULL;
        RESET ROLE;
        res := res || format('18) Master reabre a ÚLTIMA rodada ................... %s', CASE WHEN (r->>'ok')::boolean AND n = 1 THEN 'PASS' ELSE 'FALHOU ' || r::text END);

        -- ---- 19. Operador tenta exclusão lógica -> recusado ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            UPDATE public.bid SET deleted_at = now() WHERE id = v_bid;
        EXCEPTION WHEN others THEN ok := SQLERRM LIKE 'SO_MASTER%';
        END;
        RESET ROLE;
        res := res || format('19) Operador exclui bid: recusado ................... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 20. DELETE físico de bid e de rodada -> sem privilégio ----
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            DELETE FROM public.bid WHERE id = v_bid;
        EXCEPTION WHEN insufficient_privilege THEN ok := true;
        END;
        IF ok THEN
            ok := false;
            BEGIN
                DELETE FROM public.bid_rodada WHERE id = v_rod2;
            EXCEPTION WHEN insufficient_privilege THEN ok := true;
            END;
        END IF;
        RESET ROLE;
        res := res || format('20) DELETE de bid e de rodada: sem privilégio ....... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- ---- 21. Master exclui o bid (lógica); o nome volta a ficar livre ----
        PERFORM set_config('request.jwt.claims', json_build_object('sub', m::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.bid SET deleted_at = now() WHERE id = v_bid;
        SELECT count(*) INTO n FROM public.bid WHERE id = v_bid AND deleted_by = m;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        ok := false;
        BEGIN
            PERFORM public.bid_criar(nome_teste, NULL, NULL);
            ok := true;
        EXCEPTION WHEN unique_violation THEN ok := false;
        END;
        RESET ROLE;
        res := res || format('21) Master exclui (deleted_by = M); nome reutilizável %s', CASE WHEN n = 1 AND ok THEN 'PASS' ELSE 'FALHOU' END);

        -- ---- 22. anon (sem login) não lê nem grava ----
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        SET LOCAL ROLE anon;
        ok := false;
        BEGIN
            SELECT count(*) INTO n FROM public.bid;
        EXCEPTION WHEN insufficient_privilege THEN ok := true;
        END;
        IF ok THEN
            ok := false;
            BEGIN
                PERFORM public.bid_criar('anon', NULL, NULL);
            EXCEPTION WHEN insufficient_privilege THEN ok := true;
            END;
        END IF;
        RESET ROLE;
        res := res || format('22) anon não lê nem grava (42501) ................... %s', CASE WHEN ok THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

        -- Desfaz TUDO o que os casos gravaram. As variáveis (res) ficam.
        RAISE EXCEPTION 'SIMULACAO_DESFEITA';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'SIMULACAO_DESFEITA' THEN RAISE; END IF;
    END;
    RESET ROLE;

    res := res || format('TOTAL: %s PASS, %s FALHOU (de 22 casos)',
        (SELECT count(*) FROM unnest(res) x WHERE x ~ '^[0-9]{2}\)' AND x LIKE '%PASS%'),
        (SELECT count(*) FROM unnest(res) x WHERE x ~ '^[0-9]{2}\)' AND x NOT LIKE '%PASS%'));
    res := res || ARRAY(
        SELECT format('RLS %s: relrowsecurity = %s', relname, relrowsecurity)
          FROM pg_class
         WHERE relnamespace = 'public'::regnamespace
           AND relname IN ('bid', 'bid_rodada', 'bid_rodada_linha')
         ORDER BY relname);
    res := res || format('Gravado pela simulação (deve ser 0): %s bid(s) de teste',
        (SELECT count(*) FROM public.bid WHERE nome LIKE 'SIM Bid Histórico %'));
    RETURN QUERY SELECT i::int, res[i] FROM generate_subscripts(res, 1) AS i ORDER BY i;
END $$;

SELECT * FROM pg_temp.bid_simulacao();

-- =====================================================================
-- Prova por simulação — registro de envio (Pipefy/Ramper) na cotação
-- =====================================================================
-- Roda ANTES de aplicar a migration, no SQL Editor. Termina em ROLLBACK:
-- nada do que acontece aqui sobrevive.
--
-- Roda contra public.freight_calculations DE VERDADE, com as policies de
-- verdade (fc_select/fc_insert/fc_update/fc_delete, de migrations_rls_stage_d).
-- As colunas novas são criadas aqui dentro, então isto é também um ensaio da
-- migration sobre os dados reais.
--
-- A PERGUNTA CENTRAL É DIFERENTE DA DA CARROCERIA. Lá se provava que só master
-- escreve. Aqui é o contrário: marcar envio PRECISA funcionar para o operador,
-- porque quem clica em "→ Pipefy" é quem opera. O que não pode é anon escrever,
-- e a cotação não pode ser apagada por quem não é master.
--
-- E tem um caso que não é de permissão nenhuma, o 3: a trava anti-duplicação.
-- Ela é um UPDATE condicional (só marca se ainda não estiver marcado), e é o
-- que faz o segundo clique — ou o clique depois do F5 — não virar card novo.
--
-- O QUE PROTEGE OS DADOS REAIS
--   - ROLLBACK no fim; erro no meio aborta a transação e também desfaz.
--   - A cotação de teste usa id 'SIM-ENVIO-1', que não colide com id real
--     (os reais são epoch em ms + aleatório, só dígitos).
--   - Nenhum UPDATE/DELETE mira linha real: todos filtram por esse id.
--   - O caso 7 confere, com EXCEPT, que nenhuma cotação real mudou.
--
-- Casos:
--    0. A migration aplica sobre os dados reais                    -> PASS
--    1. Operador MARCA envio ao Ramper                             -> PASS
--    2. Operador MARCA envio ao Pipefy                             -> PASS
--    3. TRAVA: segunda marcação nao repete (0 linhas)              -> PASS
--    4. anon NAO le cotacao                                        -> bloqueado
--    5. anon NAO marca envio                                       -> bloqueado
--    6. Operador NAO apaga cotacao (delete e so master)            -> bloqueado
--    7. Nenhuma cotacao real foi alterada                          -> PASS
--    8. So 1 linha de teste criada                                 -> PASS
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Caso 0 — ensaio da migration sobre a tabela real.
-- ---------------------------------------------------------------------
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS ramper_sent_at        timestamptz,
    ADD COLUMN IF NOT EXISTS ramper_opportunity_id text;

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text) ON COMMIT DROP;

-- Retrato das cotações reais ANTES, restrito ao que esta simulação poderia
-- tocar. Comparado no caso 7.
CREATE TEMP TABLE _antes ON COMMIT DROP AS
    SELECT id, pipefy_card_id, pipefy_sent_at, ramper_sent_at, ramper_opportunity_id
      FROM public.freight_calculations
     WHERE id NOT LIKE 'SIM-%';

DO $do$
DECLARE
    a uuid; n int; bloqueou boolean; txt text;
    reais_antes int; divergentes int;
BEGIN
    SELECT count(*) INTO reais_antes FROM _antes;
    INSERT INTO _r VALUES (0, 'migration aplica sobre dados reais',
        'sem erro', reais_antes || ' cotacao(oes) reais intactas', 'PASS');

    -- Um usuário NÃO-master: é ele quem opera o botão de enviar.
    SELECT id INTO a FROM public.profiles WHERE role IS DISTINCT FROM 'master' ORDER BY created_at LIMIT 1;
    IF a IS NULL THEN RAISE EXCEPTION 'Precisa de >=1 usuario nao-master em public.profiles'; END IF;

    -- Cotação de teste, criada como dono da tabela (fora das policies).
    -- customer_id NULL de proposito: nao depende de customers existir.
    INSERT INTO public.freight_calculations
        (id, proposal_number, origin, destination, distance_km, vehicle_type, merchandise_type,
         weight, customer_id, suggested_freight, base_freight, tolls, extra_costs, goods_value,
         insurance_percent, ad_valorem, profit_margin, icms_percent, pis_percent, cofins_percent,
         csll_percent, irpj_percent, total_freight, created_at, disponibilidade, status,
         operacao, tipo_precificacao)
        VALUES ('SIM-ENVIO-1', 'SIM-E1', 'GUARULHOS', 'SAO PAULO/SP', 0, 'Carreta Simples',
         'Papel e derivados diversos', 0, NULL, 0, 900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1500,
         (extract(epoch from now())*1000)::bigint, 'Imediato', 'pending',
         'FAST_DELIVERY', 'tabelado');

    -- 1. Operador marca envio ao Ramper. TEM de conseguir.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    BEGIN
        UPDATE public.freight_calculations
           SET ramper_sent_at = now(), ramper_opportunity_id = 'op-teste-1'
         WHERE id = 'SIM-ENVIO-1';
        GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (1,'operador MARCA envio ao Ramper','1 linha',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU (operador nao consegue marcar!)' END);

    -- 2. E ao Pipefy, nas colunas que ja existiam.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    BEGIN
        UPDATE public.freight_calculations
           SET pipefy_card_id = 'card-teste-1', pipefy_sent_at = now()
         WHERE id = 'SIM-ENVIO-1';
        GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (2,'operador MARCA envio ao Pipefy','1 linha',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 3. A TRAVA. Este é o caso que conserta o card duplicado: a marcação é
    --    condicional (só grava se ainda estiver nula). Como o caso 1 já marcou,
    --    esta segunda tentativa tem de afetar ZERO linhas — que é como o código
    --    descobre "já foi enviado" mesmo depois de um F5, sem depender da tela.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    UPDATE public.freight_calculations
       SET ramper_sent_at = now()
     WHERE id = 'SIM-ENVIO-1' AND ramper_sent_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (3,'TRAVA: segunda marcacao nao repete','0 linha(s)', n || ' linha(s)',
        CASE WHEN n = 0 THEN 'PASS' ELSE 'FALHOU (marcaria de novo = card duplicado)' END);

    -- 4. anon nao le
    SET LOCAL ROLE anon; bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.freight_calculations;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (4,'anon NAO le cotacao','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu cotacao!)' END);

    -- 5. anon nao marca envio
    SET LOCAL ROLE anon; bloqueou := false; n := 0;
    BEGIN
        UPDATE public.freight_calculations SET ramper_sent_at = now() WHERE id = 'SIM-ENVIO-1';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (5,'anon NAO marca envio','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (anon escreveu!)' END);

    -- 6. Operador nao apaga cotacao: fc_delete exige is_master(). O historico
    --    so marca e reenvia; apagar continua fora do alcance de quem opera.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.freight_calculations WHERE id = 'SIM-ENVIO-1';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (6,'operador NAO apaga cotacao','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou cotacao!)' END);

    -- 7. Nenhuma cotacao REAL mudou.
    SELECT count(*) INTO divergentes FROM (
        SELECT id, pipefy_card_id, pipefy_sent_at, ramper_sent_at, ramper_opportunity_id FROM _antes
        EXCEPT
        SELECT id, pipefy_card_id, pipefy_sent_at, ramper_sent_at, ramper_opportunity_id
          FROM public.freight_calculations WHERE id NOT LIKE 'SIM-%'
    ) d;
    INSERT INTO _r VALUES (7,'nenhuma cotacao real foi alterada','0 divergencia(s)',
        divergentes || ' divergencia(s)',
        CASE WHEN divergentes = 0 THEN 'PASS' ELSE 'FALHOU (mexeu em cotacao real!)' END);

    -- 8. O que o ROLLBACK vai desfazer.
    SELECT count(*) INTO n FROM public.freight_calculations WHERE id LIKE 'SIM-%';
    INSERT INTO _r VALUES (8,'linhas de teste criadas (o ROLLBACK desfaz)','1 linha(s)', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

-- ÚLTIMA query do arquivo: o SQL Editor mostra só o resultado final.
SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

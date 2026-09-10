-- =====================================================================
-- Prova por simulação — carroceria no de-para do Fast Delivery
-- =====================================================================
-- Roda ANTES de aplicar a migration, no SQL Editor. Termina em ROLLBACK:
-- NADA do que acontece aqui sobrevive à execução.
--
-- POR QUE NA TABELA REAL, e não numa cópia
--
-- A primeira versão deste arquivo criava uma cópia da tabela e testava nela.
-- Batia em "relation already exists" — a tabela existe, isto não é mais um
-- banco vazio. Mas o erro fez um favor: uma cópia criada por mim, com policies
-- escritas por mim, provaria só que eu sei escrever policies. Não diria nada
-- sobre o que está valendo em produção.
--
-- Então o teste roda contra public.fast_delivery_equipamento de verdade, com as
-- policies de verdade, e desfaz tudo no fim. Como a coluna nova e a CHECK são
-- criadas AQUI DENTRO, isto é também um ensaio da migration: se ela fosse
-- quebrar em cima dos dados reais, quebra aqui, sem consequência.
--
-- O QUE PROTEGE OS DADOS REAIS
--   - ROLLBACK no fim: a coluna, a constraint e toda escrita somem.
--   - Erro no meio aborta a transação, que também desfaz tudo.
--   - Os códigos de teste usam o prefixo 'SIM-', que não colide com código do
--     OTM (numérico). Nenhum UPDATE/DELETE toca linha real.
--   - Os casos 9 e 10 conferem, com contagem, que as linhas reais continuam
--     como estavam.
--
-- EFEITO COLATERAL, pequeno e honesto: o ALTER TABLE pega lock exclusivo na
-- tabela até o ROLLBACK. São milissegundos numa tabela de 5 linhas; no pior
-- caso um ciclo de leitura espera um instante.
--
-- Casos:
--    0. A migration APLICA sobre os dados reais sem violar CHECK  -> PASS
--    1. Operador NÃO grava carroceria em código novo              -> bloqueado
--    2. Operador NÃO altera carroceria de código existente        -> bloqueado
--    3. Master CLASSIFICA código novo com carroceria              -> PASS
--    4. Master COMPLETA a carroceria que faltava                  -> PASS
--    5. Operador LÊ a carroceria (precisa, para cotar)            -> PASS
--    6. anon NÃO lê                                               -> bloqueado
--    7. CHECK barra carroceria fora do vocabulário do Pipefy      -> bloqueado
--    8. Carroceria NULA é aceita (= não classificada)             -> PASS
--    9. Os códigos REAIS continuam legíveis e intactos            -> PASS
--   10. Nenhuma linha real foi alterada pela simulação            -> PASS
--   11. Só 3 linhas de teste criadas (os 2 bloqueios seguraram)   -> PASS
--
-- O arquivo termina com UM SELECT só, o do quadro. O SQL Editor do Supabase
-- exibe apenas o resultado da última query — qualquer SELECT depois do quadro
-- o esconde. Se for acrescentar conferência, faça como o caso 11: uma linha a
-- mais no quadro, não uma query nova no fim.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Caso 0 — ensaio da migration sobre os dados que existem de verdade.
--
-- Se qualquer código já cadastrado tivesse um valor incompatível, o ADD
-- CONSTRAINT falharia AQUI e a transação abortaria. Passar significa que a
-- migration real vai aplicar limpo.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_equipamento
    ADD COLUMN IF NOT EXISTS carroceria text;

ALTER TABLE public.fast_delivery_equipamento
    DROP CONSTRAINT IF EXISTS fast_delivery_equipamento_carroceria_valida;
ALTER TABLE public.fast_delivery_equipamento
    ADD CONSTRAINT fast_delivery_equipamento_carroceria_valida
    CHECK (carroceria IS NULL OR carroceria IN
        ('Sider', 'Baú', 'Grade Baixa', 'Graneleiro', 'N/A', 'Prancha'));

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text) ON COMMIT DROP;

-- Retrato dos dados reais ANTES de qualquer teste, para comparar no fim.
CREATE TEMP TABLE _antes ON COMMIT DROP AS
    SELECT codigo_otm, tipo_veiculo, carroceria
      FROM public.fast_delivery_equipamento
     WHERE codigo_otm NOT LIKE 'SIM-%';

DO $do$
DECLARE
    m uuid; a uuid; n int; bloqueou boolean; txt text;
    reais_antes int; reais_depois int; divergentes int;
BEGIN
    SELECT count(*) INTO reais_antes FROM _antes;

    INSERT INTO _r VALUES (0, 'migration aplica sobre dados reais',
        'sem violacao', reais_antes || ' linha(s) reais aceitas', 'PASS');

    SELECT id INTO m FROM public.profiles WHERE role = 'master' ORDER BY created_at LIMIT 1;
    -- Qualquer papel que NÃO seja master serve como "operador" para este teste:
    -- amarrar em role='operador' faria a prova depender do nome do papel.
    SELECT id INTO a FROM public.profiles WHERE role IS DISTINCT FROM 'master' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN
        RAISE EXCEPTION 'Precisa de >=1 master e >=1 usuario nao-master em public.profiles';
    END IF;

    -- Semente: um código "antigo", com veículo e SEM carroceria — o estado de
    -- todos os códigos logo depois da migration. Inserido como dono da tabela,
    -- fora das policies.
    INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo, carroceria)
        VALUES ('SIM-ANTIGO', 'CARRETA', NULL);

    -- 1. Operador tenta classificar código novo COM carroceria
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo, carroceria)
            VALUES ('SIM-NOVO', 'CARRETA', 'Sider');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (1,'operador NAO grava carroceria (codigo novo)','bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (coluna nova abriu porta!)' END);

    -- 2. Operador tenta preencher a carroceria que falta num código existente.
    --    Caminho mais provável de abuso: a linha já existe, só falta um campo.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        UPDATE public.fast_delivery_equipamento SET carroceria = 'Grade Baixa' WHERE codigo_otm = 'SIM-ANTIGO';
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (2,'operador NAO altera carroceria existente','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (alterou carroceria!)' END);

    -- 3. Master classifica código novo com carroceria
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo, carroceria)
            VALUES ('SIM-MASTER', 'CARRETA', 'Grade Baixa');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (3,'master CLASSIFICA com carroceria','criou',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'criou' END,
        CASE WHEN bloqueou THEN 'FALHOU' ELSE 'PASS' END);

    -- 4. Master completa a carroceria do código antigo
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    UPDATE public.fast_delivery_equipamento SET carroceria = 'Sider' WHERE codigo_otm = 'SIM-ANTIGO';
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (4,'master COMPLETA carroceria faltante','1 linha', n || ' linha(s)',
        CASE WHEN n = 1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 5. Operador LÊ. Tem de ler: sem a carroceria a cotação dele sai errada.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT carroceria INTO txt FROM public.fast_delivery_equipamento WHERE codigo_otm = 'SIM-ANTIGO';
    RESET ROLE;
    INSERT INTO _r VALUES (5,'operador LE carroceria','Sider', coalesce(txt,'(nulo)'),
        CASE WHEN txt = 'Sider' THEN 'PASS' ELSE 'FALHOU' END);

    -- 6. anon nao le
    SET LOCAL ROLE anon; bloqueou := false; n := 0;
    BEGIN
        SELECT count(*) INTO n FROM public.fast_delivery_equipamento;
        IF n = 0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (6,'anon NAO le o de-para','bloqueado',
        CASE WHEN n = -1 THEN 'permission denied' ELSE n || ' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu!)' END);

    -- 7. CHECK barra grafia fora do vocabulário do Pipefy. "Bau" sem acento é o
    --    erro real: chega no card e não casa com opção nenhuma, silenciosamente.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo, carroceria)
            VALUES ('SIM-CHECK', 'TRUCK', 'Bau');
    EXCEPTION WHEN check_violation THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (7,'CHECK barra carroceria invalida','bloqueado',
        CASE WHEN bloqueou THEN 'check_violation' ELSE 'GRAVOU "Bau"' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 8. Carroceria nula continua aceita: é "ainda não classificada".
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN
        INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo)
            VALUES ('SIM-NULO', 'VAN');
    EXCEPTION WHEN check_violation THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (8,'carroceria NULA e aceita','criou',
        CASE WHEN bloqueou THEN 'check_violation' ELSE 'criou' END,
        CASE WHEN bloqueou THEN 'FALHOU (quebrou codigo sem carroceria)' ELSE 'PASS' END);

    -- 9. Os códigos REAIS continuam legíveis pelo operador, com a coluna nova.
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO reais_depois
      FROM public.fast_delivery_equipamento WHERE codigo_otm NOT LIKE 'SIM-%';
    RESET ROLE;
    INSERT INTO _r VALUES (9,'codigos REAIS continuam legiveis',
        reais_antes || ' linha(s)', reais_depois || ' linha(s)',
        CASE WHEN reais_depois = reais_antes THEN 'PASS' ELSE 'FALHOU' END);

    -- 10. E nenhum deles foi ALTERADO pela simulação. Compara linha a linha com
    --     o retrato tirado antes: qualquer diferença em veículo ou carroceria
    --     aparece aqui.
    SELECT count(*) INTO divergentes FROM (
        SELECT codigo_otm, tipo_veiculo, carroceria FROM _antes
        EXCEPT
        SELECT codigo_otm, tipo_veiculo, carroceria
          FROM public.fast_delivery_equipamento WHERE codigo_otm NOT LIKE 'SIM-%'
    ) d;
    INSERT INTO _r VALUES (10,'nenhuma linha real foi alterada','0 divergencia(s)',
        divergentes || ' divergencia(s)',
        CASE WHEN divergentes = 0 THEN 'PASS' ELSE 'FALHOU (mexeu em dado real!)' END);

    -- 11. O que a simulação criou e o ROLLBACK vai desfazer.
    --
    -- Esta contagem era uma query solta no fim do arquivo — e o SQL Editor do
    -- Supabase mostra só o resultado da ÚLTIMA query, então ela escondia o
    -- quadro inteiro. Virou um caso como os outros: o arquivo passa a terminar
    -- com um único SELECT, e o quadro é o que aparece na tela.
    --
    -- Esperado 3: SIM-ANTIGO, SIM-MASTER e SIM-NULO entram; SIM-NOVO é barrado
    -- pela RLS (caso 1) e SIM-CHECK pela constraint (caso 7). Sair 4 ou 5 aqui
    -- significa que um dos dois bloqueios não segurou.
    SELECT count(*) INTO n FROM public.fast_delivery_equipamento WHERE codigo_otm LIKE 'SIM-%';
    INSERT INTO _r VALUES (11,'linhas de teste criadas (o ROLLBACK desfaz)','3 linha(s)',
        n || ' linha(s)',
        CASE WHEN n = 3 THEN 'PASS' ELSE 'FALHOU (um bloqueio nao segurou)' END);
END;
$do$;

-- ÚLTIMA query do arquivo, de propósito: é esta que o SQL Editor mostra.
SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

-- Depois do ROLLBACK: a coluna carroceria NÃO existe mais. Para confirmar que
-- nada sobrou, rode fora desta transação:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'fast_delivery_equipamento';
-- Deve listar apenas codigo_otm, tipo_veiculo, observacao, atualizado_em.

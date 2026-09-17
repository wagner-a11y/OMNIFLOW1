-- =====================================================================
-- DE-PARA DOS NOMES DE VEÍCULO — banco alinhado aos 15 nomes oficiais
-- =====================================================================
-- O App monta a lista da tela com
--     setVehicleConfigs({ ...VEHICLE_CONFIGS, ...vehiclesData })
-- que é um spread: mescla por chave de STRING. Enquanto o código diz 'Truck' e
-- o banco diz 'truck', as chaves não casam, o spread SOMA em vez de sobrepor, e
-- o mesmo veículo aparece duas vezes na tela com tarifas diferentes. Os nomes do
-- código já foram alinhados ao enum VehicleType (types.ts); falta o banco.
--
-- O QUE MUDA: só o TEXTO do nome, em vehicle_configs e no vehicle_type das
-- cotações que o referenciam. Nenhuma cotação é recalculada, nenhuma é apagada,
-- nenhum valor de frete é tocado. Autorizado pelo Wagner.
--
-- CAMPO DE TARIFA: é o `factor`. Verificado no único ponto de cálculo do preço
-- base por km (App.tsx:1421-1430):
--     base = km x (calc_mode='KM_ROUND_TRIP' ? 2 : 1) x factor
-- `variable` e `fixed` NÃO entram em conta nenhuma: o piso ANTT vem da Tabela A
-- local (utils/antt.ts), indexada por `axles`. Por isso este script zera
-- variable/fixed dos utilitários (lixo de cadastro que a tela de Configurações
-- exibia como se fosse tarifa) e NÃO encosta neles nos pesados nem nos FREE.
--
-- DUAS FAMÍLIAS NO DE-PARA (a coluna `tambem_cadastro` separa):
--   a) nome que existe no CADASTRO e nas COTAÇÕES — renomeia nos dois lados.
--      São os 6 primeiros: toco, truck, bitruck, carreta ls, vanderleia, '3/4 '.
--   b) nome que existe SÓ nas COTAÇÕES (fantasma: veio do código antigo, nunca
--      foi cadastrado) — renomeia só a cotação. São os 5 últimos, encontrados
--      pelo BLOCO 0: 'Fiorino - Utilitário' (271 cotações), 'Van - Utilitário'
--      (133), 'Prancha - Preço livre' (24), 'Carreta 4º Eixo' (5, com E
--      maiúsculo) e 'Vanderleia' (3, com V maiúsculo). O cadastro de destino
--      desses cinco já existe, ou nasce nos passos 2/3 deste script.
--
-- O QUE FICA DE FORA, DE PROPÓSITO: 'HR/VUC - Utilitário', 78 cotações. HR e
-- VUC eram um item só, com um fator que não era o de nenhum dos dois; não há
-- como saber, hoje, qual dos dois cada cotação era. Decisão do Wagner: NÃO
-- migrar, fica como histórico. É o ÚNICO nome que pode sobrar na seção SOBRAS
-- da conferência final — qualquer outro ali é problema.
--
-- RLS: nenhuma policy é criada, alterada ou removida. As de vehicle_configs
-- (vc_select/vc_insert/vc_update/vc_delete — leitura por authenticated, escrita
-- só master) continuam exatamente como estão; estes comandos mexem em DADOS.
--
-- JÁ CONFERIDO NO BLOCO 0 (17/09/2026):
--   - colunas de vehicle_configs: o INSERT de HR/VUC roda;
--   - updated_at é timestamptz, então now() serve;
--   - 0.3 (colisões no cadastro) voltou VAZIA;
--   - eixos dos pesados conferidos pelo Wagner, um a um, e corretos.
--
-- COMO RODAR (SQL Editor do Supabase):
--     BLOCO 0  -> só leitura. A foto de antes e a previsão do depois.
--     BLOCO 1  -> ensaio de verdade, dentro de BEGIN ... ROLLBACK. Não grava.
--     BLOCO 2  -> aplicação, dentro de BEGIN ... COMMIT. Só depois de aprovar.
--
-- O SQL Editor mostra o resultado da ÚLTIMA query de cada execução. Por isso o
-- BLOCO 0 vem quebrado em queries numeradas para rodar UMA DE CADA VEZ, e no
-- BLOCO 2 a conferência final fica FORA da transação, depois do COMMIT — assim
-- ela sempre aparece na tela. Rode um BLOCO por vez, nunca o arquivo inteiro.
-- =====================================================================


-- #####################################################################
-- BLOCO 0 — RODE ESTE PRIMEIRO (só leitura, não grava nada)
-- Rode uma query de cada vez: selecione o trecho e execute.
-- #####################################################################

-- ---------------------------------------------------------------------
-- 0.1 — Colunas de vehicle_configs.   [CONFERIDO EM 17/09/2026 — ok]
-- Serve para duas coisas:
--   a) se aparecer uma coluna NOT NULL sem default que não esteja na lista do
--      INSERT de HR/VUC lá embaixo, PARE — o INSERT falharia. (Esperado:
--      vehicle_type, fixed, variable, factor, axles, calc_mode, updated_at.)
--   b) confirmar que `updated_at` é timestamp/timestamptz (ou text). Se vier
--      como bigint (epoch em ms, como o created_at das cotações), PARE: o
--      now() dos UPDATEs teria de virar (extract(epoch from now())*1000)::bigint.
-- ---------------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'vehicle_configs'
 ORDER BY ordinal_position;


-- ---------------------------------------------------------------------
-- 0.2 — Foto de ANTES + previsão do DEPOIS, veículo a veículo.
-- Os colchetes e o `tam` denunciam espaço no fim e caractere invisível: é
-- assim que '3/4 ' se distingue de '3/4' a olho nu.
-- ---------------------------------------------------------------------
WITH depara(de, para, tambem_cadastro) AS (VALUES
    -- (a) cadastro + cotações
    ('toco',                  'Toco',               true),
    ('truck',                 'Truck',              true),
    ('bitruck',               'Bitruck',            true),
    ('carreta ls',            'Carreta LS',         true),
    ('vanderleia',            'Carreta Vanderleia', true),
    ('3/4 ',                  '3/4',                true),
    -- (b) fantasmas: só em cotação, nunca cadastrados
    ('Fiorino - Utilitário',  'Fiorino',            false),
    ('Van - Utilitário',      'Van',                false),
    ('Prancha - Preço livre', 'Prancha',            false),
    ('Carreta 4º Eixo',       'Carreta 4º eixo',    false),
    ('Vanderleia',            'Carreta Vanderleia', false)
),
uso AS (
    -- A lixeira entra na conta de propósito: cotação na lixeira pode ser
    -- restaurada, e aí volta apontando para o veículo. Renomear olhando só as
    -- ativas deixaria essa bomba armada.
    SELECT coalesce(vehicle_type, '(nulo)')                AS nome,
           count(*)                                        AS cotacoes,
           count(*) FILTER (WHERE deleted_at IS NULL)      AS ativas,
           count(*) FILTER (WHERE deleted_at IS NOT NULL)  AS lixeira
      FROM public.freight_calculations
     GROUP BY 1
),
nomes AS (
    SELECT vehicle_type AS nome FROM public.vehicle_configs
    UNION
    SELECT nome FROM uso
)
SELECT '[' || n.nome || ']'                     AS nome_hoje,
       length(n.nome)                           AS tam,
       '[' || coalesce(d.para, n.nome) || ']'   AS vira,
       CASE
           WHEN d.para IS NOT NULL AND d.tambem_cadastro THEN '>> RENOMEIA (cadastro + cotacao)'
           WHEN d.para IS NOT NULL                       THEN '>> RENOMEIA (so cotacao)'
           WHEN n.nome = 'HR/VUC - Utilitário'           THEN '== MANTIDO de proposito (historico)'
           ELSE                                               'sem mudanca'
       END                                      AS acao,
       CASE
           WHEN v.vehicle_type IS NOT NULL AND u.nome IS NOT NULL THEN 'cadastro + cotacao'
           WHEN v.vehicle_type IS NOT NULL                        THEN 'so cadastro'
           ELSE                                                        '>> ORFAO (so em cotacao)'
       END                                      AS situacao,
       v.calc_mode,
       v.factor,
       v.variable,
       v.fixed,
       v.axles,
       coalesce(u.cotacoes, 0)                  AS cotacoes,
       coalesce(u.ativas, 0)                    AS ativas,
       coalesce(u.lixeira, 0)                   AS lixeira
  FROM nomes n
  LEFT JOIN depara d                  ON d.de = n.nome
  LEFT JOIN public.vehicle_configs v  ON v.vehicle_type = n.nome
  LEFT JOIN uso u                     ON u.nome = n.nome
 ORDER BY coalesce(u.cotacoes, 0) DESC, n.nome;


-- ---------------------------------------------------------------------
-- 0.3 — COLISÕES: pares em que o nome de origem E o nome de destino já
-- existem no CADASTRO. Se vier linha aqui, é cadastro que vai ser
-- CONSOLIDADO (uma das duas linhas some). Confira antes de aprovar.
--   [RODADA EM 17/09/2026 — voltou vazia. Nenhum cadastro é descartado.]
--
-- Regra de desempate usada nos blocos 1 e 2: a linha de ORIGEM vence — é a
-- que as cotações vinham usando e a que tem o histórico de tarifa. A linha
-- de nome oficial (destino) é a que é removida. No caso do '3/4' isso
-- preserva o cadastro das 47 cotações; logo depois os valores canônicos
-- (KM_ROUND_TRIP, factor 4.10, axles 2) são forçados na linha sobrevivente.
-- ---------------------------------------------------------------------
WITH depara(de, para) AS (VALUES
    ('toco',       'Toco'),
    ('truck',      'Truck'),
    ('bitruck',    'Bitruck'),
    ('carreta ls', 'Carreta LS'),
    ('vanderleia', 'Carreta Vanderleia'),
    ('3/4 ',       '3/4')
)
SELECT '[' || d.de || ']'      AS origem_vence,
       o.calc_mode             AS origem_calc_mode,
       o.factor                AS origem_factor,
       o.axles                 AS origem_axles,
       '[' || d.para || ']'    AS destino_sera_removido,
       p.calc_mode             AS destino_calc_mode,
       p.factor                AS destino_factor,
       p.axles                 AS destino_axles
  FROM depara d
  JOIN public.vehicle_configs o ON o.vehicle_type = d.de
  JOIN public.vehicle_configs p ON p.vehicle_type = d.para
 ORDER BY d.de;


-- ---------------------------------------------------------------------
-- 0.4 — COBERTURA do de-para: cada par casa com quantas linhas, HOJE.
--
-- Esta é a rede contra erro de digitação. Os nomes têm acento, 'º' e hífen;
-- 'Carreta 4º Eixo' com um caractere diferente do que está gravado não casa
-- com nada, o UPDATE renomeia ZERO linhas e ninguém percebe — o de-para
-- "rodou com sucesso" sem ter feito nada.
--
-- LEITURA: toda linha tem de vir com cotacoes_hoje > 0 (as contagens que o
-- BLOCO 0.2 mostrou). Se alguma vier 0, PARE: a grafia daquele par está
-- errada. `cadastro_hoje` é 1 nos seis primeiros e 0 nos cinco fantasmas.
-- ---------------------------------------------------------------------
WITH depara(de, para, tambem_cadastro) AS (VALUES
    ('toco',                  'Toco',               true),
    ('truck',                 'Truck',              true),
    ('bitruck',               'Bitruck',            true),
    ('carreta ls',            'Carreta LS',         true),
    ('vanderleia',            'Carreta Vanderleia', true),
    ('3/4 ',                  '3/4',                true),
    ('Fiorino - Utilitário',  'Fiorino',            false),
    ('Van - Utilitário',      'Van',                false),
    ('Prancha - Preço livre', 'Prancha',            false),
    ('Carreta 4º Eixo',       'Carreta 4º eixo',    false),
    ('Vanderleia',            'Carreta Vanderleia', false)
)
SELECT '[' || d.de || ']'    AS de,
       length(d.de)          AS tam_de,
       '[' || d.para || ']'  AS para,
       d.tambem_cadastro,
       (SELECT count(*) FROM public.freight_calculations f WHERE f.vehicle_type = d.de) AS cotacoes_hoje,
       (SELECT count(*) FROM public.vehicle_configs v     WHERE v.vehicle_type = d.de) AS cadastro_hoje,
       CASE
           WHEN (SELECT count(*) FROM public.freight_calculations f WHERE f.vehicle_type = d.de) = 0
               THEN '>> NAO CASA COM NADA — confira a grafia'
           ELSE 'ok'
       END                   AS obs
  FROM depara d
 ORDER BY cotacoes_hoje DESC, d.de;


-- #####################################################################
-- BLOCO 1 — SIMULAÇÃO / ENSAIO (BEGIN ... ROLLBACK)
-- RODE ESTE DEPOIS DO BLOCO 0. Executa TUDO de verdade e desfaz no fim:
-- prova que os comandos rodam sem violar constraint, sem gravar nada.
-- Rode o bloco inteiro de uma vez (do BEGIN ao ROLLBACK).
--
-- Se o editor mostrar "Success. No rows returned" em vez da tabela de
-- conferência, é a limitação do SQL Editor (a última statement é o ROLLBACK,
-- que não devolve linhas). Não tem problema: o que importa aqui é NÃO DAR
-- ERRO; a conferência dos números você já fez no BLOCO 0 e vai refazer na
-- saída do BLOCO 2.
-- #####################################################################

BEGIN;

-- ---- 0. O de-para, uma vez só, numa tabela temporária. ----
-- Em tabela e não repetido em cada comando por três motivos:
--   - a lista tem 11 pares e aparece em 3 passos; repetir é como se perde um;
--   - a PRIMARY KEY em `de` impede origem duplicada, que faria o UPDATE ...
--     FROM escolher um destino de forma não-determinística;
--   - `tambem_cadastro` deixa explícito quem mexe no cadastro e quem não.
-- ON COMMIT DROP: some no ROLLBACK deste bloco e no COMMIT do BLOCO 2.
CREATE TEMP TABLE depara (
    de              text PRIMARY KEY,
    para            text NOT NULL,
    tambem_cadastro boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO depara (de, para, tambem_cadastro) VALUES
    -- (a) cadastro + cotações
    ('toco',                  'Toco',               true),
    ('truck',                 'Truck',              true),
    ('bitruck',               'Bitruck',            true),
    ('carreta ls',            'Carreta LS',         true),
    ('vanderleia',            'Carreta Vanderleia', true),
    ('3/4 ',                  '3/4',                true),
    -- (b) fantasmas do código antigo: só em cotação
    ('Fiorino - Utilitário',  'Fiorino',            false),
    ('Van - Utilitário',      'Van',                false),
    ('Prancha - Preço livre', 'Prancha',            false),
    ('Carreta 4º Eixo',       'Carreta 4º eixo',    false),
    ('Vanderleia',            'Carreta Vanderleia', false);
-- 'HR/VUC - Utilitário' NÃO entra: 78 cotações que ficam como histórico.

-- ---- 0b. Guarda: de-para em cadeia. ----
-- Se um destino fosse também uma origem ('a'->'b' junto com 'b'->'c'), o
-- resultado passaria a depender da ordem de execução. Hoje não acontece —
-- 'Vanderleia' e 'vanderleia' apontam para o MESMO destino, e nenhum dos dois
-- é destino de ninguém, então convergem sem conflito. Esta guarda existe para
-- o dia em que alguém acrescentar um par novo sem perceber.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM depara WHERE para IN (SELECT de FROM depara);
    IF n > 0 THEN
        RAISE EXCEPTION 'de-para em cadeia: % par(es) com destino que tambem e origem. Corrija a lista.', n;
    END IF;
END $$;

-- ---- 1. Cotações: só o texto do nome. Nada recalculado, nada apagado. ----
-- Vale para os 11 pares, fantasmas inclusive. Inclui as cotações da lixeira
-- de propósito (podem ser restauradas).
UPDATE public.freight_calculations f
   SET vehicle_type = d.para
  FROM depara d
 WHERE f.vehicle_type = d.de;

-- ---- 2. Cadastro: só os pares que TÊM cadastro, consolidando duplicata. ----
-- Em forma de laço porque cada par pode cair em dois casos diferentes, e um
-- UPDATE cru estouraria a unicidade de vehicle_type quando o destino já existe.
DO $$
DECLARE
    d record;
BEGIN
    FOR d IN SELECT de, para FROM depara WHERE tambem_cadastro ORDER BY de
    LOOP
        IF EXISTS (SELECT 1 FROM public.vehicle_configs WHERE vehicle_type = d.de) THEN
            -- Colisão: a linha de origem é a que as cotações usavam, então é ela
            -- que sobrevive. A homônima de nome oficial sai. (0.3 diz que hoje
            -- não há nenhuma; o DELETE não encontra nada e não faz nada.)
            DELETE FROM public.vehicle_configs WHERE vehicle_type = d.para;
            UPDATE public.vehicle_configs
               SET vehicle_type = d.para, updated_at = now()
             WHERE vehicle_type = d.de;
        END IF;
    END LOOP;
END $$;

-- ---- 2b. 3/4: valores canônicos na linha sobrevivente. ----
-- Independe de qual das duas linhas sobreviveu no passo acima.
UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP',
       factor    = 4.10,
       axles     = 2,
       updated_at = now()
 WHERE vehicle_type = '3/4';

-- ---- 3. HR e VUC: existir é obrigatório. ----
-- Eram "HR/VUC", um item só com fator 4,20 — que não era o de nenhum dos dois.
-- UPDATE-depois-INSERT em vez de ON CONFLICT: não depende de como a unicidade
-- de vehicle_type está declarada.
UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP', factor = 2.00, variable = 0, fixed = 0,
       axles = 2, updated_at = now()
 WHERE vehicle_type = 'HR';
INSERT INTO public.vehicle_configs (vehicle_type, calc_mode, factor, variable, fixed, axles, updated_at)
SELECT 'HR', 'KM_ROUND_TRIP', 2.00, 0, 0, 2, now()
 WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_configs WHERE vehicle_type = 'HR');

UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP', factor = 3.00, variable = 0, fixed = 0,
       axles = 2, updated_at = now()
 WHERE vehicle_type = 'VUC';
INSERT INTO public.vehicle_configs (vehicle_type, calc_mode, factor, variable, fixed, axles, updated_at)
SELECT 'VUC', 'KM_ROUND_TRIP', 3.00, 0, 0, 2, now()
 WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_configs WHERE vehicle_type = 'VUC');

-- ---- 4. Utilitários: variable e fixed vão a zero. ----
-- Não entram em conta nenhuma (a tarifa é o `factor`), mas a tela de
-- Configurações os exibe — e um "1,2" na Fiorino se lê como tarifa.
-- Só os KM_ROUND_TRIP: os pesados (ANTT) e os FREE ficam intactos.
UPDATE public.vehicle_configs
   SET variable = 0, fixed = 0, updated_at = now()
 WHERE calc_mode = 'KM_ROUND_TRIP'
   AND (variable <> 0 OR fixed <> 0);

-- ---- 5. Conferência (mesma query do BLOCO 2). ----
WITH oficiais(ordem, nome) AS (VALUES
    ( 1, 'Fiorino'), ( 2, 'Van'), ( 3, 'HR'), ( 4, 'VUC'), ( 5, '3/4'),
    ( 6, 'Toco'), ( 7, 'Truck'), ( 8, 'Bitruck'), ( 9, 'Carreta Simples'),
    (10, 'Carreta LS'), (11, 'Carreta Vanderleia'), (12, 'Carreta 4º eixo'),
    (13, 'Rodotrem'), (14, 'Prancha'), (15, 'Aéreo')
),
uso AS (
    SELECT coalesce(vehicle_type, '(nulo)')               AS nome,
           count(*)                                       AS cotacoes,
           count(*) FILTER (WHERE deleted_at IS NULL)     AS ativas
      FROM public.freight_calculations
     GROUP BY 1
),
sobras AS (
    SELECT n.nome, v.calc_mode, v.factor, v.variable, v.fixed, v.axles,
           coalesce(u.cotacoes, 0) AS cotacoes, coalesce(u.ativas, 0) AS ativas,
           CASE
               WHEN n.nome = 'HR/VUC - Utilitário' THEN 'historico — mantido de proposito'
               WHEN v.vehicle_type IS NOT NULL     THEN '>> CADASTRO fora dos 15'
               ELSE                                     '>> COTACAO ORFA nao prevista'
           END AS obs
      FROM (SELECT vehicle_type AS nome FROM public.vehicle_configs
            UNION
            SELECT nome FROM uso) n
      LEFT JOIN public.vehicle_configs v ON v.vehicle_type = n.nome
      LEFT JOIN uso u                    ON u.nome = n.nome
     WHERE n.nome NOT IN (SELECT nome FROM oficiais)
)
SELECT * FROM (
    SELECT 1 AS ord, o.ordem AS sub,
           '1. OS 15 OFICIAIS'::text                       AS secao,
           ('[' || o.nome || ']')::text                    AS veiculo,
           v.calc_mode::text                               AS calc_mode,
           v.factor::numeric                               AS factor_tarifa,
           v.variable::numeric                             AS variable,
           v.fixed::numeric                                AS fixed,
           v.axles::int                                    AS axles,
           coalesce(u.cotacoes, 0)::bigint                 AS cotacoes,
           coalesce(u.ativas, 0)::bigint                   AS ativas,
           CASE WHEN v.vehicle_type IS NULL THEN '>> FALTA NO CADASTRO' ELSE 'ok' END::text AS obs
      FROM oficiais o
      LEFT JOIN public.vehicle_configs v ON v.vehicle_type = o.nome
      LEFT JOIN uso u                    ON u.nome = o.nome
    UNION ALL
    SELECT 2, 0,
           '2. SOBRAS — só pode aparecer HR/VUC - Utilitário'::text,
           ('[' || s.nome || ']')::text,
           s.calc_mode::text, s.factor::numeric, s.variable::numeric,
           s.fixed::numeric, s.axles::int,
           s.cotacoes::bigint, s.ativas::bigint, s.obs::text
      FROM sobras s
    UNION ALL
    SELECT 3, 0,
           '3. TOTAL de cotações — NÃO pode mudar'::text,
           'todas'::text,
           NULL::text, NULL::numeric, NULL::numeric, NULL::numeric, NULL::int,
           count(*)::bigint,
           count(*) FILTER (WHERE deleted_at IS NULL)::bigint,
           ''::text
      FROM public.freight_calculations
) x
ORDER BY ord, sub, veiculo;

ROLLBACK;   -- <<< NADA FOI GRAVADO. Este bloco é ensaio.


-- #####################################################################
-- BLOCO 2 — APLICAÇÃO (BEGIN ... COMMIT)
-- RODE ESTE SÓ DEPOIS DE APROVAR A SIMULAÇÃO.
-- São as MESMAS operações do BLOCO 1, com COMMIT no lugar do ROLLBACK.
-- A conferência final fica depois do COMMIT, para o editor exibi-la.
-- #####################################################################

BEGIN;

-- ---- 0. O de-para, uma vez só, numa tabela temporária. ----
CREATE TEMP TABLE depara (
    de              text PRIMARY KEY,
    para            text NOT NULL,
    tambem_cadastro boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO depara (de, para, tambem_cadastro) VALUES
    -- (a) cadastro + cotações
    ('toco',                  'Toco',               true),
    ('truck',                 'Truck',              true),
    ('bitruck',               'Bitruck',            true),
    ('carreta ls',            'Carreta LS',         true),
    ('vanderleia',            'Carreta Vanderleia', true),
    ('3/4 ',                  '3/4',                true),
    -- (b) fantasmas do código antigo: só em cotação
    ('Fiorino - Utilitário',  'Fiorino',            false),
    ('Van - Utilitário',      'Van',                false),
    ('Prancha - Preço livre', 'Prancha',            false),
    ('Carreta 4º Eixo',       'Carreta 4º eixo',    false),
    ('Vanderleia',            'Carreta Vanderleia', false);
-- 'HR/VUC - Utilitário' NÃO entra: 78 cotações que ficam como histórico.

-- ---- 0b. Guarda: de-para em cadeia. ----
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM depara WHERE para IN (SELECT de FROM depara);
    IF n > 0 THEN
        RAISE EXCEPTION 'de-para em cadeia: % par(es) com destino que tambem e origem. Corrija a lista.', n;
    END IF;
END $$;

-- ---- 1. Cotações: só o texto do nome. ----
UPDATE public.freight_calculations f
   SET vehicle_type = d.para
  FROM depara d
 WHERE f.vehicle_type = d.de;

-- ---- 2. Cadastro: só os pares que TÊM cadastro, consolidando duplicata. ----
DO $$
DECLARE
    d record;
BEGIN
    FOR d IN SELECT de, para FROM depara WHERE tambem_cadastro ORDER BY de
    LOOP
        IF EXISTS (SELECT 1 FROM public.vehicle_configs WHERE vehicle_type = d.de) THEN
            DELETE FROM public.vehicle_configs WHERE vehicle_type = d.para;
            UPDATE public.vehicle_configs
               SET vehicle_type = d.para, updated_at = now()
             WHERE vehicle_type = d.de;
        END IF;
    END LOOP;
END $$;

-- ---- 2b. 3/4: valores canônicos na linha sobrevivente. ----
UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP',
       factor    = 4.10,
       axles     = 2,
       updated_at = now()
 WHERE vehicle_type = '3/4';

-- ---- 3. HR e VUC. ----
UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP', factor = 2.00, variable = 0, fixed = 0,
       axles = 2, updated_at = now()
 WHERE vehicle_type = 'HR';
INSERT INTO public.vehicle_configs (vehicle_type, calc_mode, factor, variable, fixed, axles, updated_at)
SELECT 'HR', 'KM_ROUND_TRIP', 2.00, 0, 0, 2, now()
 WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_configs WHERE vehicle_type = 'HR');

UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP', factor = 3.00, variable = 0, fixed = 0,
       axles = 2, updated_at = now()
 WHERE vehicle_type = 'VUC';
INSERT INTO public.vehicle_configs (vehicle_type, calc_mode, factor, variable, fixed, axles, updated_at)
SELECT 'VUC', 'KM_ROUND_TRIP', 3.00, 0, 0, 2, now()
 WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_configs WHERE vehicle_type = 'VUC');

-- ---- 4. Utilitários: variable e fixed a zero (só os KM_ROUND_TRIP). ----
UPDATE public.vehicle_configs
   SET variable = 0, fixed = 0, updated_at = now()
 WHERE calc_mode = 'KM_ROUND_TRIP'
   AND (variable <> 0 OR fixed <> 0);

COMMIT;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA FINAL — roda fora da transação, depois do COMMIT.
-- É a tabela para o Wagner conferir uma por uma:
--   1. os 15 oficiais, com calc_mode, o factor (que é a tarifa que o cálculo
--      usa) e o axles (de que depende o piso ANTT dos pesados);
--   2. SOBRAS: só pode ter UMA linha, 'HR/VUC - Utilitário' com 78 cotações.
--      Qualquer outro nome ali é nome que ficou para trás;
--   3. o total de cotações tem de bater com o do BLOCO 0.2.
-- ---------------------------------------------------------------------
WITH oficiais(ordem, nome) AS (VALUES
    ( 1, 'Fiorino'), ( 2, 'Van'), ( 3, 'HR'), ( 4, 'VUC'), ( 5, '3/4'),
    ( 6, 'Toco'), ( 7, 'Truck'), ( 8, 'Bitruck'), ( 9, 'Carreta Simples'),
    (10, 'Carreta LS'), (11, 'Carreta Vanderleia'), (12, 'Carreta 4º eixo'),
    (13, 'Rodotrem'), (14, 'Prancha'), (15, 'Aéreo')
),
uso AS (
    SELECT coalesce(vehicle_type, '(nulo)')               AS nome,
           count(*)                                       AS cotacoes,
           count(*) FILTER (WHERE deleted_at IS NULL)     AS ativas
      FROM public.freight_calculations
     GROUP BY 1
),
sobras AS (
    SELECT n.nome, v.calc_mode, v.factor, v.variable, v.fixed, v.axles,
           coalesce(u.cotacoes, 0) AS cotacoes, coalesce(u.ativas, 0) AS ativas,
           CASE
               WHEN n.nome = 'HR/VUC - Utilitário' THEN 'historico — mantido de proposito'
               WHEN v.vehicle_type IS NOT NULL     THEN '>> CADASTRO fora dos 15'
               ELSE                                     '>> COTACAO ORFA nao prevista'
           END AS obs
      FROM (SELECT vehicle_type AS nome FROM public.vehicle_configs
            UNION
            SELECT nome FROM uso) n
      LEFT JOIN public.vehicle_configs v ON v.vehicle_type = n.nome
      LEFT JOIN uso u                    ON u.nome = n.nome
     WHERE n.nome NOT IN (SELECT nome FROM oficiais)
)
SELECT * FROM (
    SELECT 1 AS ord, o.ordem AS sub,
           '1. OS 15 OFICIAIS'::text                       AS secao,
           ('[' || o.nome || ']')::text                    AS veiculo,
           v.calc_mode::text                               AS calc_mode,
           v.factor::numeric                               AS factor_tarifa,
           v.variable::numeric                             AS variable,
           v.fixed::numeric                                AS fixed,
           v.axles::int                                    AS axles,
           coalesce(u.cotacoes, 0)::bigint                 AS cotacoes,
           coalesce(u.ativas, 0)::bigint                   AS ativas,
           CASE WHEN v.vehicle_type IS NULL THEN '>> FALTA NO CADASTRO' ELSE 'ok' END::text AS obs
      FROM oficiais o
      LEFT JOIN public.vehicle_configs v ON v.vehicle_type = o.nome
      LEFT JOIN uso u                    ON u.nome = o.nome
    UNION ALL
    SELECT 2, 0,
           '2. SOBRAS — só pode aparecer HR/VUC - Utilitário'::text,
           ('[' || s.nome || ']')::text,
           s.calc_mode::text, s.factor::numeric, s.variable::numeric,
           s.fixed::numeric, s.axles::int,
           s.cotacoes::bigint, s.ativas::bigint, s.obs::text
      FROM sobras s
    UNION ALL
    SELECT 3, 0,
           '3. TOTAL de cotações — NÃO pode mudar'::text,
           'todas'::text,
           NULL::text, NULL::numeric, NULL::numeric, NULL::numeric, NULL::int,
           count(*)::bigint,
           count(*) FILTER (WHERE deleted_at IS NULL)::bigint,
           ''::text
      FROM public.freight_calculations
) x
ORDER BY ord, sub, veiculo;


-- =====================================================================
-- REFERÊNCIA — o que o SELECT final deve mostrar nos 15 oficiais.
-- Espelho de VEHICLE_CONFIGS (constants.ts). O BANCO é a fonte: onde ele
-- divergir desta lista, é o banco que manda na tela — e é isto que o Wagner
-- confere linha a linha.
--
--   veiculo             calc_mode        factor   axles   piso ANTT?
--   Fiorino             KM_ROUND_TRIP      1,50     2     nao
--   Van                 KM_ROUND_TRIP      1,60     2     nao
--   HR                  KM_ROUND_TRIP      2,00     2     nao
--   VUC                 KM_ROUND_TRIP      3,00     2     nao
--   3/4                 KM_ROUND_TRIP      4,10     2     nao
--   Toco                ANTT               0        2     sim
--   Truck               ANTT               0        3     sim
--   Bitruck             ANTT               0        4     sim
--   Carreta Simples     ANTT               0        5     sim
--   Carreta LS          ANTT               0        6     sim
--   Carreta Vanderleia  ANTT               0        6     sim
--   Carreta 4º eixo     ANTT               0        7     sim
--   Rodotrem            ANTT               0        9     sim
--   Prancha             FREE               0        6     nao (preco livre)
--   Aéreo               FREE               0        0     nao (preco livre)
--
-- Nos utilitários o `factor` É a tarifa: base = km x 2 x factor. Com
-- factor = 0 o veículo deixa de ser tratado como utilitário (App.tsx:1421) e
-- o Preço Base para de autopreencher.
-- Nos pesados o que importa é o `axles`: o piso da Tabela A é escolhido pela
-- coluna de eixos. Eixo errado = piso errado.
--
-- MOVIMENTO ESPERADO DE COTAÇÕES (do BLOCO 0, 17/09/2026):
--   Fiorino             +271   (de 'Fiorino - Utilitário')
--   Van                 +133   (de 'Van - Utilitário')
--   Prancha              +24   (de 'Prancha - Preço livre')
--   Carreta Vanderleia    +3   (de 'Vanderleia') + as de 'vanderleia'
--   Carreta 4º eixo       +5   (de 'Carreta 4º Eixo')
--   3/4                  +47   (de '3/4 ', que se juntam às 32 do Fast)
--   Toco/Truck/Bitruck/Carreta LS: as que estavam em minúsculas
--   HR/VUC - Utilitário   78   INALTERADO, de propósito
-- O TOTAL de cotações não muda em nenhum caso: isto é renomeação, não
-- exclusão nem criação.
-- =====================================================================

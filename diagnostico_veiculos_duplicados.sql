-- =====================================================================
-- DIAGNÓSTICO — veículos: código × banco × uso em cotações
-- =====================================================================
-- SÓ LEITURA. Nenhum UPDATE, INSERT ou DELETE. Roda quantas vezes quiser.
--
-- Responde de uma vez:
--   1. veículo -> quantas cotações o referenciam (e de qual operação)
--   2. nomes que aparecem em COTAÇÃO mas não existem em lugar nenhum (órfãos)
--   3. o diff VEHICLE_CONFIGS (código) × vehicle_configs (banco)
--   4. se "Carreta LS" e "Vanderleia" são usados por cotações diferentes
--
-- A lista `codigo` abaixo é o enum VehicleType de types.ts, transcrito. É ele
-- que o App injeta por cima do banco em
--     setVehicleConfigs({ ...VEHICLE_CONFIGS, ...vehiclesData })
-- e é dessa injeção que nascem os "fantasmas": nome que existe só no código
-- aparece na tela como veículo, sem nunca ter sido cadastrado.
-- =====================================================================

WITH codigo(nome) AS (VALUES
    ('Fiorino - Utilitário'),
    ('Van - Utilitário'),
    ('HR/VUC - Utilitário'),
    ('Toco'),
    ('Truck'),
    ('Bitruck'),
    ('Carreta Simples'),
    ('Carreta LS'),
    ('Carreta 4º Eixo'),
    ('Vanderleia'),
    ('Rodotrem'),
    ('Prancha - Preço livre')
),
banco AS (
    SELECT vehicle_type AS nome, calc_mode, factor, fixed, variable, axles
      FROM public.vehicle_configs
),
uso AS (
    -- A lixeira entra na conta de propósito: cotação na lixeira pode ser
    -- restaurada, e aí volta apontando para o veículo. Apagar um cadastro
    -- olhando só as ativas deixaria essa bomba armada.
    SELECT coalesce(vehicle_type, '(nulo)') AS nome,
           count(*)                                                    AS cotacoes,
           count(*) FILTER (WHERE deleted_at IS NULL)                  AS ativas,
           count(*) FILTER (WHERE deleted_at IS NOT NULL)              AS na_lixeira,
           count(*) FILTER (WHERE operacao IS NULL)                    AS cotacao_normal,
           count(*) FILTER (WHERE operacao = 'FAST_DELIVERY')          AS fast,
           count(*) FILTER (WHERE operacao = 'DEMAIS_PLANTAS')         AS demais_plantas,
           to_timestamp(nullif(max(created_at), 0) / 1000.0)::date     AS ultimo_uso
      FROM public.freight_calculations
     GROUP BY 1
),
nomes AS (
    SELECT nome FROM codigo
    UNION
    SELECT nome FROM banco
    UNION
    SELECT nome FROM uso
)
SELECT
    -- Os colchetes e o comprimento denunciam espaço no fim e caracteres
    -- invisíveis: é assim que '3/4 ' se distingue de '3/4' a olho nu.
    '[' || n.nome || ']'            AS veiculo,
    length(n.nome)                  AS tam,
    CASE
        WHEN c.nome IS NOT NULL AND b.nome IS NOT NULL THEN 'codigo + banco'
        WHEN c.nome IS NOT NULL AND b.nome IS NULL     THEN '>> FANTASMA (so no codigo)'
        WHEN c.nome IS NULL     AND b.nome IS NOT NULL THEN 'so no banco'
        ELSE                                                '>> ORFAO (so em cotacao)'
    END                             AS situacao,
    b.calc_mode,
    b.factor,
    b.axles,
    coalesce(u.cotacoes, 0)         AS cotacoes,
    coalesce(u.ativas, 0)           AS ativas,
    coalesce(u.na_lixeira, 0)       AS lixeira,
    coalesce(u.cotacao_normal, 0)   AS normal,
    coalesce(u.fast, 0)             AS fast,
    coalesce(u.demais_plantas, 0)   AS demais,
    u.ultimo_uso
FROM nomes n
LEFT JOIN codigo c ON c.nome = n.nome
LEFT JOIN banco  b ON b.nome = n.nome
LEFT JOIN uso    u ON u.nome = n.nome
-- Mais usados primeiro: é a ordem em que o risco de mexer importa.
ORDER BY coalesce(u.cotacoes, 0) DESC, n.nome;

-- ---------------------------------------------------------------------
-- COMPLEMENTAR (rode separado — o SQL Editor mostra só a última query).
--
-- O vocabulário das telas Suzano, que é OUTRO campo e não se mistura com o de
-- cima. Serve para ver o que o Fast/Demais Plantas gravam em cada lado:
-- veiculo_tipo_operacao guarda "CARRETA"/"TRUCK" (a tabela de preço), enquanto
-- vehicle_type guarda a tradução para a calculadora ("Carreta Simples",
-- "truck" minúsculo).
-- ---------------------------------------------------------------------
-- SELECT operacao,
--        coalesce(veiculo_tipo_operacao, '(nulo)') AS veiculo_operacao,
--        coalesce(vehicle_type, '(nulo)')          AS vehicle_type_calculadora,
--        count(*)                                  AS cotacoes
--   FROM public.freight_calculations
--  WHERE operacao IS NOT NULL
--  GROUP BY 1, 2, 3
--  ORDER BY operacao, cotacoes DESC;

-- =====================================================================
-- tipo_precificacao — como o preço da cotação foi formado
-- =====================================================================
-- O modo TABELADO lança fretes já fechados por contrato/acordo: o operador
-- informa o valor final e a margem pretendida, e o sistema resolve a engine ao
-- contrário para achar quanto sobra para o motorista. Não consulta o Qualp.
--
--   'tabelado' -> preço veio de tabela/contrato (valor final digitado)
--   NULL       -> modo Calcular, o padrão (custos -> valor final)
--
-- Aditiva e anulável, em tabela existente: as policies de freight_calculations
-- (fc_select/fc_insert/fc_update/fc_delete) NÃO são tocadas. A coluna herda o
-- controle de acesso que já existe — não há policy por coluna aqui, então quem
-- lê a cotação lê este campo, e quem grava a cotação grava este campo.
--
-- Para filtrar depois no controle:
--   SELECT proposal_number, origin, destination, total_freight, base_freight,
--          suggested_freight, profit_margin, real_margin_percent, created_by_name,
--          to_timestamp(created_at/1000) AT TIME ZONE 'America/Sao_Paulo' AS criada
--   FROM public.freight_calculations
--   WHERE tipo_precificacao = 'tabelado'
--   ORDER BY created_at DESC;
-- =====================================================================

ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS tipo_precificacao text;

COMMENT ON COLUMN public.freight_calculations.tipo_precificacao IS
    'Como o preco foi formado: ''tabelado'' = valor final veio de tabela/contrato (engine resolvida ao contrario); NULL = modo Calcular (custos -> valor final).';

-- Índice parcial: a consulta de controle olha só as tabeladas, que são a minoria.
CREATE INDEX IF NOT EXISTS idx_fc_tipo_precificacao_tabelado
    ON public.freight_calculations (created_at DESC)
    WHERE tipo_precificacao = 'tabelado';

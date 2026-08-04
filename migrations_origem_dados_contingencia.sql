-- =====================================================================
-- origem_dados — marca a procedência dos números da cotação
-- =====================================================================
-- Incidente de 04/08/2026: o Qualp passou a recusar toda rota com
-- 422 PermissionDeniedException (problema de plano no lado deles). Foi ligado
-- um MODO CONTINGÊNCIA em que a cotação de rota simples fecha sem o Qualp:
-- pedágio digitado à mão e piso pela Tabela A local (utils/antt.ts).
--
-- Esta coluna marca quais cotações fecharam assim, para auditoria depois:
--   'contingencia' -> fechada sem o Qualp (pedágio manual, piso local)
--   NULL           -> fluxo normal (números do Qualp, ou anterior à coluna)
--
-- Aditiva e anulável: tabela existente, RLS e policies inalteradas.
-- Para listar depois:
--   SELECT proposal_number, origin, destination, distance_km, tolls,
--          suggested_freight, total_freight, created_by_name,
--          to_timestamp(created_at/1000) AT TIME ZONE 'America/Sao_Paulo' AS criada
--   FROM public.freight_calculations
--   WHERE origem_dados = 'contingencia'
--   ORDER BY created_at;
-- =====================================================================

ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS origem_dados text;

COMMENT ON COLUMN public.freight_calculations.origem_dados IS
    'Procedencia dos numeros: ''contingencia'' = fechada sem o Qualp (pedagio manual + piso da tabela local); NULL = fluxo normal.';

-- Índice parcial: a consulta de auditoria só olha as de contingência, que são
-- a minoria absoluta.
CREATE INDEX IF NOT EXISTS idx_fc_origem_dados_contingencia
    ON public.freight_calculations (created_at DESC)
    WHERE origem_dados = 'contingencia';

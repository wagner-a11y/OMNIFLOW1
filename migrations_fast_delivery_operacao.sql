-- =====================================================================
-- FAST DELIVERY — marcador de operação na cotação (Bloco 3)
--
-- ADITIVA E NULLABLE. As 1.151 cotações existentes ficam com NULL e nada
-- muda para elas. Segue o padrão que o projeto já usa para marcar procedência
-- de cotação: `origem_dados` ('contingencia') e `tipo_precificacao`
-- ('tabelado') são exatamente isso.
--
-- Não cria tabela paralela e não toca em nenhuma policy — as quatro policies
-- de freight_calculations (fc_select/insert/update/delete) valem por linha, não
-- por coluna, então uma coluna nova entra sob as mesmas regras.
--
-- O índice existe para a ANTI-DUPLICAÇÃO por DT, que é o ponto crítico numa
-- operação que lança dezenas de fretes por dia:
--     WHERE operacao = 'FAST_DELIVERY' AND client_reference = <DT>
-- =====================================================================

ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS operacao text;

COMMENT ON COLUMN public.freight_calculations.operacao IS
    'Operação de origem da cotação. NULL = cotação normal. FAST_DELIVERY = lançada pelo Excel do OTM (Suzano Fast Delivery).';

CREATE INDEX IF NOT EXISTS freight_calculations_operacao_dt
    ON public.freight_calculations (operacao, client_reference)
    WHERE operacao IS NOT NULL;

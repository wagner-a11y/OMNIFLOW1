-- =====================================================================
-- Mini CRM — coluna de resumo da empresa (campo "situacao" da base)
-- =====================================================================
-- "situacao" = texto-resumo da posição da empresa (ex.: "contrato formalizado,
-- onboarding"). NÃO confundir com crm_contato.status (respondeu/não respondeu).
-- Aditivo, só no CRM, idempotente.
-- =====================================================================

ALTER TABLE public.crm_empresa
    ADD COLUMN IF NOT EXISTS resumo text;

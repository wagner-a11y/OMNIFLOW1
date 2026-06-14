-- Três campos espelhados do card (select/checklist). Aditivo; não toca em Ramper, fórmula
-- nem estrutura do Pipefy. necessidade_gr é jsonb (lista dos marcados).
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS mercadoria_nova_usada text;
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS outras_necessidades_pipefy text;
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS necessidade_gr jsonb;

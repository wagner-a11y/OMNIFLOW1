-- Migration: novos campos da calculadora de cotação v2
-- 1) Cronômetro de elaboração (tempo gasto montando a cotação, em segundos)
ALTER TABLE freight_calculations
ADD COLUMN IF NOT EXISTS elaboration_seconds numeric DEFAULT 0;

COMMENT ON COLUMN freight_calculations.elaboration_seconds IS 'Tempo de elaboração da cotação em segundos (cronômetro)';

-- 2) Limiar de margem configurável (alerta/modal de confirmação)
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS margin_threshold numeric DEFAULT 15;

COMMENT ON COLUMN system_config.margin_threshold IS 'Limiar mínimo de margem (%) que dispara o modal de confirmação ao salvar/fechar';

-- Garante valor padrão na linha de config existente
UPDATE system_config SET margin_threshold = 15 WHERE id = 'default' AND margin_threshold IS NULL;

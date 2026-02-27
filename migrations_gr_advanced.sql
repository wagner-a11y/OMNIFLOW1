
-- Migration: Add advanced GR fields
ALTER TABLE freight_calculations 
ADD COLUMN IF NOT EXISTS motorista_rg text,
ADD COLUMN IF NOT EXISTS motorista_cnh_registro text,
ADD COLUMN IF NOT EXISTS motorista_cnh_protocolo text,
ADD COLUMN IF NOT EXISTS motorista_cnh_seguranca text,

ADD COLUMN IF NOT EXISTS placa_cavalo_renavam text,
ADD COLUMN IF NOT EXISTS placa_cavalo_chassi text,
ADD COLUMN IF NOT EXISTS placa_cavalo_cor text,
ADD COLUMN IF NOT EXISTS placa_cavalo_ano_fab text,
ADD COLUMN IF NOT EXISTS placa_cavalo_ano_mod text,
ADD COLUMN IF NOT EXISTS placa_cavalo_marca text,
ADD COLUMN IF NOT EXISTS placa_cavalo_modelo text,

ADD COLUMN IF NOT EXISTS placa_carreta_1_renavam text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_chassi text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_cor text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_ano_fab text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_ano_mod text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_marca text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_modelo text,

ADD COLUMN IF NOT EXISTS placa_carreta_2_renavam text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_chassi text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_cor text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_ano_fab text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_ano_mod text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_marca text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_modelo text;

-- Comentários para clareza
COMMENT ON COLUMN freight_calculations.motorista_cnh_protocolo IS 'Protocolo impresso na vertical perto da foto';
COMMENT ON COLUMN freight_calculations.motorista_cnh_seguranca IS 'Número de segurança da CNH';

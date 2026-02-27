-- Migration: Add fields for Hiring Stage
ALTER TABLE freight_calculations 
ADD COLUMN IF NOT EXISTS motorista_nome text,
ADD COLUMN IF NOT EXISTS motorista_cpf text,
ADD COLUMN IF NOT EXISTS motorista_telefone text,
ADD COLUMN IF NOT EXISTS placa_cavalo text,
ADD COLUMN IF NOT EXISTS placa_carreta_1 text,
ADD COLUMN IF NOT EXISTS placa_carreta_2 text,
ADD COLUMN IF NOT EXISTS motorista_doc_url text,
ADD COLUMN IF NOT EXISTS placa_cavalo_doc_url text,
ADD COLUMN IF NOT EXISTS placa_carreta_1_doc_url text,
ADD COLUMN IF NOT EXISTS placa_carreta_2_doc_url text;

COMMENT ON COLUMN freight_calculations.motorista_nome IS 'Nome do motorista para contratação';
COMMENT ON COLUMN freight_calculations.motorista_cpf IS 'CPF do motorista para contratação';
COMMENT ON COLUMN freight_calculations.motorista_telefone IS 'Telefone do motorista';
COMMENT ON COLUMN freight_calculations.placa_cavalo IS 'Placa do cavalo ou truck';
COMMENT ON COLUMN freight_calculations.placa_carreta_1 IS 'Placa da primeira carreta';
COMMENT ON COLUMN freight_calculations.placa_carreta_2 IS 'Placa da segunda carreta (bi-trem)';

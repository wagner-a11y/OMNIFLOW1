-- Integração Pipefy (controle operacional). Trava de duplicado: guarda o id do card e quando
-- foi enviado. Aditivo; não altera o Ramper nem a fórmula de cálculo.
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS pipefy_card_id text;
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS pipefy_sent_at timestamptz;

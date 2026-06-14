-- Autocomplete Cliente/Solicitante: guarda o id do registro escolhido nas tabelas do Pipefy
-- (vínculo da conexão por id). Aditivo; não toca em Ramper, fórmula nem estrutura do Pipefy.
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS cliente_pipefy_id text;
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS solicitante_pipefy_id text;

-- Data de Fechamento da carga (3ª data; espelha o campo data_de_fechamento do Pipefy).
-- Mesmo tipo das outras duas datas (timestamptz). Aditivo; não toca em estrutura do Pipefy.
ALTER TABLE freight_calculations ADD COLUMN IF NOT EXISTS data_fechamento timestamptz;

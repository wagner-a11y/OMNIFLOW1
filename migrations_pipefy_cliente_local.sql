-- Ponte cliente local ↔ Pipefy: guarda no cadastro local o id do registro correspondente
-- na tabela "Clientes" do Pipefy. Aditivo; não toca em estrutura/tabelas do Pipefy.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pipefy_client_id text;

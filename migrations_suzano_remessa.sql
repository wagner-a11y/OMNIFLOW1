-- Migration: numero de REMESSA da Suzano na cotacao
--
-- A remessa vem na planilha do OTM e vai para o campo "Remessa" do card no
-- Pipefy, que e pesquisavel: o operador digita o numero na busca e acha o card.
--
-- NAO substitui a DT SAP. A DT segue sendo o identificador, em client_reference
-- (e, no card, no campo "Solicitacao (STE, Coleta, etc)"). Nada disso muda.
--
-- Por que persistir, e nao so passar da planilha para o card: o card nasce
-- DEPOIS, a partir da cotacao ja salva -- nao do arquivo. Sem coluna, a remessa
-- morreria na importacao.
--
-- text, nao numeric: remessa e identificador. Como numero perderia zero a
-- esquerda e, acima de 2^53, arredondaria o ultimo digito -- e aí a busca do
-- Pipefy nao acharia mais o card.
--
-- Idempotente: seguro rodar mais de uma vez.
ALTER TABLE freight_calculations
ADD COLUMN IF NOT EXISTS remessa text;

COMMENT ON COLUMN freight_calculations.remessa IS 'Numero de remessa da Suzano, lido da planilha do OTM. Alimenta o campo "Remessa" (short_text) do card no Pipefy. NULL = nao informado. Nao confundir com client_reference, que e a DT SAP.';

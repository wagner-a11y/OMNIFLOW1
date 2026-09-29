-- =====================================================================
-- status 'carregando' no CHECK de freight_calculations
-- =====================================================================
-- >>> JÁ APLICADA EM PRODUÇÃO em 29/09/2026, pelo SQL Editor. <<<
-- Este arquivo existe para VERSIONAR o que já foi feito, não para ser
-- executado como um passo novo. Rodar de novo é inofensivo (idempotente),
-- mas não há nada pendente.
--
-- POR QUE ESTE ARQUIVO EXISTE. A tabela freight_calculations foi criada fora
-- do repositório, pelo painel do Supabase, então nem o tipo nem as constraints
-- dela estavam versionados aqui. Quando o funil ganhou a coluna "Carregando
-- Hoje" com o status novo `carregando`, arrastar um card para ela não
-- funcionava: o código gravava normalmente e o BANCO recusava, porque o
-- constraint freight_calculations_status_check só conhecia os status antigos.
--
-- O diagnóstico custou uma investigação inteira do lado errado — procurou-se
-- whitelist, type guard e switch no código, e não havia nenhum: o caminho do
-- arrasto até o upsert sempre tratou `carregando` como trata `aprovada`. A
-- regra que barrava estava no banco, invisível para quem lê só o repo. Por
-- isso ela passa a morar aqui.
--
-- A LISTA NÃO TEM `spot_simulated` de propósito: nada no sistema grava esse
-- status (ele é só lido, para rotular simulação na tela), e o ALTER abaixo
-- rodou sem erro em produção — o que prova que nenhuma linha o usa. Se um dia
-- alguém for GRAVAR spot_simulated, tem de entrar nesta lista antes, ou o
-- insert será recusado exatamente como o `carregando` era.
--
-- Vale a mesma regra para qualquer estágio novo do funil: coluna nova no
-- kanban pede valor novo AQUI, senão o card não se move e o motivo não aparece
-- em lugar nenhum do código.
-- =====================================================================

ALTER TABLE public.freight_calculations
    DROP CONSTRAINT IF EXISTS freight_calculations_status_check;

ALTER TABLE public.freight_calculations
    ADD CONSTRAINT freight_calculations_status_check
    CHECK (status IN ('pending', 'respondida', 'aprovada', 'carregando', 'em_operacao', 'won', 'lost'));

COMMENT ON COLUMN public.freight_calculations.status IS
    'Estagio da cotacao; e tambem a coluna do funil de faturamento (CRMBoard). Valores permitidos pelo constraint freight_calculations_status_check. Estagio novo no funil exige acrescentar o valor la primeiro.';

-- ---------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — a lista em vigor no banco.
-- ---------------------------------------------------------------------
SELECT conname, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint
 WHERE conrelid = 'public.freight_calculations'::regclass
   AND conname = 'freight_calculations_status_check';

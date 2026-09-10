-- =====================================================================
-- FAST DELIVERY — carroceria no de-para de equipamento
--
-- O PROBLEMA: o código do OTM dizia só o TIPO DE VEÍCULO. Dois códigos caem
-- em CARRETA — 10910 e 10920 — e a operação sabe que um é Sider e o outro
-- Grade Baixa, mas o de-para não tinha onde guardar isso. A cotação nascia com
-- carroceria "Baú" fixa (CARROCERIA_FIXA, services/fastDelivery.ts) e o cliente
-- recebia o carro errado.
--
-- O QUE MUDA: cada código passa a ter tipo_veiculo + carroceria.
--
-- O QUE NÃO MUDA: o PREÇO. O cruzamento da tabela é destino × tipo_veiculo e
-- continua exatamente assim — a carroceria não entra em fast_delivery_preco,
-- não tem coluna lá, e não participa de nenhuma chave de busca de valor. É
-- informação que viaja para a cotação e para o card do Pipefy, e só.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A coluna
--
-- NULL É PERMITIDO, de propósito. Os cinco códigos já classificados entram
-- aqui sem carroceria, e é essa ausência que a tela usa para listar "falta
-- definir a carroceria destes códigos". Um DEFAULT 'Baú' apagaria justamente
-- a informação que se quer ver: o que ainda não foi decidido por gente.
--
-- Nada é chutado nesta migration. Nenhum UPDATE preenche 10910 com Sider —
-- quem sabe qual é qual é o master, na tela.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_equipamento
    ADD COLUMN IF NOT EXISTS carroceria text;

-- ---------------------------------------------------------------------
-- 2. Trava de vocabulário
--
-- A MESMA lista do campo "Implemento" (qual_o_tipo_de_carreta) do Pipefy, que
-- é também a que a cotação normal usa (IMPLEMENTO_OPTIONS, constants.ts). Uma
-- grafia fora dela chega no Pipefy e não casa com opção nenhuma: o card sai com
-- o campo vazio, sem erro, sem aviso. Melhor recusar na escrita.
--
-- Se um dia a lista do Pipefy mudar, mudam as DUAS: esta CHECK e a constante
-- IMPLEMENTO_OPTIONS. Elas são a mesma lista escrita em dois lugares porque
-- uma trava só no front não é trava.
--
-- NULL passa: é "ainda não classificada", não é valor inválido.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_equipamento
    DROP CONSTRAINT IF EXISTS fast_delivery_equipamento_carroceria_valida;
ALTER TABLE public.fast_delivery_equipamento
    ADD CONSTRAINT fast_delivery_equipamento_carroceria_valida
    CHECK (carroceria IS NULL OR carroceria IN
        ('Sider', 'Baú', 'Grade Baixa', 'Graneleiro', 'N/A', 'Prancha'));

COMMENT ON COLUMN public.fast_delivery_equipamento.carroceria IS
    'Implemento do veículo daquele código do OTM. Vai para a cotação '
    '(carroceria_tipo_operacao) e para o campo Implemento do card do Pipefy. '
    'NÃO participa do cálculo de preço. NULL = ainda não classificada.';

-- ---------------------------------------------------------------------
-- 3. RLS — nada a fazer, e isto é o ponto
--
-- A policy de escrita já é FOR ALL com is_master(), então ela vale para a
-- linha INTEIRA: coluna nova entra sob a mesma trava, sem policy nova. Não há
-- column-level grant separado em jogo — o GRANT de UPDATE é da tabela.
--
-- Recriadas abaixo assim mesmo, idempotentes, para que rodar esta migration
-- num banco que perdeu as policies devolva o estado certo em vez de deixar a
-- tabela aberta. Se já existem, o resultado é idêntico.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_equipamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fd_equip_sel ON public.fast_delivery_equipamento;
DROP POLICY IF EXISTS fd_equip_wri ON public.fast_delivery_equipamento;
CREATE POLICY fd_equip_sel ON public.fast_delivery_equipamento FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_equip_wri ON public.fast_delivery_equipamento FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- ---------------------------------------------------------------------
-- 4. Conferência — quais códigos ainda estão sem carroceria
--
-- É a mesma pergunta que a tela responde para o master. Rodar depois da
-- migration deve listar os cinco códigos existentes, todos com carroceria nula.
-- ---------------------------------------------------------------------
-- SELECT codigo_otm, tipo_veiculo, carroceria
--   FROM public.fast_delivery_equipamento
--  ORDER BY (carroceria IS NOT NULL), codigo_otm;

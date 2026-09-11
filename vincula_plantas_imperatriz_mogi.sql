-- =====================================================================
-- Vincula Imperatriz e Mogi das Cruzes ao cliente do Pipefy
--
-- Completa o que a migration de vínculo deixou em branco de propósito: quando
-- ela rodou, esses dois registros ainda não existiam na tabela "Clientes" do
-- Pipefy, e inventar id teria criado um vínculo para lugar nenhum.
--
-- Os ids saíram de busca REAL na tabela do Pipefy em 11/09/2026, com a grafia
-- exata que o Wagner cadastrou:
--     1444123274  "Suzano Imperatriz/MA"
--     1444123566  "Suzano Mogi das Cruzes/SP"
--
-- Não é migration: é carga de dado, roda uma vez. Sem BEGIN/ROLLBACK — o efeito
-- tem de permanecer.
-- =====================================================================

-- A guarda `pipefy_cliente_id IS NULL` é de propósito: se você já tiver
-- vinculado pela tela, isto NÃO sobrescreve. Para TROCAR um vínculo existente,
-- use a tela (Plantas → corrigir) ou tire a guarda conscientemente.
UPDATE public.fast_delivery_planta
   SET pipefy_cliente_id   = '1444123274',
       pipefy_cliente_nome = 'Suzano Imperatriz/MA',
       atualizado_em       = now()
 WHERE codigo_planta = 'FAB_IMP_1301'
   AND pipefy_cliente_id IS NULL;

UPDATE public.fast_delivery_planta
   SET pipefy_cliente_id   = '1444123566',
       pipefy_cliente_nome = 'Suzano Mogi das Cruzes/SP',
       atualizado_em       = now()
 WHERE codigo_planta = 'FAB_MOG_1110'
   AND pipefy_cliente_id IS NULL;

-- Conferência: as cinco plantas e seus vínculos. Última query do arquivo, então
-- é esta que o SQL Editor mostra.
SELECT codigo_planta, cidade, uf, pipefy_cliente_nome, pipefy_cliente_id
  FROM public.fast_delivery_planta
 ORDER BY (pipefy_cliente_id IS NOT NULL), codigo_planta;

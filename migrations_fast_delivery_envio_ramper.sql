-- =====================================================================
-- Registro do envio ao RAMPER na cotação
--
-- O QUE FALTAVA. O Pipefy já tinha onde registrar o envio desde
-- migrations_pipefy.sql: pipefy_card_id, pipefy_sent_at e, depois,
-- pipefy_card_url. O Ramper nunca teve. O envio acontecia, o card era criado,
-- e do lado de cá não sobrava nada — nem no Fast Delivery, nem no fluxo normal.
--
-- POR QUE ISSO IMPORTA AGORA. O histórico do Fast Delivery precisa responder
-- "esta carga já foi para o Ramper?". Sem coluna, a única resposta possível era
-- o estado da tela, que morre no F5 — e foi exatamente assim que o Fast Delivery
-- vinha criando card duplicado sem avisar ninguém.
--
-- SIMÉTRICO AO PIPEFY, de propósito: um "quando" e um "qual". O id vem junto
-- porque a resposta do Ramper já o devolve; jogá-lo fora hoje custaria outra
-- migration amanhã.
-- =====================================================================

-- ---------------------------------------------------------------------
-- As colunas
--
-- Nullable e sem DEFAULT. Nulo quer dizer "não foi enviado" — é essa ausência
-- que o histórico lê para decidir se mostra o botão. Um DEFAULT aqui marcaria
-- como enviada toda cotação que já existe, inclusive as que nunca viram o
-- Ramper, e a lista nasceria mentindo.
--
-- ADD COLUMN de coluna nullable sem default não reescreve a tabela: o Postgres
-- só anota no catálogo. Em freight_calculations, que é grande e central, isso é
-- o que separa uma migration instantânea de uma que trava a operação.
-- ---------------------------------------------------------------------
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS ramper_sent_at        timestamptz,
    ADD COLUMN IF NOT EXISTS ramper_opportunity_id text;

COMMENT ON COLUMN public.freight_calculations.ramper_sent_at IS
    'Quando esta cotação foi enviada ao Ramper. NULL = não enviada. '
    'Espelha pipefy_sent_at; é a trava anti-duplicação que sobrevive ao F5.';

COMMENT ON COLUMN public.freight_calculations.ramper_opportunity_id IS
    'Id da oportunidade devolvido pelo Ramper, quando a resposta o traz. '
    'Pode ser NULL mesmo com ramper_sent_at preenchido: o envio deu certo e a '
    'resposta nao trouxe id reconhecivel. Quem manda na trava e o sent_at.';

-- ---------------------------------------------------------------------
-- RLS — nada muda, e o motivo é bom
--
-- freight_calculations já tem (migrations_rls_stage_d.sql):
--     fc_select  ... using (true)
--     fc_insert  ... with check (true)
--     fc_update  ... using (true) with check (true)
--     fc_delete  ... using (public.is_master())
--
-- A policy de UPDATE vale para a linha inteira, então coluna nova entra sob a
-- mesma regra, sem policy nova. Marcar envio é operação de quem opera — não é
-- privilégio de master, como classificar equipamento é.
--
-- O que a simulação ao lado prova é justamente que isso não abriu nada para
-- anon, e que a coluna nova não escapa da RLS existente.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'freight_calculations'
--    AND column_name IN ('pipefy_card_id','pipefy_sent_at','pipefy_card_url',
--                        'ramper_sent_at','ramper_opportunity_id')
--  ORDER BY column_name;
--
-- Esperado: as cinco, todas is_nullable = YES.

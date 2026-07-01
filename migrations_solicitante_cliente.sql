-- =====================================================================
-- Contato Diário — vínculo solicitante → cliente (Parte 2)
-- =====================================================================
-- Aditivo. cada cliente tem vários solicitantes; cada solicitante pertence a um
-- cliente só. O vínculo mora no cadastro canônico cd_solicitante, referenciando
-- o cadastro de clientes que já existe (customers) — não cria cliente novo.
-- A RLS de cd_solicitante (master gerencia, operador lê a carteira dele) já cobre
-- essa coluna. Estrutura pronta p/ meta futura (coluna aditiva em cd_solicitante
-- e/ou customers, sem retrabalho). Idempotente.
-- =====================================================================

-- customers.id é text (não uuid), então cliente_id é text.
ALTER TABLE public.cd_solicitante
    ADD COLUMN IF NOT EXISTS cliente_id text REFERENCES public.customers(id);

CREATE INDEX IF NOT EXISTS idx_cd_solicitante_cliente ON public.cd_solicitante (cliente_id);

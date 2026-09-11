-- =====================================================================
-- Vínculo da planta com o CLIENTE do Pipefy
--
-- O PROBLEMA. O card das Demais Plantas nascia com cliente "Suzano Fast" e
-- solicitante "Operação Fast Delivery" — os fixos do Fast, herdados quando o
-- envio virou código compartilhado. Carga de Mucuri chegava ao Pipefy como
-- cliente do Fast.
--
-- POR QUE NÃO BASTA TROCAR O TEXTO. O campo Cliente do card é uma CONEXÃO com a
-- tabela "Clientes" do Pipefy: ele se preenche pelo ID do registro, não pelo
-- nome. Mandar "Suzano Imperatriz" como texto deixa a conexão VAZIA — a Edge
-- Function nunca cria registro, e está certa em não criar.
--
-- POR QUE NÃO DERIVAR O NOME DA CIDADE. A grafia lá varia e não segue regra:
--     "Suzano Mucuri/BA"   "Suzano Aracruz"   "SUZANO LIMEIRA"
--     "SUZANO TRES LAGOAS" "Suzano SBC"
-- Derivar "Suzano " || cidade acertaria Aracruz e erraria Mucuri, em silêncio.
-- Adivinhar grafia foi o que produziu os bugs anteriores desta operação.
--
-- Então o vínculo vira CADASTRO, como tudo o mais aqui: o master escolhe o
-- cliente da busca do Pipefy uma vez, e o id fica guardado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- As colunas
--
-- Nullable: planta pode existir sem vínculo, e existe hoje — Imperatriz e Mogi
-- das Cruzes ainda não têm registro na tabela Clientes do Pipefy. Nulo aqui é
-- "falta vincular", e é essa ausência que a tela mostra.
--
-- O NOME vai junto do id, e não é redundância: é o que a tela exibe para
-- conferência humana sem precisar consultar o Pipefy, e o que denuncia se
-- alguém renomear o registro lá sem avisar.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_planta
    ADD COLUMN IF NOT EXISTS pipefy_cliente_id   text,
    ADD COLUMN IF NOT EXISTS pipefy_cliente_nome text;

COMMENT ON COLUMN public.fast_delivery_planta.pipefy_cliente_id IS
    'Id do registro na tabela "Clientes" do Pipefy. É por ele que a conexão do '
    'card se preenche — o nome sozinho não vincula. NULL = falta vincular.';

COMMENT ON COLUMN public.fast_delivery_planta.pipefy_cliente_nome IS
    'Nome do registro, como está no Pipefy. Para conferência na tela; o que '
    'vincula é o id.';

-- ---------------------------------------------------------------------
-- Vínculos que já dá para fazer
--
-- Três das cinco plantas têm cliente no Pipefy, conferido por busca na tabela
-- em 11/09/2026. Os ids saíram dessa busca, não de palpite.
--
-- FAB_IMP_1301 (Imperatriz) e FAB_MOG_1110 (Mogi das Cruzes) ficam SEM vínculo:
-- não existe registro para elas no Pipefy. Quando o Wagner criar, é a tela que
-- vincula — nada aqui inventa id.
-- ---------------------------------------------------------------------
UPDATE public.fast_delivery_planta
   SET pipefy_cliente_id = '1151687193', pipefy_cliente_nome = 'Suzano Mucuri/BA',
       atualizado_em = now()
 WHERE codigo_planta = 'FAB_MUC_2100' AND pipefy_cliente_id IS NULL;

UPDATE public.fast_delivery_planta
   SET pipefy_cliente_id = '1102464122', pipefy_cliente_nome = 'Suzano Aracruz',
       atualizado_em = now()
 WHERE codigo_planta = 'FAB_ARA_6300' AND pipefy_cliente_id IS NULL;

UPDATE public.fast_delivery_planta
   SET pipefy_cliente_id = '1121617000', pipefy_cliente_nome = 'SUZANO LIMEIRA',
       atualizado_em = now()
 WHERE codigo_planta = 'FAB_LIM_5400' AND pipefy_cliente_id IS NULL;

-- ---------------------------------------------------------------------
-- RLS — nada muda
--
-- fast_delivery_planta já tem fd_planta_sel (todos leem) e fd_planta_wri
-- (só master escreve, FOR ALL). A policy vale para a linha inteira, então
-- coluna nova entra sob a mesma trava. Vincular cliente é a mesma classe de
-- decisão que definir a cidade: quem responde por ela é o master.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
-- SELECT codigo_planta, cidade, uf, pipefy_cliente_nome, pipefy_cliente_id
--   FROM public.fast_delivery_planta ORDER BY codigo_planta;
-- Esperado: Mucuri, Aracruz e Limeira vinculadas; Imperatriz e Mogi em branco.

-- =====================================================================
-- freight_calculations: o que a tabela EXIGE — registro do que doeu descobrir
-- =====================================================================
-- >>> NÃO EXECUTA NADA. Este arquivo é DOCUMENTAÇÃO + uma consulta. <<<
--
-- POR QUE ELE EXISTE. A tabela freight_calculations foi criada fora do
-- repositório, pelo painel do Supabase. Nem o tipo das colunas, nem as
-- constraints, nem quais são NOT NULL estão versionados em lugar nenhum — e essa
-- lacuna já custou duas investigações nesta semana:
--
--   29/09  o card do funil nao se movia para "Carregando Hoje". O codigo estava
--          certo; um CHECK que nenhum arquivo do repo mencionava recusava o
--          status novo. Virou migrations_freight_status_carregando.sql.
--   29/09  o primeiro card criado por e-mail nao nasceu:
--            null value in column "ad_valorem" violates not-null constraint
--          A extracao estava perfeita. Faltava uma coluna obrigatoria que
--          ninguem tinha como saber que era obrigatoria.
--
-- Nos dois casos o erro estava no BANCO e a busca começou no código, porque é lá
-- que se procura quando o repo não conta a verdade sobre o banco.
--
-- CONFIRMADO NOT NULL (pela via dura, em produção):
--   ad_valorem
--
-- ENVIADAS POR PRECAUÇÃO, espelhando o insert da calculadora
-- (createFreightCalculation), sem cada uma ter sido confirmada individualmente:
--   distance_km, weight, goods_value, base_freight, tolls, extra_costs,
--   insurance_percent, profit_margin, icms_percent, icms_manual, pagador_mg,
--   pis_percent, cofins_percent, csll_percent, irpj_percent,
--   suggested_freight, total_freight, real_profit, real_margin_percent,
--   elaboration_seconds, destinations, created_at, disponibilidade, status
--
-- REGRA PARA QUEM FOR INSERIR AQUI DE UM LUGAR NOVO (robô, importador, script):
-- espelhe a lista de createFreightCalculation em services/database.ts. Não monte
-- um insert "mínimo" a partir do que parece necessário — o mínimo real não está
-- escrito em nenhum lugar, e cada descoberta custa um registro perdido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A CONSULTA — rode quando quiser a lista de verdade, direto do banco.
-- Colunas obrigatórias são as NOT NULL SEM default: nessas, omitir o campo
-- derruba o insert. Com default, o banco preenche e o silêncio é inofensivo.
-- ---------------------------------------------------------------------
SELECT column_name,
       data_type,
       column_default,
       CASE WHEN column_default IS NULL
            THEN '>> OBRIGATORIA no insert'
            ELSE 'tem default' END AS situacao
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'freight_calculations'
   AND is_nullable = 'NO'
 ORDER BY (column_default IS NULL) DESC, column_name;

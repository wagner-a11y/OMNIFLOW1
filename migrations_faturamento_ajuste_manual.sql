-- =====================================================================
-- AJUSTE MANUAL DE FATURAMENTO — as NFS que não passam pelo TMS
-- =====================================================================
-- A Omnicargo emite algumas notas de serviço FORA do TMS: elas não viram CTe,
-- então o relatório do TMS (a fonte de todo o painel) fica R$ 20-30 mil abaixo
-- do real todo mês. O painel é motivacional e mostrava sempre menos do que a
-- operação de fato faturou.
--
-- Aqui fica o complemento, digitado pelo master. UMA LINHA POR MÊS:
--   * o mês é 'YYYY-MM' e é a chave, então cada mês tem o seu valor;
--   * mês novo não existe na tabela -> o app lê 0 e o painel mostra o TMS puro.
--     É assim que "zera na virada do mês" acontece: por ausência de linha, sem
--     rotina de virada, sem cron, sem nada para dar errado à meia-noite.
--
-- O QUE O AJUSTE NÃO TOCA: o gráfico da semana continua sendo só CTe do TMS.
-- O ajuste é um total do mês; distribuí-lo pelos dias seria inventar data de
-- emissão que ninguém informou.
--
-- ESTE NÚMERO NÃO É CONTÁBIL. É o painel da parede. O número oficial é o do
-- financeiro — está dito aqui porque alguém vai achar esta tabela um dia e
-- precisar saber o que ela é.
--
-- Idempotente: seguro rodar mais de uma vez.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.faturamento_ajuste_manual (
    mes            text PRIMARY KEY,
    valor          numeric NOT NULL DEFAULT 0,
    atualizado_por text,
    atualizado_em  timestamptz NOT NULL DEFAULT now(),
    -- 'YYYY-MM' e nada além disso: a chave é comparada como TEXTO pelo app e
    -- pela Edge Function (sem Date, por causa do fuso), então formato torto
    -- viraria uma linha órfã que ninguém encontra.
    CONSTRAINT faturamento_ajuste_manual_mes_formato CHECK (mes ~ '^[0-9]{4}-[0-9]{2}$')
);

COMMENT ON TABLE  public.faturamento_ajuste_manual IS
    'Complemento manual do faturamento do mes (NFS emitidas fora do TMS, que nao viram CTe). Digitado pelo master; soma ao total do mes no Dashboard e no Painel TV. NAO e numero contabil.';
COMMENT ON COLUMN public.faturamento_ajuste_manual.mes IS
    'Mes de competencia, "YYYY-MM" (America/Sao_Paulo). Ausencia de linha = ajuste zero.';
COMMENT ON COLUMN public.faturamento_ajuste_manual.valor IS
    'Valor a SOMAR ao faturamento do TMS naquele mes. Aceita negativo de proposito: serve para corrigir um lancamento a maior sem apagar o historico.';
COMMENT ON COLUMN public.faturamento_ajuste_manual.atualizado_por IS
    'Nome de quem digitou por ultimo. Rastro simples: quem colocou aquele numero na parede.';

-- ---------------------------------------------------------------------
-- RLS — leitura para quem está logado, ESCRITA SÓ PARA O MASTER.
--
-- is_master() é a mesma função que customers e vehicle_configs já usam
-- (migrations_rls_stage_d.sql): security definer, lê profiles por auth.uid().
--
-- A TV não passa por aqui: ela lê pela get-faturamento-publico, que usa
-- service_role atrás do token e ignora RLS.
-- ---------------------------------------------------------------------
ALTER TABLE public.faturamento_ajuste_manual ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fam_select ON public.faturamento_ajuste_manual;
DROP POLICY IF EXISTS fam_insert ON public.faturamento_ajuste_manual;
DROP POLICY IF EXISTS fam_update ON public.faturamento_ajuste_manual;
DROP POLICY IF EXISTS fam_delete ON public.faturamento_ajuste_manual;

CREATE POLICY fam_select ON public.faturamento_ajuste_manual
    FOR SELECT TO authenticated USING (true);
CREATE POLICY fam_insert ON public.faturamento_ajuste_manual
    FOR INSERT TO authenticated WITH CHECK (public.is_master());
CREATE POLICY fam_update ON public.faturamento_ajuste_manual
    FOR UPDATE TO authenticated USING (public.is_master()) WITH CHECK (public.is_master());
-- Sem policy de DELETE de propósito: ajuste errado se corrige digitando outro
-- valor (inclusive zero). Apagar a linha só perderia o rastro de quem digitou.

-- =====================================================================
-- CONFERÊNCIA — rode junto e CONFIRA a saída antes de dar por aplicado.
--
-- Em 25/09/2026 a faturamento_diario nasceu sem RLS porque o ALTER TABLE não
-- chegou a rodar, e a tabela ficou legível pela anon key (a chave pública, que
-- vai no bundle). Descobrimos por acaso. Por isso a conferência vem junto da
-- migration agora, e não como passo separado que se esquece.
--
-- ESPERADO:  rls_ligada = true   e   TRÊS policies (select/insert/update).
-- =====================================================================
SELECT c.relname,
       c.relrowsecurity AS rls_ligada,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = 'faturamento_ajuste_manual') AS policies
  FROM pg_class c
 WHERE c.oid = 'public.faturamento_ajuste_manual'::regclass;

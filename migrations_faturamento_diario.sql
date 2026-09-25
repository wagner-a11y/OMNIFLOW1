-- =====================================================================
-- Faturamento DIA A DIA (TMS) — a série que o gráfico da TV lê
-- =====================================================================
-- O painel já mostrava o total do mês e o "emitidos hoje", os dois vindos de
-- faturamento_cache (linha única). O gráfico da semana precisa de outra coisa:
-- o valor de CADA dia, e de dias que podem estar no mês PASSADO.
--
-- POR QUE UMA TABELA, E NAO MAIS UMA COLUNA NO CACHE. O relatório do TMS é
-- pedido com `dados_periodo_emissao: 'mc'` — mês CORRENTE. Numa semana que
-- atravessa a virada (domingo 27/09, sábado 03/10), os dias de setembro
-- simplesmente não estão no HTML que a coleta de outubro baixa. Guardando a
-- série aqui, cada dia fica gravado de quando o mês dele era o corrente, e a
-- semana atravessa a virada inteira. De quebra sobra histórico para comparar
-- semanas, que o cache de linha única nunca poderia dar.
--
-- O QUE E UM "DIA" AQUI: a DATA DE EMISSAO do CTe, em America/Sao_Paulo. É o
-- mesmo critério do "emitidos hoje" que já está na tela — as duas contas têm de
-- bater, senão a barra de hoje discorda do número ao lado dela.
--
-- Idempotente: seguro rodar mais de uma vez.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.faturamento_diario (
    dia           date PRIMARY KEY,
    valor         numeric NOT NULL DEFAULT 0,
    ctes          integer NOT NULL DEFAULT 0,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.faturamento_diario IS
    'Faturamento por data de EMISSAO do CTe (America/Sao_Paulo). Alimentada pelo cron datamex-relatorio a cada 2 min, por upsert dos dias do mes corrente. Dias de meses anteriores nao sao tocados.';
COMMENT ON COLUMN public.faturamento_diario.dia   IS 'Data de emissao (BRT). Chave: um registro por dia.';
COMMENT ON COLUMN public.faturamento_diario.valor IS 'Soma do frete dos CTe emitidos nesse dia. No scraping = total da linha; na API Bsoft = autorizados.';
COMMENT ON COLUMN public.faturamento_diario.ctes  IS 'Quantos CTe entraram nessa soma.';

-- RLS: MESMO modelo de faturamento_cache — leitura para authenticated, nenhuma
-- policy de escrita. Quem grava é a Edge Function com service_role, que ignora
-- RLS; e o painel da TV (sem login) lê pela get-faturamento-publico, que também
-- usa service_role atrás do token. Nenhum acesso anonimo direto a tabela.
ALTER TABLE public.faturamento_diario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faturamento_diario_select ON public.faturamento_diario;
CREATE POLICY faturamento_diario_select ON public.faturamento_diario
    FOR SELECT TO authenticated USING (true);

-- A semana é sempre uma janela recente: o índice serve o BETWEEN de 7 dias.
CREATE INDEX IF NOT EXISTS faturamento_diario_dia_desc ON public.faturamento_diario (dia DESC);

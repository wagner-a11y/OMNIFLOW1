-- =====================================================================
-- Cron: atualiza o faturamento do mês de 2 em 2 minutos
-- =====================================================================
-- A cada 2 min (horário comercial), chama a Edge Function datamex-relatorio,
-- que raspa o total no TMS e grava em public.faturamento_cache. O painel lê
-- desse cache via realtime.
--
-- Janela: seg–sex, 07h–20h BRT  ->  10h–23h UTC (o pg_cron roda em UTC).
-- Para ALARGAR (ex.: 24/7), troque a expressão por '*/2 * * * *'.
-- Para PAUSAR:   select cron.unschedule('datamex-faturamento-2min');
--
-- Observação: __ANON_KEY__ é substituída pela anon key no momento de aplicar
-- (a anon key já é pública — usada no front — mas não a versionamos no repo).
-- Idempotente: recria o job se já existir.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove o job anterior, se existir (evita duplicar ao reaplicar).
SELECT cron.unschedule('datamex-faturamento-2min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'datamex-faturamento-2min');

SELECT cron.schedule(
    'datamex-faturamento-2min',
    '*/2 10-23 * * 1-5',
    $job$
    SELECT net.http_post(
        url     := 'https://trdkggiobsydruihvesj.supabase.co/functions/v1/datamex-relatorio',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer __ANON_KEY__'
        )
    );
    $job$
);

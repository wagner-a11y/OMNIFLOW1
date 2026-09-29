-- =====================================================================
-- CRON da gmail-intake — a leitura da caixa de cotações a cada 5 minutos
-- =====================================================================
-- Até aqui toda rodada era um disparo manual. Isto põe o robô de pé sozinho.
--
-- 5 MINUTOS, e não 2 como o do faturamento: cada e-mail custa uma chamada ao
-- Gemini com os anexos embutidos (~13s por e-mail; 5 e-mails ficam perto de
-- 65s). A cada 2 minutos duas rodadas poderiam se sobrepor; a cada 5 há folga
-- sobrando mesmo numa rodada cheia e lenta.
--
-- MESMO PADRÃO do datamex-faturamento-2min: pg_cron chamando a Edge Function por
-- net.http_post, com a anon key no header (a função está com verify_jwt = true).
--
-- >>> SUBSTITUA __ANON_KEY__ pela anon key do projeto ANTES de rodar. <<<
-- A chave não fica versionada aqui de propósito — é o mesmo cuidado do cron do
-- faturamento. Ela é pública (vai no bundle do site), mas versionar credencial
-- em repositório é hábito que uma vez adquirido não se perde.
--
-- Idempotente: desagenda antes de agendar, então rodar de novo não duplica o job.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('gmail-intake-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gmail-intake-5min');

SELECT cron.schedule(
    'gmail-intake-5min',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
        url     := 'https://trdkggiobsydruihvesj.supabase.co/functions/v1/gmail-intake',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer __ANON_KEY__'
        ),
        -- Corpo VAZIO de propósito: sem `backfill`, a função roda no modo
        -- incremental, que é o único que respeita o cutoff. Um `{"backfill":true}`
        -- aqui faria o cron varrer os mais recentes sem filtro de data a cada 5
        -- minutos — e a proteção dos e-mails antigos passaria a depender só da
        -- checagem por e-mail, em vez das quatro travas.
        body    := '{}'::jsonb,
        -- 5 e-mails (o teto_rodada) chegam perto de 65s. 120s dá margem para um
        -- anexo grande ou o Gemini lento sem cortar a rodada no meio. O default
        -- do pg_net é 5000ms, que cortaria toda execução.
        timeout_milliseconds := 120000
    );
    $job$
);

-- =====================================================================
-- POR QUE OS ~2.900 E-MAILS ANTIGOS CONTINUAM FORA
--
-- Agendar não afrouxa nenhuma trava. As quatro seguem valendo, e o cron passa
-- por todas elas a cada rodada:
--
--   1. a consulta ao Gmail leva `q=after:<cutoff>`, então e-mail anterior à
--      virada nem é listado;
--   2. antes de criar, a função compara a data de recebimento com o cutoff de
--      novo — proteção por e-mail, não só por consulta;
--   3. o que já está no gmail_intake_log não é reprocessado (nem relido no
--      Gemini, que custa);
--   4. o índice único parcial em freight_calculations.gmail_message_id recusa o
--      segundo card do mesmo e-mail, no banco. O 23505 é tratado como
--      "já existia", não como erro.
--
-- A trava 4 é a que cobre o caso novo que o cron cria: duas rodadas se
-- sobrepondo veriam o mesmo e-mail (nenhuma das duas o teria gravado no log
-- ainda) e as duas tentariam criar a cotação. A segunda bate no índice e para.
--
-- E o interruptor continua sendo o freio de mão: com
-- gmail_intake_config.ativo = false, o cron roda, lê e registra no log, mas NÃO
-- cria cotação nenhuma.
-- =====================================================================

-- ---------------------------------------------------------------------
-- COMO PAUSAR (guardar este trecho à mão — é o que se procura com pressa)
--
--   -- pausa a leitura por completo: o cron para de existir
--   SELECT cron.unschedule('gmail-intake-5min');
--
--   -- OU: mantém o cron rodando e só desliga a CRIAÇÃO de cotação
--   UPDATE public.gmail_intake_config SET ativo = false, atualizado_em = now() WHERE id = 1;
--
-- A diferença importa. O unschedule para de ler a caixa: os e-mails que
-- chegarem no intervalo continuam lá e serão lidos quando religar (o cutoff não
-- se move sozinho). O ativo = false continua lendo e registrando no log — só
-- não cria card. Para "parar de criar card errado", o segundo é melhor: não se
-- perde a visibilidade do que está chegando.
--
-- Religar a leitura é rodar este arquivo de novo (com a chave substituída).
-- ---------------------------------------------------------------------

-- CONFERÊNCIA (só leitura): o job existe e está ativo?
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'gmail-intake-5min';

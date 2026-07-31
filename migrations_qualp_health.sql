-- =====================================================================
-- qualp_health — log de saúde da integração Qualp (fonte única de rota)
-- =====================================================================
-- Uma linha por chamada da Edge Function qualp-rota (sucesso ou falha), com
-- latência, nº de tentativas e a rota consultada. Serve para responder
-- "o Qualp está de pé?" e para conferir consumo contra a fatura (id_transacao).
--
-- Quem escreve: SÓ a Edge Function, via service_role (que bypassa RLS).
-- Quem lê: qualquer analista autenticado (transparência de time, mesmo
--          princípio das outras tabelas do sistema).
-- anon: não lê nada. É dado operacional, não é o Painel TV.
--
-- Imutabilidade: a linha NUNCA muda. UPDATE é bloqueado por trigger, o que
-- barra até o postgres/service_role — log de saúde adulterado não serve para
-- diagnosticar nada. DELETE fica disponível só para service_role/postgres,
-- para permitir retenção (podar linhas antigas); analista e master não apagam.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.qualp_health (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    criado_em     timestamptz NOT NULL DEFAULT now(),
    ok            boolean     NOT NULL,
    status_http   int,
    erro          text,
    latencia_ms   int,
    tentativas    smallint,
    origem        text,
    destino       text,
    eixos         smallint,
    freight_load  text,
    distancia_km  numeric(10,3),
    pedagio_cheio numeric(12,2),
    piso_antt     numeric(12,2),   -- null = combinação sem piso ANTT (nunca zero)
    id_transacao  text             -- id do Qualp, p/ bater com a fatura
);

-- Consulta típica: "como está a saúde nas últimas horas" e "só as falhas".
CREATE INDEX IF NOT EXISTS idx_qualp_health_criado ON public.qualp_health (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_qualp_health_falhas ON public.qualp_health (criado_em DESC) WHERE ok = false;

-- ---------- Imutabilidade (barra até superuser) ----------
CREATE OR REPLACE FUNCTION public.qualp_health_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'qualp_health e imutavel: UPDATE bloqueado (log de saude)';
END;
$fn$;

DROP TRIGGER IF EXISTS qualp_health_sem_update ON public.qualp_health;
CREATE TRIGGER qualp_health_sem_update
    BEFORE UPDATE ON public.qualp_health
    FOR EACH ROW EXECUTE FUNCTION public.qualp_health_imutavel();

-- ---------- Privilégios ----------
-- Explícito em vez de confiar no default privilege do Supabase.
REVOKE ALL ON public.qualp_health FROM anon, authenticated;
GRANT SELECT ON public.qualp_health TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.qualp_health ENABLE ROW LEVEL SECURITY;

-- SELECT: todo analista autenticado lê tudo (transparência).
DROP POLICY IF EXISTS qualp_health_sel_auth ON public.qualp_health;
CREATE POLICY qualp_health_sel_auth ON public.qualp_health FOR SELECT TO authenticated
    USING (true);

-- Sem policy de INSERT/UPDATE/DELETE: authenticated e anon não escrevem nem
-- apagam. A Edge Function escreve com service_role, que bypassa RLS.

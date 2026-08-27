-- =====================================================================
-- Prova por simulação da RLS — Fast Delivery
-- =====================================================================
-- Roda ANTES de aplicar a migration: as tabelas são criadas AQUI DENTRO com o
-- mesmo DDL, exercitadas com papéis reais, e a transação termina em ROLLBACK.
--
-- Regras provadas:
--   1. Operador LÊ o preço (precisa, para cotar)              -> PASS
--   2. Operador NÃO cria destino                              -> bloqueado
--   3. Operador NÃO altera preço                              -> bloqueado
--   4. Operador NÃO apaga preço                               -> bloqueado
--   5. Master CRIA destino                                    -> PASS
--   6. Master ALTERA preço                                    -> PASS
--   7. anon NÃO lê                                            -> bloqueado
--   8. Operador NÃO mexe no de-para de equipamento            -> bloqueado
--   9. UNIQUE barra destino repetido na mesma origem          -> bloqueado
--  10. Normalização casa "São Paulo (2)" com "SAO PAULO"      -> PASS
-- =====================================================================
BEGIN;

CREATE TABLE public.fast_delivery_destino (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origem           text NOT NULL DEFAULT 'GUARULHOS',
    destino          text NOT NULL,
    destino_original text,
    km               numeric(10,2),
    pedagio          numeric(12,2),
    atualizado_em    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fast_delivery_destino_unico UNIQUE (origem, destino)
);
CREATE TABLE public.fast_delivery_preco (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    destino_id    bigint NOT NULL REFERENCES public.fast_delivery_destino(id) ON DELETE CASCADE,
    tipo_veiculo  text   NOT NULL,
    nosso_frete   numeric(12,2),
    a_pagar       numeric(12,2),
    sobra         numeric(12,2),
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fast_delivery_preco_unico UNIQUE (destino_id, tipo_veiculo)
);
CREATE TABLE public.fast_delivery_equipamento (
    codigo_otm    text PRIMARY KEY,
    tipo_veiculo  text NOT NULL,
    observacao    text,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fast_delivery_normaliza(texto text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT btrim(regexp_replace(
        regexp_replace(
            upper(translate(coalesce(texto, ''),
                'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
                'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
            '\(\s*\d+\s*\)', '', 'g'),
        '\s+', ' ', 'g'));
$fn$;

ALTER TABLE public.fast_delivery_destino     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fast_delivery_preco       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fast_delivery_equipamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fast_delivery_destino, public.fast_delivery_preco,
              public.fast_delivery_equipamento FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fast_delivery_destino,
    public.fast_delivery_preco, public.fast_delivery_equipamento TO authenticated;

CREATE POLICY fd_destino_sel ON public.fast_delivery_destino FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_destino_wri ON public.fast_delivery_destino FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());
CREATE POLICY fd_preco_sel ON public.fast_delivery_preco FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_preco_wri ON public.fast_delivery_preco FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());
CREATE POLICY fd_equip_sel ON public.fast_delivery_equipamento FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_equip_wri ON public.fast_delivery_equipamento FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

CREATE TEMP TABLE _r (n int, caso text, esperado text, obtido text, veredito text);

DO $do$
DECLARE m uuid; a uuid; n int; bloqueou boolean; d_id bigint;
BEGIN
    SELECT id INTO m FROM public.profiles WHERE role='master'   ORDER BY created_at LIMIT 1;
    SELECT id INTO a FROM public.profiles WHERE role='operador' ORDER BY created_at LIMIT 1;
    IF m IS NULL OR a IS NULL THEN RAISE EXCEPTION 'Precisa de >=1 master e >=1 operador'; END IF;

    -- semente criada como dono da tabela (service_role), fora das policies
    INSERT INTO public.fast_delivery_destino (destino, destino_original, km, pedagio)
        VALUES ('SAO PAULO', 'São Paulo', 45, 12.50) RETURNING id INTO d_id;
    INSERT INTO public.fast_delivery_preco (destino_id, tipo_veiculo, nosso_frete, a_pagar, sobra)
        VALUES (d_id, 'TRUCK', 1500, 900, 600);

    -- 1. Operador lê
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.fast_delivery_preco;
    RESET ROLE;
    INSERT INTO _r VALUES (1,'operador LE preco','1 linha', n||' linha(s)',
        CASE WHEN n=1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 2. Operador tenta criar destino
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN INSERT INTO public.fast_delivery_destino (destino) VALUES ('PIRATININGA');
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (2,'operador NAO cria destino','bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'CRIOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 3. Operador tenta alterar preco
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        UPDATE public.fast_delivery_preco SET a_pagar = 1 WHERE destino_id = d_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n=0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (3,'operador NAO altera preco','bloqueado',
        CASE WHEN n=-1 THEN 'permission denied' ELSE n||' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (alterou preco!)' END);

    -- 4. Operador tenta apagar
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false; n := 0;
    BEGIN
        DELETE FROM public.fast_delivery_preco WHERE destino_id = d_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n=0 THEN bloqueou := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; n := -1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (4,'operador NAO apaga preco','bloqueado',
        CASE WHEN n=-1 THEN 'permission denied' ELSE n||' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (apagou!)' END);

    -- 5. Master cria destino
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN INSERT INTO public.fast_delivery_destino (destino) VALUES ('CAMPINAS');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (5,'master CRIA destino','1 linha',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'criou' END,
        CASE WHEN bloqueou THEN 'FALHOU' ELSE 'PASS' END);

    -- 6. Master altera preco
    PERFORM set_config('request.jwt.claims', json_build_object('sub',m::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; n := 0;
    UPDATE public.fast_delivery_preco SET a_pagar = 950 WHERE destino_id = d_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    INSERT INTO _r VALUES (6,'master ALTERA preco','1 linha', n||' linha(s)',
        CASE WHEN n=1 THEN 'PASS' ELSE 'FALHOU' END);

    -- 7. anon nao le
    SET LOCAL ROLE anon; bloqueou := false; n := 0;
    BEGIN SELECT count(*) INTO n FROM public.fast_delivery_preco; IF n=0 THEN bloqueou:=true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN bloqueou:=true; n:=-1; END;
    RESET ROLE;
    INSERT INTO _r VALUES (7,'anon NAO le','bloqueado',
        CASE WHEN n=-1 THEN 'permission denied' ELSE n||' linha(s)' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU (leu preco!)' END);

    -- 8. Operador nao mexe no de-para
    PERFORM set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated; bloqueou := false;
    BEGIN INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo) VALUES ('99999','INVENTADO');
    EXCEPTION WHEN insufficient_privilege THEN bloqueou := true; END;
    RESET ROLE;
    INSERT INTO _r VALUES (8,'operador NAO mexe no de-para','bloqueado',
        CASE WHEN bloqueou THEN 'permission denied' ELSE 'INSERIU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 9. UNIQUE barra destino repetido
    bloqueou := false;
    BEGIN INSERT INTO public.fast_delivery_destino (destino) VALUES ('SAO PAULO');
    EXCEPTION WHEN unique_violation THEN bloqueou := true; END;
    INSERT INTO _r VALUES (9,'UNIQUE barra destino repetido','bloqueado',
        CASE WHEN bloqueou THEN 'unique_violation' ELSE 'DUPLICOU' END,
        CASE WHEN bloqueou THEN 'PASS (bloqueado)' ELSE 'FALHOU' END);

    -- 10. Normalizacao
    INSERT INTO _r VALUES (10,'normaliza "São Paulo (2)"','SAO PAULO',
        public.fast_delivery_normaliza('São Paulo (2)'),
        CASE WHEN public.fast_delivery_normaliza('São Paulo (2)') = 'SAO PAULO'
             THEN 'PASS' ELSE 'FALHOU' END);
END;
$do$;

SELECT n AS "#", caso, esperado, obtido, veredito FROM _r ORDER BY n;

ROLLBACK;

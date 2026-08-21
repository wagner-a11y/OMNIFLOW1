-- =====================================================================
-- KM_ROUND_TRIP — utilitário é pago pelo km RODADO (ida e volta)
-- =====================================================================
-- O utilitário vai e volta: quem dirige roda o dobro da distância da rota, e é
-- por isso que recebe. O modo já existia na declaração do tipo desde o desenho
-- original ('KM' | 'ANTT' | 'KM_ROUND_TRIP' | 'FREE'), mas nunca chegou a ser
-- implementado nem a existir no banco.
--
--   'KM'             -> base = km x factor          (só ida)
--   'KM_ROUND_TRIP'  -> base = km x 2 x factor      (ida e volta)  <-- utilitários
--   'ANTT'           -> piso da Tabela A            (caminhões; padrão)
--   'FREE'           -> sem piso e sem tarifa       (preço livre)
--
-- ATENÇÃO: isto DOBRA o preço base dos utilitários em relação ao modo 'KM'.
-- Ex.: Fiorino em rota de 100 km passa de R$ 150,00 para R$ 300,00 (200 km
-- rodados x R$ 1,50). As tarifas seguem as confirmadas em 21/08/2026.
-- =====================================================================

ALTER TABLE public.vehicle_configs
    DROP CONSTRAINT IF EXISTS vehicle_configs_calc_mode_check;
ALTER TABLE public.vehicle_configs
    ADD CONSTRAINT vehicle_configs_calc_mode_check
    CHECK (calc_mode IN ('KM', 'KM_ROUND_TRIP', 'ANTT', 'FREE'));

COMMENT ON COLUMN public.vehicle_configs.calc_mode IS
    'Formacao do preco base: KM = km x factor; KM_ROUND_TRIP = km x 2 x factor (ida e volta, utilitarios); ANTT = piso da Tabela A (padrao); FREE = preco livre.';

-- Utilitários passam a ser pagos pelo rodado (ida e volta).
UPDATE public.vehicle_configs
   SET calc_mode = 'KM_ROUND_TRIP'
 WHERE vehicle_type IN ('Fiorino', 'Van', '3/4 ');

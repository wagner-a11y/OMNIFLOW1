-- =====================================================================
-- calc_mode — como o preço base de cada veículo é formado
-- =====================================================================
-- O desenho original já previa isto: a tela de Configurações tem o seletor
-- "Modo Cálculo" (KM / ANTT) por veículo. O que faltava era a COLUNA: o seletor
-- aparecia, o master escolhia, mas upsertVehicleConfig nunca gravava e a leitura
-- sempre devolvia 'ANTT'. O cálculo, por sua vez, nem consultava o modo — usava
-- uma lista fixa no código (UTILITARIO_KM_RATES) chaveada pelos nomes do enum
-- VehicleType, que NÃO batem com os nomes gravados aqui. Resultado: utilitários
-- e Prancha recebiam piso ANTT em vez de KM x tarifa.
--
--   'KM'   -> preço base = km x factor        (utilitários)
--   'ANTT' -> piso mínimo pela Tabela A       (caminhões; é o padrão)
--   'FREE' -> sem piso e sem tarifa           (Prancha "preço livre", Aéreo)
--
-- Aditiva: coluna nova em tabela existente, com default 'ANTT', então todo
-- veículo que não for tocado aqui continua exatamente como está. As policies de
-- vehicle_configs (vc_select/insert/update/delete) NÃO são alteradas — a coluna
-- herda o controle que já existe (leitura por authenticated, escrita só master).
-- =====================================================================

ALTER TABLE public.vehicle_configs
    ADD COLUMN IF NOT EXISTS calc_mode text NOT NULL DEFAULT 'ANTT';

-- Barra valor fora do vocabulário (defende contra digitação/integração futura).
ALTER TABLE public.vehicle_configs
    DROP CONSTRAINT IF EXISTS vehicle_configs_calc_mode_check;
ALTER TABLE public.vehicle_configs
    ADD CONSTRAINT vehicle_configs_calc_mode_check
    CHECK (calc_mode IN ('KM', 'ANTT', 'FREE'));

COMMENT ON COLUMN public.vehicle_configs.calc_mode IS
    'Formação do preço base: KM = km x factor (utilitarios); ANTT = piso da Tabela A (padrao); FREE = sem piso e sem tarifa (preco livre).';

-- ---------- Utilitários: passam a ser por km ----------
-- Tarifas confirmadas pelo Wagner em 21/08/2026. O valor vai no `factor`, que é
-- o campo que a tela rotula como "Fator por KM (R$)" no modo KM.
-- ATENÇÃO ao '3/4 ': a chave tem um espaço no fim (herdado de digitação na tela
-- de Configurações) e é a que as 15 cotações referenciam. Mantida de propósito.
UPDATE public.vehicle_configs SET calc_mode = 'KM', factor = 1.50 WHERE vehicle_type = 'Fiorino';
UPDATE public.vehicle_configs SET calc_mode = 'KM', factor = 1.60 WHERE vehicle_type = 'Van';
UPDATE public.vehicle_configs SET calc_mode = 'KM', factor = 4.10 WHERE vehicle_type = '3/4 ';

-- ---------- Preço livre: sem piso, sem tarifa ----------
UPDATE public.vehicle_configs SET calc_mode = 'FREE' WHERE vehicle_type IN ('Prancha', 'Aéreo');

-- Todos os demais (toco, truck, bitruck, carretas, vanderleia, rodotrem) ficam
-- em 'ANTT' pelo default — comportamento inalterado.

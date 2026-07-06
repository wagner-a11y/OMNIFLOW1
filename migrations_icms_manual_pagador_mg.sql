-- Correção da regra de ICMS na calculadora (aditivo).
-- PARTE 1: campo do pagador de MG (alimenta a isenção da regra 2: origem MG + pagador MG = isento).
-- PARTE 2: trava do ICMS manual — marca que o ICMS foi ajustado na mão pra não recalcular por cima.
-- Aditivo e retrocompatível: cotações antigas ficam com os defaults (false) e mantêm o ICMS que já têm.

ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS icms_manual boolean NOT NULL DEFAULT false;

ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS pagador_mg boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.freight_calculations.icms_manual IS
    'ICMS ajustado manualmente pelo operador: trava o recálculo automático; o valor salvo é o que o operador colocou.';
COMMENT ON COLUMN public.freight_calculations.pagador_mg IS
    'Pagador é de MG — só relevante quando a origem é MG; alimenta a isenção da regra 2.';

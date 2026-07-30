-- 47_concepto_juridico_garantias.sql
-- Soporta: porcentaje de anticipo (Sección de Forma de Pago) y la nueva
-- sección "Concepto Jurídico y Garantías" (diligenciada por Jurídica).

ALTER TABLE solicitudes
    ADD COLUMN IF NOT EXISTS porcentaje_anticipo NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS concepto_juridico TEXT,
    ADD COLUMN IF NOT EXISTS garantias TEXT,
    ADD COLUMN IF NOT EXISTS tiene_riesgos_juridicos BOOLEAN,
    ADD COLUMN IF NOT EXISTS riesgos_juridicos TEXT;

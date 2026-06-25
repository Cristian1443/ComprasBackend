-- Columnas de aprobación por supervisor y gerente
-- NULL = pendiente, TRUE = aprobado, FALSE = rechazado
ALTER TABLE facturas_contrato
    ADD COLUMN IF NOT EXISTS aprobado_supervisor  BOOLEAN,
    ADD COLUMN IF NOT EXISTS comentario_supervisor TEXT,
    ADD COLUMN IF NOT EXISTS aprobado_gerente     BOOLEAN,
    ADD COLUMN IF NOT EXISTS comentario_gerente   TEXT;

-- 23_comite_columns.sql
-- Campos complementarios para decisiones del Comité de Contrataciones.

ALTER TABLE solicitudes
ADD COLUMN IF NOT EXISTS resultado_comite VARCHAR(20),
ADD COLUMN IF NOT EXISTS fecha_comite_decision TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS comentario_comite TEXT;


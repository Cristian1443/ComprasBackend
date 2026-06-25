-- Migración 36: Agregar campo correo a proponentes
-- Permite capturar el correo electrónico del proponente de forma explícita,
-- necesario para vincularlos automáticamente a las convocatorias.

ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS correo TEXT;

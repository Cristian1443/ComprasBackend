-- 42_actas_textos.sql
-- Agrega campos de texto libre (desarrollo y conclusión) al acta de comité,
-- con bloqueo de edición una vez guardados.

ALTER TABLE actas_comite
  ADD COLUMN IF NOT EXISTS desarrollo_texto   TEXT,
  ADD COLUMN IF NOT EXISTS conclusion_texto   TEXT,
  ADD COLUMN IF NOT EXISTS desarrollo_cerrado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS conclusion_cerrada BOOLEAN NOT NULL DEFAULT FALSE;

-- 43_actas_firmantes.sql
-- Permite que cada acta de comité registre su propia Directora y Secretaria
-- de firma (pueden variar de una sesión a otra), en vez de depender siempre
-- del valor único configurado globalmente en configuracion_firmantes.
-- Si estos campos quedan vacíos, el acta sigue usando el valor global como
-- respaldo (ver ActaSesionComite.tsx).

ALTER TABLE actas_comite
  ADD COLUMN IF NOT EXISTS firmante_directora_nombre  TEXT,
  ADD COLUMN IF NOT EXISTS firmante_directora_cargo   TEXT,
  ADD COLUMN IF NOT EXISTS firmante_secretaria_nombre TEXT,
  ADD COLUMN IF NOT EXISTS firmante_secretaria_cargo  TEXT;

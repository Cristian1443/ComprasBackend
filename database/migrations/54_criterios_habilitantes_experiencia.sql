-- Agrega los campos 1.3 "Criterios habilitantes" (lista, guardada como JSON en TEXT)
-- y 1.4 "Experiencia Acreditada Exigida" de la Sección I del formulario de planeación.
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS experiencia_acreditada_exigida TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS criterios_habilitantes_planeacion TEXT;

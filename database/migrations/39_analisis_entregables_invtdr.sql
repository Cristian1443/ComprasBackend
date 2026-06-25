-- Campos para modalidades Invitación y TDR
-- Análisis del mercado (Sección III)
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS analisis_servicios_ofertados TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS analisis_valor_promedio       TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS analisis_plazo_promedio       TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS analisis_presupuesto_oficial  TEXT;

-- Entregables estructurados (Sección V)
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS entregable1 TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS entregable2 TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS entregable3 TEXT;

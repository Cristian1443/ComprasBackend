-- 20_fix_solicitudes_table.sql
-- Asegurar que todas las columnas necesarias existan en la tabla solicitudes

ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS descripcion_necesidad TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS plazo_ejecucion_dias INTEGER DEFAULT 0;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS supervision_id UUID REFERENCES usuarios(id);
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS entregables TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS anexos_texto TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS riesgos TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS criterios_ambientales_sst TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS conclusiones_comite TEXT;

-- Consolidar rubro (usaremos rubro_presupuestal como el estándar)
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitudes' AND column_name='rubro') 
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitudes' AND column_name='rubro_presupuestal') THEN
        UPDATE solicitudes SET rubro_presupuestal = COALESCE(rubro_presupuestal, rubro);
    END IF;
END $$;

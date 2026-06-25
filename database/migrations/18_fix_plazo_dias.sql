-- Migración para añadir plazo_ejecucion_dias si no existe
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS plazo_ejecucion_dias INTEGER DEFAULT 0;

-- Migración 16: Soporte para Invitación y TDR
-- Añadir campo Valor Agregado a proponentes según el nuevo formulario Excel

ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS valor_agregado TEXT;

-- Asegurar que la tabla solicitudes_modalidad_directa (o similar) tenga los campos de cronograma
-- Aunque ya existen, los mencionamos por si acaso.
-- ALTER TABLE solicitudes_modalidad_directa ADD COLUMN IF NOT EXISTS fecha_estimada_solicitud DATE;
-- ALTER TABLE solicitudes_modalidad_directa ADD COLUMN IF NOT EXISTS fecha_estimada_recepcion DATE;

-- Actualizar vista si es necesario (v_solicitudes_resumen)
-- CREATE OR REPLACE VIEW v_solicitudes_resumen AS ...

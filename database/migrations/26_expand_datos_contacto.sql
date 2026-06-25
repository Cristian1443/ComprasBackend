-- 26_expand_datos_contacto.sql
-- Evita truncamientos en datos de contacto de proponentes.
-- Se mantiene la misma columna, solo se amplía a TEXT.
-- Nota: la vista v_proponentes_solicitud depende de la columna.

DROP VIEW IF EXISTS v_proponentes_solicitud;

ALTER TABLE proponentes
ALTER COLUMN datos_contacto TYPE TEXT;

CREATE OR REPLACE VIEW v_proponentes_solicitud AS
SELECT
    p.*,
    s.codigo        AS solicitud_codigo,
    s.estado        AS solicitud_estado,
    s.modalidad,
    u.nombre        AS solicitante_nombre
FROM proponentes p
JOIN solicitudes s ON p.solicitud_id = s.id
JOIN usuarios u    ON s.solicitante_id = u.id;

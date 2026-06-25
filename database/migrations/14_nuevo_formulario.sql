-- 14_nuevo_formulario.sql
-- Cambios para ajustar la base de datos al nuevo formulario

-- Primero eliminamos las vistas que dependan de columnas antiguas
DROP VIEW IF EXISTS v_solicitudes_resumen CASCADE;

-- 1. Actualizar tabla solicitudes
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS descripcion_necesidad_detalle TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS plazo_ejecucion_meses INTEGER;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS rubro_presupuestal VARCHAR(100);

-- Si es seguro, se eliminan las columnas obsoletas
ALTER TABLE solicitudes DROP COLUMN IF EXISTS plazo_desde;
ALTER TABLE solicitudes DROP COLUMN IF EXISTS plazo_hasta;

-- 2. Renombrar solicitudes_detalle_juridico a solicitudes_avanzado
ALTER TABLE IF EXISTS solicitudes_detalle_juridico RENAME TO solicitudes_avanzado;

-- Limpiar columnas obsoletas de la tabla renombrada (solo si existen)
ALTER TABLE IF EXISTS solicitudes_avanzado DROP COLUMN IF EXISTS anexo_estudios;
ALTER TABLE IF EXISTS solicitudes_avanzado DROP COLUMN IF EXISTS anexo_especificaciones;
ALTER TABLE IF EXISTS solicitudes_avanzado DROP COLUMN IF EXISTS anexo_analisis_riesgo;
ALTER TABLE IF EXISTS solicitudes_avanzado DROP COLUMN IF EXISTS anexo_estudios_seg;
ALTER TABLE IF EXISTS solicitudes_avanzado DROP COLUMN IF EXISTS anexo_otros;

-- Actualizar nombre del trigger
DROP TRIGGER IF EXISTS trg_detalle_jur_ts ON solicitudes_avanzado;
DROP TRIGGER IF EXISTS trg_avanzado_ts ON solicitudes_avanzado;
CREATE TRIGGER trg_avanzado_ts
    BEFORE UPDATE ON solicitudes_avanzado
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

-- 3. Crear tabla dinamica para anexos documentales
CREATE TABLE IF NOT EXISTS anexos_documentos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id        UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    nombre_documento    VARCHAR(255) NOT NULL,
    tipo                VARCHAR(100),
    fecha_documento     DATE,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RECREAR VISTA
CREATE OR REPLACE VIEW v_solicitudes_resumen AS
SELECT
    s.id,
    s.codigo,
    s.version,
    s.estado,
    s.prioridad,
    s.modalidad,
    s.objeto,
    s.justificacion,
    s.descripcion_necesidad_detalle,
    s.criterios_contratacion,
    s.forma_pago,
    s.efecto_estimar_presupuesto,
    s.valor_estimado,
    s.moneda,
    s.valor_en_cop,
    s.lugar_ejecucion,
    s.plazo_ejecucion_meses,
    s.creado_en,
    s.actualizado_en,
    s.fecha_envio_gerente,
    s.rubro_presupuestal,
    s.presupuesto_aprobado,

    -- Solicitante
    u_sol.id           AS solicitante_id,
    u_sol.nombre       AS solicitante_nombre,
    u_sol.email        AS solicitante_email,
    u_sol.cargo        AS solicitante_cargo,
    g_sol.nombre       AS gerencia_nombre,

    -- Gerente
    u_ger.nombre       AS gerente_nombre,
    u_ger.email        AS gerente_email,
    s.comentario_gerente,
    s.fecha_respuesta_gerente,

    -- Jurídica
    u_jur.nombre       AS juridica_nombre,
    s.comentario_juridica,
    s.fecha_respuesta_juridica,

    -- Financiera
    u_fin.nombre       AS financiera_nombre,
    u_fin.email        AS financiera_email,
    s.comentario_financiera,
    s.fecha_respuesta_financiera,

    -- Días transcurridos desde creación
    EXTRACT(DAY FROM NOW() - s.creado_en)::INTEGER AS dias_transcurridos,

    -- ¿Tiene documentos?
    (SELECT COUNT(*) FROM documentos d WHERE d.solicitud_id = s.id) AS num_documentos,

    -- ¿Tiene comentarios sin resolver?
    (SELECT COUNT(*) FROM comentarios c WHERE c.solicitud_id = s.id) AS num_comentarios

FROM solicitudes s
JOIN usuarios u_sol   ON s.solicitante_id = u_sol.id
LEFT JOIN gerencias g_sol ON s.gerencia_id = g_sol.id
LEFT JOIN usuarios u_ger  ON s.gerente_id  = u_ger.id
LEFT JOIN usuarios u_jur  ON s.juridica_id = u_jur.id
LEFT JOIN usuarios u_fin  ON s.financiera_id = u_fin.id;

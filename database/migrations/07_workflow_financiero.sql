-- ============================================================
-- PORTAL COMPRAS Y CONTRATACIÓN
-- Migración 07: Workflow Financiero
-- ============================================================

-- Agregar columnas necesarias a la tabla de solicitudes
ALTER TABLE solicitudes 
ADD COLUMN IF NOT EXISTS rubro VARCHAR(255),
ADD COLUMN IF NOT EXISTS presupuesto_aprobado NUMERIC(18,2);

-- Actualizar la vista de resumen para incluir estos nuevos campos
DROP VIEW IF EXISTS v_solicitudes_resumen CASCADE;

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
    s.criterios_contratacion,
    s.valor_estimado,
    s.moneda,
    s.valor_en_cop,
    s.lugar_ejecucion,
    s.plazo_desde,
    s.plazo_hasta,
    s.creado_en,
    s.actualizado_en,
    s.fecha_envio_gerente,
    s.rubro,
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

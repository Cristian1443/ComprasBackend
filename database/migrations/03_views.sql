-- ============================================================
-- PORTAL COMPRAS Y CONTRATACIÓN - INVEST IN BOGOTÁ
-- Vistas útiles v1.0
-- ============================================================

-- ============================================================
-- VISTA: v_solicitudes_resumen
-- Vista principal para listados y dashboards
-- ============================================================
-- ============================================================
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
    s.descripcion_necesidad_detalle,
    s.criterios_contratacion,
    s.forma_pago,
    s.efecto_estimar_presupuesto,
    s.valor_estimado,
    s.moneda,
    s.valor_en_cop,
    s.valor_moneda_cop,
    s.valor_moneda_usd,
    s.valor_moneda_eur,
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

-- ============================================================
-- VISTA: v_dashboard_admin
-- Métricas globales para el administrador
-- ============================================================
DROP VIEW IF EXISTS v_dashboard_admin CASCADE;
CREATE OR REPLACE VIEW v_dashboard_admin AS
SELECT
    COUNT(*)                                            AS total_solicitudes,
    COUNT(*) FILTER (WHERE estado = 'borrador')         AS en_borrador,
    COUNT(*) FILTER (WHERE estado = 'enviado_gerente')  AS pendientes_gerente,
    COUNT(*) FILTER (WHERE estado = 'en_juridica')      AS en_juridica,
    COUNT(*) FILTER (WHERE estado = 'en_financiera')    AS en_financiera,
    COUNT(*) FILTER (WHERE estado = 'contratado')       AS contratados,
    COUNT(*) FILTER (WHERE estado::text LIKE '%rechazado%')   AS rechazadas,
    SUM(valor_en_cop) FILTER (WHERE estado = 'contratado') AS valor_total_contratado_cop,
    AVG(EXTRACT(DAY FROM NOW() - creado_en))::NUMERIC(6,1) AS promedio_dias_proceso
FROM solicitudes;

-- ============================================================
-- VISTA: v_notificaciones_usuario
-- Notificaciones con datos completos para el frontend
-- ============================================================
DROP VIEW IF EXISTS v_notificaciones_usuario CASCADE;
CREATE OR REPLACE VIEW v_notificaciones_usuario AS
SELECT
    n.id,
    n.destinatario_id,
    n.tipo,
    n.titulo,
    n.mensaje,
    n.leida,
    n.correo_enviado,
    n.creado_en,
    s.codigo AS solicitud_codigo,
    s.estado AS solicitud_estado
FROM notificaciones n
LEFT JOIN solicitudes s ON n.solicitud_id = s.id
ORDER BY n.creado_en DESC;

-- ============================================================
-- VISTA: v_solicitudes_por_gerencia
-- Agrupación por gerencia para reportes gerenciales
-- ============================================================
DROP VIEW IF EXISTS v_solicitudes_por_gerencia CASCADE;
CREATE OR REPLACE VIEW v_solicitudes_por_gerencia AS
SELECT
    g.nombre         AS gerencia,
    s.modalidad,
    s.estado,
    COUNT(*)         AS cantidad,
    SUM(s.valor_en_cop) AS valor_total_cop,
    AVG(s.valor_en_cop) AS valor_promedio_cop,
    MIN(s.creado_en)    AS primera_solicitud,
    MAX(s.creado_en)    AS ultima_solicitud
FROM solicitudes s
JOIN gerencias g ON s.gerencia_id = g.id
GROUP BY g.nombre, s.modalidad, s.estado
ORDER BY g.nombre, valor_total_cop DESC;

-- ============================================================
-- VISTA: v_proponentes_solicitud
-- Proponentes enriquecidos con datos del proceso
-- ============================================================
DROP VIEW IF EXISTS v_proponentes_solicitud CASCADE;
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

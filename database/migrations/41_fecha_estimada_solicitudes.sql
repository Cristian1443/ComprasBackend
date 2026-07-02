-- 41_fecha_estimada_solicitudes.sql
-- Agrega las columnas de fechas estimadas directamente en la tabla solicitudes.
-- El backend escribe estas columnas en solicitudes (POST/PUT), pero la tabla
-- no las tenía, lo que causaba que el INSERT y el UPDATE fallaran con error de
-- "column does not exist" impidiendo guardar la solicitud.

ALTER TABLE solicitudes
    ADD COLUMN IF NOT EXISTS fecha_estimada_solicitud DATE,
    ADD COLUMN IF NOT EXISTS fecha_estimada_recepcion DATE;

-- Actualizar la vista resumen para exponer estos campos directamente
-- (evita depender del Object.assign del GET endpoint)
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
    s.descripcion_necesidad,
    s.descripcion_necesidad_detalle,
    s.criterios_contratacion,
    s.valor_estimado,
    s.moneda,
    s.valor_en_cop,
    s.valor_moneda_cop,
    s.valor_moneda_usd,
    s.valor_moneda_eur,
    s.lugar_ejecucion,
    s.plazo_ejecucion_meses,
    s.plazo_ejecucion_dias,
    s.creado_en,
    s.actualizado_en,
    s.fecha_envio_gerente,
    s.rubro_presupuestal,
    s.presupuesto_aprobado,
    s.fecha_comite,
    s.modalidad_seleccion,
    s.justificacion_cd,
    s.forma_pago,
    s.efecto_estimar_presupuesto,
    s.entregables,
    s.anexos_texto,
    s.riesgos,
    s.criterios_ambientales_sst,
    s.conclusiones_comite,
    s.supervision_id,
    s.gerencia_id,
    s.fecha_estimada_solicitud,
    s.fecha_estimada_recepcion,

    -- Supervisor del contrato
    u_sup_cont.nombre      AS supervision_nombre,
    u_sup_cont.email       AS supervision_email,

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

    EXTRACT(DAY FROM NOW() - s.creado_en)::INTEGER AS dias_transcurridos,

    (SELECT COUNT(*) FROM documentos d WHERE d.solicitud_id = s.id) AS num_documentos,
    (SELECT COUNT(*) FROM comentarios c WHERE c.solicitud_id = s.id) AS num_comentarios

FROM solicitudes s
JOIN  usuarios u_sol      ON s.solicitante_id = u_sol.id
LEFT JOIN gerencias g_sol ON s.gerencia_id    = g_sol.id
LEFT JOIN usuarios u_ger  ON s.gerente_id     = u_ger.id
LEFT JOIN usuarios u_jur  ON s.juridica_id    = u_jur.id
LEFT JOIN usuarios u_fin  ON s.financiera_id  = u_fin.id
LEFT JOIN usuarios u_sup_cont ON s.supervision_id = u_sup_cont.id;

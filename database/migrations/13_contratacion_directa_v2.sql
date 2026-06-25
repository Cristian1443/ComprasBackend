-- ============================================================
-- MIGRACIÓN: 13_contratacion_directa_v2.sql
-- Añade nuevos campos específicos para Contratación Directa
-- Secciones: I-IX del formulario estudio previo
-- ============================================================

-- Sección I: Justificación y descripción de la necesidad
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS descripcion_necesidad TEXT;         -- 1.2 Descripción de la necesidad

-- Sección II: Plazo y Lugar
-- plazo_desde y plazo_hasta ya existen (como TEXT para soportar meses)
-- lugar_ejecucion ya existe

-- Sección IV: Identificación del contrato y modalidad de selección
-- modalidad_seleccion ya existe en solicitudes (como VARCHAR)
-- justificacion_cd ya existe

-- Sección V: Análisis del valor estimado - Forma de pago
-- forma_pago ya existe

-- Sección VI: Supervisión y entregables
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS supervision_id UUID REFERENCES usuarios(id),   -- 6.1 Supervisor (persona de Microsoft)
  ADD COLUMN IF NOT EXISTS entregables TEXT;                               -- 6.2 Entregables

-- Sección VII: Anexos
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS anexos_texto TEXT;                              -- 7.1 Relación de anexos (texto)

-- Sección VIII: Riesgos y criterios ambientales/SST
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS riesgos TEXT,                                   -- 8.1 Riesgos
  ADD COLUMN IF NOT EXISTS criterios_ambientales_sst TEXT;                 -- 8.2 Criterios ambientales/SST

-- Sección IX: Conclusiones del Comité
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS conclusiones_comite TEXT;                       -- 9.1 Conclusiones

-- Para Investigación de Mercado en Directa: solo 1 proponente
-- La tabla proponentes ya existe, pero asegurar restricción a 1 para directa se maneja en lógica de negocio

-- Actualizar la vista de resumen para incluir los nuevos campos
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

    -- Supervisor del contrato (persona asignada como supervisor)
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
LEFT JOIN usuarios u_fin  ON s.financiera_id = u_fin.id
LEFT JOIN usuarios u_sup_cont ON s.supervision_id = u_sup_cont.id;

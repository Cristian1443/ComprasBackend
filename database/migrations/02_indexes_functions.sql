-- ============================================================
-- PORTAL COMPRAS Y CONTRATACIÓN - INVEST IN BOGOTÁ
-- Índices y Funciones v1.0
-- ============================================================

-- ============================================================
-- ÍNDICES DE RENDIMIENTO
-- ============================================================

-- usuarios
CREATE INDEX idx_usuarios_email        ON usuarios(email);
CREATE INDEX idx_usuarios_azure_id     ON usuarios(azure_id);
CREATE INDEX idx_usuarios_rol          ON usuarios(rol);
CREATE INDEX idx_usuarios_gerencia     ON usuarios(gerencia_id);

-- solicitudes (tabla más consultada)
CREATE INDEX idx_sol_solicitante       ON solicitudes(solicitante_id);
CREATE INDEX idx_sol_estado            ON solicitudes(estado);
CREATE INDEX idx_sol_gerencia          ON solicitudes(gerencia_id);
CREATE INDEX idx_sol_gerente           ON solicitudes(gerente_id);
CREATE INDEX idx_sol_juridica          ON solicitudes(juridica_id);
CREATE INDEX idx_sol_financiera        ON solicitudes(financiera_id);
CREATE INDEX idx_sol_modalidad         ON solicitudes(modalidad);
CREATE INDEX idx_sol_fecha_envio       ON solicitudes(fecha_envio_gerente);
CREATE INDEX idx_sol_estado_sol        ON solicitudes(solicitante_id, estado);

-- Búsqueda de texto en justificación y criterios
CREATE INDEX idx_sol_justificacion_trgm ON solicitudes USING GIN (justificacion gin_trgm_ops);
CREATE INDEX idx_sol_objeto_trgm        ON solicitudes USING GIN (criterios_contratacion gin_trgm_ops);

-- proponentes
CREATE INDEX idx_prop_solicitud        ON proponentes(solicitud_id);

-- documentos
CREATE INDEX idx_doc_solicitud         ON documentos(solicitud_id);

-- comentarios
CREATE INDEX idx_com_solicitud         ON comentarios(solicitud_id);
CREATE INDEX idx_com_autor             ON comentarios(autor_id);

-- notificaciones
CREATE INDEX idx_notif_destinatario    ON notificaciones(destinatario_id);
CREATE INDEX idx_notif_solicitud       ON notificaciones(solicitud_id);
CREATE INDEX idx_notif_leida           ON notificaciones(destinatario_id, leida) WHERE NOT leida;

-- auditoría
CREATE INDEX idx_audit_registro        ON auditoria(registro_id);
CREATE INDEX idx_audit_usuario         ON auditoria(usuario_id);

-- ============================================================
-- FUNCIÓN: actualizar_timestamp
-- Actualiza automáticamente el campo actualizado_en
-- ============================================================
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar a todas las tablas con actualizado_en
CREATE TRIGGER trg_usuarios_ts
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_solicitudes_ts
    BEFORE UPDATE ON solicitudes
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_avanzado_ts
    BEFORE UPDATE ON solicitudes_avanzado
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_proponentes_ts
    BEFORE UPDATE ON proponentes
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

-- ============================================================
-- FUNCIÓN: generar_codigo_solicitud
-- Genera código automático: SOL-YYYY-NNNN
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS seq_solicitud_codigo START 1 INCREMENT 1;

CREATE OR REPLACE FUNCTION generar_codigo_solicitud()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.codigo IS NULL THEN
        NEW.codigo := 'SOL-' || TO_CHAR(NOW(), 'YYYY') || '-'
                      || LPAD(NEXTVAL('seq_solicitud_codigo')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_solicitud_codigo
    BEFORE INSERT ON solicitudes
    FOR EACH ROW EXECUTE FUNCTION generar_codigo_solicitud();

-- ============================================================
-- FUNCIÓN: registrar_cambio_estado
-- Audita automáticamente cambios de estado en solicitudes
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_cambio_estado()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo)
        VALUES ('solicitudes', NEW.id, 'UPDATE', 'estado', OLD.estado::TEXT, NEW.estado::TEXT);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_solicitud_estado_audit
    AFTER UPDATE OF estado ON solicitudes
    FOR EACH ROW EXECUTE FUNCTION registrar_cambio_estado();

-- ============================================================
-- PROCEDIMIENTO: avanzar_flujo_solicitud
-- Avanza el estado de la solicitud al siguiente paso según el rol
-- ============================================================
CREATE OR REPLACE PROCEDURE avanzar_flujo_solicitud(
    p_solicitud_id  UUID,
    p_usuario_id    UUID,
    p_aprobado      BOOLEAN,
    p_comentario    TEXT DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_rol           rol_usuario;
    v_estado_actual estado_solicitud;
    v_nuevo_estado  estado_solicitud;
BEGIN
    SELECT u.rol INTO v_rol FROM usuarios u WHERE u.id = p_usuario_id;
    SELECT s.estado INTO v_estado_actual FROM solicitudes s WHERE s.id = p_solicitud_id;

    -- Lógica de transición de estado
    CASE
        WHEN v_estado_actual = 'enviado_gerente' AND v_rol = 'gerente_area' THEN
            v_nuevo_estado := CASE WHEN p_aprobado THEN 'aprobado_gerente' ELSE 'rechazado_gerente' END;
            UPDATE solicitudes SET
                estado = v_nuevo_estado,
                gerente_id = p_usuario_id,
                fecha_respuesta_gerente = NOW(),
                comentario_gerente = p_comentario
            WHERE id = p_solicitud_id;

        WHEN v_estado_actual = 'aprobado_gerente' AND v_rol IN ('administrador','gerente_area') THEN
            v_nuevo_estado := 'en_juridica';
            UPDATE solicitudes SET estado = v_nuevo_estado,
                juridica_id = NULL, fecha_envio_juridica = NOW()
            WHERE id = p_solicitud_id;

        WHEN v_estado_actual = 'en_juridica' AND v_rol = 'juridica' THEN
            v_nuevo_estado := CASE WHEN p_aprobado THEN 'aprobado_juridica' ELSE 'rechazado_juridica' END;
            UPDATE solicitudes SET
                estado = v_nuevo_estado,
                juridica_id = p_usuario_id,
                fecha_respuesta_juridica = NOW(),
                comentario_juridica = p_comentario
            WHERE id = p_solicitud_id;

        WHEN v_estado_actual = 'aprobado_juridica' AND v_rol IN ('administrador','juridica') THEN
            v_nuevo_estado := 'en_financiera';
            UPDATE solicitudes SET estado = v_nuevo_estado,
                financiera_id = NULL, fecha_envio_financiera = NOW()
            WHERE id = p_solicitud_id;

        WHEN v_estado_actual = 'en_financiera' AND v_rol = 'financiera' THEN
            v_nuevo_estado := CASE WHEN p_aprobado THEN 'aprobado_financiera' ELSE 'rechazado_financiera' END;
            UPDATE solicitudes SET
                estado = v_nuevo_estado,
                financiera_id = p_usuario_id,
                fecha_respuesta_financiera = NOW(),
                comentario_financiera = p_comentario
            WHERE id = p_solicitud_id;

        ELSE
            RAISE EXCEPTION 'Transición de estado no permitida: % para rol %', v_estado_actual, v_rol;
    END CASE;

    -- Registrar comentario si aplica
    IF p_comentario IS NOT NULL THEN
        INSERT INTO comentarios (solicitud_id, autor_id, contenido, es_rechazo)
        VALUES (p_solicitud_id, p_usuario_id, p_comentario, NOT p_aprobado);
    END IF;
END;
$$;

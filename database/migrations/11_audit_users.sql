-- ============================================================
-- MIGRACIÓN 11: Auditoría Inteligente con track de usuarios
-- ============================================================

-- 1. Añadimos el campo actualizado_por a solicitudes
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS actualizado_por UUID REFERENCES usuarios(id);

-- 2. Creamos una función más robusta para registrar la auditoría
CREATE OR REPLACE FUNCTION registrar_auditoria_extendida()
RETURNS TRIGGER AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    -- Determinar el usuario que hace el cambio
    v_usuario_id := NEW.actualizado_por;
    
    -- Si es NULL, intentamos inferirlo según el cambio de estado
    IF v_usuario_id IS NULL AND OLD.estado IS DISTINCT FROM NEW.estado THEN
        IF NEW.estado IN ('enviado_gerente') THEN
            v_usuario_id := NEW.solicitante_id;
        ELSIF NEW.estado IN ('aprobado_gerente', 'rechazado_gerente', 'en_financiera', 'en_juridica') THEN
            v_usuario_id := NEW.gerente_id;
        ELSIF NEW.estado IN ('aprobado_juridica', 'rechazado_juridica') THEN
            v_usuario_id := NEW.juridica_id;
        ELSIF NEW.estado IN ('aprobado_financiera', 'rechazado_financiera') THEN
            v_usuario_id := NEW.financiera_id;
        ELSIF NEW.estado IN ('finalizado') THEN
            v_usuario_id := NEW.solicitante_id;
        END IF;
    END IF;

    -- Registrar cambio de ESTADO
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
        VALUES ('solicitudes', NEW.id, 'UPDATE', 'estado', OLD.estado::TEXT, NEW.estado::TEXT, v_usuario_id);
    END IF;

    -- Registrar cambio de OBJETIVO
    IF OLD.objeto IS DISTINCT FROM NEW.objeto THEN
        INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
        VALUES ('solicitudes', NEW.id, 'UPDATE', 'objeto', substring(OLD.objeto FROM 1 FOR 50), substring(NEW.objeto FROM 1 FOR 50), v_usuario_id);
    END IF;

    -- Registrar cambio de VALOR
    IF OLD.valor_estimado IS DISTINCT FROM NEW.valor_estimado THEN
        INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
        VALUES ('solicitudes', NEW.id, 'UPDATE', 'valor_estimado', OLD.valor_estimado::TEXT, NEW.valor_estimado::TEXT, v_usuario_id);
    END IF;
    
    -- Registrar cambio de FECHA COMITÉ
    IF OLD.fecha_comite IS DISTINCT FROM NEW.fecha_comite THEN
        INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
        VALUES ('solicitudes', NEW.id, 'UPDATE', 'fecha_comite', OLD.fecha_comite::TEXT, NEW.fecha_comite::TEXT, v_usuario_id);
    END IF;

    -- Registrar cambio de RUBRO
    IF OLD.rubro IS DISTINCT FROM NEW.rubro THEN
        INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
        VALUES ('solicitudes', NEW.id, 'UPDATE', 'rubro', OLD.rubro::TEXT, NEW.rubro::TEXT, v_usuario_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Reemplazamos el trigger existente
DROP TRIGGER IF EXISTS trg_solicitud_estado_audit ON solicitudes;
DROP TRIGGER IF EXISTS trg_solicitud_audit_extendida ON solicitudes;

CREATE TRIGGER trg_solicitud_audit_extendida
    AFTER UPDATE ON solicitudes
    FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_extendida();

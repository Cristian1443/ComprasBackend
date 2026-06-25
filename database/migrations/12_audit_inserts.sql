-- ============================================================
-- MIGRACIÓN 12: Registro de INSERTS en Auditoría
-- ============================================================

-- 1. Creamos la función para registrar la creación de solicitudes
CREATE OR REPLACE FUNCTION registrar_auditoria_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
    VALUES (
        'solicitudes', 
        NEW.id, 
        'INSERT', 
        'solicitud', 
        '-', 
        COALESCE(NEW.codigo, 'Nueva solicitud creada'), 
        COALESCE(NEW.actualizado_por, NEW.solicitante_id)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Asignamos el trigger a la tabla
DROP TRIGGER IF EXISTS trg_solicitud_audit_insert ON solicitudes;

CREATE TRIGGER trg_solicitud_audit_insert
    AFTER INSERT ON solicitudes
    FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_insert();

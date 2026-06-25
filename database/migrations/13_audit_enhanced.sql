-- ============================================================
-- MIGRACIÓN 13: Logs de Auditoría Mejorados
-- Agrega tipo_log, modulo, descripcion, rol_usuario, resultado
-- a la tabla auditoria para cumplir con el documento CCB-177.
-- ============================================================

-- 1. Nuevas columnas en la tabla auditoria
ALTER TABLE auditoria
    ADD COLUMN IF NOT EXISTS tipo_log    VARCHAR(30)  NOT NULL DEFAULT 'negocio',
    ADD COLUMN IF NOT EXISTS modulo      VARCHAR(50),
    ADD COLUMN IF NOT EXISTS descripcion TEXT,
    ADD COLUMN IF NOT EXISTS rol_usuario VARCHAR(50),
    ADD COLUMN IF NOT EXISTS resultado   VARCHAR(20)  NOT NULL DEFAULT 'exitoso';

-- Partición para 2027 (anticipada)
CREATE TABLE IF NOT EXISTS auditoria_2027 PARTITION OF auditoria
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- 2. Índices para los nuevos campos de búsqueda y filtro
CREATE INDEX IF NOT EXISTS idx_audit_tipo_log  ON auditoria(tipo_log);
CREATE INDEX IF NOT EXISTS idx_audit_modulo    ON auditoria(modulo);
CREATE INDEX IF NOT EXISTS idx_audit_resultado ON auditoria(resultado);
CREATE INDEX IF NOT EXISTS idx_audit_creado_en ON auditoria(creado_en DESC);

-- 3. Actualizar la función del trigger para poblar los nuevos campos
--    (estado de solicitud → negocio + descripción legible)
CREATE OR REPLACE FUNCTION registrar_auditoria_extendida()
RETURNS TRIGGER AS $$
DECLARE
    v_usuario_id UUID;
    v_descripcion TEXT;
BEGIN
    v_usuario_id := NEW.actualizado_por;

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

    -- Cambio de ESTADO
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        v_descripcion := 'Solicitud ' || COALESCE(NEW.codigo, NEW.id::text) ||
                         ' cambió de estado: ' || COALESCE(OLD.estado, 'inicial') ||
                         ' → ' || NEW.estado;
        INSERT INTO auditoria
            (tipo_log, modulo, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, descripcion, usuario_id, resultado)
        VALUES
            ('negocio', 'solicitudes', 'solicitudes', NEW.id, 'UPDATE', 'estado',
             OLD.estado::TEXT, NEW.estado::TEXT, v_descripcion, v_usuario_id, 'exitoso');
    END IF;

    -- Cambio de OBJETO
    IF OLD.objeto IS DISTINCT FROM NEW.objeto THEN
        INSERT INTO auditoria
            (tipo_log, modulo, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, descripcion, usuario_id, resultado)
        VALUES
            ('cambio_datos', 'solicitudes', 'solicitudes', NEW.id, 'UPDATE', 'objeto',
             substring(OLD.objeto FROM 1 FOR 100), substring(NEW.objeto FROM 1 FOR 100),
             'Modificó el objeto/descripción de la solicitud ' || COALESCE(NEW.codigo, ''),
             v_usuario_id, 'exitoso');
    END IF;

    -- Cambio de VALOR ESTIMADO
    IF OLD.valor_estimado IS DISTINCT FROM NEW.valor_estimado THEN
        INSERT INTO auditoria
            (tipo_log, modulo, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, descripcion, usuario_id, resultado)
        VALUES
            ('cambio_datos', 'solicitudes', 'solicitudes', NEW.id, 'UPDATE', 'valor_estimado',
             OLD.valor_estimado::TEXT, NEW.valor_estimado::TEXT,
             'Cambió valor estimado en solicitud ' || COALESCE(NEW.codigo, ''),
             v_usuario_id, 'exitoso');
    END IF;

    -- Cambio de FECHA COMITÉ
    IF OLD.fecha_comite IS DISTINCT FROM NEW.fecha_comite THEN
        INSERT INTO auditoria
            (tipo_log, modulo, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, descripcion, usuario_id, resultado)
        VALUES
            ('cambio_datos', 'solicitudes', 'solicitudes', NEW.id, 'UPDATE', 'fecha_comite',
             OLD.fecha_comite::TEXT, NEW.fecha_comite::TEXT,
             'Modificó fecha de comité en solicitud ' || COALESCE(NEW.codigo, ''),
             v_usuario_id, 'exitoso');
    END IF;

    -- Cambio de RUBRO
    IF OLD.rubro IS DISTINCT FROM NEW.rubro THEN
        INSERT INTO auditoria
            (tipo_log, modulo, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, descripcion, usuario_id, resultado)
        VALUES
            ('cambio_datos', 'solicitudes', 'solicitudes', NEW.id, 'UPDATE', 'rubro',
             OLD.rubro::TEXT, NEW.rubro::TEXT,
             'Cambió rubro presupuestal en solicitud ' || COALESCE(NEW.codigo, ''),
             v_usuario_id, 'exitoso');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Actualizar trigger de INSERT para poblar nuevos campos
CREATE OR REPLACE FUNCTION registrar_auditoria_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO auditoria
        (tipo_log, modulo, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, descripcion, usuario_id, resultado)
    VALUES (
        'negocio', 'solicitudes', 'solicitudes',
        NEW.id, 'INSERT', 'solicitud', '-',
        COALESCE(NEW.codigo, 'Nueva solicitud'),
        'Creó la solicitud ' || COALESCE(NEW.codigo, NEW.id::text),
        COALESCE(NEW.actualizado_por, NEW.solicitante_id),
        'exitoso'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comentario de política de retención (documentativo)
COMMENT ON TABLE auditoria IS
    'Logs de auditoría inmutables. Retención: negocio/cambio_datos=5 años, acceso=2-5 años, tecnico=6-12 meses.';

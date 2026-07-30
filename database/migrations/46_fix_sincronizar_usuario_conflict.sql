-- Migración 46: Corregir conflicto de sincronizar_usuario()
-- ============================================================
-- Problema:
--   sincronizar_usuario() hacía INSERT ... ON CONFLICT (email) DO UPDATE.
--   Eso solo intercepta el conflicto cuando ya existe una fila con el
--   mismo email. Si el azure_id ya existía en OTRA fila (con un email
--   distinto — por ejemplo, un usuario sembrado manualmente o que
--   cambió de correo), el INSERT igual violaba la restricción
--   UNIQUE de azure_id y la función lanzaba:
--     "duplicate key value violates unique constraint usuarios_azure_id_key"
--   Esto rompía POST /api/auth/sync con 500 en cada login.
--
-- Corrección:
--   Se busca la fila existente por email O por azure_id (lo que
--   coincida primero) y se actualiza esa fila. Si no existe ninguna,
--   se inserta un usuario nuevo.
-- ============================================================

CREATE OR REPLACE FUNCTION sincronizar_usuario(
    p_azure_id      VARCHAR(100),
    p_email         VARCHAR(255),
    p_nombre        VARCHAR(255),
    p_cargo         VARCHAR(150)   DEFAULT NULL,
    p_departamento  VARCHAR(150)   DEFAULT NULL
)
RETURNS TABLE (
    id              UUID,
    rol             rol_usuario,
    gerencia_id     UUID,
    gerencia_nombre VARCHAR(150),
    es_nuevo        BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
    v_gerencia_id   UUID;
    v_es_nuevo      BOOLEAN := FALSE;
    v_id            UUID;
BEGIN
    IF p_departamento IS NOT NULL THEN
        SELECT g.id INTO v_gerencia_id
        FROM gerencias g
        WHERE LOWER(g.nombre) = LOWER(p_departamento)
           OR LOWER(g.codigo) = LOWER(p_departamento)
        LIMIT 1;
    END IF;

    -- Buscar por email o por azure_id: cualquiera de las dos claves
    -- únicas puede ya existir por separado (correo cambiado, usuario
    -- sembrado con azure_id distinto, etc.). Se prioriza el match
    -- por email cuando ambas coinciden en filas distintas.
    SELECT u.id INTO v_id
    FROM usuarios u
    WHERE u.email = p_email OR u.azure_id = p_azure_id
    ORDER BY (u.email = p_email) DESC
    LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol, ultimo_acceso)
        VALUES (p_azure_id, p_email, p_nombre, p_cargo, v_gerencia_id, 'supervisor', NOW())
        RETURNING usuarios.id INTO v_id;
        v_es_nuevo := TRUE;
    ELSE
        UPDATE usuarios SET
            azure_id       = p_azure_id,
            email          = p_email,
            nombre         = p_nombre,
            cargo          = COALESCE(p_cargo, usuarios.cargo),
            gerencia_id    = COALESCE(v_gerencia_id, usuarios.gerencia_id),
            ultimo_acceso  = NOW(),
            actualizado_en = NOW()
        WHERE usuarios.id = v_id;
    END IF;

    RETURN QUERY
    SELECT
        u.id,
        u.rol,
        u.gerencia_id,
        g.nombre AS gerencia_nombre,
        v_es_nuevo
    FROM usuarios u
    LEFT JOIN gerencias g ON u.gerencia_id = g.id
    WHERE u.id = v_id;
END;
$$;

COMMENT ON FUNCTION sincronizar_usuario IS
'Llama esta función en cada login. Busca la fila existente por email o por
azure_id (lo que coincida) y la actualiza; si no existe ninguna, crea un
usuario nuevo con rol=supervisor. El rol solo puede cambiarse manualmente
por un administrador.';

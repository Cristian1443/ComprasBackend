-- ============================================================
-- AUTO-SYNC DE USUARIOS DESDE AZURE AD
-- Se ejecuta en cada inicio de sesión a través del API
-- ============================================================

-- Función UPSERT: crea o actualiza el usuario al iniciar sesión
-- El API backend llama a esta función con los datos del token de Azure AD
CREATE OR REPLACE FUNCTION sincronizar_usuario(
    p_azure_id      VARCHAR(100),
    p_email         VARCHAR(255),
    p_nombre        VARCHAR(255),
    p_cargo         VARCHAR(150)   DEFAULT NULL,
    p_departamento  VARCHAR(150)   DEFAULT NULL   -- Viene del campo "department" de Azure AD
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
BEGIN
    -- Buscar la gerencia por nombre (viene del campo department de Azure AD)
    IF p_departamento IS NOT NULL THEN
        SELECT g.id INTO v_gerencia_id
        FROM gerencias g
        WHERE LOWER(g.nombre) = LOWER(p_departamento)
           OR LOWER(g.codigo) = LOWER(p_departamento)
        LIMIT 1;
    END IF;

    -- UPSERT: si ya existe por email, actualiza azure_id y datos; si no, crea
    INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol, ultimo_acceso)
    VALUES (p_azure_id, p_email, p_nombre, p_cargo, v_gerencia_id, 'supervisor', NOW())
    ON CONFLICT (email) DO UPDATE SET
        azure_id       = EXCLUDED.azure_id,
        nombre         = EXCLUDED.nombre,
        cargo          = COALESCE(EXCLUDED.cargo, usuarios.cargo),
        gerencia_id    = COALESCE(v_gerencia_id, usuarios.gerencia_id),
        ultimo_acceso  = NOW(),
        actualizado_en = NOW()
    RETURNING FALSE INTO v_es_nuevo;

    -- Si no hubo conflicto (usuario nuevo) marcar como nuevo
    IF NOT FOUND THEN
        v_es_nuevo := TRUE;
    END IF;

    -- Retornar datos del usuario
    RETURN QUERY
    SELECT
        u.id,
        u.rol,
        u.gerencia_id,
        g.nombre AS gerencia_nombre,
        v_es_nuevo
    FROM usuarios u
    LEFT JOIN gerencias g ON u.gerencia_id = g.id
    WHERE u.email = p_email;
END;
$$;

-- Comentario explicativo
COMMENT ON FUNCTION sincronizar_usuario IS
'Llama esta función en cada login. Si el usuario no existe, lo crea con rol=supervisor.
Si ya existe, actualiza su azure_id, nombre, cargo y último acceso.
El rol solo puede cambiarse manualmente por un administrador.';

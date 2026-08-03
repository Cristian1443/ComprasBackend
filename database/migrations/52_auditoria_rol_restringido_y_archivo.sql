-- ============================================================
-- MIGRACIÓN 52: Inmutabilidad real de `auditoria` + archivado
-- ------------------------------------------------------------
-- La tabla `auditoria` se documenta como "inmutable" (comentarios en
-- 01_schema.sql y 13_audit_enhanced.sql) pero hasta ahora eso era solo
-- una convención: nada a nivel de base de datos impedía un UPDATE/DELETE.
--
-- Este archivo crea un rol de aplicación restringido (compras_app_rw)
-- que puede INSERT/SELECT en `auditoria` pero NO UPDATE/DELETE/TRUNCATE,
-- y una tabla `auditoria_archivo` (sin borrar nada de `auditoria`) donde
-- el job jobs/archivarAuditoria.js copia los registros vencidos según la
-- política ya documentada en 13_audit_enhanced.sql.
--
-- ADVERTENCIA IMPORTANTE: en PostgreSQL un rol SUPERUSER ignora cualquier
-- GRANT/REVOKE. Esta migración NO tiene ningún efecto mientras el backend
-- siga conectándose con un usuario superusuario (hoy, en el `.env` local,
-- DB_USER=postgres). Para que esta protección sea real en producción,
-- alguien con acceso al servidor debe:
--   1) Asignarle una contraseña a compras_app_rw:
--        ALTER ROLE compras_app_rw WITH PASSWORD '...'; (fuera de este archivo, nunca commitear la clave)
--   2) Cambiar DB_USER/DB_PASSWORD en el .env de producción a ese rol.
--   3) Reiniciar el proceso del backend.
-- Ese cambio de credenciales no se hace desde este repo/migración.
-- ============================================================

DO $$ BEGIN
    CREATE ROLE compras_app_rw LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- current_database() en vez de un nombre fijo: el nombre real difiere por
-- ambiente (compras_db en local, compras_db_qa en QA, etc.)
DO $$ BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO compras_app_rw', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO compras_app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO compras_app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO compras_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO compras_app_rw;

-- Restricción específica: sobre auditoria (y sus particiones) solo INSERT/SELECT.
DO $$
DECLARE
    particion TEXT;
BEGIN
    FOR particion IN
        SELECT c.relname FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'auditoria'
    LOOP
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM compras_app_rw', particion);
    END LOOP;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM compras_app_rw;

-- ============================================================
-- Tabla de archivo: destino de copia de registros vencidos.
-- Nunca se borra nada de `auditoria` — ver jobs/archivarAuditoria.js.
-- ============================================================
CREATE TABLE IF NOT EXISTS auditoria_archivo (
    id              BIGINT NOT NULL,
    tabla           VARCHAR(100) NOT NULL,
    registro_id     UUID,
    accion          VARCHAR(20) NOT NULL,
    campo           VARCHAR(100),
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    usuario_id      UUID,
    ip_address      INET,
    creado_en       TIMESTAMPTZ NOT NULL,
    tipo_log        VARCHAR(30) NOT NULL,
    modulo          VARCHAR(50),
    descripcion     TEXT,
    rol_usuario     VARCHAR(50),
    resultado       VARCHAR(20) NOT NULL,
    archivado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, creado_en)
);

CREATE INDEX IF NOT EXISTS idx_audit_archivo_creado_en ON auditoria_archivo(creado_en DESC);

COMMENT ON TABLE auditoria_archivo IS
    'Copia (no destructiva) de registros de auditoria vencidos según la política de retención documentada en auditoria. auditoria nunca se purga desde este job — ver jobs/archivarAuditoria.js.';

GRANT SELECT, INSERT ON auditoria_archivo TO compras_app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria_archivo FROM compras_app_rw;

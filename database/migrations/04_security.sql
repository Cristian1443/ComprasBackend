-- ============================================================
-- PORTAL COMPRAS Y CONTRATACIÓN - INVEST IN BOGOTÁ
-- Permisos y Roles de Base de Datos v1.0
-- ============================================================

-- ============================================================
-- ROLES DE BASE DE DATOS (separar de roles de app)
-- ============================================================

-- Rol de solo lectura (reportes, BI)
CREATE ROLE compras_readonly;
GRANT CONNECT ON DATABASE compras_db TO compras_readonly;
GRANT USAGE ON SCHEMA public TO compras_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO compras_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO compras_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO compras_readonly;

-- Rol de la aplicación (API backend)
CREATE ROLE compras_app;
GRANT CONNECT ON DATABASE compras_db TO compras_app;
GRANT USAGE ON SCHEMA public TO compras_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO compras_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO compras_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO compras_app;

-- Rol de administrador de datos (sin acceso a DROP/ALTER)
CREATE ROLE compras_admin;
GRANT compras_app TO compras_admin;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO compras_admin;

-- ============================================================
-- POLÍTICA DE SEGURIDAD EN FILAS (Row Level Security)
-- Cada usuario solo ve lo que le corresponde por rol
-- ============================================================

-- Habilitar RLS en solicitudes
ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes FORCE ROW LEVEL SECURITY;

-- Habilitar RLS en notificaciones
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones FORCE ROW LEVEL SECURITY;

-- ============================================================
-- POLÍTICA: solicitudes
-- La app debe pasar azure_id en current_setting('app.azure_id')
-- ============================================================

-- El solicitante ve sus propias solicitudes
CREATE POLICY pol_sol_solicitante ON solicitudes
    FOR ALL
    USING (
        solicitante_id = (
            SELECT id FROM usuarios
            WHERE azure_id = current_setting('app.azure_id', TRUE)
        )
    );

-- El gerente ve las solicitudes de su gerencia
CREATE POLICY pol_sol_gerente ON solicitudes
    FOR SELECT
    USING (
        gerencia_id = (
            SELECT gerencia_id FROM usuarios
            WHERE azure_id = current_setting('app.azure_id', TRUE)
            AND rol = 'gerente_area'
        )
    );

-- Jurídica ve todas las solicitudes en su etapa
CREATE POLICY pol_sol_juridica ON solicitudes
    FOR SELECT
    USING (
        estado IN ('en_juridica','aprobado_juridica','rechazado_juridica')
        AND EXISTS (
            SELECT 1 FROM usuarios
            WHERE azure_id = current_setting('app.azure_id', TRUE)
            AND rol = 'juridica'
        )
    );

-- Financiera ve todas las solicitudes en su etapa
CREATE POLICY pol_sol_financiera ON solicitudes
    FOR SELECT
    USING (
        estado IN ('en_financiera','aprobado_financiera','rechazado_financiera')
        AND EXISTS (
            SELECT 1 FROM usuarios
            WHERE azure_id = current_setting('app.azure_id', TRUE)
            AND rol = 'financiera'
        )
    );

-- Administrador ve todo
CREATE POLICY pol_sol_admin ON solicitudes
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM usuarios
            WHERE azure_id = current_setting('app.azure_id', TRUE)
            AND rol = 'administrador'
        )
    );

-- ============================================================
-- POLÍTICA: notificaciones (cada usuario solo ve las suyas)
-- ============================================================
CREATE POLICY pol_notif_usuario ON notificaciones
    FOR ALL
    USING (
        destinatario_id = (
            SELECT id FROM usuarios
            WHERE azure_id = current_setting('app.azure_id', TRUE)
        )
    );

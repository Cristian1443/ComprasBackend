-- ============================================================
-- PORTAL COMPRAS Y CONTRATACIÓN - INVEST IN BOGOTÁ
-- Script de instalación completa
-- Ejecutar en orden con usuario SUPERUSER en PostgreSQL
-- ============================================================

-- 1. Crear base de datos (ejecutar como postgres)
-- CREATE DATABASE compras_db
--     ENCODING    = 'UTF8'
--     LC_COLLATE  = 'es_CO.UTF-8'
--     LC_CTYPE    = 'es_CO.UTF-8'
--     TEMPLATE    = template0;

-- 2. Conectar a compras_db y ejecutar en orden:
\i database/01_schema.sql
\i database/02_indexes_functions.sql
\i database/03_views.sql
\i database/04_security.sql
\i database/06_auto_sync_usuarios.sql
\i database/05_seed_data.sql

-- 3. Verificar instalación
SELECT 'Tablas creadas:' AS info, COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public';

SELECT 'Gerencias:' AS info, COUNT(*) FROM gerencias;
SELECT 'Usuarios:' AS info, COUNT(*) FROM usuarios;
SELECT 'Configuración:' AS info, COUNT(*) FROM configuracion;

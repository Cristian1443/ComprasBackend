-- Migración 30: Corregir ultimo_acceso incorrecto
-- ============================================================
-- Problema:
--   sincronizar_usuario() actualizaba ultimo_acceso = NOW() cada vez
--   que un usuario era referenciado como supervisor en una solicitud.
--   Esto hacía aparecer fechas de "última gestión" para personas que
--   NUNCA habían iniciado sesión en la aplicación.
--
-- Corrección aplicada en server.js:
--   Las rutas POST /api/solicitudes y PUT /api/solicitudes/:id
--   ahora usan ensureUsuarioExists() que NO actualiza ultimo_acceso.
--   Solo POST /api/auth/sync (login real) actualiza ultimo_acceso.
--
-- Limpieza de datos incorrectos ya existentes:
-- ============================================================

-- 1. Usuarios sembrados que NUNCA han iniciado sesión
--    (azure_id = 'temp-*' indica que aún no pasaron por el flujo real de login)
UPDATE usuarios
SET ultimo_acceso = NULL
WHERE azure_id LIKE 'temp-%'
  AND ultimo_acceso IS NOT NULL;

-- 2. Limpieza manual para usuarios que fueron contaminados via sync de solicitudes.
--    Ejecutar solo si se tiene certeza de que el usuario no ha iniciado sesión.
--    Ejemplo: Marcela Sánchez Cardona
--
--    UPDATE usuarios SET ultimo_acceso = NULL WHERE email = 'mcardona@investinbogota.org';
--
--    Para ver todos los usuarios con ultimo_acceso y su azure_id:
--    SELECT nombre, email, azure_id, ultimo_acceso FROM usuarios ORDER BY ultimo_acceso DESC NULLS LAST;

-- 3. Verificación final
SELECT
    COUNT(*) FILTER (WHERE ultimo_acceso IS NOT NULL) AS con_acceso,
    COUNT(*) FILTER (WHERE ultimo_acceso IS NULL)     AS sin_acceso_nunca
FROM usuarios;

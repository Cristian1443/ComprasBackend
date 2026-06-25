-- ============================================================
-- SEED DATA ACTUALIZADO v2
-- Sin azure_id hardcodeado — se sincroniza automáticamente al primer login
-- ============================================================

-- ============================================================
-- CONFIGURACIÓN DEL SISTEMA
-- ============================================================
INSERT INTO configuracion (clave, valor, descripcion) VALUES
('SMLV_2025',             '2000000',                              'Salario Mínimo Legal Vigente 2025 (COP)'),
('EMAIL_GERENTE_DEFAULT', 'pasantedesarrollo@investinbogota.org', 'Correo del Gerente de Área para pruebas'),
('MAX_PROPONENTES',       '10',                                   'Máximo de proponentes por solicitud'),
('UMBRAL_TDR_SMLV',      '50',                                   'Umbral SMLV para modalidad TDR'),
('DIAS_ALERTA',           '5',                                    'Días sin respuesta antes de enviar alerta'),
('VERSION_SCHEMA',        '1.0',                                  'Versión del schema de base de datos')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;

-- ============================================================
-- GERENCIAS DE INVEST IN BOGOTÁ
-- ============================================================
INSERT INTO gerencias (nombre, codigo, descripcion) VALUES
('Dirección Ejecutiva',                   'DE',  'Máxima dirección de la corporación'),
('Gerencia de Promoción de Inversión',    'GPI', 'Atracción y promoción de inversión extranjera y local'),
('Gerencia de Mercadeo y Comunicaciones', 'GMC', 'Estrategia de comunicaciones y marca'),
('Gerencia Administrativa y Financiera',  'GAF', 'Gestión administrativa, financiera y de contratación'),
('Gerencia de Apoyo Estratégico',         'GAE', 'Planeación estratégica y apoyo institucional'),
('Gerencia Bureau de Convenciones',       'GBC', 'Gestión del Bureau de Convenciones de Bogotá'),
('Gerencia Jurídica',                     'GJU', 'Asesoría jurídica y gestión contractual')
ON CONFLICT (nombre) DO NOTHING;

-- ============================================================
-- USUARIOS BASE (sin azure_id — se completa al primer login)
-- El campo azure_id se auto-actualiza vía sincronizar_usuario()
-- Estos registros existen para poder asignar roles de antemano
-- ============================================================

-- Administrador principal (pasante de desarrollo)
INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
VALUES (
    'pending-' || md5('pasantedesarrollo@investinbogota.org'),
    'pasantedesarrollo@investinbogota.org',
    'Cristian Johan Reyes Gutiérrez',
    'Pasante de Desarrollo Tecnológico',
    (SELECT id FROM gerencias WHERE codigo = 'GAF'),
    'administrador'
)
ON CONFLICT (email) DO UPDATE SET
    rol  = 'administrador',
    nombre = EXCLUDED.nombre;

-- Gerente de Área - GPI (actualizar email cuando sea conocido)
INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
VALUES (
    'pending-' || md5('gerente.gpi@investinbogota.org'),
    'gerente.gpi@investinbogota.org',
    'Gerente Promoción de Inversión',
    'Gerente de Área',
    (SELECT id FROM gerencias WHERE codigo = 'GPI'),
    'gerente_area'
)
ON CONFLICT (email) DO UPDATE SET rol = 'gerente_area';

-- Profesional Jurídico
INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
VALUES (
    'pending-' || md5('juridica@investinbogota.org'),
    'juridica@investinbogota.org',
    'Profesional Jurídico',
    'Abogado(a) de Contratación',
    (SELECT id FROM gerencias WHERE codigo = 'GJU'),
    'juridica'
)
ON CONFLICT (email) DO UPDATE SET rol = 'juridica';

-- Profesional Financiero
INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
VALUES (
    'pending-' || md5('financiera@investinbogota.org'),
    'financiera@investinbogota.org',
    'Analista Financiero',
    'Profesional Financiero',
    (SELECT id FROM gerencias WHERE codigo = 'GAF'),
    'financiera'
)
ON CONFLICT (email) DO UPDATE SET rol = 'financiera';

-- ============================================================
-- NOTA IMPORTANTE PARA ADMINISTRACIÓN
-- ============================================================
-- Para asignar un rol a un usuario después de su primer login:
--   UPDATE usuarios SET rol = 'gerente_area'
--   WHERE email = 'nuevo.gerente@investinbogota.org';
--
-- Para ver todos los usuarios registrados:
--   SELECT email, nombre, rol, gerencia_id, ultimo_acceso
--   FROM usuarios ORDER BY creado_en;

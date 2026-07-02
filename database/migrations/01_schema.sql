-- ============================================================
-- PORTAL COMPRAS Y CONTRATACIÓN - INVEST IN BOGOTÁ
-- Schema Principal v1.0
-- Motor: PostgreSQL 15+
-- ============================================================

-- Activar UUID y trigram para búsquedas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE rol_usuario AS ENUM (
    'administrador',
    'gerente_area',
    'supervisor',       -- Solicitante
    'juridica',
    'financiera',
    'secretaria_comite'     
);

CREATE TYPE estado_solicitud AS ENUM (
    'borrador',
    'enviado_gerente',
    'aprobado_gerente',
    'rechazado_gerente',
    'en_juridica',
    'aprobado_juridica',
    'rechazado_juridica',
    'en_financiera',
    'aprobado_financiera',
    'rechazado_financiera',
    'contratado',
    'cerrado',
    'cancelado'
);

CREATE TYPE modalidad_contrato AS ENUM (
    'directa',
    'invitacion',       -- <50 SMLV
    'tdr'               -- >50 SMLV (Términos de Referencia)
);

CREATE TYPE moneda AS ENUM ('COP', 'USD', 'EUR');

CREATE TYPE tipo_notificacion AS ENUM (
    'nueva_solicitud',
    'aprobacion',
    'rechazo',
    'comentario',
    'recordatorio',
    'sistema'
);

-- ============================================================
-- TABLA: gerencias
-- Catálogo de gerencias de la organización
-- ============================================================
CREATE TABLE gerencias (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(150) NOT NULL UNIQUE,
    codigo          VARCHAR(20) UNIQUE,
    descripcion     TEXT,
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: usuarios
-- Sincronizado con Azure AD. azure_id = Object ID del usuario en AAD
-- ============================================================
CREATE TABLE usuarios (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    azure_id        VARCHAR(100) NOT NULL UNIQUE,   -- Object ID de Azure AD
    email           VARCHAR(255) NOT NULL UNIQUE,
    nombre          VARCHAR(255) NOT NULL,
    cargo           VARCHAR(150),
    gerencia_id     UUID REFERENCES gerencias(id) ON DELETE SET NULL,
    rol             rol_usuario NOT NULL DEFAULT 'supervisor',
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso   TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: solicitudes
-- Cabecera principal de cada solicitud de contratación
-- ============================================================
CREATE TABLE solicitudes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo              VARCHAR(30) UNIQUE,             -- e.g. SOL-2024-001
    version             VARCHAR(10) NOT NULL DEFAULT 'V1',

    -- Solicitante
    solicitante_id      UUID NOT NULL REFERENCES usuarios(id),
    gerencia_id         UUID REFERENCES gerencias(id),

    -- Estado y flujo
    estado              estado_solicitud NOT NULL DEFAULT 'borrador',
    prioridad           SMALLINT NOT NULL DEFAULT 2    -- 1=Alta 2=Normal 3=Baja
                        CHECK (prioridad BETWEEN 1 AND 3),

    -- Sección I: Justificación (Solicitante llena)
    justificacion       TEXT,
    descripcion_necesidad_detalle TEXT,

    -- Sección II: Objeto y Lugar (Solicitante llena)
    objeto              TEXT,               -- Descripción corta/titulo
    lugar_ejecucion     VARCHAR(200),
    plazo_ejecucion_meses INTEGER,          -- Tiempo en meses calendario
    plazo_desde         DATE,               -- Fecha inicio de ejecución
    plazo_hasta         DATE,               -- Fecha fin de ejecución

    -- Sección III: Modalidad y Valor (Solicitante llena)
    modalidad           modalidad_contrato,
    valor_estimado      NUMERIC(18,2),
    moneda              TEXT NOT NULL DEFAULT 'COP',  -- Changed from ENUM to support multiple currencies (e.g., "COP,USD")
    valor_en_cop        NUMERIC(18,2),          -- Valor convertido para comparaciones

    -- Sección IV/V: Presupuesto (Solicitante / Financiera llena)
    efecto_estimar_presupuesto TEXT,        -- Análisis para estimar el presupuesto
    forma_pago          TEXT,               -- Forma de pago acordada
    rubro_presupuestal  VARCHAR(100),       -- Rubro presupuestal a afectar

    -- Criterios de Contratación (Solicitante llena)
    criterios_contratacion TEXT,

    -- Aprobación Gerente
    gerente_id          UUID REFERENCES usuarios(id),
    fecha_envio_gerente TIMESTAMPTZ,
    fecha_respuesta_gerente TIMESTAMPTZ,
    comentario_gerente  TEXT,

    -- Revisión Jurídica
    juridica_id         UUID REFERENCES usuarios(id),
    fecha_envio_juridica TIMESTAMPTZ,
    fecha_respuesta_juridica TIMESTAMPTZ,
    comentario_juridica TEXT,

    -- Revisión Financiera
    financiera_id       UUID REFERENCES usuarios(id),
    fecha_envio_financiera TIMESTAMPTZ,
    fecha_respuesta_financiera TIMESTAMPTZ,
    comentario_financiera TEXT,

    -- Metadatos
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: solicitudes_avanzado
-- Sección avanzada: Supervisión, Entregables, Riesgos (Llenado por Solicitante/Supervisor)
-- ============================================================
CREATE TABLE solicitudes_avanzado (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id        UUID NOT NULL UNIQUE REFERENCES solicitudes(id) ON DELETE CASCADE,

    -- Sección VI
    supervision         TEXT,
    entregables         TEXT,

    -- Sección VIII
    riesgos             TEXT,
    criterios_ambientales TEXT,
    criterios_sst       TEXT,

    -- Sección IX (TDR >50 SMLV o según corresponda)
    conclusiones        TEXT,

    completado_en       TIMESTAMPTZ,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: anexos_documentos
-- Relacionar documentos generados en el estudio previo (Dinámico)
-- ============================================================
CREATE TABLE anexos_documentos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id        UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    nombre_documento    VARCHAR(255) NOT NULL,
    tipo                VARCHAR(100),
    fecha_documento     DATE,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: solicitudes_modalidad_directa
-- Campos adicionales para modalidad = 'directa'
-- ============================================================
CREATE TABLE solicitudes_modalidad_directa (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id            UUID NOT NULL UNIQUE REFERENCES solicitudes(id) ON DELETE CASCADE,
    modalidad_seleccion     VARCHAR(255),
    fecha_comite            DATE,
    justificacion_cd        TEXT,
    -- Campos para Modalidad Invitación y TDR
    fecha_estimada_solicitud    DATE,       -- Fecha estimada para enviar la invitación
    fecha_estimada_recepcion    DATE,       -- Fecha estimada de recepción de propuestas
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: proponentes
-- Tabla de cotizaciones / proponentes por solicitud
-- ============================================================
CREATE TABLE proponentes (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id            UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    numero                  SMALLINT NOT NULL CHECK (numero BETWEEN 1 AND 10),
    nombre_proveedor        VARCHAR(255),
    datos_contacto          VARCHAR(500),
    requisitos_tecnicos     TEXT,
    experiencia             VARCHAR(100),
    criterios_habilitantes  VARCHAR(50),
    valor_con_impuestos     NUMERIC(18,2),
    moneda                  TEXT DEFAULT 'COP',
    observaciones           TEXT,
    seleccionado            BOOLEAN DEFAULT FALSE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(solicitud_id, numero)
);

-- ============================================================
-- TABLA: documentos
-- Archivos adjuntos a solicitudes (almacenados en SharePoint/Azure Blob)
-- ============================================================
CREATE TABLE documentos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id    UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    nombre          VARCHAR(255) NOT NULL,
    tipo_mime       VARCHAR(100),
    tamaño_bytes    BIGINT,
    url_storage     TEXT NOT NULL,          -- URL de SharePoint o Azure Blob
    subido_por      UUID NOT NULL REFERENCES usuarios(id),
    descripcion     VARCHAR(500),
    es_oficial      BOOLEAN DEFAULT FALSE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: comentarios
-- Hilo de comunicación interno por solicitud
-- ============================================================
CREATE TABLE comentarios (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id    UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    autor_id        UUID NOT NULL REFERENCES usuarios(id),
    contenido       TEXT NOT NULL,
    es_rechazo      BOOLEAN DEFAULT FALSE,
    es_privado      BOOLEAN DEFAULT FALSE,   -- Solo visible para el rol que lo creó
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: notificaciones
-- Notificaciones in-app (también sirve de log de correos enviados)
-- ============================================================
CREATE TABLE notificaciones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    destinatario_id UUID NOT NULL REFERENCES usuarios(id),
    solicitud_id    UUID REFERENCES solicitudes(id) ON DELETE SET NULL,
    tipo            tipo_notificacion NOT NULL,
    titulo          VARCHAR(255) NOT NULL,
    mensaje         TEXT NOT NULL,
    leida           BOOLEAN NOT NULL DEFAULT FALSE,
    correo_enviado  BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: auditoria
-- Log inmutable de cambios de estado y acciones críticas
-- ============================================================
CREATE TABLE auditoria (
    id              BIGSERIAL,
    tabla           VARCHAR(100) NOT NULL,
    registro_id     UUID NOT NULL,
    accion          VARCHAR(20) NOT NULL,    -- INSERT, UPDATE, DELETE
    campo           VARCHAR(100),
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    usuario_id      UUID REFERENCES usuarios(id),
    ip_address      INET,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, creado_en)
) PARTITION BY RANGE (creado_en);

-- Particiones anuales de auditoría (agregar cada año)
CREATE TABLE auditoria_2024 PARTITION OF auditoria
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE auditoria_2025 PARTITION OF auditoria
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE auditoria_2026 PARTITION OF auditoria
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- ============================================================
-- TABLA: configuracion
-- Parámetros del sistema (SMLV, correos, etc.)
-- ============================================================
CREATE TABLE configuracion (
    clave           VARCHAR(100) PRIMARY KEY,
    valor           TEXT NOT NULL,
    descripcion     TEXT,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

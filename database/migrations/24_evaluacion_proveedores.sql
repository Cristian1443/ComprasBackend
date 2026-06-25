-- ============================================================
-- 24_evaluacion_proveedores.sql
-- Tablas para evaluaciones de proveedores y bloqueo automático
-- Si total < 70, el proveedor queda bloqueado para futuros contratos
-- ============================================================

-- Tabla: proveedores_bloqueados
-- Registra proveedores bloqueados por evaluación < 70
CREATE TABLE IF NOT EXISTS proveedores_bloqueados (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identificador   VARCHAR(255) NOT NULL UNIQUE,  -- nombre normalizado (UPPER TRIM) o NIT
    nombre_original VARCHAR(255),
    motivo          TEXT,                           -- "Evaluación inferior a 70"
    evaluacion_id   UUID,                           -- FK añadida después
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla: evaluaciones_proveedor
-- Una evaluación por contrato/proveedor
CREATE TABLE IF NOT EXISTS evaluaciones_proveedor (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id        UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    proponente_id       UUID REFERENCES proponentes(id) ON DELETE SET NULL,
    nombre_proveedor    VARCHAR(255) NOT NULL,
    correo_proveedor    VARCHAR(255),
    evaluador_id       UUID NOT NULL REFERENCES usuarios(id),
    criterios          JSONB NOT NULL DEFAULT '[]',  -- [{nombre, puntaje}, ...]
    total              NUMERIC(5,2) NOT NULL,
    observaciones      TEXT,
    firma_designado    VARCHAR(255),
    fecha_evaluacion   DATE NOT NULL,
    proxima_evaluacion DATE,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(solicitud_id)  -- Una evaluación por solicitud/contrato
);

-- FK circular: evaluacion_id en proveedores_bloqueados
ALTER TABLE proveedores_bloqueados
    DROP CONSTRAINT IF EXISTS fk_evaluacion;
ALTER TABLE proveedores_bloqueados
    ADD CONSTRAINT fk_evaluacion FOREIGN KEY (evaluacion_id)
    REFERENCES evaluaciones_proveedor(id) ON DELETE SET NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_eval_solicitud ON evaluaciones_proveedor(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluador ON evaluaciones_proveedor(evaluador_id);
CREATE INDEX IF NOT EXISTS idx_prov_bloq_ident ON proveedores_bloqueados(identificador);

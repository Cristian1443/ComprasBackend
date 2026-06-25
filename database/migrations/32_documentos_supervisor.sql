-- Lista de documentos planificados por el supervisor para cada contrato
CREATE TABLE IF NOT EXISTS documentos_supervisor (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    nombre       VARCHAR(255) NOT NULL,
    carpeta      VARCHAR(50)  NOT NULL
                   CHECK (carpeta IN ('01.Precontractual', '02.Contractual', '03.Postcontractual')),
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documentos_supervisor_solicitud
    ON documentos_supervisor(solicitud_id);

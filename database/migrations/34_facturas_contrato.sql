CREATE TABLE IF NOT EXISTS facturas_contrato (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    nombre_solicitud VARCHAR(500),
    aprobador_1 VARCHAR(255),
    aprobador_2 VARCHAR(255),
    fecha_factura DATE NOT NULL,
    no_contrato_oc VARCHAR(255) NOT NULL,
    no_factura_cxc VARCHAR(255) NOT NULL,
    concepto TEXT NOT NULL,
    certificacion_supervisor BOOLEAN NOT NULL DEFAULT FALSE,
    adjunto_url TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
    comentario_financiera TEXT,
    creado_por_email VARCHAR(255),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facturas_contrato_solicitud ON facturas_contrato(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_facturas_contrato_estado ON facturas_contrato(estado);

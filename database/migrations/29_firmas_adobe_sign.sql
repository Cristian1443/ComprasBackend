-- ============================================================
-- MIGRACIÓN 29: Firma electrónica con Adobe Acrobat Sign
-- ============================================================
-- Tablas para gestionar acuerdos de firma, firmantes y
-- configuración de los firmantes fijos por etapa del flujo.
--
-- Reglas de negocio:
--  - Cada etapa de aprobación (Gerente, Financiera, Comité, Jurídica)
--    genera un acuerdo de firma en Adobe Sign.
--  - El flujo NO avanza al siguiente paso hasta que todas las firmas
--    de la etapa actual estén completas.
--  - Financiera firma siempre Samuel (Jefe Financiera).
--  - Comité firma siempre Directora + Secretaria.
--  - Jurídica puede firmar cualquier persona del rol jurídica.
--  - Gerente firma el gerente del área asignado a la solicitud.
-- ============================================================

CREATE TABLE IF NOT EXISTS firmas_documento (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    solicitud_id        UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    etapa               TEXT NOT NULL,          -- gerente | financiera | comite | juridica | proveedor
    tipo_documento      TEXT NOT NULL,          -- formato_planeacion | acta_comite | visto_bueno_juridica | contrato
    titulo              TEXT NOT NULL,
    -- Adobe Sign
    agreement_id        TEXT UNIQUE,
    estado              TEXT NOT NULL DEFAULT 'pendiente',
        -- pendiente | enviado | firmando | firmado | rechazado | expirado | error
    -- Archivos
    pdf_original_path   TEXT,                   -- ruta local del PDF generado
    pdf_firmado_path    TEXT,                   -- ruta local del PDF firmado descargado de Adobe
    -- Trazabilidad
    iniciado_por        UUID REFERENCES usuarios(id),
    enviado_en          TIMESTAMPTZ,
    completado_en       TIMESTAMPTZ,
    ultima_consulta_en  TIMESTAMPTZ,            -- para el polling
    error_mensaje       TEXT,
    -- Datos crudos
    metadata            JSONB DEFAULT '{}'::jsonb,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT firmas_estado_valido CHECK (
        estado IN ('pendiente', 'enviado', 'firmando', 'firmado', 'rechazado', 'expirado', 'error')
    )
);

CREATE INDEX IF NOT EXISTS idx_firmas_solicitud ON firmas_documento(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_firmas_estado ON firmas_documento(estado);
CREATE INDEX IF NOT EXISTS idx_firmas_etapa ON firmas_documento(solicitud_id, etapa);
CREATE INDEX IF NOT EXISTS idx_firmas_polling
    ON firmas_documento(ultima_consulta_en)
    WHERE estado IN ('enviado', 'firmando');

-- ============================================================
-- TABLA: firmantes_documento
-- Cada acuerdo tiene 1+ firmantes en orden.
-- ============================================================
CREATE TABLE IF NOT EXISTS firmantes_documento (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firma_id        UUID NOT NULL REFERENCES firmas_documento(id) ON DELETE CASCADE,
    orden           SMALLINT NOT NULL DEFAULT 1,
    rol_firma       TEXT NOT NULL,
        -- gerente | director_financiero | directora_comite | secretaria_comite
        -- | juridica | proveedor
    nombre          TEXT NOT NULL,
    email           TEXT NOT NULL,
    cargo           TEXT,
    estado          TEXT NOT NULL DEFAULT 'pendiente',
        -- pendiente | firmado | rechazado | delegado
    firmado_en      TIMESTAMPTZ,
    ip_address      INET,
    comentario      TEXT,                       -- opcional, motivo de rechazo
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT firmantes_estado_valido CHECK (
        estado IN ('pendiente', 'firmado', 'rechazado', 'delegado')
    )
);

CREATE INDEX IF NOT EXISTS idx_firmantes_firma ON firmantes_documento(firma_id);

-- ============================================================
-- TABLA: configuracion_firmantes
-- Firmantes fijos: Financiera (Samuel), Directora y Secretaria del comité.
-- Editables desde el panel de Administrador.
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion_firmantes (
    rol_firma       TEXT PRIMARY KEY,           -- director_financiero | directora_comite | secretaria_comite
    nombre          TEXT NOT NULL,
    email           TEXT NOT NULL,
    cargo           TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por UUID REFERENCES usuarios(id)
);

-- Semillas con placeholders. Reemplazar emails reales desde la pantalla Admin.
INSERT INTO configuracion_firmantes (rol_firma, nombre, email, cargo) VALUES
    ('director_financiero', 'Samuel (Jefe Financiera)', 'samuel@investinbogota.org', 'Jefe de Financiera'),
    ('directora_comite',    'Directora del Comité',    'directora@investinbogota.org', 'Directora'),
    ('secretaria_comite',   'Secretaria del Comité',   'secretaria@investinbogota.org', 'Secretaria del Comité')
ON CONFLICT (rol_firma) DO NOTHING;

-- ============================================================
-- TABLA: configuracion_adobe_sign
-- Credenciales y endpoints del cliente OAuth (1 sola fila).
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion_adobe_sign (
    id              SMALLINT PRIMARY KEY DEFAULT 1,
    client_id       TEXT,
    client_secret   TEXT,
    refresh_token   TEXT,
    access_token    TEXT,
    access_expira_en TIMESTAMPTZ,
    api_base_url    TEXT DEFAULT 'https://api.na1.adobesign.com',
    integration_key TEXT,                       -- alternativa a OAuth (más simple)
    modo            TEXT NOT NULL DEFAULT 'mock',
        -- mock | sandbox | produccion
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT adobe_modo_valido CHECK (modo IN ('mock', 'sandbox', 'produccion')),
    CONSTRAINT adobe_unica_fila CHECK (id = 1)
);

INSERT INTO configuracion_adobe_sign (id, modo) VALUES (1, 'mock')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- VISTA: estado de firmas por solicitud y etapa
-- ============================================================
CREATE OR REPLACE VIEW v_firmas_por_etapa AS
SELECT
    fd.solicitud_id,
    fd.etapa,
    fd.id                 AS firma_id,
    fd.tipo_documento,
    fd.titulo,
    fd.estado             AS estado_firma,
    fd.agreement_id,
    fd.enviado_en,
    fd.completado_en,
    fd.pdf_firmado_path,
    -- Firmantes agregados
    (
        SELECT jsonb_agg(jsonb_build_object(
            'orden', f.orden,
            'rol', f.rol_firma,
            'nombre', f.nombre,
            'email', f.email,
            'cargo', f.cargo,
            'estado', f.estado,
            'firmado_en', f.firmado_en
        ) ORDER BY f.orden)
        FROM firmantes_documento f
        WHERE f.firma_id = fd.id
    ) AS firmantes
FROM firmas_documento fd;

-- ============================================================
-- HELPER: ¿está completa la firma de una etapa?
-- ============================================================
CREATE OR REPLACE FUNCTION etapa_firma_completa(p_solicitud_id UUID, p_etapa TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    estado_actual TEXT;
BEGIN
    SELECT estado INTO estado_actual
    FROM firmas_documento
    WHERE solicitud_id = p_solicitud_id AND etapa = p_etapa
    ORDER BY creado_en DESC
    LIMIT 1;

    RETURN COALESCE(estado_actual, '') = 'firmado';
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- COMENTARIOS
-- ============================================================
COMMENT ON TABLE firmas_documento IS
'Acuerdos de firma electrónica con Adobe Sign. Una fila por documento firmable.';
COMMENT ON TABLE firmantes_documento IS
'Firmantes asociados a cada acuerdo, en orden.';
COMMENT ON TABLE configuracion_firmantes IS
'Firmantes fijos por rol (Financiera, Comité). Editable desde admin.';
COMMENT ON TABLE configuracion_adobe_sign IS
'Credenciales y configuración del cliente Adobe Sign. Modo mock por defecto.';

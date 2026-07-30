-- ============================================================
-- 50_evaluacion_firma_sharepoint.sql
-- Cierra el ciclo de RA1-5 Evaluación de Proveedores:
--  - Vincula la evaluación con su acuerdo de firma electrónica
--    (reutiliza firmas_documento / etapa = 'proveedor', ya prevista
--    en 29_firmas_adobe_sign.sql pero nunca implementada).
--  - Registra dónde quedó guardado el PDF firmado en SharePoint.
--  - configuracion_graph_app: credenciales de una App Registration
--    de Azure AD (client credentials) para que el backend pueda subir
--    el PDF firmado a SharePoint sin depender de la sesión del navegador.
-- ============================================================

ALTER TABLE evaluaciones_proveedor
    ADD COLUMN IF NOT EXISTS firma_id UUID REFERENCES firmas_documento(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS sharepoint_url TEXT,
    ADD COLUMN IF NOT EXISTS sharepoint_subido_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS contrato_finalizado_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_eval_firma ON evaluaciones_proveedor(firma_id);

-- ============================================================
-- TABLA: configuracion_graph_app
-- Credenciales de la App Registration (client credentials flow)
-- usada para subir archivos a SharePoint desde el backend, sin
-- depender de que el usuario tenga el navegador abierto.
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion_graph_app (
    id                SMALLINT PRIMARY KEY DEFAULT 1,
    tenant_id         TEXT,
    client_id         TEXT,
    client_secret     TEXT,
    site_search       TEXT NOT NULL DEFAULT 'Documental',
    drive_name        TEXT NOT NULL DEFAULT 'Expedientes',
    parent_path       TEXT NOT NULL DEFAULT 'Pruebas tecnicas',
    access_token      TEXT,
    access_expira_en  TIMESTAMPTZ,
    modo              TEXT NOT NULL DEFAULT 'mock',
        -- mock (no llama a Graph, solo simula) | produccion
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT graph_modo_valido CHECK (modo IN ('mock', 'produccion')),
    CONSTRAINT graph_unica_fila CHECK (id = 1)
);

INSERT INTO configuracion_graph_app (id, modo) VALUES (1, 'mock')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE configuracion_graph_app IS
'Credenciales de App Registration (Azure AD) para subir archivos a SharePoint vía Microsoft Graph con permisos de aplicación (sin sesión de usuario). Modo mock por defecto.';

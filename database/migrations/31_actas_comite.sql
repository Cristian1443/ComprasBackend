-- 31_actas_comite.sql
-- Tabla para persistir el registro completo de cada sesión de comité
-- (número de acta, participantes, decisiones).

CREATE TABLE IF NOT EXISTS actas_comite (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  acta_numero TEXT,
  fecha_sesion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  participantes JSONB      NOT NULL DEFAULT '[]'::jsonb,
  solicitudes_ids TEXT[]   NOT NULL DEFAULT '{}',
  decisiones  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actas_comite_fecha ON actas_comite(fecha_sesion DESC);

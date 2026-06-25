-- Migración 17: Configuración de Variables Globales (SMLV)
-- Crear tabla de configuración para valores dinámicos como el SMLV

CREATE TABLE IF NOT EXISTS configuracion (
    clave           VARCHAR(50) PRIMARY KEY,
    valor           NUMERIC(18,2) NOT NULL,
    descripcion     TEXT,
    actualizado_en  TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar SMLV 2024 Colombia (aprox 1.300.000)
INSERT INTO configuracion (clave, valor, descripcion) 
VALUES ('SMLV_VIGENTE', 1300000, 'Salario Mínimo Legal Vigente para cálculos de modalidad')
ON CONFLICT (clave) DO NOTHING;

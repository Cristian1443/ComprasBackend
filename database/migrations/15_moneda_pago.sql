-- 15_moneda_pago.sql
-- Adición de campos para manejo de moneda múltiple/combinada

ALTER TABLE solicitudes 
ADD COLUMN IF NOT EXISTS valor_moneda_cop NUMERIC(18,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS valor_moneda_usd NUMERIC(18,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS valor_moneda_eur NUMERIC(18,2) DEFAULT 0;

-- Nota: Ya existe la columna 'moneda' (TEXT) que usaremos para 'COP', 'USD', 'EUR' o 'COMBINADA'.

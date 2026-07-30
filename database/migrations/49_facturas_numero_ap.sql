ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS numero_ap VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_facturas_contrato_numero_ap ON facturas_contrato(numero_ap);

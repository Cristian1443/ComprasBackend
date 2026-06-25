-- 27_valores_moneda_texto.sql
-- Conserva el valor digitado exactamente por el usuario (con separadores)
-- sin depender de conversiones ni formateos automáticos.

ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS valor_moneda_cop_texto TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS valor_moneda_usd_texto TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS valor_moneda_eur_texto TEXT;

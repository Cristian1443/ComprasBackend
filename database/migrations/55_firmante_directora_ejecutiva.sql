-- ============================================================
-- 55_firmante_directora_ejecutiva.sql
-- Nuevo rol de firmante fijo para el Acta de Designación de
-- Supervisor (etapa "supervision" en routes/firmas.js): la
-- Directora Ejecutiva / ordenador del gasto que designa al
-- supervisor de cada contrato.
--
-- Valor de nombre/email en placeholder — corregir desde
-- Admin → Configuración de Firmas antes de enviar la primera
-- acta a firma electrónica.
-- ============================================================

INSERT INTO configuracion_firmantes (rol_firma, nombre, email, cargo)
VALUES ('directora_ejecutiva', 'Directora Ejecutiva', 'directora.ejecutiva@investinbogota.org', 'Directora Ejecutiva')
ON CONFLICT (rol_firma) DO NOTHING;
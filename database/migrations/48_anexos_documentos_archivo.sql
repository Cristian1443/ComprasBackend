-- 48_anexos_documentos_archivo.sql
-- Permite adjuntar el archivo real (no solo el nombre) en la sección de Anexos
-- del Formato de Planeación Contractual (punto 4.3 / VI. Anexos).

ALTER TABLE anexos_documentos
    ADD COLUMN IF NOT EXISTS archivo_url TEXT,
    ADD COLUMN IF NOT EXISTS archivo_nombre_original TEXT;

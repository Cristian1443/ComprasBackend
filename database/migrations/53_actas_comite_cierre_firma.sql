-- ============================================================
-- MIGRACIÓN 53: El Acta de Sesión de Comité solo se considera
-- cerrada cuando queda firmada electrónicamente en Adobe Sign.
-- ------------------------------------------------------------
-- Agrega a actas_comite:
--   cerrada_en  -> se llena cuando la firma (etapa 'comite') llega a 'firmado'
--   firma_id    -> referencia a la fila de firmas_documento que la cerró
--
-- El backfill de actas YA EXISTENTES (creadas antes de este cambio, cuando
-- no existía ningún requisito de firma) va DENTRO del mismo bloque que
-- verifica si la columna ya existe. Esto es intencional: el runner de
-- migraciones (scripts/run-migration.cjs) re-ejecuta TODOS los archivos en
-- cada despliegue; un UPDATE suelto fuera de este chequeo volvería a
-- "cerrar" retroactivamente actas nuevas que estén legítimamente pendientes
-- de firma en despliegues futuros. Al envolverlo en el chequeo de
-- information_schema, el backfill corre una sola vez (la primera vez que
-- se agrega la columna) y las re-ejecuciones posteriores no tocan nada.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'actas_comite' AND column_name = 'cerrada_en'
    ) THEN
        ALTER TABLE actas_comite ADD COLUMN cerrada_en TIMESTAMPTZ;
        ALTER TABLE actas_comite ADD COLUMN firma_id UUID REFERENCES firmas_documento(id);

        -- Grandfathering: las actas ya existentes antes de este cambio no
        -- deben quedar bloqueadas retroactivamente por no tener firma.
        UPDATE actas_comite SET cerrada_en = creado_en WHERE cerrada_en IS NULL;
    END IF;
END $$;

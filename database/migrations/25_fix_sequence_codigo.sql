-- 25_fix_sequence_codigo.sql
-- Resincroniza la secuencia con el máximo código existente
-- y mejora el trigger para evitar colisiones futuras

-- 1. Resincronizar la secuencia al valor máximo real de la tabla
SELECT setval(
  'seq_solicitud_codigo',
  GREATEST(
    COALESCE(
      (SELECT MAX(CAST(SPLIT_PART(codigo, '-', 3) AS INTEGER))
       FROM solicitudes
       WHERE codigo ~ '^SOL-\d{4}-\d+$'),
      0
    ),
    1
  )
);

-- 2. Mejorar la función del trigger para tolerar colisiones
--    (por si la secuencia vuelve a desincronizarse en el futuro)
CREATE OR REPLACE FUNCTION generar_codigo_solicitud()
RETURNS TRIGGER AS $$
DECLARE
    nuevo_codigo VARCHAR(30);
    intentos     INTEGER := 0;
BEGIN
    IF NEW.codigo IS NULL THEN
        LOOP
            nuevo_codigo := 'SOL-' || TO_CHAR(NOW(), 'YYYY') || '-'
                          || LPAD(NEXTVAL('seq_solicitud_codigo')::TEXT, 4, '0');
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM solicitudes WHERE codigo = nuevo_codigo
            );
            intentos := intentos + 1;
            IF intentos > 200 THEN
                RAISE EXCEPTION 'No se pudo generar un código único para la solicitud después de 200 intentos';
            END IF;
        END LOOP;
        NEW.codigo := nuevo_codigo;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

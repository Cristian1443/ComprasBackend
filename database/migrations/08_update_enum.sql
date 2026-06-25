-- Agregar valores faltantes al ENUM si no existen
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'estado_solicitud' AND e.enumlabel = 'enviado_juridica') THEN
        ALTER TYPE estado_solicitud ADD VALUE 'enviado_juridica';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'estado_solicitud' AND e.enumlabel = 'finalizado') THEN
        ALTER TYPE estado_solicitud ADD VALUE 'finalizado';
    END IF;
END $$;

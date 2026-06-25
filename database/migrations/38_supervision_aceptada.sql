-- Aceptación formal de supervisión por parte del supervisor asignado
-- entregables ya existe como TEXT desde la migración 13/20
ALTER TABLE solicitudes
    ADD COLUMN IF NOT EXISTS supervision_aceptada BOOLEAN;

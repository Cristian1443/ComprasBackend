ALTER TABLE entregables_supervisor
    ADD COLUMN IF NOT EXISTS fecha_completado TIMESTAMPTZ;

ALTER TABLE informes_supervision_contrato
    ADD COLUMN IF NOT EXISTS fecha_completado TIMESTAMPTZ;

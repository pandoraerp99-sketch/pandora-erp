-- Migration 0017 — ADR-0026: corrección de medio de pago (append-only).
--
-- Agrega `sale_payments.corrects_id` (auto-referencia) para que una corrección
-- de método sea una fila NUEVA que apunta a la original, sin UPDATE (el trigger
-- sale_payments_immutable bloquea UPDATE de todos modos). "Activo" = fila que
-- nadie apunta con su corrects_id.
--
-- Idempotente (IF NOT EXISTS + DO block) — db-apply-all re-corre. Cubre DBs
-- existentes; para DBs frescas la columna ya está en 0008 (fuente de verdad).
--
-- DDL (ADD COLUMN / ADD CONSTRAINT / CREATE INDEX) — NO es un row UPDATE, así
-- que el trigger de inmutabilidad no aplica.

BEGIN;

ALTER TABLE sale_payments
  ADD COLUMN IF NOT EXISTS corrects_id uuid;

-- FK self-ref (guardada: solo si no existe todavía).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_corrects_id_fkey'
  ) THEN
    ALTER TABLE sale_payments
      ADD CONSTRAINT sale_payments_corrects_id_fkey
      FOREIGN KEY (corrects_id) REFERENCES sale_payments(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- UNIQUE partial: ≤1 corrección por fila (estructural, mata doble-click concurrente).
CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_corrects_uidx
  ON sale_payments (corrects_id)
  WHERE corrects_id IS NOT NULL;

COMMIT;

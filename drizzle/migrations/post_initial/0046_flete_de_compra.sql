-- 0046 — El flete de una compra de mercadería (Compras y gastos, V1 paso 2).
--
-- Decisión del owner (2026-11-19): el flete del expreso es costo de
-- adquisición. Se suma al costo de la mercadería que vino en esa compra,
-- repartido por valor. Confirmación contable pendiente con la contadora
-- (A-33, reunion-contador-y-abogado.md).
--
-- ── QUÉ SE GUARDA Y QUÉ NO ──────────────────────────────────────────────────
-- Sólo la RELACIÓN: el gasto del flete apunta a la compra que trajo. La parte
-- del flete de cada artículo NO se escribe en ningún lado: se calcula al leer
-- (ver COSTO_UNITARIO_CON_FLETE_SQL en src/lib/db/schema/expense_items.ts).
-- Así, anular el flete o la compra corrige solo el costo: un flete anulado
-- deja de estar vigente y su parte desaparece de la cuenta, sin reescribir
-- filas que son append-only.
--
-- La FK es COMPUESTA con tenant_id: un flete no puede apuntar a una compra de
-- otro comercio, lo diga quien lo diga.
--
-- `expenses` es append-only por trigger (0026): la columna se completa al
-- insertar y no se toca después.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS flete_de_compra_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_flete_de_compra_fk') THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_flete_de_compra_fk
      FOREIGN KEY (flete_de_compra_id, tenant_id)
      REFERENCES expenses (id, tenant_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_flete_no_es_su_compra') THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_flete_no_es_su_compra
      CHECK (flete_de_compra_id IS NULL OR flete_de_compra_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expenses_flete_de_compra_idx
  ON expenses (flete_de_compra_id)
  WHERE flete_de_compra_id IS NOT NULL;

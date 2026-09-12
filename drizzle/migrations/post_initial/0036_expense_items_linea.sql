-- ─────────────────────────────────────────────────────────────────────────────
-- 0036 — `expense_items.linea`: el orden del detalle de un comprobante
--
-- ── POR QUÉ ─────────────────────────────────────────────────────────────────
-- Dos líneas del mismo comprobante se insertan en la MISMA transacción, así que
-- comparten `created_at` al milisegundo (en Postgres `now()` es el arranque de
-- la transacción, no el reloj). Sin un desempate explícito:
--
--  1. El detalle se puede mostrar hoy en un orden y mañana en otro. Una factura
--     de 8 renglones que se relee en distinto orden que el papel es un detalle
--     que no se puede cotejar.
--  2. Anular una compra no puede recalcular `products.cost`: si el comprobante
--     que queda como "última compra" tiene dos líneas del mismo producto, no
--     hay forma determinística de decir cuál manda. Hoy el costo queda en el
--     valor de un comprobante anulado, que es peor.
--
-- Es una columna de ORDEN, no de negocio: es el renglón del papel.
--
-- ── EL BACKFILL NECESITA UPDATE SOBRE UNA TABLA APPEND-ONLY ─────────────────
-- `expense_items` bloquea UPDATE por trigger (migration 0034). Para numerar lo
-- que ya está cargado hace falta `session_replication_role = 'replica'`, y eso
-- SÓLO funciona a nivel superior dentro de un BEGIN explícito: adentro de un
-- bloque DO da "permission denied", y fuera de una transacción tira un warning
-- que no hace nada. Mismo aprendizaje que la migration 0032.
--
-- El orden que se usa para numerar lo ya cargado es `created_at, id`: es
-- arbitrario (esa información nunca se guardó) pero estable. Lo importante es
-- que de acá en adelante el número lo escribe el service con el orden real en
-- que el comerciante cargó los renglones.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SET LOCAL session_replication_role = 'replica';

ALTER TABLE expense_items ADD COLUMN IF NOT EXISTS linea integer;

UPDATE expense_items ei
   SET linea = num.n
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY expense_id ORDER BY created_at, id) AS n
      FROM expense_items
  ) num
 WHERE ei.id = num.id
   AND ei.linea IS NULL;

DO $guard$
DECLARE
  sin_numero int;
BEGIN
  SELECT count(*) INTO sin_numero FROM expense_items WHERE linea IS NULL;
  IF sin_numero > 0 THEN
    RAISE EXCEPTION 'Quedaron % lineas sin numerar', sin_numero;
  END IF;
END
$guard$;

ALTER TABLE expense_items ALTER COLUMN linea SET NOT NULL;

ALTER TABLE expense_items
  ADD CONSTRAINT expense_items_linea_positiva CHECK (linea > 0);

-- Dos renglones no pueden ser el mismo renglón. Además de la integridad, es lo
-- que hace determinístico el desempate al recalcular el costo.
ALTER TABLE expense_items
  ADD CONSTRAINT expense_items_linea_uq UNIQUE (expense_id, linea);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 — `stock_movements.fecha`: el día en que el movimiento PASÓ
--
-- ── POR QUÉ ─────────────────────────────────────────────────────────────────
-- El libro de stock sólo tenía `created_at`: cuándo se CARGÓ la fila. El
-- inventario al cierre (ítem 8) reconstruía la cantidad con ese reloj, y los
-- lotes con otro: la fecha del COMPROBANTE (`expenses.fecha`).
--
-- Un comprobante de julio cargado en septiembre —el caso de todos los días—
-- quedaba de un lado del cierre para la cantidad y del otro para el lote. En la
-- base de dev, 3 de 3 compras tenían las dos fechas distintas, y el reporte
-- decía que 8 yerbas al 31/07 venían de un comprobante mientras la cantidad al
-- 31/07 no las contenía. Medido con `scripts/dos-relojes.sh`.
--
-- `created_at` se queda: es la auditoría de cuándo se escribió. `fecha` es el
-- hecho de negocio, y es la que leen los reportes.
--
-- ── QUÉ FECHA LLEVA CADA MOVIMIENTO ─────────────────────────────────────────
--  * purchase                → la del comprobante (`expenses.fecha`).
--  * reversa de una anulación → la del comprobante ORIGINAL. Misma regla que la
--                               fila de anulación en `expenses`: si llevara la
--                               de hoy, anular en septiembre una compra de julio
--                               dejaría a julio con mercadería sin comprobante.
--  * todo lo demás           → el día del comercio en que se cargó.
--
-- El default de la columna es ese último caso, calculado en la zona del
-- comercio: un movimiento de las 23:30 del 31/07 en Ushuaia es el 01/08 en UTC.
--
-- ── EL STOCK INICIAL ────────────────────────────────────────────────────────
-- Lo que regularizó la 0035 queda con la fecha de alta del producto, que es su
-- `created_at`. Es la misma elección que ya documentó esa migration; con esta
-- columna la elección pasa a verse, no cambia.
--
-- ── BACKFILL SOBRE UNA TABLA APPEND-ONLY ────────────────────────────────────
-- Igual que 0032 y 0036: `session_replication_role = 'replica'` a nivel
-- superior dentro del BEGIN.
--
-- Antes de escribir esto se midió qué había que completar
-- (`scripts/medir-fecha-movimientos.sh`): 37 movimientos en el único tenant,
-- 3 compras (todas vinculadas a su gasto) y CERO reversas de anulación. Las
-- reversas viejas no guardaban a qué compra pertenecían, así que si apareciera
-- alguna la migration ABORTA en vez de adivinar su fecha.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SET LOCAL session_replication_role = 'replica';

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS fecha date;

-- Reversas de anulación sin vínculo: no hay forma exacta de fecharlas.
DO $guard_reversas$
DECLARE
  sin_vinculo int;
BEGIN
  SELECT count(*) INTO sin_vinculo
    FROM stock_movements
   WHERE type = 'adjustment'
     AND reason LIKE 'Anulación de compra%'
     AND related_expense_id IS NULL
     AND fecha IS NULL;
  IF sin_vinculo > 0 THEN
    RAISE EXCEPTION
      'Hay % reversas de anulacion sin compra vinculada: fecharlas a mano antes de migrar',
      sin_vinculo;
  END IF;
END
$guard_reversas$;

-- Compras: la fecha del comprobante.
UPDATE stock_movements m
   SET fecha = e.fecha
  FROM expenses e
 WHERE e.id = m.related_expense_id
   AND m.fecha IS NULL;

-- Todo lo demás: el día del comercio en que se cargó.
UPDATE stock_movements
   SET fecha = (created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date
 WHERE fecha IS NULL;

DO $guard$
DECLARE
  total int;
  sin_fecha int;
  compras_distintas int;
BEGIN
  SELECT count(*) INTO total FROM stock_movements;
  SELECT count(*) INTO sin_fecha FROM stock_movements WHERE fecha IS NULL;
  SELECT count(*) INTO compras_distintas
    FROM stock_movements m
    JOIN expenses e ON e.id = m.related_expense_id
   WHERE m.fecha <> e.fecha;

  IF sin_fecha > 0 THEN
    RAISE EXCEPTION 'Quedaron % de % movimientos sin fecha', sin_fecha, total;
  END IF;
  IF compras_distintas > 0 THEN
    RAISE EXCEPTION 'Quedaron % movimientos con fecha distinta a su comprobante', compras_distintas;
  END IF;
  RAISE NOTICE 'stock_movements.fecha: % de % movimientos fechados', total - sin_fecha, total;
END
$guard$;

ALTER TABLE stock_movements
  ALTER COLUMN fecha SET DEFAULT (now() AT TIME ZONE 'America/Argentina/Ushuaia')::date,
  ALTER COLUMN fecha SET NOT NULL;

-- El inventario al cierre filtra por (tenant, producto, fecha).
CREATE INDEX IF NOT EXISTS stock_movements_tenant_product_fecha_idx
  ON stock_movements (tenant_id, product_id, fecha);

COMMIT;

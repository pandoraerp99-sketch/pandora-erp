-- 0032 — El ledger de stock guarda el SIGNO del movimiento.
--
-- ── EL AGUJERO ────────────────────────────────────────────────────────────
-- `stock_movements` guarda siempre `qty > 0` (CHECK `stock_movements_qty_positive`)
-- y el signo se deducia del `type`. Para 4 de los 5 types esa deduccion es
-- exacta: sale y loss siempre restan, purchase y return siempre suman.
--
-- Para `adjustment` NO. La direccion es input EXPLICITO de quien ajusta
-- (`inferDirection` en src/lib/inventory/stock.ts la exige justamente por eso),
-- se usaba para calcular el stock nuevo, se escribia en el payload del audit...
-- y despues no se guardaba en ningun lado.
--
-- O sea: dos ajustes de 5 unidades sobre el mismo producto, uno que SUMA y otro
-- que RESTA, quedaban como dos filas identicas salvo el `id` y la hora. El dato
-- que las distingue existia en memoria y se tiraba al escribir.
--
-- ── POR QUE IMPORTA, Y NO ES COSMETICO ────────────────────────────────────
-- Un ledger append-only existe para UNA cosa: reconstruir el estado a una fecha
-- pasada sumando los movimientos. Sin el signo de los ajustes esa suma no se
-- puede hacer — y "inventario valorizado AL CIERRE", que es lo que pide la
-- contadora (item 8 de su lista), es exactamente esa cuenta.
--
-- Con la columna, el stock a cualquier fecha es una sola expresion y no hay que
-- consultar el `type` para nada:
--   sum(CASE WHEN direction = 'in' THEN qty ELSE -qty END)
--
-- ── EL BACKFILL SALE DE LA REGLA, NO DE LOS DATOS DE HOY ──────────────────
-- Hoy las 27 filas que existen son todas `type='sale'`, asi que un
-- `DEFAULT 'out'` daria el resultado correcto. Seria correcto por casualidad: la
-- primera compra o devolucion que entrara quedaria mal. El backfill deriva de
-- `type` con la MISMA regla que `inferDirection`, que es correcta para cualquier
-- fila que exista hoy o aparezca en el medio.
--
-- Los `adjustment` son el unico caso que no se puede derivar (ese es todo el
-- punto de la columna). Hoy hay CERO — porque `adjustStock` nunca escribio en
-- esta tabla, que es el otro agujero que cierra este commit. Si hubiera alguno,
-- esta migration FALLA en vez de adivinar: un signo inventado en un ledger es
-- peor que no tener el ledger.
--
-- ── POR QUE session_replication_role ──────────────────────────────────────
-- `stock_movements_no_update` (migration 0002) hace RAISE EXCEPTION en UPDATE:
-- la tabla es append-only y el trigger esta haciendo exactamente su trabajo. El
-- backfill es una correccion estructural del schema, no la edicion de un
-- movimiento, asi que corre con los triggers de usuario apagados por el tiempo
-- de esta transaccion.
--
-- `SET LOCAL` tiene que ir a nivel top Y dentro de una transaccion explicita:
-- adentro de un bloque DO da "permission denied" (el rol `postgres` de Supabase
-- local no es superusuario) y afuera de una transaccion es un warning que no
-- hace nada y deja pasar el UPDATE contra el trigger.

BEGIN;

SET LOCAL session_replication_role = 'replica';

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS direction text;

COMMENT ON COLUMN stock_movements.direction IS
  'Signo del movimiento: in suma al stock, out resta. qty es SIEMPRE positivo. Para adjustment lo elige quien ajusta; para el resto se deriva del type (misma regla que inferDirection).';

-- Backfill por regla, no por dato.
UPDATE stock_movements
   SET direction = CASE
         WHEN type IN ('sale', 'loss') THEN 'out'
         WHEN type IN ('purchase', 'return') THEN 'in'
       END
 WHERE direction IS NULL
   AND type <> 'adjustment';

-- Fail-closed: un adjustment sin direccion derivable no se adivina.
DO $guard$
DECLARE
  huerfanos bigint;
BEGIN
  SELECT count(*) INTO huerfanos
    FROM stock_movements
   WHERE direction IS NULL;

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Hay % movimientos sin direccion derivable (adjustment previos a esta migration). No se inventa el signo: resolver a mano antes de aplicar.',
      huerfanos;
  END IF;
END
$guard$;

ALTER TABLE stock_movements
  ALTER COLUMN direction SET NOT NULL;

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_direction_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_direction_check
  CHECK (direction IN ('in', 'out'));

COMMIT;

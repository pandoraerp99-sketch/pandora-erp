-- ─────────────────────────────────────────────────────────────────────────────
-- 0035 — Regularización: el stock que el libro no explica entra al libro
--
-- ── EL AGUJERO ──────────────────────────────────────────────────────────────
-- `createProduct` escribía `products.stock_current` directo en el INSERT, sin
-- emitir ningún movimiento. `importProductsFromCsv` hacía lo mismo en bulk, y
-- `updateProduct` permitía escribir la columna por spread. Resultado medido
-- contra la base de dev (`scripts/reconstruye-stock.sh`): de 7 productos con
-- movimientos, **7 no reconstruían**, y la diferencia de cada uno era su stock
-- de alta (60, 36, 20, 15, 12, 4, 2).
--
-- Eso rompe la única invariante de la que depende el inventario valorizado al
-- cierre (ítem 8 del pedido de la contadora): si sumando los movimientos con su
-- signo no se llega al stock de hoy, tampoco se puede decir cuánto había al 31
-- de diciembre, y la valuación no se puede calcular ni explicar.
--
-- El código ya no abre ese agujero (ver `recordOpeningStock`). Esta migración
-- se ocupa de lo que YA está cargado.
--
-- ── QUÉ DICE Y QUÉ NO DICE CADA FILA QUE INSERTA ────────────────────────────
-- La cantidad NO se inventa: es exactamente `stock_current − Σ(movimientos con
-- signo)`, o sea lo que el libro no puede explicar. Por construcción, un
-- producto que ya cuadra da 0 y no genera fila (el CHECK `qty > 0` lo impediría
-- igual), así que esta migración es idempotente y segura contra una base donde
-- el código nuevo ya viene abriendo el libro.
--
-- 🔴 La FECHA sí es una elección, y por eso se explica acá y en el motivo de
-- cada fila. Se usa `products.created_at`: es cuándo el sistema se enteró de
-- esa mercadería, **no** cuándo se adquirió. Es lo único que la base sabe; el
-- resto sería inventado. No se usa como fecha de adquisición para valorizar:
-- estas unidades no tienen comprobante ni costo verificable, así que el reporte
-- de valuación tiene que mostrarlas como un estado aparte ("sin compra
-- asociada") en vez de tratarlas como una compra.
--
-- ⚠️ Y el motivo NO dice "stock inicial" a secas: la diferencia puede incluir
-- ediciones directas posteriores al alta (`updateProduct` pudo escribir la
-- columna hasta hoy). Afirmar "inicial" sería afirmar más de lo que se midió.
--
-- ── SIN session_replication_role ────────────────────────────────────────────
-- `stock_movements` es append-only por triggers que bloquean UPDATE, DELETE y
-- TRUNCATE. El INSERT está permitido, así que acá no hace falta desactivar
-- nada (a diferencia de la 0032, que necesitaba UPDATE).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH libro AS (
  SELECT product_id,
         SUM(CASE WHEN direction = 'in' THEN qty ELSE -qty END) AS segun_libro
    FROM stock_movements
   GROUP BY product_id
),
descuadre AS (
  SELECT p.tenant_id,
         p.id AS product_id,
         p.created_at,
         p.stock_current - COALESCE(l.segun_libro, 0) AS diferencia
    FROM products p
    LEFT JOIN libro l ON l.product_id = p.id
   WHERE p.stock_tracking_enabled
     AND p.stock_current <> COALESCE(l.segun_libro, 0)
)
INSERT INTO stock_movements (
  tenant_id, product_id, type, qty, direction, reason, created_at
)
SELECT d.tenant_id,
       d.product_id,
       'adjustment',
       abs(d.diferencia),
       CASE WHEN d.diferencia > 0 THEN 'in' ELSE 'out' END,
       'Regularizacion (migration 0035): unidades que el libro no explicaba. '
       'La fecha es la del alta del producto en el sistema, NO una fecha de '
       'adquisicion conocida: no hay comprobante ni costo verificable detras.',
       d.created_at
  FROM descuadre d;

-- ── Guard: si después de esto queda UN solo producto descuadrado, la
-- migración no hizo lo que dice y no se commitea.
DO $guard$
DECLARE
  faltan int;
BEGIN
  WITH libro AS (
    SELECT product_id,
           SUM(CASE WHEN direction = 'in' THEN qty ELSE -qty END) AS segun_libro
      FROM stock_movements
     GROUP BY product_id
  )
  SELECT count(*) INTO faltan
    FROM products p
    LEFT JOIN libro l ON l.product_id = p.id
   WHERE p.stock_tracking_enabled
     AND p.stock_current <> COALESCE(l.segun_libro, 0);

  IF faltan > 0 THEN
    RAISE EXCEPTION
      'Quedan % productos cuyo stock no se reconstruye desde el libro', faltan;
  END IF;
END
$guard$;

COMMIT;

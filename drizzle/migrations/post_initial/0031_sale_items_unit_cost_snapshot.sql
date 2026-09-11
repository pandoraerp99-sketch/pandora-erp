-- 0031 — El costo al momento de la venta.
--
-- RESEARCH-BRIEF-panel.md §8.b: "es barato agregarlo de aca en adelante e
-- IMPOSIBLE de backfillear". Esa es toda la razon por la que esta migration
-- existe hoy y no cuando se construya el reporte de margen.
--
-- ── POR QUE NO ALCANZA CON `products.cost` ────────────────────────────────
-- `products.cost` es UN SOLO valor: el costo de hoy. Cuando el proveedor
-- aumenta, se pisa y lo anterior no queda en ningun lado. Calcular el margen
-- de una venta de marzo con el costo de septiembre no da el margen de marzo:
-- da un numero inventado que ademas parece confiable.
--
-- El resto de la fila ya funciona asi. `product_name_snapshot`,
-- `product_sku_snapshot`, `unit_price`, `tax_rate`, `tdf_exempt`: todos se
-- congelan en addItemToSale. El costo se suma a ese conjunto y se congela en
-- el mismo lugar y en el mismo instante. Que el precio saliera de un momento y
-- el costo de otro es precisamente lo que haria el margen inexplicable.
--
-- ── NULLABLE, Y NO ES UN DESCUIDO ─────────────────────────────────────────
-- `products.cost` es nullable: un comercio puede tener productos cargados sin
-- costo, y esa ausencia es INFORMACION. "No habia costo cargado" NO es lo
-- mismo que "el costo era 0".
--
-- Un DEFAULT 0 convertiria cada producto sin costo en uno que se regala, y el
-- margen daria 100%: un numero alto, redondo y falso, del lado que nadie
-- revisa. Y como en la practica nadie carga un costo de 0, la confusion seria
-- silenciosa: no habria ninguna fila con 0 legitimo con la cual contrastar.
--
-- Quien lea esta columna tiene que tratar NULL como un tercer estado visible
-- ("sin costo cargado"), igual que 'sin_rotacion' en dias de stock y que los
-- dias sin dato del calendario. Nunca como 0, nunca como una fila que se
-- descarta en silencio y hace que los totales no cierren.
--
-- ── LAS 8.582 FILAS QUE YA EXISTEN QUEDAN EN NULL ─────────────────────────
-- NO se backfillean. Ponerles el costo de hoy seria fabricar la historia que
-- §8.b dice que no se puede reconstruir, con el agravante de que quedaria
-- indistinguible de un dato real. Se quedan en NULL para siempre y esa es la
-- respuesta correcta: de esas ventas no sabemos el costo.
--
-- ── INMUTABILIDAD ─────────────────────────────────────────────────────────
-- `sale_items_immutable_after_finalize()` es por FILA, no por columna: lanza
-- ante cualquier UPDATE/DELETE si la venta padre tiene `finalized_at`. Por eso
-- la columna nueva queda protegida sin tocar el trigger. Igual va con test,
-- porque un costo editable despues del cobro es PEOR que no tenerlo: parece
-- evidencia.

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS unit_cost_snapshot numeric(19, 4);

COMMENT ON COLUMN sale_items.unit_cost_snapshot IS
  'Costo unitario del producto congelado en addItemToSale. NULL = no habia costo cargado (NO es 0). Las filas anteriores a la migration 0031 quedan en NULL a proposito: ese dato no se puede reconstruir.';

-- Un costo negativo no significa nada. 0 si: un producto que entra sin cargo.
ALTER TABLE sale_items
  DROP CONSTRAINT IF EXISTS sale_items_unit_cost_snapshot_no_negativo;
ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_unit_cost_snapshot_no_negativo
  CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0);

-- 0022 — Rubro (categoría) de producto.
--
-- Motivo: la maqueta `pos-preview/productos-v3.html` filtra y agrupa por rubro
-- (Bebidas · Almacén · Cigarrillos · Limpieza · Golosinas), y el POS muestra
-- los mismos chips arriba del catálogo. Es el único dato de esa pantalla que
-- NO se podía derivar de lo que ya había en la tabla.
--
-- ── Qué NO se agrega, y por qué ────────────────────────────────────────────
--
-- * Tabla `categories` aparte. Sería un CRUD entero (alta, baja, color, orden,
--   reasignación al borrar) para algo que hoy son cinco strings. CLAUDE.md
--   §20.2 — abstracción prematura. Si aparecen jerarquías, reglas por rubro o
--   un cliente que necesite administrarlas, ahí se promueve con su ADR.
--
-- * Columna de COLOR. La maqueta le da un color a cada rubro, pero se deriva
--   determinísticamente del nombre en el cliente: mismo rubro → mismo color,
--   siempre, sin guardar nada ni mantenerlo sincronizado.
--
-- * `is_favorite` / `is_featured`. La maqueta muestra una estrella que dice
--   "★ Más vendido" — eso NO es un favorito marcado a mano, es una CONSULTA
--   sobre el histórico de ventas (`sale_items`). Guardarlo como booleano sería
--   un dato que nace desactualizado. Va con reportes, no con el producto.
--
-- * `image_url`. La foto necesita el flujo de subida a Storage completo
--   (validación de tipo/tamaño, límites por tenant, borrado al reemplazar).
--   La maqueta YA trae el fallback de inicial con color para los productos sin
--   foto — se usa ese, y la subida entra cuando se construya en serio.
--
-- ── Forma de la columna ────────────────────────────────────────────────────
-- NULLABLE a propósito: los productos que ya existen no tienen rubro y
-- obligarlos exigiría inventarles uno. "Sin rubro" es un estado legítimo, y la
-- pantalla lo muestra como tal.
--
-- Sin CHECK contra una lista cerrada: cada comercio tiene sus rubros (una
-- ferretería no vende Golosinas). El largo se acota para que no entre un
-- párrafo.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_length;
ALTER TABLE products
  ADD CONSTRAINT products_category_length
  CHECK (category IS NULL OR (length(btrim(category)) BETWEEN 1 AND 64));

-- Filtrar por rubro dentro del tenant es la consulta de la pantalla.
-- Parcial: los NULL no se filtran nunca, no tiene sentido indexarlos.
CREATE INDEX IF NOT EXISTS products_tenant_category_idx
  ON products (tenant_id, category)
  WHERE category IS NOT NULL;

COMMENT ON COLUMN products.category IS
  'Rubro comercial libre por tenant (Bebidas, Almacén, ...). NULL = sin rubro. '
  'El color del chip se deriva del nombre en el cliente, no se guarda. '
  'No confundir con tdf_exempt, que es fiscal (Ley 19.640) y ya existe.';

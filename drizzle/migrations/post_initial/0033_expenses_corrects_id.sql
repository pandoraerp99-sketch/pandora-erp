-- 0033 — Un gasto cargado de mas se puede corregir.
--
-- ── EL AGUJERO ────────────────────────────────────────────────────────────
-- `RESEARCH-BRIEF-gastos.md` §7 dice: "Append-only... corregir es registrar un
-- gasto de ajuste, no editar". La primera mitad es cierta y esta enforced por
-- trigger (`expenses_no_update` / `expenses_no_delete`, verificado: el UPDATE
-- falla). La segunda mitad NO FUNCIONA.
--
-- `expenses_importes_check` exige `total > 0`, asi que el "gasto de ajuste"
-- solo puede sumar. Un gasto cargado de MAS —o uno que directamente no
-- existio— no se puede corregir por ningun camino: ni editando (trigger), ni
-- borrando (trigger), ni compensando (CHECK).
--
-- Se encontro construyendo compras de mercaderia: una compra mal tipeada
-- corromperia el inventario valorizado que se le manda a la contadora, que es
-- justo el reporte para el que existe el modulo.
--
-- ── EL PATRON YA ESTABA DECIDIDO ──────────────────────────────────────────
-- ADR-0026 resolvio exactamente esto para el medio de pago de una venta:
-- `corrects_id` self-ref + "activo = fila que nadie apunta" + UNIQUE parcial
-- contra el doble-click. Cero UPDATE. Se copia, no se inventa otro.
--
--   corregir un importe → fila nueva con los valores correctos + corrects_id
--   anular              → fila nueva en CERO + corrects_id
--
-- Un solo mecanismo para los dos casos. La anulacion en cero es lo que obliga
-- a tocar el CHECK: es la unica fila que legitimamente vale 0.
--
-- ── DOS DECISIONES QUE SE TOMAN ACA PARA NO DESCUBRIRLAS DESPUES ──────────
--
-- 1. LA CORRECCION HEREDA LA `fecha` DEL ORIGINAL, no la de hoy.
--    Las 7 consultas que leen esta tabla filtran por rango de fecha. Si la
--    correccion de un gasto de marzo llevara la fecha de hoy, marzo perderia
--    el gasto (el original queda superseded) y septiembre ganaria uno que no
--    existe. Ningun total se veria mal: la plata cambia de PERIODO en
--    silencio. `fecha` es la fecha economica del comprobante — arreglar un
--    tipeo no cambia cuando paso.
--
-- 2. LA FILA DE ANULACION NO SE QUEDA CON EL `cash_movement_id`.
--    Si el gasto se pago en efectivo, devolver la plata a la caja es un
--    `deposit` nuevo en la caja ABIERTA de hoy — no se toca la sesion vieja,
--    que puede estar cerrada y arqueada. Ese deposit NO se linkea a la fila de
--    anulacion (`expenses_cash_movement_uq` es el 1:1 gasto→egreso, y un
--    ingreso no es el pago de un gasto): queda nombrado en el `reason` del
--    movimiento de caja.
--
-- ── LO QUE ESTA MIGRATION NO HACE ─────────────────────────────────────────
-- No agrega evento de auditoria. El catalogo de EVENT-TAXONOMY esta CERRADO y
-- no tiene ningun `expense.*`; el modulo de gastos hoy no emite un solo evento
-- (usa `logger.info`). La tabla append-only + `corrects_id` ES el rastro: cada
-- correccion deja las dos filas y quien apunta a quien. Es decision
-- deliberada, no olvido.

BEGIN;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS corrects_id uuid;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_corrects_id_fkey;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_corrects_id_fkey
  FOREIGN KEY (corrects_id) REFERENCES expenses(id) ON DELETE RESTRICT;

COMMENT ON COLUMN expenses.corrects_id IS
  'Apunta al gasto que esta fila corrige o anula. Una fila esta VIGENTE si nadie la apunta y su total > 0. Nunca se hace UPDATE: corregir es insertar.';

-- Una sola correccion por gasto. Es lo que mata el doble-click concurrente:
-- dos correcciones simultaneas dejarian dos filas vigentes por un solo gasto.
DROP INDEX IF EXISTS expenses_corrects_uq;
CREATE UNIQUE INDEX expenses_corrects_uq
  ON expenses (corrects_id)
  WHERE corrects_id IS NOT NULL;

-- Los importes en CERO son legales SOLO para una anulacion.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_importes_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_importes_check
  CHECK (
    (total > 0 AND neto >= 0 AND iva >= 0)
    OR (corrects_id IS NOT NULL AND total = 0 AND neto = 0 AND iva = 0)
  );

-- Nadie se corrige a si mismo (un ciclo de largo 1 dejaria la fila fuera de
-- toda consulta: superseded por ella misma).
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_corrects_no_self;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_corrects_no_self
  CHECK (corrects_id IS NULL OR corrects_id <> id);

COMMIT;

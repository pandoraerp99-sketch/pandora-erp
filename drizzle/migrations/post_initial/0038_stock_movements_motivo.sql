-- ─────────────────────────────────────────────────────────────────────────────
-- 0038 — `stock_movements.motivo`: por qué se ajustó el stock a mano
--
-- ── POR QUÉ ─────────────────────────────────────────────────────────────────
-- El ajuste manual desde la pantalla de Productos pide un motivo de una lista
-- cerrada (RESEARCH-BRIEF-ajuste-de-stock.md):
--
--   Merma      rotura · vencimiento · robo          → type 'loss', sólo resta
--   Corrección recuento · error_carga · otro        → type 'adjustment'
--
-- `type` ya separa merma de corrección. Lo que NO separa es rotura de
-- vencimiento de robo — y "hay un problema de robo" es justamente lo que el
-- bloque de merma del Panel tiene que poder decir. Como texto libre en `reason`
-- habría que parsearlo; como columna se consulta.
--
-- Y es un dato CON RELOJ: un ajuste cargado sin la columna no se puede
-- reclasificar después sin adivinar. Mismo argumento que `unit_cost_snapshot`
-- (migration 0031). Por eso entra antes del primer ajuste real.
--
-- ── LA REGLA, TAMBIÉN EN LA DB ──────────────────────────────────────────────
--  * motivo de merma       ⇔ type = 'loss'
--  * motivo de corrección  ⇒ type = 'adjustment'
--  * NULL                  ⇒ no es 'loss'. Los movimientos del sistema (venta,
--                            compra, reversa de anulación, stock inicial) no
--                            llevan motivo: su origen está en su vínculo.
--
-- El service valida lo mismo antes de tomar el lock. La CHECK es la red para
-- quien escriba por fuera del service.
--
-- ── NO HAY BACKFILL ─────────────────────────────────────────────────────────
-- Medido antes de escribir esto: 0 movimientos 'loss' en la base, y los
-- 'adjustment' existentes son todos del sistema (stock inicial de la 0035). La
-- CHECK valida las filas existentes al crearse: si hubiera algún 'loss', la
-- migration falla en vez de inventarle un motivo.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS motivo text;

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_motivo_check;
-- ⚠️ Cada rama con motivo lleva `motivo IS NOT NULL` explícito. Sin eso, un
-- 'loss' con motivo NULL evalúa `NULL IN (...)` → NULL, el OR entero da NULL, y
-- una CHECK que da NULL se considera CUMPLIDA: la primera versión de esta
-- migration dejaba entrar una merma sin motivo. Lo encontró T-INV-06.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_motivo_check CHECK (
  (motivo IS NULL AND type <> 'loss')
  OR (motivo IS NOT NULL AND motivo IN ('rotura', 'vencimiento', 'robo') AND type = 'loss')
  OR (motivo IS NOT NULL AND motivo IN ('recuento', 'error_carga', 'otro') AND type = 'adjustment')
);

-- Una merma siempre sale. `inferDirection` ya lo garantiza en el service.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_loss_out_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_loss_out_check CHECK (
  type <> 'loss' OR direction = 'out'
);

COMMIT;

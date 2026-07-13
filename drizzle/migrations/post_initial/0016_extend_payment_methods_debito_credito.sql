-- ─────────────────────────────────────────────────────────────
-- 0016 — Extender medios de pago: débito / crédito separados
-- ─────────────────────────────────────────────────────────────
-- A-26 (resuelto por investigación 2026-07-12): el posnet AR liquida y concilia
-- débito y crédito por SEPARADO (crédito incluso por plazo/cuotas), así que el
-- arqueo los separa. Es concern de caja/conciliación, NO fiscal (la forma de pago
-- no viaja en el CAE de B/C). Aditivo: 'tarjeta' se retiene como genérico legacy;
-- ninguna fila existente se invalida (el nuevo conjunto es superset del viejo).
--
-- drizzle-kit generate está roto (bug BigInt, ver 0000_workaround_drizzle_kit_bigint_bug),
-- por eso la constraint se maneja acá (post_initial) con ALTER IDEMPOTENTE que corre
-- en cada apply. Cubre:
--   (a) DBs existentes — 0008 usa CREATE TABLE IF NOT EXISTS = no re-crea la constraint.
--   (b) sales.payment_method — su CHECK vive en la migración drizzle 0000 (estática).
-- Debe correr DESPUÉS de 0008 (sale_payments) — el orden alfabético lo garantiza.

-- sale_payments.method (granular per-row): efectivo / debito / credito / tarjeta / mp_qr
ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
  CHECK (method IN ('efectivo','debito','credito','tarjeta','mp_qr'));

-- sales.payment_method (denormalizado): + 'mixto' (2+ payments con methods distintos)
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('efectivo','debito','credito','tarjeta','mp_qr','mixto'));

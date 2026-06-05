/**
 * Helpers comunes para schema Drizzle.
 * Centraliza columnas estandar (id, timestamps, tenant_id) para no repetir.
 */
import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const tenantId = () => uuid('tenant_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const TAX_REGIMES = [
  'responsable_inscripto',
  'monotributo',
  'iva_liberado',
] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const JURISDICTION_PROVINCES = ['TIERRA_DEL_FUEGO'] as const;
export type JurisdictionProvince = (typeof JURISDICTION_PROVINCES)[number];

export const SPECIAL_REGIMES = ['LEY_19640'] as const;
export type SpecialRegime = (typeof SPECIAL_REGIMES)[number];

export const AFIP_ENVIRONMENTS = ['homologacion', 'produccion'] as const;
export type AfipEnvironment = (typeof AFIP_ENVIRONMENTS)[number];

export const DEMO_STATUSES = ['trial', 'active', 'read_only', 'archived'] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];

export const USER_ROLES = ['owner', 'admin', 'cashier', 'accountant'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACTOR_TYPES = ['user', 'system', 'support', 'cron', 'worker'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const PII_LEVELS = ['public', 'internal', 'pii_low', 'pii_high', 'secret'] as const;
export type PiiLevel = (typeof PII_LEVELS)[number];

export const SEVERITIES = ['info', 'notice', 'warning', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const COMMERCIAL_STATUSES = [
  'draft',
  'in_progress',
  'cobrando',
  'cobrada',
  'terminada',
  'cancelada',
] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export const FISCAL_STATUSES = [
  'not_required',
  'pending',
  'requesting',
  'issued',
  'reconciled_issued',
  'requires_reconciliation',
  'failed',
  'number_burned',
  'contingency',
  'manual_resolution_required',
] as const;
export type FiscalStatus = (typeof FISCAL_STATUSES)[number];

export const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'mp_qr', 'mixto'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Métodos válidos para `sale_payments.method` (granular per-row).
 * NO incluye 'mixto' — ese valor solo aplica al denormalizado
 * `sales.payment_method` cuando hay 2+ sale_payments con methods distintos
 * en una misma sale. Sprint 5 ROADMAP.
 */
export const SALE_PAYMENT_METHODS = ['efectivo', 'tarjeta', 'mp_qr'] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

/**
 * Estados de MercadoPago para `mp_payments.status` — mapeo del enum oficial
 * de MP API webhook. Sprint 5 ROADMAP Sales+MP.
 * - pending: payment creado, esperando aprobación
 * - approved: payment aceptado, fondos retenidos/transferidos
 * - rejected: payment rechazado (tarjeta sin fondos, anti-fraud, etc.)
 * - cancelled: cancelado por usuario o expirado
 * - refunded: payment aprobado y luego devuelto al pagador
 *
 * NO mapeamos in_process / authorized / charged_back F0 — si MP los envía,
 * el handler los registra como 'pending' temporal y conciliación posterior
 * los reclasifica con audit explícito.
 */
export const MP_PAYMENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'refunded',
] as const;
export type MpPaymentStatus = (typeof MP_PAYMENT_STATUSES)[number];

export const INVOICE_TYPES = ['A', 'B', 'C', 'E', 'M'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const CUSTOMER_DOC_TYPES = ['DNI', 'CUIT', 'CUIL', 'none'] as const;
export type CustomerDocType = (typeof CUSTOMER_DOC_TYPES)[number];

// Stock movement types — Sprint 3 ROADMAP Inventory context.
// - sale: salida por venta a cliente final (FK related_sale_id obligatorio)
// - purchase: ingreso por compra a proveedor (FK related_purchase_id, F1+ cuando exista módulo compras)
// - adjustment: ajuste manual (reason text obligatorio — enforce via CHECK constraint)
// - return: retorno (sale → return invierte stock, o purchase → return descuenta)
// - loss: pérdida/merma (incluye robo, vencimiento, rotura)
export const STOCK_MOVEMENT_TYPES = [
  'sale',
  'purchase',
  'adjustment',
  'return',
  'loss',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

// Cash movement types — Sprint 4 ROADMAP Cash context (C-OPS-01).
// Movimientos MANUALES de caja (no ventas — esos van a sales/sale_payments).
// - withdraw: comerciante retira efectivo de caja (gastos del día, transferir al banco)
// - deposit: comerciante aporta efectivo a caja (caja chica, dinero suelto)
// - provider_payment: pago en efectivo a proveedor desde caja
//
// F1+ trigger (agregar nuevos types): salary_advance / tip_distribution / etc.
// requiere ADR pequeño + cambio CHECK constraint DB + advisor doc cierre.
export const CASH_MOVEMENT_TYPES = [
  'withdraw',
  'deposit',
  'provider_payment',
] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

/**
 * Umbral de descuadre (en ARS, scale 4) para escalar severidad de incidente:
 * - Descuadre absoluto > DESCUADRE_HIGH_THRESHOLD_ARS → S2 (OPERATIONAL-SEVERITY)
 * - Descuadre absoluto ≤ DESCUADRE_HIGH_THRESHOLD_ARS → S3
 *
 * F1+ trigger: si comerciante pide threshold custom (raro), implementar
 * feature flag por tenant. Por ahora hardcoded para Pandora team alerting consistente.
 */
export const DESCUADRE_HIGH_THRESHOLD_ARS = '5000.0000';

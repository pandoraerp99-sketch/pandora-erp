/**
 * Guard de conexión de la ruta fiscal (HIGH-2, auditoría externa 2026-07-10).
 *
 * La emisión del CAE sostiene una transacción DB (SELECT FOR UPDATE de la
 * secuencia) DURANTE la llamada AFIP (§8.5). El **pooler transaccional de
 * Supabase (puerto 6543)** no soporta txns con locks sostenidos y las mata
 * (idle_in_transaction) → el número no se incrementa + el snapshot no se escribe
 * → el próximo intento reusa CbteDesde → 10016 / doble autorización.
 *
 * Por eso la ruta fiscal DEBE usar conexión directa/session (5432). Este guard
 * falla-rápido si detecta el pooler. Puro (sin imports de DB) → testeable.
 */
import { FiscalIntegrityError } from '../multi_tenant/errors.js';

/** Puerto del pooler transaccional de Supabase (transaction mode). */
const SUPABASE_TRANSACTION_POOLER_PORT = '6543';

export function assertFiscalDbConnectionMode(databaseUrl: string): void {
  let port: string;
  try {
    port = new URL(databaseUrl).port;
  } catch {
    // URL no parseable → env.ts ya la valida al boot; no bloqueamos acá.
    return;
  }
  if (port === SUPABASE_TRANSACTION_POOLER_PORT) {
    throw new FiscalIntegrityError(
      'La ruta fiscal no puede usar el pooler transaccional de Supabase (puerto 6543). ' +
        'Usá una conexión directa/session (5432): §8.5 sostiene la tx durante la llamada AFIP.',
      { port }
    );
  }
}

/**
 * El timeout de AFIP tiene que ser MENOR que el de la base.
 *
 * La otra mitad de HIGH-2. `emitInvoice` sostiene la transaccion (con el lock
 * de la secuencia) mientras espera a AFIP. Si Postgres tiene
 * `idle_in_transaction_session_timeout` y ese numero es MENOR que lo que
 * esperamos a AFIP, la base corta la transaccion PRIMERO: el numero fiscal no
 * avanza, el snapshot no se escribe, y si AFIP igual autorizo quedo un CAE
 * emitido que la app no registro. Ese es el peor estado posible — hay que
 * resolverlo a mano contra AFIP.
 *
 * Quien corta tiene que ser SIEMPRE nuestro timeout, que sabe transicionar la
 * venta a `requires_reconciliation` y dejarle el trabajo al worker.
 *
 * `dbTimeoutMs = 0` significa "sin limite" en Postgres: no hay conflicto.
 *
 * Es puro para poder testear el orden sin depender de como este configurada la
 * base de desarrollo (en local esta en 0 y no probaria nada).
 */
export function assertAfipTimeoutFitsDb(
  afipTimeoutMs: number,
  dbTimeoutMs: number,
  /** Margen para que la transicion de estado alcance a escribirse. */
  margenMs = 5_000
): void {
  if (dbTimeoutMs === 0) return; // sin limite en la base
  if (afipTimeoutMs + margenMs >= dbTimeoutMs) {
    throw new FiscalIntegrityError(
      'El timeout de AFIP (' +
        afipTimeoutMs / 1000 +
        's) no entra en el idle_in_transaction_session_timeout de la base (' +
        dbTimeoutMs / 1000 +
        's). La base cortaria la transaccion antes que nosotros y el numero ' +
        'fiscal quedaria en un limbo. Subi el timeout de la base o baja el de AFIP.',
      { afipTimeoutMs, dbTimeoutMs, margenMs }
    );
  }
}

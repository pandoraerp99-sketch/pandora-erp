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

/**
 * Resolución del tenant cuando NO viene de la sesión.
 * CLAUDE.md §7.2 — defensa en profundidad, aplicada donde de verdad hace falta.
 *
 * **Por qué existe, y por qué no se usa en todos lados.**
 *
 * §7.2 pide que "toda Application Service valide el tenant además del RLS".
 * En este código eso ya se cumple de otra forma: cada query de los services
 * filtra por `tenant_id` adentro del `where`, así que un acceso cruzado
 * devuelve cero filas y termina en `NotFoundError`. Agregar ahí un
 * `validateTenantAccess()` sería un chequeo siempre verdadero — y peor,
 * daría la falsa sensación de cobertura que esa regla busca evitar.
 *
 * La excepción real es el webhook de MercadoPago: el tenant llega en el
 * PATH de la URL (`/api/webhooks/mp/{company_id}`), o sea input externo,
 * y entra directo al tracing context. Ahí sí hay algo que validar.
 *
 * **Qué pasaba sin esto** (verificado contra la base, no inferido):
 *   - malformado → el INSERT de dedup explotaba en el cast a uuid → 500.
 *     Un 500 en un webhook además hace que MP reintente.
 *   - uuid válido pero inexistente → `processed_webhook_events` y
 *     `jobs_queue` no tienen FK sobre `tenant_id`: la fila entraba y
 *     quedaba un job encolado para un tenant fantasma. `mp_payments` sí
 *     tiene FK, así que lo atrapaba una tabla más abajo — el chequeo tiene
 *     que estar en el borde, no repartido entre las FKs que existan.
 *
 * **Se llama ANTES de montar el tracing context.** Una vez que el
 * `tenant_id` entró al context, mancha cada línea de Pino y cada escritura
 * de audit_log que venga después.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { companies } from '../db/schema/companies.js';
import { isValidUuid } from '../tracing/ids.js';

export type ResolveTenantResult =
  | { ok: true; tenantId: string }
  /**
   * `malformed` → el valor ni siquiera tiene forma de UUID. El llamador
   * responde 400: es un pedido mal armado.
   * `unknown` → tiene forma válida pero no corresponde a ninguna company.
   * El llamador responde 404. Se separan a propósito: son bugs distintos
   * del lado del que llama, y mezclarlos esconde cuál de los dos pasó.
   */
  | { ok: false; reason: 'malformed' | 'unknown' };

/**
 * Convierte un `company_id` de origen no confiable en un tenant_id usable.
 * Devuelve `ok:false` en vez de lanzar: el llamador es un endpoint HTTP y
 * necesita elegir el status code, no atrapar una excepción.
 */
export async function resolveKnownTenantId(
  rawCompanyId: string
): Promise<ResolveTenantResult> {
  const candidato = rawCompanyId.trim();

  // Se chequea la FORMA antes de tocar la base: sin esto, cualquiera con
  // una firma válida puede hacer que el endpoint le mande basura a Postgres.
  if (!isValidUuid(candidato)) {
    return { ok: false, reason: 'malformed' };
  }

  const filas = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, candidato))
    .limit(1);

  const encontrada = filas[0];
  if (!encontrada) {
    return { ok: false, reason: 'unknown' };
  }

  return { ok: true, tenantId: encontrada.id };
}

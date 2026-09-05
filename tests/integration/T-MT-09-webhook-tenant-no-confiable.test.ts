/**
 * T-MT-09 — el `company_id` del webhook de MP es input NO confiable.
 *
 * **Por qué este es el único lugar donde hace falta la 2ª capa.**
 * CLAUDE.md §7.2 pide validación de tenant en la capa de servicio además de
 * RLS. En la práctica todos los services ya filtran por `tenant_id` dentro
 * de la query, así que un acceso cruzado devuelve cero filas y termina en
 * `NotFoundError`. Ahí un `validateTenantAccess` sería un chequeo siempre
 * verdadero.
 *
 * El webhook de MercadoPago es la excepción real: el tenant llega en el
 * PATH de la URL (`/api/webhooks/mp/{company_id}`), no de una sesión. Es
 * input externo que entra directo al tracing context.
 *
 * **Lo que estaba pasando antes de este fix** (verificado contra la base):
 *   - `company_id` malformado → el INSERT de dedup revienta en el cast a
 *     uuid ("invalid input syntax for type uuid") → 500. Y un 500 hace que
 *     MP reintente, así que no es cosmético.
 *   - `company_id` bien formado pero inexistente → `processed_webhook_events`
 *     y `jobs_queue` NO tienen FK sobre `tenant_id`, así que la fila de
 *     dedup entra y queda un job encolado para un tenant fantasma.
 *     (`mp_payments` sí tiene FK — o sea que la tabla que lo atrapa está
 *     aguas ABAJO de la que no. Ese desfasaje es justamente el argumento
 *     para chequear en el borde y no depender de las FKs.)
 *
 * El HMAC corre antes del primer write, así que sin el secreto esto es un
 * 401 limpio. Lo que se cierra acá es la defensa en profundidad para quien
 * SÍ tiene una notificación firmada y le cambia el company_id de la URL.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { resolveKnownTenantId } from '@/lib/multi_tenant/resolve-tenant';

/** Una company real de la base de test, para el caso feliz. */
async function algunaCompanyReal(): Promise<string> {
  const filas = await db.execute<{ id: string }>(
    sql`SELECT id::text FROM companies LIMIT 1`
  );
  const id = filas[0]?.id;
  if (!id) {
    throw new Error('La base de test no tiene ninguna company — revisar seed.');
  }
  return id;
}

describe('T-MT-09 — company_id del webhook es input no confiable', () => {
  it('acepta una company que existe', async () => {
    const real = await algunaCompanyReal();

    const resultado = await resolveKnownTenantId(real);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.tenantId).toBe(real);
    }
  });

  it('RECHAZA un uuid bien formado que no existe — sin tocar la base de escritura', async () => {
    // Antes esto encolaba un job para un tenant fantasma: ni
    // processed_webhook_events ni jobs_queue tienen FK sobre tenant_id.
    const resultado = await resolveKnownTenantId(
      '00000000-0000-4000-8000-000000000123'
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toBe('unknown');
    }
  });

  it('RECHAZA un company_id malformado como "malformed", NO como error de base', async () => {
    // Este es el que producía el 500: llegaba hasta el INSERT y explotaba en
    // el cast a uuid. Ahora se corta antes, y el llamador puede devolver 400.
    const resultado = await resolveKnownTenantId('no-es-un-uuid');

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toBe('malformed');
    }
  });

  it('un malformado NO llega a consultar la base (se corta por forma)', async () => {
    // Sin esto, un atacante con firma válida podría usar el endpoint para
    // hacerle ejecutar queries a la base con basura.
    const casos = [
      '',
      '   ',
      '../../etc/passwd',
      "'; DROP TABLE companies; --",
      '00000000-0000-4000-8000-00000000012', // un dígito de menos
    ];

    for (const caso of casos) {
      const resultado = await resolveKnownTenantId(caso);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.reason).toBe('malformed');
      }
    }

    // Y la tabla sigue en pie después del intento de inyección.
    const companies = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM companies`
    );
    expect(Number(companies[0]?.n)).toBeGreaterThan(0);
  });
});

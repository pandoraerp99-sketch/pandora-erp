/**
 * Cache de credenciales WSAA sobre la tabla `wsaa_tokens` — implementacion
 * real de `WsaaTokenCache`.
 *
 * POR QUE EN LA BASE Y NO EN MEMORIA: WSAA da UN token cada 12 horas y **no
 * deja pedir otro antes de que venza el anterior** — si se pide de nuevo,
 * responde el error "El CEE ya posee un TA valido". En Vercel cada invocacion
 * puede ser un proceso nuevo, asi que un cache en memoria pediria token en
 * cada arranque en frio y AFIP nos empezaria a rechazar. Tiene que ser
 * compartido, o sea la base.
 *
 * `token` y `sign` son SECRETOS (§10.5): no se loguean nunca, ni truncados.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { wsaa_tokens } from '../../db/schema/wsaa_tokens.js';
import type { AfipEnvironment } from '../../db/schema/_common.js';
import type { WsaaCredentials } from './wsaa-tra.js';

export function createWsaaTokenCache(): {
  get(tenantId: string, environment: AfipEnvironment): Promise<WsaaCredentials | null>;
  save(
    tenantId: string,
    environment: AfipEnvironment,
    creds: WsaaCredentials
  ): Promise<void>;
} {
  return {
    async get(tenantId, environment) {
      const [fila] = await db
        .select()
        .from(wsaa_tokens)
        .where(
          and(
            eq(wsaa_tokens.tenant_id, tenantId),
            eq(wsaa_tokens.environment, environment)
          )
        )
        .limit(1);

      if (!fila) return null;
      return {
        token: fila.token,
        sign: fila.sign,
        generatedAt: fila.generated_at,
        expiresAt: fila.expires_at,
      };
    },

    async save(tenantId, environment, creds) {
      // UPSERT sobre (tenant, environment): guardar el nuevo token sin pisar
      // el viejo dejaria dos filas y `get` devolveria cualquiera de las dos.
      const valores = {
        tenant_id: tenantId,
        environment,
        token: creds.token,
        sign: creds.sign,
        generated_at: creds.generatedAt,
        expires_at: creds.expiresAt,
      };
      await db
        .insert(wsaa_tokens)
        .values(valores)
        .onConflictDoUpdate({
          target: [wsaa_tokens.tenant_id, wsaa_tokens.environment],
          set: valores,
        });
    },
  };
}

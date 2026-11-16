/**
 * Quién puede ESCRIBIR en el comercio. Una sola regla, en un solo lugar.
 *
 * ── Por qué existe (H-01 de la auditoría del 2026-11-15) ─────────────────
 * ADR-0008 y CLAUDE.md §7.3 dicen que el contador es read-only. Hasta hoy eso
 * no lo hacía cumplir nada fuera de los adjuntos:
 *
 *   - La UI del contador no dibuja los botones de escribir, pero §6.4 dice
 *     con todas las letras que esconder un botón no es autorización, y
 *     `src/proxy.ts` no filtra ninguna ruta por rol: el contador entra a
 *     /pos, /caja y /gastos con su login.
 *   - El RLS tampoco: Drizzle se conecta como `postgres` con
 *     `rolbypassrls = true` (medido con scripts/ver-rol-de-la-conexion.sh), así
 *     que ninguna escritura del service layer pasa por una policy. Y aunque
 *     pasara, el RLS separa COMERCIOS, no roles adentro de uno.
 *
 * Se verificó corriendo: con rol `accountant`, `registerExpense` y
 * `createProduct` escribían. Esta guardia cierra eso en todas las mutaciones
 * del service layer (ver tests/integration/T-ROL-01).
 *
 * ── Dónde se lee el rol ───────────────────────────────────────────────────
 * De `company_users`, por (comercio, usuario): es la fuente de verdad. El
 * `app_role` del JWT se parece pero es una FOTO de cuando se firmó el token;
 * revocarle el acceso a alguien tiene que hacer efecto en la próxima
 * escritura, no cuando venza el token.
 *
 * `withServerActionTracing` lo lee UNA vez por request y lo deja en el
 * contexto de tracing (`actor_role`); así `exigirQueOpereElComercio()` no
 * cuesta una consulta por mutación. Si el contexto no lo trae (los tests
 * arman contextos a mano), se consulta.
 *
 * ── Lista blanca, no negra ────────────────────────────────────────────────
 * Preguntar "¿es contador?" deja pasar al usuario sin membresía (invitación
 * revocada, id inventado) y al rol que se agregue mañana. Preguntar al revés
 * los manda a los dos al lado seguro (§13.9, fail-closed).
 *
 * ── Quién NO pasa por acá ─────────────────────────────────────────────────
 * Los actores que no son personas: `system` (webhook de MercadoPago, que
 * entra por HMAC), `cron` y `worker`. Sus escrituras son del sistema, no de
 * un usuario, y tienen su propia puerta. `support` es persona y por §7.8 es
 * read-only: NO escribe.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { company_users } from '../db/schema/users.js';
import type { UserRole } from '../db/schema/_common.js';
import { DomainError } from '../multi_tenant/errors.js';
import { requireTracingContext } from '../tracing/context.js';

export const ROLES_QUE_OPERAN: readonly string[] = ['owner', 'admin', 'cashier'];

export class SoloLecturaError extends DomainError {
  constructor() {
    super(
      'SOLO_LECTURA',
      'Tu usuario puede ver la información del comercio, pero no modificarla',
      403
    );
  }
}

/**
 * El rol del usuario EN ESE comercio, o `null` si no es miembro.
 *
 * `company_users.role` es `text` con CHECK en la base, así que Drizzle lo tipa
 * como string. Se devuelve como está y la comparación decide; castear sería
 * decir "confiá en mí" sobre un valor que viene de la base.
 */
export async function leerRolEnElComercio(
  tenantId: string,
  userId: string
): Promise<string | null> {
  const [miembro] = await db
    .select({ role: company_users.role })
    .from(company_users)
    .where(and(eq(company_users.company_id, tenantId), eq(company_users.user_id, userId)))
    .limit(1);
  return miembro?.role ?? null;
}

export function rolOpera(rol: string | null | undefined): rol is UserRole {
  return rol != null && ROLES_QUE_OPERAN.includes(rol);
}

/**
 * Rechaza la mutación si quien la pide no opera el comercio.
 *
 * Va como PRIMERA línea de cada función exportada que escribe, antes de
 * validar el input y antes de cualquier efecto (subir un archivo, abrir una
 * transacción): rechazar después deja mitades hechas.
 */
export async function exigirQueOpereElComercio(): Promise<void> {
  const ctx = requireTracingContext();

  // No es una persona: webhook, cron, worker. Tienen su propia puerta.
  if (ctx.actor_type !== 'user' && ctx.actor_type !== 'support') return;

  // Soporte es persona y es read-only (§7.8). Sin excepciones acá: una
  // mutación de soporte con consentimiento es otra función, con su audit.
  if (ctx.actor_type === 'support') throw new SoloLecturaError();

  if (!ctx.tenant_id || !ctx.actor_user_id) throw new SoloLecturaError();

  const rol =
    ctx.actor_role !== undefined
      ? ctx.actor_role
      : await leerRolEnElComercio(ctx.tenant_id, ctx.actor_user_id);

  if (!rolOpera(rol)) throw new SoloLecturaError();
}

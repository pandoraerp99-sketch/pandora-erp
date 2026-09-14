/**
 * Invitación del contador a una empresa (ADR-0008).
 *
 * ── POR QUE ESTO ES EL DIFERENCIADOR, Y NO UNA PANTALLA MAS ───────────────
 * La contadora atiende N comercios. Hoy cada uno le manda un Excel distinto
 * por WhatsApp. Acá entra con UN usuario y ve los N que la invitaron. Es
 * gratis para ella: paga el comercio. Si le resulta cómodo, ella recomienda
 * Pandora a sus otros clientes — es el canal de venta.
 *
 * ── ENTRA EN MODO LECTURA ─────────────────────────────────────────────────
 * El rol `accountant` no puede facturar ni tocar la caja en nombre del
 * comercio. No es una restricción técnica: es la posición del producto. La Ley
 * 20.488 reserva la firma al profesional matriculado, y Pandora prepara
 * borradores para que ella revise — nunca al revés.
 *
 * ── COMO ENTRA LA PRIMERA VEZ ─────────────────────────────────────────────
 * Se usa `inviteUserByEmail` de Supabase, que crea el usuario en estado
 * "invitado" y le manda el mail para poner su contraseña. No se inventa una
 * contraseña temporal ni un flujo de tokens propio: reimplementar el alta de
 * usuarios es superficie de ataque nueva para resolver algo que la plataforma
 * ya hace.
 *
 * OJO en producción: sin SMTP configurado el mail NO sale. El alta igual queda
 * hecha, así que la acción devuelve si el mail se envió y la pantalla lo dice
 * — mejor eso que un "listo" que miente.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, company_users } from '../../db/schema/users.js';
import { companies } from '../../db/schema/companies.js';
import { createSupabaseServiceRoleClient } from '../../auth/supabase-server.js';
import { requireTracingContext } from '../../tracing/context.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';

export class AccountantInviteError extends DomainError {
  constructor(code: string, messageEs: string) {
    super(code, messageEs, 422);
  }
}

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'accountant.service (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ContadorVinculado {
  user_id: string;
  email: string;
  full_name: string | null;
  /** Cuántas empresas ve en total (incluida ésta). El número de la maqueta. */
  empresas: number;
  /** Si ya entró alguna vez. Mientras sea false, sigue siendo una invitación. */
  activo: boolean;
}

/**
 * Invita a un contador a ESTA empresa.
 *
 * Idempotente a propósito: si ya estaba invitado, no falla ni duplica. El
 * dueño que aprieta dos veces no tiene por qué ver un error, y un segundo
 * vínculo con la misma empresa no significaría nada.
 */
export async function inviteAccountant(input: {
  email: string;
  fullName?: string;
}): Promise<{ contador: ContadorVinculado; mailEnviado: boolean; yaEstaba: boolean }> {
  const tenantId = requireTenantId();
  const email = input.email.trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    throw new AccountantInviteError('invalid_email', 'Ese email no parece válido');
  }

  const supabase = await createSupabaseServiceRoleClient();

  // ¿Ya existe como usuario? Se busca ANTES de invitar: invitar a alguien que
  // ya tiene cuenta le mandaría un mail para "crear" una cuenta que ya tiene.
  const { data: existentes } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const yaRegistrado = existentes?.users.find(
    (u) => (u.email ?? '').toLowerCase() === email
  );

  let authUserId: string;
  let mailEnviado = false;
  let confirmado = false;

  if (yaRegistrado) {
    authUserId = yaRegistrado.id;
    confirmado = yaRegistrado.last_sign_in_at !== null;
  } else {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
    if (error || !data?.user) {
      // El error de Supabase puede citar detalles de infraestructura; se
      // traduce a algo que el dueño pueda accionar.
      logger.error({ email, error: error?.message }, 'accountant.invite_failed');
      throw new AccountantInviteError(
        'invite_failed',
        'No se pudo invitar a ese email. Revisá que esté bien escrito.'
      );
    }
    authUserId = data.user.id;
    mailEnviado = true;
  }

  const { contador, yaEstaba } = await linkAccountant({
    userId: authUserId,
    email,
    fullName: input.fullName ?? null,
    via: yaRegistrado ? 'usuario_existente' : 'invitacion',
  });

  return { contador: { ...contador, activo: confirmado }, mailEnviado, yaEstaba };
}

/**
 * La parte que toca la BASE: espeja el usuario y lo vincula a esta empresa
 * como contador.
 *
 * Está separada de `inviteAccountant` a propósito. Lo de Supabase Auth (buscar
 * o crear el usuario, mandar el mail) es pegamento fino; lo que puede salir
 * mal de verdad es el vínculo — que se duplique, que quede colgado, o que le
 * dé acceso a una empresa que no corresponde. Eso se testea contra la base
 * real, sin depender de que el servidor de auth esté levantado.
 */
export async function linkAccountant(input: {
  userId: string;
  email: string;
  fullName?: string | null;
  /** Cómo llegó: se le mandó el mail de alta, o ya tenía cuenta. Va al audit. */
  via?: 'invitacion' | 'usuario_existente';
}): Promise<{ contador: ContadorVinculado; yaEstaba: boolean }> {
  const tenantId = requireTenantId();
  const email = input.email.trim().toLowerCase();

  const yaVinculado = await db.transaction(async (tx) => {
    // Espejo en public.users: el hook del JWT y las FKs leen de acá, no de
    // auth.users.
    await tx
      .insert(users)
      .values({
        id: input.userId,
        email,
        full_name: input.fullName?.trim() || null,
        is_support: false,
      })
      .onConflictDoNothing();

    const [existente] = await tx
      .select({ id: company_users.id, role: company_users.role })
      .from(company_users)
      .where(
        and(
          eq(company_users.company_id, tenantId),
          eq(company_users.user_id, input.userId)
        )
      )
      .limit(1);

    // Si ya estaba con OTRO rol (es el dueño, por ejemplo), no se lo degrada a
    // contador: eso le sacaria permisos sin que nadie lo pida.
    if (existente && existente.role !== 'accountant') {
      throw new AccountantInviteError(
        'ya_es_de_la_empresa',
        'Ese usuario ya trabaja en este comercio con otro rol. No se lo puede invitar como contador.'
      );
    }

    if (!existente) {
      await tx.insert(company_users).values({
        company_id: tenantId,
        user_id: input.userId,
        role: 'accountant',
      });

      // EVENT-TAXONOMY v2.1.0 — warning: un TERCERO pasa a ver los datos
      // fiscales y comerciales del comercio (misma familia que CLAUDE.md §7.8
      // exige para soporte). Sólo cuando el vínculo se CREA: reinvitar a quien
      // ya estaba no cambia nada. Sólo ids: el email no se copia a un log de
      // 10 años.
      await writeAuditLog(
        {
          event_name: 'auth.accountant.granted',
          payload: {
            accountant_user_id: input.userId,
            via: input.via ?? 'usuario_existente',
          },
          pii_level: 'internal',
          severity: 'warning',
        },
        tx
      );
    }

    return existente;
  });

  logger.info(
    { tenant_id: tenantId, accountant_user_id: input.userId, ya_estaba: !!yaVinculado },
    'accountant.invited'
  );

  return {
    contador: {
      user_id: input.userId,
      email,
      full_name: input.fullName?.trim() || null,
      empresas: await contarEmpresasDe(input.userId),
      activo: false,
    },
    yaEstaba: !!yaVinculado,
  };
}

async function contarEmpresasDe(userId: string): Promise<number> {
  const filas = await db
    .select({ id: company_users.company_id })
    .from(company_users)
    .where(eq(company_users.user_id, userId));
  return filas.length;
}

/** Contadores vinculados a ESTA empresa. Para la sección Usuarios. */
export async function listAccountants(): Promise<ContadorVinculado[]> {
  const tenantId = requireTenantId();

  const filas = await db
    .select({
      user_id: users.id,
      email: users.email,
      full_name: users.full_name,
    })
    .from(company_users)
    .innerJoin(users, eq(users.id, company_users.user_id))
    .where(
      and(
        eq(company_users.company_id, tenantId),
        eq(company_users.role, 'accountant')
      )
    );

  return Promise.all(
    filas.map(async (f) => ({
      ...f,
      empresas: await contarEmpresasDe(f.user_id),
      // `activo` se resuelve en la capa de arriba si hace falta consultar auth;
      // acá alcanza con que exista el vínculo.
      activo: true,
    }))
  );
}

/**
 * Saca el acceso de un contador a ESTA empresa.
 *
 * Borra SOLO el vínculo con este comercio: la contadora sigue viendo las otras
 * empresas que la invitaron. Borrar su usuario seria sacarle el acceso a
 * comercios que no tienen nada que ver.
 */
export async function revokeAccountant(userId: string): Promise<void> {
  const tenantId = requireTenantId();
  const borrados = await db.transaction(async (tx) => {
    const filas = await tx
      .delete(company_users)
      .where(
        and(
          eq(company_users.company_id, tenantId),
          eq(company_users.user_id, userId),
          eq(company_users.role, 'accountant')
        )
      )
      .returning({ id: company_users.id });

    // EVENT-TAXONOMY v2.1.0. El vínculo se BORRA: sin este evento no quedaría
    // en ningún lado que alguna vez tuvo acceso, ni hasta cuándo. Sólo si
    // efectivamente se borró algo — revocar a quien no estaba no es un hecho.
    if (filas.length > 0) {
      await writeAuditLog(
        {
          event_name: 'auth.accountant.revoked',
          payload: { accountant_user_id: userId },
          pii_level: 'internal',
          severity: 'warning',
        },
        tx
      );
    }
    return filas.length;
  });
  logger.info(
    { tenant_id: tenantId, accountant_user_id: userId, revocado: borrados > 0 },
    'accountant.revoked'
  );
}

/** Nombre de las empresas que puede ver un contador. Para el selector. */
export async function listCompaniesForUser(
  userId: string
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: companies.id, name: companies.name })
    .from(company_users)
    .innerJoin(companies, eq(companies.id, company_users.company_id))
    .where(eq(company_users.user_id, userId))
    .orderBy(companies.name);
}

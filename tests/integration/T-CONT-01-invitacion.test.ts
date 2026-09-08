/**
 * T-CONT-01 — el contador multi-empresa (ADR-0008).
 *
 * Es el diferenciador del producto: una contadora, UN usuario, N comercios que
 * la invitaron. Y es la superficie donde una fuga cross-tenant sería más cara
 * — no se filtraría una venta, se filtraría la contabilidad entera de un
 * comercio a otro estudio.
 *
 * Todo el andamiaje multi-empresa (claims `company_ids[]` en el JWT, el hook
 * de Supabase, `pandora.current_company_ids()` en el RLS) estaba escrito desde
 * hace meses y NO tenía un solo consumidor. Estos tests son los primeros que
 * lo ejercen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  AccountantInviteError,
  linkAccountant,
  listAccountants,
  listCompaniesForUser,
  revokeAccountant,
} from '@/lib/services/identity/accountant.service';

describe('T-CONT-01 — contador multi-empresa', () => {
  let kiosco: string;
  let ferreteria: string;
  let ajena: string;
  let duenoKiosco: string;
  let contadora: string;

  const enEmpresa = <T,>(companyId: string, fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: companyId,
          actor_user_id: duenoKiosco,
          actor_type: 'user',
        },
        fn
      )
    );

  const crearEmpresa = async (id: string, nombre: string) => {
    await db.insert(companies).values({
      id,
      name: nombre,
      legal_name: `${nombre} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  beforeEach(async () => {
    kiosco = crypto.randomUUID();
    ferreteria = crypto.randomUUID();
    ajena = crypto.randomUUID();
    duenoKiosco = crypto.randomUUID();
    contadora = crypto.randomUUID();

    await crearEmpresa(kiosco, 'Kiosco El Faro');
    await crearEmpresa(ferreteria, 'Ferretería del Sur');
    await crearEmpresa(ajena, 'Almacén de otro estudio');

    await db.insert(users).values({
      id: duenoKiosco,
      email: `dueno-${duenoKiosco.slice(0, 8)}@test.local`,
      full_name: 'Dueño',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: kiosco,
      user_id: duenoKiosco,
      role: 'owner',
    });
  });

  afterEach(async () => {
    const ids = [kiosco, ferreteria, ajena];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(company_users).where(inArray(company_users.company_id, ids));
      await tx.delete(users).where(inArray(users.id, [duenoKiosco, contadora]));
      await tx.delete(companies).where(inArray(companies.id, ids));
    });
  });

  it('la contadora ve las empresas que la invitaron, y SOLO esas', async () => {
    // El corazón del producto: un login, varios comercios.
    await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    await enEmpresa(ferreteria, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );

    const suyas = await listCompaniesForUser(contadora);
    const nombres = suyas.map((e) => e.name).sort();
    expect(nombres).toEqual(['Ferretería del Sur', 'Kiosco El Faro']);
    // La tercera existe y NO aparece: nadie la invitó ahí.
    expect(suyas.some((e) => e.id === ajena)).toBe(false);
  });

  it('invitar dos veces no duplica el vínculo', async () => {
    // El dueño que aprieta el botón dos veces no tiene por qué ver un error, y
    // un segundo vínculo con la misma empresa no significaría nada.
    const a = await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    const b = await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );

    expect(a.yaEstaba).toBe(false);
    expect(b.yaEstaba).toBe(true);
    expect((await listCompaniesForUser(contadora)).length).toBe(1);
  });

  it('cuenta cuántas empresas ve — el número que muestra la pantalla', async () => {
    await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    const segunda = await enEmpresa(ferreteria, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    expect(segunda.contador.empresas).toBe(2);
  });

  it('NO degrada a alguien que ya trabaja en el comercio con otro rol', async () => {
    // Invitar al dueño como contador le sacaría sus permisos sin que nadie lo
    // pida. Falla explícito en vez de "arreglarlo" solo.
    await expect(
      enEmpresa(kiosco, () =>
        linkAccountant({ userId: duenoKiosco, email: 'dueno@test.local' })
      )
    ).rejects.toThrow(AccountantInviteError);
  });

  it('sacarle el acceso a UN comercio no le saca los otros', async () => {
    // Lo que se borra es el vínculo con este comercio, no su usuario: la
    // contadora sigue atendiendo a los demás.
    await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    await enEmpresa(ferreteria, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );

    await enEmpresa(kiosco, () => revokeAccountant(contadora));

    const suyas = await listCompaniesForUser(contadora);
    expect(suyas.map((e) => e.name)).toEqual(['Ferretería del Sur']);
    // Y su usuario sigue existiendo.
    const [u] = await db.select().from(users).where(eq(users.id, contadora));
    expect(u).toBeTruthy();
  });

  it('cada comercio ve SUS contadores, no los del vecino', async () => {
    const otraCra = crypto.randomUUID();
    await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    await enEmpresa(ajena, () =>
      linkAccountant({ userId: otraCra, email: 'otra@estudio.com' })
    );

    const delKiosco = await enEmpresa(kiosco, () => listAccountants());
    expect(delKiosco.map((c) => c.email)).toEqual(['cra@estudio.com']);

    await db.delete(company_users).where(eq(company_users.user_id, otraCra));
    await db.delete(users).where(eq(users.id, otraCra));
  });

  it('el rol que queda es accountant, que es el de solo lectura', async () => {
    await enEmpresa(kiosco, () =>
      linkAccountant({ userId: contadora, email: 'cra@estudio.com' })
    );
    const [vinculo] = await db
      .select({ role: company_users.role })
      .from(company_users)
      .where(eq(company_users.user_id, contadora));
    expect(vinculo?.role).toBe('accountant');
  });
});

/**
 * T-ADJ-01 — aislamiento y durabilidad de los adjuntos (ítem 12, migration 0040).
 *
 * **Lo que este test tiene que probar y casi ningún test de adjuntos prueba:**
 *
 *  1. Que el comercio de al lado **no pueda BAJAR EL ARCHIVO**. No que el
 *     service devuelva vacío: que la policy sobre `storage.objects` lo niegue.
 *     Son dos superficies distintas — con la tabla protegida y el bucket
 *     abierto, los bytes del vecino se bajan igual y ningún test de la tabla se
 *     entera. Por eso acá se consulta `storage.objects` directo, con el JWT del
 *     otro tenant, como lo haría el cliente.
 *
 *  2. Que el bucket sea **privado**. Uno público sirve los archivos por URL a
 *     cualquiera, sin login y sin RLS.
 *
 *  3. Que el adjunto **no se pueda borrar**. Mientras A-31 no se responda se
 *     asume que la copia digital ES el respaldo del gasto: un DELETE destruye
 *     ese respaldo y deja al gasto apuntando a nada. La baja es lógica, y un
 *     adjunto dado de baja no resucita.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { expenses } from '@/lib/db/schema/expenses';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

/**
 * El mensaje REAL de Postgres, que Drizzle envuelve en un "Failed query: ...".
 *
 * Sin esto, `rejects.toThrow(/no admite DELETE/)` falla aunque el trigger haya
 * funcionado perfecto — y peor: `rejects.toThrow()` a secas pasaría con
 * CUALQUIER error, incluido un typo en el SQL. La garantía que se prueba acá es
 * el texto del trigger, así que hay que llegar hasta él.
 */
async function motivoDelRechazo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '(no falló)';
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message ?? String(e);
  }
}

describe('T-ADJ-01 — adjuntos: aislamiento cross-tenant y baja lógica', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const expenseA = crypto.randomUUID();
  const expenseB = crypto.randomUUID();
  const adjuntoA = crypto.randomUUID();
  const pathA = `${tenantA}/${adjuntoA}`;

  beforeAll(async () => {
    const armar = async (tenantId: string, userId: string) => {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-ADJ-01 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-ADJ-01 Co SRL ${tenantId.slice(0, 8)}`,
        cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
        tax_regime: 'responsable_inscripto',
        merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
        merchant_special_regime: null,
        afip_environment: 'homologacion',
        afip_sale_point: '0001',
        demo_status: 'trial',
      });
      await db.insert(users).values({
        id: userId,
        email: `t-adj-${tenantId.slice(0, 8)}@test.local`,
        full_name: 'Dueño T-ADJ-01',
        is_support: false,
      });
      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: userId,
        role: 'owner',
      });
    };
    await armar(tenantA, userA);
    await armar(tenantB, userB);

    await db.insert(expenses).values([
      {
        id: expenseA,
        tenant_id: tenantA,
        fecha: '2026-03-01',
        categoria: 'alquiler',
        total: '400000.0000',
        medio_pago: 'transferencia',
      },
      {
        id: expenseB,
        tenant_id: tenantB,
        fecha: '2026-03-01',
        categoria: 'alquiler',
        total: '400000.0000',
        medio_pago: 'transferencia',
      },
    ]);

    // El adjunto de A, con su objeto en el bucket. El INSERT va como service
    // role (sin RLS) a propósito: acá se arma el escenario, no se prueba.
    await db.execute(sql`
      INSERT INTO attachments (id, tenant_id, tipo, expense_id, nombre_original,
                               content_type, bytes, sha256, storage_path, uploaded_by)
      VALUES (${adjuntoA}, ${tenantA}, 'comprobante', ${expenseA},
              'alquiler-marzo.pdf', 'application/pdf', 12345,
              'abc123', ${pathA}, ${userA})
    `);
    await db.execute(sql`
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('comprobantes', ${pathA}, ${userA})
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    // Tres tablas de acá se defienden de los borrados —`attachments` (el punto
    // de este test), `expenses` y el `protect_delete` de Supabase sobre
    // `storage.objects`—, así que el cleanup usa el mismo patrón que el resto
    // de la suite: `session_replication_role='replica'` apaga los triggers de
    // usuario sólo dentro de esta transacción, sin pedir ser dueño de nada.
    //
    // Que limpiar sea incómodo es la señal de que las garantías existen.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(
        sql`DELETE FROM storage.objects WHERE bucket_id = 'comprobantes' AND name = ${pathA}`
      );
      await tx.execute(sql`DELETE FROM attachments WHERE tenant_id IN (${tenantA}, ${tenantB})`);
      await tx.delete(expenses).where(sql`${expenses.tenant_id} IN (${tenantA}, ${tenantB})`);
      await tx
        .delete(company_users)
        .where(sql`${company_users.company_id} IN (${tenantA}, ${tenantB})`);
      await tx.delete(users).where(sql`${users.id} IN (${userA}, ${userB})`);
      await tx.delete(companies).where(sql`${companies.id} IN (${tenantA}, ${tenantB})`);
    });
  });

  describe('el bucket', () => {
    it('es PRIVADO — si fuera público se sirve por URL sin login ni RLS', async () => {
      const filas = await db.execute<{ public: boolean; limite: string }>(sql`
        SELECT public, file_size_limit::text AS limite
          FROM storage.buckets WHERE id = 'comprobantes'
      `);
      expect(filas[0]?.public).toBe(false);
      expect(Number(filas[0]?.limite)).toBeGreaterThan(0);
    });
  });

  describe('cross-tenant', () => {
    it('A ve su adjunto', async () => {
      const filas = await withRlsContext({ sub: userA, company_id: tenantA }, (tx) =>
        tx.execute<{ id: string }>(sql`SELECT id::text FROM attachments WHERE id = ${adjuntoA}`)
      );
      expect(filas).toHaveLength(1);
    });

    it('B NO ve la fila del adjunto de A', async () => {
      const filas = await withRlsContext({ sub: userB, company_id: tenantB }, (tx) =>
        tx.execute<{ id: string }>(sql`SELECT id::text FROM attachments WHERE id = ${adjuntoA}`)
      );
      expect(filas).toHaveLength(0);
    });

    it('🔴 B NO puede BAJAR EL ARCHIVO de A (policy sobre storage.objects)', async () => {
      // Éste es el test que importa. Aunque B adivine el path exacto —acá se lo
      // damos literal— el bucket tiene que negarlo. Un service que filtra bien
      // y un bucket abierto dan exactamente este test en verde por la razón
      // equivocada, por eso se consulta storage.objects directo.
      const filas = await withRlsContext({ sub: userB, company_id: tenantB }, (tx) =>
        tx.execute<{ name: string }>(sql`
          SELECT name FROM storage.objects
           WHERE bucket_id = 'comprobantes' AND name = ${pathA}
        `)
      );
      expect(filas).toHaveLength(0);
    });

    it('A sí puede bajar el suyo — la policy no bloquea a todos por igual', async () => {
      // Sin esta mitad, una policy que niegue SIEMPRE pasaría el test de arriba.
      const filas = await withRlsContext({ sub: userA, company_id: tenantA }, (tx) =>
        tx.execute<{ name: string }>(sql`
          SELECT name FROM storage.objects
           WHERE bucket_id = 'comprobantes' AND name = ${pathA}
        `)
      );
      expect(filas).toHaveLength(1);
    });

    it('B NO puede SUBIR un archivo dentro de la carpeta de A', async () => {
      await expect(
        withRlsContext({ sub: userB, company_id: tenantB }, (tx) =>
          tx.execute(sql`
            INSERT INTO storage.objects (bucket_id, name, owner)
            VALUES ('comprobantes', ${`${tenantA}/${crypto.randomUUID()}`}, ${userB})
          `)
        )
      ).rejects.toThrow();
    });

    it('🔴 un adjunto NO puede apuntar al gasto de OTRO comercio', async () => {
      // El agujero que los otros tests no ven: todos prueban LECTURAS cruzadas.
      // Esto es una ESCRITURA que localmente parece válida — la fila lleva
      // tenant_id = A, así que pasa el WITH CHECK del RLS sin despeinarse — y
      // sin embargo su `expense_id` es de B. El resultado sería el comprobante
      // de un comercio colgando del gasto de otro, sin que nada avise.
      //
      // Las FK apuntaban a `expenses(id)` a secas, sin el tenant, así que el
      // único que podía impedirlo era el código que arma el INSERT. Eso es
      // justo lo que CLAUDE.md §7.2 dice que no alcanza.
      //
      // Va como service role (sin RLS) a propósito: se prueba la BASE, no el
      // service. Si esto pasa, un bug de un service futuro lo reproduce.
      const motivo = await motivoDelRechazo(() =>
        db.execute(sql`
          INSERT INTO attachments (tenant_id, tipo, expense_id, nombre_original,
                                   content_type, bytes, sha256, storage_path, uploaded_by)
          VALUES (${tenantA}, 'comprobante', ${expenseB}, 'ajeno.pdf',
                  'application/pdf', 10, 'h', ${`${tenantA}/${crypto.randomUUID()}`}, ${userA})
        `)
      );
      expect(motivo).toMatch(/foreign key|llave foránea|violates/i);
    });

    it('la contadora multi-empresa SÍ ve los de las empresas que la invitaron', async () => {
      // El aislamiento no puede lograrse rompiendo el caso de uso: el contador
      // entra con un array de company_ids (ADR-0008).
      const filas = await withRlsContext(
        { sub: userB, company_ids: [tenantB, tenantA] },
        (tx) =>
          tx.execute<{ name: string }>(sql`
            SELECT name FROM storage.objects
             WHERE bucket_id = 'comprobantes' AND name = ${pathA}
          `)
      );
      expect(filas).toHaveLength(1);
    });
  });

  describe('la baja es lógica', () => {
    it('DELETE está prohibido: borrarlo destruye el respaldo del gasto', async () => {
      const motivo = await motivoDelRechazo(() =>
        db.execute(sql`DELETE FROM attachments WHERE id = ${adjuntoA}`)
      );
      expect(motivo).toMatch(/no admite DELETE/i);
    });

    it('no se puede repuntar a otro gasto ni cambiarle el hash', async () => {
      const motivo = await motivoDelRechazo(() =>
        db.execute(sql`UPDATE attachments SET sha256 = 'otro' WHERE id = ${adjuntoA}`)
      );
      expect(motivo).toMatch(/inmutable/i);
    });

    it('la baja lógica sí funciona, y deja quién y cuándo', async () => {
      await db.execute(sql`
        UPDATE attachments
           SET removed_at = now(), removed_by = ${userA}, removed_reason = 'subí el que no era'
         WHERE id = ${adjuntoA}
      `);
      const filas = await db.execute<{ removed_by: string; removed_reason: string }>(sql`
        SELECT removed_by::text, removed_reason FROM attachments WHERE id = ${adjuntoA}
      `);
      expect(filas[0]?.removed_by).toBe(userA);
      expect(filas[0]?.removed_reason).toBe('subí el que no era');
    });

    it('un adjunto dado de baja NO resucita', async () => {
      const motivo = await motivoDelRechazo(() =>
        db.execute(sql`UPDATE attachments SET removed_at = NULL WHERE id = ${adjuntoA}`)
      );
      expect(motivo).toMatch(/no se puede reactivar/i);
    });
  });
});

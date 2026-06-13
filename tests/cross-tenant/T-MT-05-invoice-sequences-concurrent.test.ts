/**
 * T-MT-05 — Numeración fiscal concurrente entre tenants sin colisión.
 * CLAUDE.md §7.9 mandatory test multi-tenant + ADR-0006 (SELECT FOR UPDATE
 * pesimista) + ADR-0002 (RLS isolation).
 *
 * **Foco del test: CROSS-TENANT NO BLOQUEA**. Dos comerciantes emitiendo
 * factura simultánea (cada uno en SU `invoice_sequences` row) deben poder
 * tomar `SELECT FOR UPDATE` en paralelo SIN bloquearse entre sí. El lock
 * es por-row, y como las rows son distintas (tenant_id distinto), no hay
 * contención.
 *
 * Esto es distinto del test intra-tenant T-CONC-01 (CLAUDE.md §8.5) que
 * verifica concurrencia DENTRO del mismo tenant — ese vive en Sprint 6
 * fiscal cuando el numbering service se implemente.
 *
 * Mecánica del test:
 *   1. Setup privileged: 2 tenants + 1 invoice_sequence cada uno
 *      (sale_point=1, invoice_type='B', next_number=1).
 *   2. 2 transactions en paralelo coordinadas con Deferreds:
 *      - Tx1 (tenantA): SELECT FOR UPDATE → señaliza → espera tx2 → UPDATE
 *      - Tx2 (tenantB): espera tx1 → SELECT FOR UPDATE → señaliza → UPDATE
 *      Si los locks se bloquearan mutuamente (no debería: rows distintas),
 *      tx2 nunca completaría su SELECT FOR UPDATE y el test colgaría hasta
 *      timeout. Que ambas completen rápido demuestra independencia.
 *   3. Verificar: cada una leyó next_number=1, post-COMMIT cada sequence
 *      quedó con next_number=2.
 *
 * Cobertura:
 *   T5.1: SELECT FOR UPDATE cross-tenant no se bloquean (paralelas completan)
 *   T5.2: incrementos independientes (cada sequence avanza solo en SU tenant)
 *   T5.3: RLS oculta sequence ajena (SELECT FOR UPDATE de B desde A → 0 rows)
 *   T5.4: cross-check privileged confirma ambas sequences existen
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { invoice_sequences } from '@/lib/db/schema/invoice_sequences';
import { withRlsContext } from '@/lib/multi_tenant/rls_context';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('T-MT-05 — numeración fiscal cross-tenant concurrente sin colisión', () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  let seqIdA: string | undefined;
  let seqIdB: string | undefined;

  beforeAll(async () => {
    for (const [tenantId, userId] of [
      [tenantA, userA],
      [tenantB, userB],
    ] as const) {
      await db.insert(companies).values({
        id: tenantId,
        name: `T-MT-05 Co ${tenantId.slice(0, 8)}`,
        legal_name: `T-MT-05 Co SRL ${tenantId.slice(0, 8)}`,
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
        email: `t-mt-05-${userId.slice(0, 8)}@test.local`,
        full_name: `User T-MT-05 ${userId.slice(0, 4)}`,
        is_support: false,
      });

      await db.insert(company_users).values({
        id: crypto.randomUUID(),
        company_id: tenantId,
        user_id: userId,
        role: 'cashier',
      });
    }

    seqIdA = crypto.randomUUID();
    seqIdB = crypto.randomUUID();
    await db.insert(invoice_sequences).values({
      id: seqIdA,
      tenant_id: tenantA,
      sale_point: 1,
      invoice_type: 'B',
      next_number: 1,
    });
    await db.insert(invoice_sequences).values({
      id: seqIdB,
      tenant_id: tenantB,
      sale_point: 1,
      invoice_type: 'B',
      next_number: 1,
    });
  });

  afterAll(async () => {
    await db
      .delete(invoice_sequences)
      .where(inArray(invoice_sequences.tenant_id, [tenantA, tenantB]));
    await db
      .delete(company_users)
      .where(inArray(company_users.company_id, [tenantA, tenantB]));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await db.delete(companies).where(inArray(companies.id, [tenantA, tenantB]));
  });

  it(
    'T5.1+T5.2: SELECT FOR UPDATE cross-tenant paralelas no se bloquean + incrementos independientes',
    async () => {
      // Deferreds para coordinar el overlap: tx2 espera que tx1 tenga su lock,
      // tx1 espera que tx2 tenga el suyo. Si los locks se bloquearan, este
      // test nunca completaría (hasta timeout vitest 5s).
      const sigALocked = deferred<void>();
      const sigBLocked = deferred<void>();

      // Tx1 — tenant A
      const txA = withRlsContext(
        { sub: userA, company_id: tenantA },
        async (tx) => {
          const rows = await tx.execute<{ id: string; next_number: number }>(sql`
            SELECT id, next_number FROM invoice_sequences
            WHERE tenant_id = ${tenantA}
              AND sale_point = 1
              AND invoice_type = 'B'
            FOR UPDATE
          `);
          // Ya tengo lock sobre row de A — señalizo a tx2
          sigALocked.resolve();
          // Espero confirmación de que tx2 también tomó SU lock (sobre row B)
          await sigBLocked.promise;
          // Ambos locks coexisten → no hay bloqueo cross-tenant. UPDATE adelante.
          await tx.execute(sql`
            UPDATE invoice_sequences
            SET next_number = next_number + 1
            WHERE id = ${rows[0]!.id}
          `);
          return rows[0]!.next_number;
        }
      );

      // Tx2 — tenant B
      const txB = withRlsContext(
        { sub: userB, company_id: tenantB },
        async (tx) => {
          // Espero que tx1 ya tenga lock sobre row A
          await sigALocked.promise;
          const rows = await tx.execute<{ id: string; next_number: number }>(sql`
            SELECT id, next_number FROM invoice_sequences
            WHERE tenant_id = ${tenantB}
              AND sale_point = 1
              AND invoice_type = 'B'
            FOR UPDATE
          `);
          // Si llegué hasta acá SIN bloqueo ⇒ el lock de A NO bloqueó row B ✓
          sigBLocked.resolve();
          await tx.execute(sql`
            UPDATE invoice_sequences
            SET next_number = next_number + 1
            WHERE id = ${rows[0]!.id}
          `);
          return rows[0]!.next_number;
        }
      );

      const [numA, numB] = await Promise.all([txA, txB]);
      // T5.1: ambas completaron + obtuvieron next_number=1
      expect(numA).toBe(1);
      expect(numB).toBe(1);

      // T5.2: post-COMMIT, cada sequence quedó en next_number=2
      // (incremento por-tenant independiente, sin colisión)
      const finalA = await db
        .select({ next_number: invoice_sequences.next_number })
        .from(invoice_sequences)
        .where(eq(invoice_sequences.id, seqIdA!));
      const finalB = await db
        .select({ next_number: invoice_sequences.next_number })
        .from(invoice_sequences)
        .where(eq(invoice_sequences.id, seqIdB!));

      expect(finalA[0]?.next_number).toBe(2);
      expect(finalB[0]?.next_number).toBe(2);
    },
    10_000 // timeout 10s — si los locks se bloquearan cross-tenant, sale por acá
  );

  it('T5.3: RLS oculta invoice_sequence ajena (SELECT FOR UPDATE de B desde A → 0 rows)', async () => {
    await withRlsContext({ sub: userA, company_id: tenantA }, async (tx) => {
      // Intento explícito de tomar lock sobre la row del tenant B desde context A
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT id FROM invoice_sequences
        WHERE id = ${seqIdB!}
        FOR UPDATE
      `);
      // RLS filtra el row del USING — SELECT FOR UPDATE no matchea nada.
      // No error: la "fuga silente" es exactamente la propiedad que RLS protege.
      expect(rows).toHaveLength(0);
    });
  });

  it('T5.4: cross-check privileged confirma ambas sequences existen post-test', async () => {
    const rows = await db
      .select({ tenant_id: invoice_sequences.tenant_id, next: invoice_sequences.next_number })
      .from(invoice_sequences)
      .where(inArray(invoice_sequences.tenant_id, [tenantA, tenantB]));

    expect(rows).toHaveLength(2);
    // Ambas avanzaron a 2 tras T5.1+T5.2
    const byTenant = Object.fromEntries(rows.map((r) => [r.tenant_id, r.next]));
    expect(byTenant[tenantA]).toBe(2);
    expect(byTenant[tenantB]).toBe(2);
  });
});

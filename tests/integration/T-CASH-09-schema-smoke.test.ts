/**
 * T-CASH-09 — Schema verification smoke test (cash_sessions + cash_movements).
 * Sprint 4 ROADMAP Cash context (C-OPS-01) — confirma empíricamente que la
 * migration 0007 dejó el schema EXACTO esperado.
 *
 * **Por qué importa:**
 * La migration 0007 fue reescrita post-advisor con `CREATE TABLE` hand-written
 * (drizzle-kit roto por BigInt bug — 6ta vez consecutiva). El advisor también
 * pidió agregar el trigger condicional `cash_sessions_immutable_after_close`
 * que originalmente faltaba.
 *
 * Sin este smoke test, futuras migrations podrían silenciosamente romper:
 *   - alguna CHECK constraint (defensa quebrada — T-CASH-04/07 lo notarían
 *     después en el fallo, pero T-CASH-09 lo notaría temprano)
 *   - el UNIQUE partial podría perder la cláusula `WHERE closed_at IS NULL`
 *     (sería bug catastrófico: 2 sessions abiertas mismo tenant+sp posible)
 *   - los triggers podrían no estar instalados (regresión silenciosa)
 *
 * Es el equivalente al "schema snapshot" pero sin necesidad de SnapshotDB tool:
 * verificamos las propiedades estructurales clave consultando `pg_catalog`.
 *
 * **NO seed needed:** este test no inserta data — solo consulta meta-schema.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

describe('T-CASH-09 — Schema verification smoke', () => {
  describe('cash_sessions', () => {
    it('tabla existe + 14 columnas con tipos esperados', async () => {
      const rows = (await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_sessions'
        ORDER BY ordinal_position
      `)) as unknown as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>;

      expect(rows).toHaveLength(14);

      const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      // PK + tenant + sale_point + opened_by + opened_at + initial_amount +
      // closed_by + closed_at + final_amount + expected_amount + descuadre +
      // discrepancy_reason + created_at + updated_at = 14
      expect(cols['id']?.data_type).toBe('uuid');
      expect(cols['tenant_id']?.data_type).toBe('uuid');
      expect(cols['tenant_id']?.is_nullable).toBe('NO');
      expect(cols['sale_point']?.data_type).toBe('integer');
      expect(cols['sale_point']?.is_nullable).toBe('NO');
      expect(cols['opened_by']?.data_type).toBe('uuid');
      expect(cols['opened_by']?.is_nullable).toBe('NO');
      expect(cols['opened_at']?.data_type).toBe('timestamp with time zone');
      expect(cols['opened_at']?.is_nullable).toBe('NO');
      expect(cols['initial_amount']?.data_type).toBe('numeric');
      expect(cols['initial_amount']?.is_nullable).toBe('NO');
      // Campos del cierre — todos nullables (closed_consistency CHECK los acopla)
      expect(cols['closed_by']?.is_nullable).toBe('YES');
      expect(cols['closed_at']?.is_nullable).toBe('YES');
      expect(cols['final_amount']?.is_nullable).toBe('YES');
      expect(cols['expected_amount']?.is_nullable).toBe('YES');
      expect(cols['descuadre']?.is_nullable).toBe('YES');
      expect(cols['discrepancy_reason']?.is_nullable).toBe('YES');
      expect(cols['discrepancy_reason']?.data_type).toBe('text');
      expect(cols['created_at']?.is_nullable).toBe('NO');
      expect(cols['updated_at']?.is_nullable).toBe('NO');
    });

    it('6 CHECK constraints con nombres esperados', async () => {
      const rows = (await db.execute(sql`
        SELECT conname
        FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid = 'public.cash_sessions'::regclass
        ORDER BY conname
      `)) as unknown as Array<{ conname: string }>;

      const names = rows.map((r) => r.conname);
      expect(names).toContain('cash_sessions_sale_point_positive');
      expect(names).toContain('cash_sessions_initial_amount_non_negative');
      expect(names).toContain('cash_sessions_final_amount_non_negative');
      expect(names).toContain('cash_sessions_expected_amount_non_negative');
      expect(names).toContain('cash_sessions_closed_consistency');
      expect(names).toContain('cash_sessions_discrepancy_reason_required');
      expect(names).toHaveLength(6);
    });

    it('UNIQUE partial index existe con cláusula WHERE closed_at IS NULL exacta', async () => {
      const rows = (await db.execute(sql`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cash_sessions'
        ORDER BY indexname
      `)) as unknown as Array<{ indexname: string; indexdef: string }>;

      const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

      // PK + 1 UNIQUE partial + 2 secundarios = 4
      expect(rows).toHaveLength(4);

      expect(byName['cash_sessions_pkey']).toMatch(/USING btree \(id\)/);

      // El UNIQUE partial es el corazón de la garantía del schema.
      const uniquePartial = byName['cash_sessions_open_unique_partial'];
      expect(uniquePartial).toBeDefined();
      expect(uniquePartial).toMatch(/UNIQUE/);
      expect(uniquePartial).toMatch(/\(tenant_id, sale_point\)/);
      expect(uniquePartial).toMatch(/WHERE \(closed_at IS NULL\)/);

      // Secundarios para queries de listado / búsqueda activa.
      expect(byName['cash_sessions_tenant_opened_idx']).toMatch(
        /\(tenant_id, opened_at\)/
      );
      expect(byName['cash_sessions_tenant_sale_point_idx']).toMatch(
        /\(tenant_id, sale_point, closed_at\)/
      );
    });

    it('triggers immutability instalados con WHEN condicional (UPDATE + DELETE)', async () => {
      const rows = (await db.execute(sql`
        SELECT tgname, pg_get_triggerdef(oid) AS definition
        FROM pg_trigger
        WHERE tgrelid = 'public.cash_sessions'::regclass
          AND NOT tgisinternal
        ORDER BY tgname
      `)) as unknown as Array<{ tgname: string; definition: string }>;

      const byName = Object.fromEntries(rows.map((r) => [r.tgname, r.definition]));
      expect(byName['cash_sessions_no_update_after_close']).toBeDefined();
      expect(byName['cash_sessions_no_delete_after_close']).toBeDefined();

      // El WHEN condicional es esencial: sin él, los triggers bloquearían
      // todos los UPDATE/DELETE, incluido el cierre legítimo. La presencia
      // de "OLD.closed_at IS NOT NULL" en la def confirma la lógica correcta.
      expect(byName['cash_sessions_no_update_after_close']).toMatch(
        /BEFORE UPDATE/
      );
      expect(byName['cash_sessions_no_update_after_close']).toMatch(
        /WHEN \(\(?old.closed_at IS NOT NULL\)?\)/i
      );
      expect(byName['cash_sessions_no_delete_after_close']).toMatch(
        /BEFORE DELETE/
      );
      expect(byName['cash_sessions_no_delete_after_close']).toMatch(
        /WHEN \(\(?old.closed_at IS NOT NULL\)?\)/i
      );
    });

    it('3 foreign keys (tenant_id, opened_by, closed_by) → companies/users con ON DELETE RESTRICT', async () => {
      const rows = (await db.execute(sql`
        SELECT
          conname,
          confdeltype,
          pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.cash_sessions'::regclass AND contype = 'f'
        ORDER BY conname
      `)) as unknown as Array<{
        conname: string;
        confdeltype: string;
        definition: string;
      }>;

      expect(rows).toHaveLength(3);
      const byName = Object.fromEntries(rows.map((r) => [r.conname, r]));
      expect(byName['cash_sessions_tenant_id_fkey']?.definition).toMatch(
        /REFERENCES companies\(id\)/
      );
      expect(byName['cash_sessions_opened_by_fkey']?.definition).toMatch(
        /REFERENCES users\(id\)/
      );
      expect(byName['cash_sessions_closed_by_fkey']?.definition).toMatch(
        /REFERENCES users\(id\)/
      );
      // confdeltype 'r' = RESTRICT (default para todas las FKs cash).
      for (const r of rows) expect(r.confdeltype).toBe('r');
    });
  });

  describe('cash_movements', () => {
    it('tabla existe + 8 columnas con tipos esperados', async () => {
      const rows = (await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_movements'
        ORDER BY ordinal_position
      `)) as unknown as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>;

      expect(rows).toHaveLength(8);
      const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      expect(cols['id']?.data_type).toBe('bigint');
      expect(cols['cash_session_id']?.data_type).toBe('uuid');
      expect(cols['cash_session_id']?.is_nullable).toBe('NO');
      expect(cols['type']?.data_type).toBe('text');
      expect(cols['type']?.is_nullable).toBe('NO');
      expect(cols['amount']?.data_type).toBe('numeric');
      expect(cols['amount']?.is_nullable).toBe('NO');
      expect(cols['reason']?.data_type).toBe('text');
      expect(cols['reason']?.is_nullable).toBe('NO');
      expect(cols['created_by']?.data_type).toBe('uuid');
      expect(cols['created_by']?.is_nullable).toBe('NO');
      expect(cols['correlation_id']?.data_type).toBe('uuid');
      expect(cols['correlation_id']?.is_nullable).toBe('YES');
      expect(cols['created_at']?.is_nullable).toBe('NO');
    });

    it('3 CHECK constraints con nombres esperados', async () => {
      const rows = (await db.execute(sql`
        SELECT conname
        FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid = 'public.cash_movements'::regclass
        ORDER BY conname
      `)) as unknown as Array<{ conname: string }>;

      const names = rows.map((r) => r.conname);
      expect(names).toContain('cash_movements_type_check');
      expect(names).toContain('cash_movements_amount_positive');
      expect(names).toContain('cash_movements_reason_not_empty');
      expect(names).toHaveLength(3);
    });

    it('3 indexes (PK + session + correlation_id partial)', async () => {
      const rows = (await db.execute(sql`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cash_movements'
        ORDER BY indexname
      `)) as unknown as Array<{ indexname: string; indexdef: string }>;

      expect(rows).toHaveLength(3);
      const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(byName['cash_movements_pkey']).toMatch(/USING btree \(id\)/);
      expect(byName['cash_movements_session_idx']).toMatch(
        /\(cash_session_id, created_at\)/
      );
      // El correlation_id index es partial — confirma que solo indexa rows
      // con correlation_id NOT NULL (espacio + perf).
      expect(byName['cash_movements_correlation_idx']).toMatch(
        /WHERE \(correlation_id IS NOT NULL\)/
      );
    });

    it('3 triggers immutability (UPDATE + DELETE + TRUNCATE) sin WHEN clause (incondicional)', async () => {
      const rows = (await db.execute(sql`
        SELECT tgname, pg_get_triggerdef(oid) AS definition
        FROM pg_trigger
        WHERE tgrelid = 'public.cash_movements'::regclass
          AND NOT tgisinternal
        ORDER BY tgname
      `)) as unknown as Array<{ tgname: string; definition: string }>;

      const byName = Object.fromEntries(rows.map((r) => [r.tgname, r.definition]));
      expect(byName['cash_movements_no_update']).toBeDefined();
      expect(byName['cash_movements_no_delete']).toBeDefined();
      expect(byName['cash_movements_no_truncate']).toBeDefined();
      expect(byName['cash_movements_no_update']).toMatch(/BEFORE UPDATE/);
      expect(byName['cash_movements_no_delete']).toMatch(/BEFORE DELETE/);
      expect(byName['cash_movements_no_truncate']).toMatch(/BEFORE TRUNCATE/);

      // Ninguno tiene WHEN — son incondicionales (cash_movements ALWAYS append-only).
      for (const def of Object.values(byName)) {
        expect(def).not.toMatch(/WHEN \(/);
      }
    });

    it('2 foreign keys (cash_session_id, created_by) → cash_sessions/users con ON DELETE RESTRICT', async () => {
      const rows = (await db.execute(sql`
        SELECT
          conname,
          confdeltype,
          pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.cash_movements'::regclass AND contype = 'f'
        ORDER BY conname
      `)) as unknown as Array<{
        conname: string;
        confdeltype: string;
        definition: string;
      }>;

      expect(rows).toHaveLength(2);
      const byName = Object.fromEntries(rows.map((r) => [r.conname, r]));
      expect(byName['cash_movements_cash_session_id_fkey']?.definition).toMatch(
        /REFERENCES cash_sessions\(id\)/
      );
      expect(byName['cash_movements_created_by_fkey']?.definition).toMatch(
        /REFERENCES users\(id\)/
      );
      for (const r of rows) expect(r.confdeltype).toBe('r');
    });
  });
});

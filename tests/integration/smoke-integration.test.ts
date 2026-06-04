/**
 * Smoke test integration — verifica conexión + migrations aplicadas.
 * Spike A1 #5 — validación que Supabase Local CLI + Drizzle + Vitest integration
 * config están bien atados.
 *
 * **Si esto NO pasa:** algo del stack está mal (supabase down, migrations
 * no aplicadas, DATABASE_URL mal, etc). Investigar ANTES de portar T-INV-*.
 *
 * **Si pasa:** spike A1 funcional. Próximo: T-INV-04..08.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

describe('Smoke integration — Supabase Local CLI conectividad', () => {
  it('conecta a Postgres y devuelve version', async () => {
    const result = await db.execute<{ version: string }>(sql`SELECT version()`);
    const versionRow = result[0];
    expect(versionRow).toBeDefined();
    expect(versionRow?.version).toMatch(/PostgreSQL/);
  });

  it('pg_trgm extension instalada (migration 0006 aplicó)', async () => {
    const rows = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.extname).toBe('pg_trgm');
  });

  it('tabla audit_log existe (migration 0000 + post_initial/0001 partition aplicó)', async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'audit_log'`
    );
    expect(rows.length).toBe(1);
  });

  it('tabla stock_movements existe + trigger immutable activo', async () => {
    const tableRows = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'stock_movements'`
    );
    expect(tableRows.length).toBe(1);

    // Usar pg_trigger (catalog Postgres) en vez de information_schema.triggers
    // — el último NO lista triggers TRUNCATE (SQL standard solo cubre DML
    // INSERT/UPDATE/DELETE). Necesitamos verificar los 3 (no_update + no_delete +
    // no_truncate) por CLAUDE.md §16.5 append-only enforcement.
    const triggerRows = await db.execute<{ tgname: string }>(
      sql`SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'stock_movements'::regclass
            AND NOT tgisinternal
            AND tgname LIKE 'stock_movements_%'`
    );
    expect(triggerRows.length).toBe(3);
    const names = triggerRows.map((r) => r.tgname).sort();
    expect(names).toEqual([
      'stock_movements_no_delete',
      'stock_movements_no_truncate',
      'stock_movements_no_update',
    ]);
  });

  it('GIN trigram index existe en products.name (migration 0006 aplicó)', async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes
          WHERE tablename = 'products' AND indexname = 'idx_products_name_trgm'`
    );
    expect(rows.length).toBe(1);
  });
});

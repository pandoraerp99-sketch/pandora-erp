import { describe, expect, it } from 'vitest';
import { assertFiscalDbConnectionMode } from '@/lib/fiscal/fiscal-db-guard';
import { FiscalIntegrityError } from '@/lib/multi_tenant/errors';

describe('assertFiscalDbConnectionMode (guard HIGH-2)', () => {
  it('RECHAZA el pooler transaccional de Supabase (puerto 6543)', () => {
    expect(() =>
      assertFiscalDbConnectionMode('postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres')
    ).toThrow(FiscalIntegrityError);
  });

  it('ACEPTA conexión directa/session (5432)', () => {
    expect(() =>
      assertFiscalDbConnectionMode('postgresql://u:p@localhost:5432/postgres')
    ).not.toThrow();
    expect(() =>
      assertFiscalDbConnectionMode('postgresql://u:p@db.x.supabase.co:5432/postgres')
    ).not.toThrow();
  });

  it('no bloquea si la URL no es parseable (env.ts ya la valida al boot)', () => {
    expect(() => assertFiscalDbConnectionMode('no-es-una-url')).not.toThrow();
  });
});

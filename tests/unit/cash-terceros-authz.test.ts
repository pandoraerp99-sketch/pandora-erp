/**
 * Gate owner-only del catálogo de terceros/beneficiarios (assertOwnerTercero).
 * Mismo boundary que motivos: solo el dueño administra empleados/proveedores.
 */
import { describe, expect, it } from 'vitest';
import { assertOwnerTercero, TerceroAuthorizationError } from '@/lib/cash/terceros';
import type { UserRole } from '@/lib/db/schema/_common';

describe('assertOwnerTercero — solo el dueño administra beneficiarios', () => {
  it('owner: pasa sin lanzar', () => {
    expect(() => assertOwnerTercero('owner')).not.toThrow();
  });

  it.each<UserRole>(['admin', 'cashier', 'accountant'])(
    'rol %s: rechazado',
    (role) => {
      expect(() => assertOwnerTercero(role)).toThrow(TerceroAuthorizationError);
    }
  );

  it('null / undefined: rechazado', () => {
    expect(() => assertOwnerTercero(null)).toThrow(TerceroAuthorizationError);
    expect(() => assertOwnerTercero(undefined)).toThrow(TerceroAuthorizationError);
  });
});

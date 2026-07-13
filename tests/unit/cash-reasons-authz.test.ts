/**
 * Gate owner-only del catálogo de motivos de retiro (assertOwner).
 *
 * "únicamente el dueño" (owner) → admin/cashier/accountant NO pueden administrar
 * los motivos. Este es el boundary de seguridad; se testea en aislamiento.
 */
import { describe, expect, it } from 'vitest';
import { assertOwner, ReasonAuthorizationError } from '@/lib/cash/reasons';
import type { UserRole } from '@/lib/db/schema/_common';

describe('assertOwner — solo el dueño administra motivos de retiro', () => {
  it('owner: pasa sin lanzar', () => {
    expect(() => assertOwner('owner')).not.toThrow();
  });

  it.each<UserRole>(['admin', 'cashier', 'accountant'])(
    'rol %s: rechazado con ReasonAuthorizationError',
    (role) => {
      expect(() => assertOwner(role)).toThrow(ReasonAuthorizationError);
    }
  );

  it('null / undefined (sin rol): rechazado', () => {
    expect(() => assertOwner(null)).toThrow(ReasonAuthorizationError);
    expect(() => assertOwner(undefined)).toThrow(ReasonAuthorizationError);
  });
});

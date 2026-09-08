/**
 * Qué empresa está mirando el usuario.
 *
 * El contador ve N empresas y elige una. Esa elección viaja en una cookie, o
 * sea: la manda el navegador, o sea que no se confía. Lo que decide a qué
 * puede acceder es `company_ids` del JWT, que lo firma el servidor de auth.
 *
 * Si esta función aceptara la cookie sin mirar, cambiar un valor en el
 * navegador dejaría ver la contabilidad de otro comercio. Es la fuga
 * cross-tenant más barata que existe, así que tiene su test aparte del resto.
 */
import { describe, expect, it } from 'vitest';
import { resolverEmpresaActiva } from '@/lib/auth/session';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const AJENA = '99999999-9999-4999-8999-999999999999';

describe('empresa activa', () => {
  it('sin cookie, manda la del token', () => {
    expect(resolverEmpresaActiva(A, [A, B], null)).toBe(A);
  });

  it('la cookie puede elegir OTRA de las suyas', () => {
    // El caso de uso: la contadora cambia de comercio con el selector.
    expect(resolverEmpresaActiva(A, [A, B], B)).toBe(B);
  });

  it('IGNORA una empresa que no es suya', () => {
    // Lo importante. Y se ignora, no se lanza: el navegador puede mandar
    // cualquier cosa, y romper la sesión por eso convierte una cookie vieja en
    // una pantalla de error.
    expect(resolverEmpresaActiva(A, [A, B], AJENA)).toBe(A);
  });

  it('una cookie ajena no da acceso ni cuando el token no trae empresa', () => {
    // El caso peor: usuario sin empresa que se inventa una cookie.
    expect(resolverEmpresaActiva(null, [], AJENA)).toBeNull();
  });

  it('una cookie vacía no cuenta como elección', () => {
    expect(resolverEmpresaActiva(A, [A, B], '')).toBe(A);
  });

  it('el dueño de un solo comercio no se ve afectado', () => {
    expect(resolverEmpresaActiva(A, [A], null)).toBe(A);
    expect(resolverEmpresaActiva(A, [A], A)).toBe(A);
  });
});

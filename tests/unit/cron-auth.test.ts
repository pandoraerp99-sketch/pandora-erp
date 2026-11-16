/**
 * T-SEC-09 — la puerta de los crons es fail-closed (H-15).
 *
 * Las rutas /api/internal/cron/* son públicas en el proxy (Vercel Cron no
 * trae sesión). Lo único que las separa de internet es CRON_SECRET, así que
 * cada rama de esta función es una garantía: la que se pruebe de menos es la
 * que algún día queda abierta.
 */
import { describe, expect, it } from 'vitest';
import { autorizarCron } from '@/lib/security/cron-auth';

const SECRETO = 'un-secreto-de-cron-largo-y-aleatorio';

describe('T-SEC-09 — autorizarCron', () => {
  it('🔴 SIN secreto configurado el cron está APAGADO, no abierto', () => {
    // Era la rama abierta: `if (env.CRON_SECRET) { ...exigir... }` dejaba
    // pasar todo cuando la variable faltaba.
    expect(autorizarCron(null, undefined)).toMatchObject({ ok: false, status: 503 });
    expect(autorizarCron('Bearer cualquier-cosa', undefined)).toMatchObject({ ok: false, status: 503 });
    expect(autorizarCron('Bearer ', '')).toMatchObject({ ok: false, status: 503 });
  });

  it('🔴 sin header, rechazado', () => {
    expect(autorizarCron(null, SECRETO)).toMatchObject({ ok: false, status: 401 });
  });

  it('🔴 secreto equivocado, rechazado — también con el mismo largo', () => {
    expect(autorizarCron('Bearer otro', SECRETO)).toMatchObject({ ok: false, status: 401 });
    const mismoLargo = 'x'.repeat(SECRETO.length);
    expect(autorizarCron(`Bearer ${mismoLargo}`, SECRETO)).toMatchObject({ ok: false, status: 401 });
  });

  it('🔴 sin el prefijo Bearer, rechazado', () => {
    expect(autorizarCron(SECRETO, SECRETO)).toMatchObject({ ok: false, status: 401 });
  });

  it('el secreto correcto pasa', () => {
    expect(autorizarCron(`Bearer ${SECRETO}`, SECRETO)).toEqual({ ok: true });
  });
});

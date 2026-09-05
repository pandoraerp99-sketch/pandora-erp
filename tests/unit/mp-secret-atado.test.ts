/**
 * T-SEC-09 — el secret global de MP está atado a UN comercio.
 *
 * El `company_id` viaja en la URL del webhook. Mientras
 * `resolveMpWebhookSecret` ignoraba ese id y devolvía el mismo secret para
 * cualquiera, una notificación legítima de MP **reenviada cambiando el
 * company_id** pasaba el HMAC y el cobro caía en el comercio equivocado.
 *
 * Validar que la company exista no alcanzaba: prueba que el tenant es real,
 * no que la notificación sea suya.
 *
 * Estos casos fijan la atadura para que nadie la afloje sin darse cuenta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El módulo env lo importa también el logger (que arma pino con varios de sus
// campos), así que NO se puede reemplazar por un objeto pelado: se parte del
// env real y se pisan sólo las dos claves de MP. Cada caso las setea a las dos
// explícitamente — omitir una dejaría pasar el valor real del .env.
const mockEnv = vi.hoisted(() => ({
  current: {} as Record<string, string | undefined>,
}));
vi.mock('@/lib/env', async () => {
  const actual = await vi.importActual<typeof import('@/lib/env')>('@/lib/env');
  return {
    ...actual,
    get env() {
      return { ...actual.env, ...mockEnv.current };
    },
  };
});

import { resolveMpWebhookSecret } from '@/lib/integrations/mercadopago/mp-secret';

const DUENIO = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';

describe('T-SEC-09 — secret de MP atado a un comercio', () => {
  beforeEach(() => {
    mockEnv.current = {
      MP_WEBHOOK_SECRET: 'secret-del-piloto',
      MP_WEBHOOK_SECRET_COMPANY_ID: DUENIO,
    };
  });

  it('devuelve el secret para el comercio dueño', async () => {
    await expect(resolveMpWebhookSecret(DUENIO)).resolves.toBe(
      'secret-del-piloto'
    );
  });

  it('LO NIEGA para cualquier otro comercio — este es el agujero que cierra', async () => {
    // El escenario real: alguien toma una notificación firmada válida y la
    // reenvía a /api/webhooks/mp/{otro_id}. Antes pasaba el HMAC.
    await expect(resolveMpWebhookSecret(OTRO)).resolves.toBeNull();
  });

  it('fail-closed si el secret no declara dueño', async () => {
    // Era el estado normal antes del fix: secret global sin atadura.
    // Ahora es configuración inválida y se rechaza en vez de aceptar a todos.
    mockEnv.current = {
      MP_WEBHOOK_SECRET: 'secret-sin-dueño',
      MP_WEBHOOK_SECRET_COMPANY_ID: undefined,
    };

    await expect(resolveMpWebhookSecret(DUENIO)).resolves.toBeNull();
    await expect(resolveMpWebhookSecret(OTRO)).resolves.toBeNull();
  });

  it('sin secret configurado devuelve null (comportamiento previo intacto)', async () => {
    mockEnv.current = {
      MP_WEBHOOK_SECRET: undefined,
      MP_WEBHOOK_SECRET_COMPANY_ID: DUENIO,
    };

    await expect(resolveMpWebhookSecret(DUENIO)).resolves.toBeNull();
  });

  it('un secret vacío se trata como ausente, no como válido', async () => {
    mockEnv.current = {
      MP_WEBHOOK_SECRET: '',
      MP_WEBHOOK_SECRET_COMPANY_ID: DUENIO,
    };

    await expect(resolveMpWebhookSecret(DUENIO)).resolves.toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  WsaaClient,
  buildLoginCmsEnvelope,
  isCredentialsExpiring,
  type LoginCmsTransport,
  type TraSigner,
  type WsaaTokenCache,
} from '@/lib/integrations/afip/wsaa-client';
import type { WsaaCredentials } from '@/lib/integrations/afip/wsaa-tra';

function soapWith(token: string, sign: string, expISO: string): string {
  const ta =
    '<loginTicketResponse version="1.0"><header>' +
    '<generationTime>2026-07-10T12:00:00-03:00</generationTime>' +
    `<expirationTime>${expISO}</expirationTime></header>` +
    `<credentials><token>${token}</token><sign>${sign}</sign></credentials>` +
    '</loginTicketResponse>';
  const escaped = ta.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<soap:Body><loginCmsReturn>${escaped}</loginCmsReturn></soap:Body>`;
}

function makeCache(seed?: WsaaCredentials): WsaaTokenCache & { saved: WsaaCredentials[] } {
  const saved: WsaaCredentials[] = [];
  let store = seed ?? null;
  return {
    saved,
    get: vi.fn(async () => store),
    save: vi.fn(async (_t, _e, creds) => {
      saved.push(creds);
      store = creds;
    }),
  };
}

const okSigner: TraSigner = { sign: vi.fn(async () => 'CMS_FAKE_BASE64') };

describe('isCredentialsExpiring', () => {
  const now = new Date('2026-07-10T15:00:00Z');
  it('true si expira dentro del margen', () => {
    const creds = { expiresAt: new Date('2026-07-10T15:05:00Z') } as WsaaCredentials;
    expect(isCredentialsExpiring(creds, now, 600)).toBe(true); // faltan 5min < 10min margen
  });
  it('false si falta más que el margen', () => {
    const creds = { expiresAt: new Date('2026-07-10T16:00:00Z') } as WsaaCredentials;
    expect(isCredentialsExpiring(creds, now, 600)).toBe(false);
  });
});

describe('buildLoginCmsEnvelope', () => {
  it('envuelve el CMS en el body loginCms', () => {
    const env = buildLoginCmsEnvelope('ABC123');
    expect(env).toContain('<wsaa:in0>ABC123</wsaa:in0>');
    expect(env).toContain('wsaa:loginCms');
  });
});

describe('WsaaClient.getCredentials', () => {
  const now = () => new Date('2026-07-10T15:00:00Z');

  it('cache HIT válido: devuelve cache sin llamar transport/signer', async () => {
    const cache = makeCache({
      token: 'CACHED',
      sign: 'CACHED_SIGN',
      generatedAt: new Date('2026-07-10T14:00:00Z'),
      expiresAt: new Date('2026-07-10T17:00:00Z'), // lejos
    });
    const transport: LoginCmsTransport = { send: vi.fn() };
    const client = new WsaaClient({ signer: okSigner, transport, cache, now });

    const auth = await client.getCredentials('tenant-1', 'homologacion');

    expect(auth).toEqual({ token: 'CACHED', sign: 'CACHED_SIGN' });
    expect(transport.send).not.toHaveBeenCalled();
    expect(okSigner.sign).not.toHaveBeenCalled();
  });

  it('cache MISS: corre flujo completo (firma → LoginCms → parse → save)', async () => {
    const cache = makeCache(null as unknown as WsaaCredentials);
    const transport: LoginCmsTransport = {
      send: vi.fn(async () => soapWith('NEW_TOKEN', 'NEW_SIGN', '2026-07-10T14:10:00-03:00')),
    };
    const signer: TraSigner = { sign: vi.fn(async () => 'CMS_X') };
    const client = new WsaaClient({ signer, transport, cache, now });

    const auth = await client.getCredentials('tenant-1', 'homologacion');

    expect(auth).toEqual({ token: 'NEW_TOKEN', sign: 'NEW_SIGN' });
    expect(signer.sign).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledWith(
      'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
      'CMS_X'
    );
    expect(cache.saved).toHaveLength(1);
    expect(cache.saved[0]!.token).toBe('NEW_TOKEN');
  });

  it('cache EXPIRANDO: refresca', async () => {
    const cache = makeCache({
      token: 'OLD',
      sign: 'OLD_SIGN',
      generatedAt: new Date('2026-07-10T14:00:00Z'),
      expiresAt: new Date('2026-07-10T15:05:00Z'), // faltan 5min < margen 10min
    });
    const transport: LoginCmsTransport = {
      send: vi.fn(async () => soapWith('FRESH', 'FRESH_SIGN', '2026-07-10T14:10:00-03:00')),
    };
    const client = new WsaaClient({ signer: okSigner, transport, cache, now });

    const auth = await client.getCredentials('tenant-1', 'homologacion');

    expect(auth.token).toBe('FRESH');
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it('usa el endpoint de PRODUCCIÓN cuando environment=produccion', async () => {
    const cache = makeCache(null as unknown as WsaaCredentials);
    const transport: LoginCmsTransport = {
      send: vi.fn(async () => soapWith('P', 'P_SIGN', '2026-07-10T14:10:00-03:00')),
    };
    const client = new WsaaClient({ signer: okSigner, transport, cache, now });

    await client.getCredentials('tenant-1', 'produccion');

    expect(transport.send).toHaveBeenCalledWith(
      'https://wsaa.afip.gov.ar/ws/services/LoginCms',
      expect.any(String)
    );
  });
});

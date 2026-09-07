/**
 * T-SEC-06 — el canal a AFIP exige TLS 1.2+ y valida el certificado.
 *
 * Catálogo CLAUDE.md §18.3. Faltaba porque el transporte no existía; ahora
 * existe, así que el test también.
 *
 * POR QUE IMPORTA: por este canal viajan el certificado X.509 del comercio y
 * el token WSAA. Bajar `rejectUnauthorized` es el atajo más común de la
 * industria cuando el handshake falla — y convierte a cualquier intermediario
 * en lector de la identidad fiscal del comerciante. CLAUDE.md §11.4 lo prohíbe
 * explícitamente.
 *
 * NO se prueba leyendo el código ni espiando las opciones: se levantan
 * servidores TLS de verdad y se comprueba que la conexión FALLA.
 *   1. servidor con certificado autofirmado  → tiene que rechazarlo
 *   2. servidor que sólo habla TLS 1.1       → tiene que fallar el handshake
 *   3. servidor legítimo (su CA de confianza) → tiene que funcionar
 * El (3) es el que evita que este test pase por estar todo roto.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { postSoap, SoapTransportError } from '@/lib/integrations/afip/soap-transport';
import { generarCertDePrueba } from '../helpers/cert-de-prueba';

const cred = generarCertDePrueba({ cn: 'localhost' });
const RESPUESTA = '<?xml version="1.0"?><Envelope><Body>ok</Body></Envelope>';

const servidores: Server[] = [];

function levantar(opciones: Record<string, unknown>): Promise<number> {
  const srv = createServer(
    { cert: cred.certPem, key: cred.privateKeyPem, ...opciones },
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(RESPUESTA);
    }
  );
  servidores.push(srv);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as AddressInfo).port));
  });
}

afterAll(async () => {
  await Promise.all(
    servidores.map((s) => new Promise<void>((r) => s.close(() => r())))
  );
});

describe('T-SEC-06 — TLS del canal AFIP', () => {
  it('RECHAZA un certificado que no puede validar (rejectUnauthorized)', async () => {
    const port = await levantar({});
    const err = await postSoap({
      url: `https://127.0.0.1:${port}/`,
      body: '<a/>',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SoapTransportError);
    expect((err as SoapTransportError).code).toBe('network');
    // El motivo real de Node: firma autofirmada / no confiable.
    expect((err as SoapTransportError).message).toMatch(
      /self[- ]signed|unable to verify|certificate/i
    );
  });

  it('RECHAZA un servidor que sólo habla TLS 1.1', async () => {
    const port = await levantar({ maxVersion: 'TLSv1.1', minVersion: 'TLSv1.1' });
    const err = await postSoap({
      url: `https://127.0.0.1:${port}/`,
      body: '<a/>',
    }).catch((e: unknown) => e);

    // Falla en el handshake, antes de cualquier validación de certificado.
    expect(err).toBeInstanceOf(SoapTransportError);
    expect((err as SoapTransportError).code).toBe('network');
  });

  it('SÍ habla con un servidor legítimo sobre TLS 1.2+', async () => {
    // El control positivo: sin esto, los dos de arriba pasarían aunque el
    // transporte estuviera roto de punta a punta.
    const port = await levantar({ minVersion: 'TLSv1.2' });
    const anteriorCa = process.env.NODE_EXTRA_CA_CERTS;
    // Se confía en el cert de prueba SOLO para esta llamada, sin tocar
    // rejectUnauthorized: es la diferencia entre "confío en esta CA" y
    // "no valido nada".
    const respuesta = await postSoap({
      url: `https://127.0.0.1:${port}/`,
      body: '<a/>',
      ca: cred.certPem,
    });
    expect(respuesta).toContain('ok');
    expect(process.env.NODE_EXTRA_CA_CERTS).toBe(anteriorCa);
  });

  it('corta por timeout en vez de esperar para siempre', async () => {
    // Importa más de lo que parece: emitInvoice sostiene una transacción de
    // base abierta durante esta llamada. Si no corta acá, corta Postgres, y el
    // número fiscal queda en el limbo.
    const srv = createServer(
      { cert: cred.certPem, key: cred.privateKeyPem, minVersion: 'TLSv1.2' },
      () => {
        /* nunca responde */
      }
    );
    servidores.push(srv);
    const port = await new Promise<number>((r) =>
      srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port))
    );

    const err = await postSoap({
      url: `https://127.0.0.1:${port}/`,
      body: '<a/>',
      timeoutMs: 400,
      ca: cred.certPem,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SoapTransportError);
    expect((err as SoapTransportError).code).toBe('timeout');
  });
});

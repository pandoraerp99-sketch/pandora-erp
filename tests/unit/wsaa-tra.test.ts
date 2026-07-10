import { describe, expect, it } from 'vitest';
import {
  buildTra,
  formatArIso,
  parseLoginCmsResponse,
} from '@/lib/integrations/afip/wsaa-tra';

describe('formatArIso', () => {
  it('convierte UTC a offset AR -03:00 sin milisegundos', () => {
    // 2026-07-10T15:00:00Z → AR = 12:00:00-03:00
    expect(formatArIso(new Date('2026-07-10T15:00:00Z'))).toBe('2026-07-10T12:00:00-03:00');
  });

  it('cruza el límite de día correctamente', () => {
    // 2026-07-10T01:00:00Z → AR = 2026-07-09T22:00:00-03:00
    expect(formatArIso(new Date('2026-07-10T01:00:00Z'))).toBe('2026-07-09T22:00:00-03:00');
  });
});

describe('buildTra', () => {
  const now = new Date('2026-07-10T15:00:00Z');

  it('genera TRA con service, uniqueId y ventana gen/exp', () => {
    const tra = buildTra('wsfe', now);
    expect(tra).toContain('<service>wsfe</service>');
    expect(tra).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`);
    // gen = now - 600s = 14:50Z = 11:50-03:00 ; exp = now + 600s = 15:10Z = 12:10-03:00
    expect(tra).toContain('<generationTime>2026-07-10T11:50:00-03:00</generationTime>');
    expect(tra).toContain('<expirationTime>2026-07-10T12:10:00-03:00</expirationTime>');
    expect(tra).toContain('loginTicketRequest version="1.0"');
  });

  it('es determinístico para un mismo now', () => {
    expect(buildTra('wsfe', now)).toBe(buildTra('wsfe', now));
  });

  it('rechaza service inválido', () => {
    expect(() => buildTra('', now)).toThrow();
    expect(() => buildTra('ws fe!', now)).toThrow();
  });
});

describe('parseLoginCmsResponse', () => {
  const ta =
    '<?xml version="1.0"?>' +
    '<loginTicketResponse version="1.0">' +
    '<header><generationTime>2026-07-10T12:00:00-03:00</generationTime>' +
    '<expirationTime>2026-07-10T12:10:00-03:00</expirationTime></header>' +
    '<credentials><token>TOKEN_ABC</token><sign>SIGN_XYZ</sign></credentials>' +
    '</loginTicketResponse>';

  const escaped = ta.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const soapResponse =
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    '<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    `<loginCmsReturn>${escaped}</loginCmsReturn>` +
    '</loginCmsResponse></soap:Body></soap:Envelope>';

  it('extrae token/sign/expiración de una respuesta SOAP escapada', () => {
    const creds = parseLoginCmsResponse(soapResponse);
    expect(creds.token).toBe('TOKEN_ABC');
    expect(creds.sign).toBe('SIGN_XYZ');
    expect(creds.expiresAt.toISOString()).toBe('2026-07-10T15:10:00.000Z');
    expect(creds.generatedAt.toISOString()).toBe('2026-07-10T15:00:00.000Z');
  });

  it('parsea también un loginTicketResponse directo (sin SOAP wrap)', () => {
    const creds = parseLoginCmsResponse(ta);
    expect(creds.token).toBe('TOKEN_ABC');
    expect(creds.sign).toBe('SIGN_XYZ');
  });

  it('fail-closed si falta token/sign', () => {
    const bad = ta.replace('<token>TOKEN_ABC</token>', '');
    expect(() => parseLoginCmsResponse(bad)).toThrow();
  });

  it('fail-closed si no hay loginTicketResponse', () => {
    expect(() => parseLoginCmsResponse('<soap:Envelope/>')).toThrow();
  });
});

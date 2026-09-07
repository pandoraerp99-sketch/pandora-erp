/**
 * Firma CMS del TRA.
 *
 * WSAA no acepta una firma cualquiera: pide el TRA envuelto en PKCS#7
 * SignedData, con el certificado adentro y el contenido ATTACHED. Si algo de
 * eso sale mal, AFIP responde un error de parseo genérico que no dice qué
 * falta — por eso conviene verificar la estructura acá y no descubrirlo contra
 * el servidor.
 */
import { describe, expect, it } from 'vitest';
import forge from 'node-forge';
import {
  createTraSigner,
  readCertificateExpiry,
  signTraCms,
  TraSignError,
} from '@/lib/integrations/afip/tra-signer';
import { generarCertDePrueba } from '../helpers/cert-de-prueba';

/**
 * Lo que se lee del CMS parseado.
 *
 * `@types/node-forge` no declara `type` ni `rawCapture` en `PkcsSignedData`,
 * aunque forge los expone en runtime. Se tipa acotado a lo que este test mira,
 * en vez de castear a `any` y perder la verificación entera.
 */
interface CmsLeido {
  type: string;
  certificates: unknown[];
  rawCapture?: {
    content?: forge.asn1.Asn1;
    authenticatedAttributes?: unknown[];
  };
}

const parsearCms = (b64: string): CmsLeido =>
  forge.pkcs7.messageFromAsn1(
    forge.asn1.fromDer(forge.util.decode64(b64))
  ) as unknown as CmsLeido;

// Generar RSA 2048 tarda; se hace UNA vez para todo el archivo.
const cred = generarCertDePrueba();

const TRA =
  '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0">' +
  '<header><uniqueId>1</uniqueId></header><service>wsfe</service></loginTicketRequest>';

describe('firma CMS del TRA', () => {
  it('produce un PKCS#7 que se puede volver a parsear', () => {
    const b64 = signTraCms(TRA, cred);

    expect(b64.length).toBeGreaterThan(100);
    // Base64 puro: si se colara un salto de línea o un header PEM, WSAA lo
    // rechaza.
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);

    expect(parsearCms(b64).type).toBe(forge.pki.oids.signedData);
  });

  it('el TRA viaja ADENTRO del sobre (attached, no detached)', () => {
    // Con firma desprendida WSAA no tiene qué verificar y falla sin explicar.
    const contenido = parsearCms(signTraCms(TRA, cred)).rawCapture?.content;
    expect(contenido).toBeTruthy();
    const texto = forge.asn1.toDer(contenido as forge.asn1.Asn1).getBytes();
    expect(texto).toContain('loginTicketRequest');
    expect(texto).toContain('wsfe');
  });

  it('el certificado va incluido — WSAA lo necesita para verificar', () => {
    expect(parsearCms(signTraCms(TRA, cred)).certificates.length).toBeGreaterThan(0);
  });

  it('van los tres atributos firmados que espera un CMS', () => {
    // contentType + messageDigest + signingTime. Sin ellos el sobre es válido
    // como ASN.1 pero WSAA lo rechaza sin decir cuál falta.
    //
    // OJO: NO se compara "dos firmas dan distinto". signingTime se codifica
    // como UTCTime, con resolución de UN SEGUNDO, así que dos firmas del mismo
    // TRA en el mismo segundo salen iguales — y está bien. Ese assert parecía
    // razonable y fallaba por la razón equivocada.
    const atributos =
      parsearCms(signTraCms(TRA, cred)).rawCapture?.authenticatedAttributes ?? [];
    expect(atributos.length).toBe(3);
  });

  it('un PEM inválido falla con un mensaje del negocio, sin filtrar el PEM', () => {
    // El mensaje termina en un log: no puede citar pedazos del certificado.
    const err = (() => {
      try {
        signTraCms(TRA, { certPem: 'no soy un cert', privateKeyPem: cred.privateKeyPem });
        return null;
      } catch (e) {
        return e as TraSignError;
      }
    })();

    expect(err).toBeInstanceOf(TraSignError);
    expect(err?.code).toBe('invalid_certificate');
    expect(err?.message).not.toContain('no soy un cert');
  });

  it('una clave privada inválida se distingue de un certificado inválido', () => {
    expect(() =>
      signTraCms(TRA, { certPem: cred.certPem, privateKeyPem: 'cualquier cosa' })
    ).toThrow(/clave privada/i);
  });

  it('un TRA vacío no se firma', () => {
    expect(() => signTraCms('', cred)).toThrow(TraSignError);
  });

  it('el adaptador cumple la forma que espera WsaaClient', async () => {
    const signer = createTraSigner(cred);
    await expect(signer.sign(TRA)).resolves.toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('vencimiento del certificado', () => {
  it('se lee del propio PEM, no de un dato aparte', () => {
    // Una sola fuente: si el operador tipea mal la fecha al cargarlo, el aviso
    // de vencimiento llegaría cuando no corresponde.
    const leido = readCertificateExpiry(cred.certPem);
    expect(Math.abs(leido.getTime() - cred.notAfter.getTime())).toBeLessThan(1000);
  });

  it('un PEM inválido falla explícito', () => {
    expect(() => readCertificateExpiry('nada')).toThrow(TraSignError);
  });
});

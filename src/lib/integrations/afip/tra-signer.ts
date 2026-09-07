/**
 * Firma CMS/PKCS#7 del TRA — la implementacion real de `TraSigner`.
 *
 * WSAA no acepta una firma cualquiera: pide el TRA envuelto en un **CMS
 * firmado** (PKCS#7 SignedData), en base64. Node no arma CMS: `node:crypto`
 * firma bytes, pero no construye la estructura ASN.1 con el certificado
 * adentro. Por eso entra `node-forge`, que es la unica dependencia de cripto
 * del proyecto y esta justificada por esa carencia concreta.
 *
 * Se descarto llamar a `openssl smime -sign` por consola: en Vercel no hay
 * binario de openssl garantizado, y una dependencia invisible del sistema
 * operativo es la clase de cosa que anda en tu maquina y explota en el deploy.
 *
 * El PEM de la clave privada NUNCA se loguea ni sale de esta funcion.
 */
import forge from 'node-forge';

/**
 * OIDs del CMS, literales.
 *
 * `forge.pki.oids.sha256` viene tipado como `string | undefined` porque es un
 * diccionario. Ponerlos a mano saca cuatro `!` y ademas deja ver QUE se esta
 * firmando sin ir a buscar la tabla de forge.
 */
const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  data: '1.2.840.113549.1.7.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
} as const;

export interface CmsSignerInput {
  /** PEM del certificado X.509 emitido por AFIP. */
  certPem: string;
  /** PEM de la clave privada con la que se genero el CSR. */
  privateKeyPem: string;
}

export class TraSignError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'TraSignError';
  }
}

/**
 * Firma el XML del TRA y devuelve el CMS en base64, listo para `LoginCms`.
 *
 * `detached: false` a proposito: WSAA necesita el contenido firmado ADENTRO
 * del sobre (attached). Con firma desprendida el server no tiene que firmar y
 * responde un error de parseo que no dice nada.
 */
export function signTraCms(traXml: string, cred: CmsSignerInput): string {
  if (traXml.length === 0) {
    throw new TraSignError('empty_tra', 'El TRA a firmar está vacío');
  }

  let cert: forge.pki.Certificate;
  let key: forge.pki.rsa.PrivateKey;
  try {
    cert = forge.pki.certificateFromPem(cred.certPem);
  } catch {
    // Se traga el error original a proposito: los mensajes de forge citan
    // pedazos del PEM, y esto termina en un log.
    throw new TraSignError(
      'invalid_certificate',
      'No se pudo leer el certificado de AFIP (PEM inválido)'
    );
  }
  try {
    key = forge.pki.privateKeyFromPem(cred.privateKeyPem) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new TraSignError(
      'invalid_private_key',
      'No se pudo leer la clave privada (PEM inválido)'
    );
  }

  const p7 = forge.pkcs7.createSignedData();
  // El contenido va como binario utf-8: el TRA lleva acentos en la razón
  // social y latin1 los rompe.
  p7.content = forge.util.createBuffer(traXml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: OID.sha256,
    authenticatedAttributes: [
      { type: OID.contentType, value: OID.data },
      { type: OID.messageDigest },
      // Un Date, que es lo que forge espera acá. Se codifica como UTCTime, o
      // sea con resolucion de UN SEGUNDO: dos firmas del mismo TRA dentro del
      // mismo segundo salen byte a byte iguales, y eso es correcto. (No es
      // problema: el TRA real lleva uniqueId y generationTime propios, asi que
      // nunca se firma dos veces el mismo contenido.)
      { type: OID.signingTime, value: new Date() as unknown as string },
    ],
  });

  p7.sign({ detached: false });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

/** Adaptador con la forma que espera `WsaaClient`. */
export function createTraSigner(cred: CmsSignerInput): {
  sign(traXml: string): Promise<string>;
} {
  return {
    sign: async (traXml: string) => signTraCms(traXml, cred),
  };
}

/**
 * Vencimiento del certificado, leido del propio PEM.
 *
 * Se saca de aca y no se pide aparte para que no haya dos verdades: si el
 * operador tipea mal la fecha al cargarlo, el aviso de vencimiento llega
 * cuando no corresponde.
 */
export function readCertificateExpiry(certPem: string): Date {
  try {
    return forge.pki.certificateFromPem(certPem).validity.notAfter;
  } catch {
    throw new TraSignError(
      'invalid_certificate',
      'No se pudo leer el certificado de AFIP (PEM inválido)'
    );
  }
}

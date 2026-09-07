/**
 * Genera un certificado X.509 autofirmado + su clave, para los tests.
 *
 * NUNCA sirve contra AFIP: AFIP solo acepta certificados que emitió ella. Esto
 * existe para probar lo NUESTRO — que la firma CMS se arma bien, que el vault
 * guarda y devuelve el PEM, y que el transporte rechaza un certificado que no
 * puede validar.
 */
import forge from 'node-forge';

export interface CertDePrueba {
  certPem: string;
  privateKeyPem: string;
  notAfter: Date;
}

export function generarCertDePrueba(
  opciones: { cn?: string; diasDeVida?: number } = {}
): CertDePrueba {
  const { cn = 'pandora-test', diasDeVida = 365 } = opciones;

  // 2048 bits: es lo que pide AFIP y lo que tarda un rato en generarse. Los
  // tests que lo usen tienen que darse el tiempo.
  const par = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = par.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + diasDeVida * 86400000);

  const atributos = [
    { name: 'commonName', value: cn },
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'Pandora Test' },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  // subjectAltName: Node ya NO valida contra el CommonName. Sin SAN, conectarse
  // al servidor de prueba falla con ERR_TLS_CERT_ALTNAME_INVALID y el test
  // parece decir "el TLS no anda" cuando lo que falta es esta extensión.
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' }, // DNS
        { type: 7, ip: '127.0.0.1' }, // IP
      ],
    },
  ]);
  cert.sign(par.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(par.privateKey),
    notAfter: cert.validity.notAfter,
  };
}

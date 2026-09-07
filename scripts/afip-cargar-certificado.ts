/**
 * Carga el certificado de AFIP de un comercio en la base, cifrado.
 *
 * Es el onboarding fiscal, y por ahora se hace por consola: cargar un
 * certificado es una operación de una vez por comercio y por environment, y
 * una pantalla para eso es superficie de ataque sin beneficio.
 *
 * El vencimiento se lee del PROPIO certificado, no se pide por parámetro: una
 * sola fuente, así el aviso de vencimiento no depende de que alguien tipee
 * bien una fecha.
 *
 * Uso:
 *   pnpm tsx scripts/afip-cargar-certificado.ts \
 *     --tenant <uuid> --cuit <11 digitos> --cert ruta.crt --key ruta.key \
 *     [--env homologacion|produccion] [--alias nombre]
 */
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db/client.js';
import { companies } from '../src/lib/db/schema/companies.js';
import { saveAfipCredentials } from '../src/lib/fiscal/afip-credentials.js';
import { readCertificateExpiry } from '../src/lib/integrations/afip/tra-signer.js';
import type { AfipEnvironment } from '../src/lib/db/schema/_common.js';

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function morir(mensaje: string): never {
  console.error(`\n  ERROR: ${mensaje}\n`);
  process.exit(1);
}

const tenantId = arg('tenant');
const cuit = arg('cuit');
const certPath = arg('cert');
const keyPath = arg('key');
const environment = (arg('env') ?? 'homologacion') as AfipEnvironment;
const alias = arg('alias') ?? null;

if (!tenantId || !cuit || !certPath || !keyPath) {
  morir(
    'faltan parámetros.\n' +
      '  Uso: --tenant <uuid> --cuit <11 dígitos> --cert <archivo> --key <archivo>\n' +
      '       [--env homologacion|produccion] [--alias nombre]'
  );
}
if (environment !== 'homologacion' && environment !== 'produccion') {
  morir(`--env tiene que ser homologacion o produccion, no '${environment}'`);
}

// La empresa tiene que existir. Cargar un cert contra un uuid inventado
// "funciona" y el error recién aparece al facturar.
const [empresa] = await db
  .select({ id: companies.id, name: companies.name, cuit: companies.cuit })
  .from(companies)
  .where(eq(companies.id, tenantId))
  .limit(1);

if (!empresa) morir(`no existe ninguna empresa con id ${tenantId}`);

const certPem = readFileSync(certPath, 'utf8');
const privateKeyPem = readFileSync(keyPath, 'utf8');
const expiresAt = readCertificateExpiry(certPem);

if (expiresAt.getTime() <= Date.now()) {
  morir(
    `ese certificado ya está VENCIDO (${expiresAt.toISOString()}). ` +
      'Hay que pedir uno nuevo en AFIP.'
  );
}

// Aviso, no bloqueo: son datos distintos y el que manda es el del certificado
// (AFIP valida contra ese). Pero si no coinciden, casi siempre es un error.
if (empresa.cuit !== null && empresa.cuit.replace(/\D/g, '') !== cuit) {
  console.warn(
    `\n  OJO: el CUIT del certificado (${cuit}) no coincide con el de la ` +
      `empresa en la base (${empresa.cuit}).\n  Se guarda igual — manda el del ` +
      'certificado — pero revisá que sea el comercio correcto.\n'
  );
}

await saveAfipCredentials({
  tenantId,
  environment,
  cuit,
  certPem,
  privateKeyPem,
  expiresAt,
  alias,
});

const dias = Math.round((expiresAt.getTime() - Date.now()) / 86400000);
console.log(`
  Certificado cargado.

    empresa     : ${empresa.name}
    environment : ${environment}
    CUIT        : ${cuit}
    vence       : ${expiresAt.toISOString().slice(0, 10)}  (en ${dias} días)

  Queda guardado CIFRADO (el vault): en la base no hay ningún PEM en claro.

  A partir de ahora getCaeRequester() devuelve un cliente real para esta
  empresa, así que las ventas marcadas para facturar van a pedir CAE de verdad.
`);

process.exit(0);

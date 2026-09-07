/**
 * Lectura y alta del certificado AFIP de un tenant.
 *
 * Es el unico lugar de la app que descifra el material del certificado. Todo
 * lo que sale de aca es SECRETO (CLAUDE.md §10.5): no se loguea, no se manda
 * al cliente, no entra en un audit payload.
 *
 * `getAfipCredentials` devuelve `null` cuando el tenant todavia no cargo su
 * certificado. Eso NO es un error: es el estado normal antes del onboarding, y
 * el factory lo traduce en "emision diferida" — el cobro sigue funcionando y
 * la venta queda `pending` (fail-closed A-2).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { afip_credentials } from '../db/schema/afip_credentials.js';
import type { AfipEnvironment } from '../db/schema/_common.js';
import { decryptSecret, encryptSecret } from '../security/vault.js';
import { DomainError } from '../multi_tenant/errors.js';
import { logger } from '../observability/logger.js';

export class AfipCredentialError extends DomainError {
  constructor(code: string, messageEs: string) {
    super(code, messageEs, 422);
  }
}

export interface AfipCredentials {
  /** CUIT del certificado, 11 digitos. */
  cuit: string;
  /** PEM del certificado X.509. SECRETO. */
  certPem: string;
  /** PEM de la clave privada. SECRETO. */
  privateKeyPem: string;
  expiresAt: Date | null;
}

/**
 * Credenciales del tenant para ese environment, descifradas. `null` si no
 * cargo certificado todavia.
 *
 * **Falla si el certificado esta vencido** en vez de intentar y que AFIP
 * rechace: el error de AFIP no dice "se te vencio el cert", dice cualquier
 * cosa, y el comerciante se entera en el peor momento (CLAUDE.md §8.12,
 * cert vencido = NO emitir).
 */
export async function getAfipCredentials(
  tenantId: string,
  environment: AfipEnvironment,
  now: Date = new Date()
): Promise<AfipCredentials | null> {
  const [fila] = await db
    .select()
    .from(afip_credentials)
    .where(
      and(
        eq(afip_credentials.tenant_id, tenantId),
        eq(afip_credentials.environment, environment)
      )
    )
    .limit(1);

  if (!fila) return null;

  if (fila.expires_at !== null && fila.expires_at.getTime() <= now.getTime()) {
    // Se loguea el VENCIMIENTO, nunca el contenido.
    logger.error(
      { tenant_id: tenantId, environment, expires_at: fila.expires_at },
      'afip.certificate_expired'
    );
    throw new AfipCredentialError(
      'certificate_expired',
      'El certificado de AFIP está vencido. Hay que renovarlo antes de poder facturar.'
    );
  }

  return {
    cuit: fila.cuit,
    certPem: decryptSecret(fila.cert_encrypted),
    privateKeyPem: decryptSecret(fila.private_key_encrypted),
    expiresAt: fila.expires_at,
  };
}

/**
 * Guarda (o reemplaza) el certificado de un tenant. Lo usa el script de
 * onboarding; no hay UI todavia.
 *
 * Valida que lo que llega SEA un PEM antes de cifrarlo: cifrar cualquier cosa
 * "funciona" y el error recien aparece al firmar, con un mensaje de la libreria
 * de cripto que no dice nada del negocio.
 */
export async function saveAfipCredentials(input: {
  tenantId: string;
  environment: AfipEnvironment;
  cuit: string;
  certPem: string;
  privateKeyPem: string;
  expiresAt?: Date | null;
  alias?: string | null;
}): Promise<void> {
  if (!/^[0-9]{11}$/.test(input.cuit)) {
    throw new AfipCredentialError(
      'invalid_cuit',
      'El CUIT tiene que ser 11 dígitos sin guiones'
    );
  }
  if (!input.certPem.includes('BEGIN CERTIFICATE')) {
    throw new AfipCredentialError(
      'invalid_cert',
      'Eso no parece un certificado PEM (falta BEGIN CERTIFICATE)'
    );
  }
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(input.privateKeyPem)) {
    throw new AfipCredentialError(
      'invalid_private_key',
      'Eso no parece una clave privada PEM (falta BEGIN PRIVATE KEY)'
    );
  }

  const valores = {
    tenant_id: input.tenantId,
    environment: input.environment,
    cuit: input.cuit,
    cert_encrypted: encryptSecret(input.certPem),
    private_key_encrypted: encryptSecret(input.privateKeyPem),
    expires_at: input.expiresAt ?? null,
    alias: input.alias ?? null,
    updated_at: new Date(),
  };

  await db
    .insert(afip_credentials)
    .values(valores)
    .onConflictDoUpdate({
      target: [afip_credentials.tenant_id, afip_credentials.environment],
      set: valores,
    });

  logger.info(
    {
      tenant_id: input.tenantId,
      environment: input.environment,
      cuit: input.cuit,
      expires_at: valores.expires_at,
    },
    'afip.credentials_saved'
  );
}

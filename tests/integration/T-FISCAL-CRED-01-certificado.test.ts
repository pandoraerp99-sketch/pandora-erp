/**
 * T-FISCAL-CRED-01 — el certificado de AFIP se guarda cifrado y por tenant.
 *
 * Este es el primer consumidor real del vault, que estaba escrito y sin usar
 * desde Sprint 1. Lo que se protege acá es la identidad fiscal del comercio:
 * con ese certificado se firma en su nombre ante AFIP.
 *
 * Las tres cosas que no pueden fallar:
 *   1. en la base NO puede quedar un PEM en claro (un dump lo llevaría entero)
 *   2. un tenant no puede leer el certificado de otro (§7.5: nunca compartido)
 *   3. un certificado vencido NO se usa — se falla explícito, porque el error
 *      que devuelve AFIP no dice "se te venció" y el comerciante se enteraría
 *      en el peor momento (§8.12)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { afip_credentials } from '@/lib/db/schema/afip_credentials';
import {
  AfipCredentialError,
  getAfipCredentials,
  saveAfipCredentials,
} from '@/lib/fiscal/afip-credentials';
import { generarCertDePrueba } from '../helpers/cert-de-prueba';

const cred = generarCertDePrueba();
const CUIT = '20123456789';

describe('T-FISCAL-CRED-01 — certificado AFIP', () => {
  let tenantA: string;
  let tenantB: string;

  const crearCompany = async (id: string, n: number) => {
    await db.insert(companies).values({
      id,
      name: `T-CRED Co ${n}`,
      legal_name: `T-CRED Co ${n} SRL`,
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
  };

  beforeEach(async () => {
    tenantA = crypto.randomUUID();
    tenantB = crypto.randomUUID();
    await crearCompany(tenantA, 1);
    await crearCompany(tenantB, 2);
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      for (const t of [tenantA, tenantB]) {
        await tx.delete(afip_credentials).where(eq(afip_credentials.tenant_id, t));
        await tx.delete(companies).where(eq(companies.id, t));
      }
    });
  });

  it('sin certificado devuelve null, no explota', async () => {
    // Es el estado NORMAL antes del onboarding: el POS tiene que seguir
    // cobrando y la venta queda pendiente de emisión (fail-closed A-2).
    await expect(getAfipCredentials(tenantA, 'homologacion')).resolves.toBeNull();
  });

  it('guarda y devuelve el PEM intacto', async () => {
    await saveAfipCredentials({
      tenantId: tenantA,
      environment: 'homologacion',
      cuit: CUIT,
      certPem: cred.certPem,
      privateKeyPem: cred.privateKeyPem,
      expiresAt: cred.notAfter,
    });

    const leido = await getAfipCredentials(tenantA, 'homologacion');
    expect(leido?.certPem).toBe(cred.certPem);
    expect(leido?.privateKeyPem).toBe(cred.privateKeyPem);
    expect(leido?.cuit).toBe(CUIT);
  });

  it('en la BASE no queda un PEM en claro', async () => {
    await saveAfipCredentials({
      tenantId: tenantA,
      environment: 'homologacion',
      cuit: CUIT,
      certPem: cred.certPem,
      privateKeyPem: cred.privateKeyPem,
    });

    const [fila] = await db
      .select()
      .from(afip_credentials)
      .where(eq(afip_credentials.tenant_id, tenantA));

    // Lo que importa es esto: quien lea la tabla sin la clave no tiene nada.
    expect(fila?.cert_encrypted).not.toContain('BEGIN CERTIFICATE');
    expect(fila?.private_key_encrypted).not.toContain('PRIVATE KEY');
    expect(fila?.cert_encrypted.startsWith('v1:')).toBe(true);
    expect(fila?.private_key_encrypted.startsWith('v1:')).toBe(true);
  });

  it('la BASE rechaza un PEM sin cifrar aunque lo intente el código', async () => {
    // Defensa en profundidad: si mañana alguien saltea el vault, el CHECK lo
    // frena. Un cert en claro es la clase de error que no se nota hasta el dump.
    await expect(
      db.insert(afip_credentials).values({
        tenant_id: tenantA,
        environment: 'homologacion',
        cuit: CUIT,
        cert_encrypted: cred.certPem,
        private_key_encrypted: cred.privateKeyPem,
      })
    ).rejects.toThrow();
  });

  it('un tenant NO ve el certificado de otro', async () => {
    await saveAfipCredentials({
      tenantId: tenantA,
      environment: 'homologacion',
      cuit: CUIT,
      certPem: cred.certPem,
      privateKeyPem: cred.privateKeyPem,
    });
    await expect(getAfipCredentials(tenantB, 'homologacion')).resolves.toBeNull();
  });

  it('homologación y producción son credenciales DISTINTAS', async () => {
    // ADR-0019 S13: un cert de homologación no puede llegar a producción.
    await saveAfipCredentials({
      tenantId: tenantA,
      environment: 'homologacion',
      cuit: CUIT,
      certPem: cred.certPem,
      privateKeyPem: cred.privateKeyPem,
    });
    await expect(getAfipCredentials(tenantA, 'produccion')).resolves.toBeNull();
  });

  it('un certificado VENCIDO no se usa: falla explícito', async () => {
    await saveAfipCredentials({
      tenantId: tenantA,
      environment: 'homologacion',
      cuit: CUIT,
      certPem: cred.certPem,
      privateKeyPem: cred.privateKeyPem,
      expiresAt: new Date(Date.now() - 86400000),
    });

    await expect(getAfipCredentials(tenantA, 'homologacion')).rejects.toThrow(
      AfipCredentialError
    );
    await expect(getAfipCredentials(tenantA, 'homologacion')).rejects.toThrow(
      /vencido/i
    );
  });

  it('recargar el certificado REEMPLAZA, no duplica', async () => {
    const otro = generarCertDePrueba({ cn: 'renovado' });
    for (const c of [cred, otro]) {
      await saveAfipCredentials({
        tenantId: tenantA,
        environment: 'homologacion',
        cuit: CUIT,
        certPem: c.certPem,
        privateKeyPem: c.privateKeyPem,
      });
    }
    const filas = await db
      .select()
      .from(afip_credentials)
      .where(eq(afip_credentials.tenant_id, tenantA));
    expect(filas.length).toBe(1);

    const leido = await getAfipCredentials(tenantA, 'homologacion');
    expect(leido?.certPem).toBe(otro.certPem);
  });

  it('rechaza un CUIT con guiones antes de guardarlo', async () => {
    // Con guiones el TRA sale mal y AFIP contesta algo que no menciona el CUIT.
    await expect(
      saveAfipCredentials({
        tenantId: tenantA,
        environment: 'homologacion',
        cuit: '20-12345678-9',
        certPem: cred.certPem,
        privateKeyPem: cred.privateKeyPem,
      })
    ).rejects.toThrow(/11 dígitos/i);
  });

  it('rechaza algo que no es un PEM', async () => {
    await expect(
      saveAfipCredentials({
        tenantId: tenantA,
        environment: 'homologacion',
        cuit: CUIT,
        certPem: 'esto no es un certificado',
        privateKeyPem: cred.privateKeyPem,
      })
    ).rejects.toThrow(/certificado/i);
  });
});

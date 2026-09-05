/**
 * T-INV-09 — el rubro (category) se persiste de verdad.
 *
 * **Por qué existe.** `createProduct` y `updateProduct` NO hacen spread del
 * input: enumeran los campos uno por uno en el `.values({...})`. Un campo
 * nuevo que pase el Zod pero no esté en esa lista **se descarta en silencio**:
 * la validación acepta, el INSERT anda, y el dato nunca llega a la base.
 *
 * Es el mismo modo de falla que `stock_minimum` en el POS (el dato existía y
 * no viajaba al cliente), sólo que un escalón más abajo. Se fija acá para que
 * el próximo campo que se agregue no se pierda igual.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createProduct,
  updateProduct,
  getProductById,
} from '@/lib/services/products/product.service';

describe('T-INV-09 — rubro del producto', () => {
  let tenantId: string;
  let userId: string;

  const withCtx = <T,>(fn: () => Promise<T>): Promise<T> =>
    Promise.resolve(
      withTracingContext(
        {
          correlation_id: generateCorrelationId(),
          request_id: generateRequestId(),
          tenant_id: tenantId,
          actor_user_id: userId,
          actor_type: 'user',
        },
        fn
      )
    );

  const base = {
    name: 'Producto T-INV-09',
    price: '1000.0000',
    cost: '600.0000',
  };

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-INV-09 Co',
      legal_name: 'T-INV-09 Co SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    await db.insert(users).values({
      id: userId,
      email: `t-inv-09-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Owner T-INV-09',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'owner',
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('createProduct GUARDA el rubro (no lo descarta en silencio)', async () => {
    const creado = await withCtx(() =>
      createProduct({ ...base, category: 'Bebidas' })
    );

    // Lo que devuelve el service...
    expect(creado.category).toBe('Bebidas');

    // ...y lo que quedó en la base, que es lo que realmente importa.
    const [enBase] = await db
      .select({ category: products.category })
      .from(products)
      .where(eq(products.id, creado.id));
    expect(enBase?.category).toBe('Bebidas');
  });

  it('un producto sin rubro queda en NULL, no en cadena vacía', async () => {
    // "Sin rubro" es un estado legítimo. Guardar '' crearía un rubro fantasma
    // que aparecería como chip vacío en el filtro.
    const creado = await withCtx(() => createProduct({ ...base }));
    expect(creado.category).toBeNull();

    const conVacio = await withCtx(() =>
      createProduct({ ...base, name: 'Otro', category: '' })
    );
    expect(conVacio.category).toBeNull();
  });

  it('updateProduct cambia el rubro', async () => {
    const creado = await withCtx(() =>
      createProduct({ ...base, category: 'Almacén' })
    );

    await withCtx(() => updateProduct(creado.id, { category: 'Limpieza' }));

    const releido = await withCtx(() => getProductById(creado.id));
    expect(releido.category).toBe('Limpieza');
  });

  it('el rubro respeta el largo máximo del CHECK (64)', async () => {
    await expect(
      withCtx(() => createProduct({ ...base, category: 'x'.repeat(65) }))
    ).rejects.toThrow();
  });

  it('el rubro se recorta (no entra con espacios alrededor)', async () => {
    const creado = await withCtx(() =>
      createProduct({ ...base, category: '  Golosinas  ' })
    );
    expect(creado.category).toBe('Golosinas');
  });
});

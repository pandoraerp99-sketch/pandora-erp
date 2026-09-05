/**
 * T-SALES-06 — asociar un cliente del padrón a la venta.
 *
 * **La regla que este test protege.** `sales` guarda DOS cosas distintas:
 *   - `customer_id`: referencia al padrón — "quién era".
 *   - `customer_name_snapshot` / `customer_tax_condition_snapshot`: lo que
 *     DICE el comprobante, inmutable post-emisión (CLAUDE.md §2.3).
 *
 * Elegir un cliente NO puede reducirse a guardar el id: hay que copiar sus
 * datos al snapshot en ese momento. Si mañana el cliente pasa de Monotributo
 * a Responsable Inscripto, la factura vieja tiene que seguir diciendo lo que
 * decía. Un JOIN al padrón para imprimir un comprobante viejo sería un bug
 * fiscal, no una optimización.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema/companies';
import { users, company_users } from '@/lib/db/schema/users';
import { products } from '@/lib/db/schema/products';
import { customers } from '@/lib/db/schema/customers';
import { sales, sale_items } from '@/lib/db/schema/sales';
import { sale_payments } from '@/lib/db/schema/sale_payments';
import { stock_movements } from '@/lib/db/schema/stock_movements';
import { audit_log } from '@/lib/db/schema/audit';
import { withTracingContext } from '@/lib/tracing/context';
import { generateCorrelationId, generateRequestId } from '@/lib/tracing/ids';
import {
  createDraftSale,
  addItemToSale,
  setSaleCustomer,
  finalizeSale,
} from '@/lib/services/sales/sale.service';
import {
  createCustomer,
  updateCustomer,
} from '@/lib/services/customers/customer.service';

describe('T-SALES-06 — cliente asociado a la venta', () => {
  let tenantId: string;
  let userId: string;
  let productId: string;

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

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    productId = crypto.randomUUID();

    await db.insert(companies).values({
      id: tenantId,
      name: 'T-SALES-06 Co',
      legal_name: 'T-SALES-06 Co SRL',
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
      email: `t-sales-06-${tenantId.slice(0, 8)}@test.local`,
      full_name: 'Cajero T-SALES-06',
      is_support: false,
    });
    await db.insert(company_users).values({
      id: crypto.randomUUID(),
      company_id: tenantId,
      user_id: userId,
      role: 'cashier',
    });
    await db.insert(products).values({
      id: productId,
      tenant_id: tenantId,
      name: 'Producto T-SALES-06',
      unit_type: 'unidad',
      price: '100.0000',
      cost: '60.0000',
      tax_rate: '21.00',
      tdf_exempt: false,
      stock_current: '100.0000',
      stock_minimum: '5.0000',
      stock_tracking_enabled: true,
      is_active: true,
    });
  });

  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.delete(sale_payments).where(eq(sale_payments.tenant_id, tenantId));
      await tx.delete(stock_movements).where(eq(stock_movements.tenant_id, tenantId));
      await tx.delete(sale_items).where(eq(sale_items.tenant_id, tenantId));
      await tx.delete(sales).where(eq(sales.tenant_id, tenantId));
      await tx.delete(customers).where(eq(customers.tenant_id, tenantId));
      await tx.delete(audit_log).where(eq(audit_log.tenant_id, tenantId));
      await tx.delete(products).where(eq(products.tenant_id, tenantId));
      await tx.delete(company_users).where(eq(company_users.company_id, tenantId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(companies).where(eq(companies.id, tenantId));
    });
  });

  it('elegir un cliente del padrón guarda el id Y COPIA el snapshot', async () => {
    const cliente = await withCtx(() =>
      createCustomer({
        name: 'Distribuidora Austral',
        doc_type: 'CUIT',
        doc_number: '30712345678',
        tax_condition: 'responsable_inscripto',
      })
    );

    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      return setSaleCustomer({ sale_id: draft.id, customer_id: cliente.id });
    });

    // El id, para poder listar las compras del cliente...
    expect(venta.customer_id).toBe(cliente.id);
    // ...y el snapshot, que es lo que dice el comprobante.
    expect(venta.customer_name_snapshot).toBe('Distribuidora Austral');
    expect(venta.customer_doc_type).toBe('CUIT');
    expect(venta.customer_doc_number).toBe('30712345678');
    expect(venta.customer_tax_condition_snapshot).toBe('responsable_inscripto');
  });

  it('EL SNAPSHOT NO CAMBIA aunque el cliente cambie después', async () => {
    // Es la razón de ser del snapshot: una factura vieja no puede decir algo
    // distinto porque el cliente se recategorizó el año siguiente.
    const cliente = await withCtx(() =>
      createCustomer({
        name: 'Kiosco El Faro',
        doc_type: 'CUIT',
        doc_number: '20987654321',
        tax_condition: 'monotributo',
      })
    );

    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      await addItemToSale({
        sale_id: draft.id,
        product_id: productId,
        quantity: '1.0000',
      });
      await setSaleCustomer({ sale_id: draft.id, customer_id: cliente.id });
      return finalizeSale({
        sale_id: draft.id,
        payments: [{ method: 'efectivo', amount: '121.0000' }],
        require_fiscal_invoice: false,
      });
    });

    // El cliente cambia de condición fiscal y de nombre.
    await withCtx(() =>
      updateCustomer(cliente.id, {
        name: 'Kiosco El Faro SRL',
        tax_condition: 'responsable_inscripto',
      })
    );

    const [releida] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, venta.sale.id));

    // La venta sigue diciendo lo de ANTES.
    expect(releida?.customer_name_snapshot).toBe('Kiosco El Faro');
    expect(releida?.customer_tax_condition_snapshot).toBe('monotributo');
    // Y el vínculo con el padrón se mantiene.
    expect(releida?.customer_id).toBe(cliente.id);
  });

  it('sigue funcionando cargar el documento a mano, sin padrón', async () => {
    // El cajero tiene que poder facturar a alguien que no está en la agenda.
    const venta = await withCtx(async () => {
      const draft = await createDraftSale(userId, 1);
      return setSaleCustomer({
        sale_id: draft.id,
        doc_type: 'DNI',
        doc_number: '27345678',
        name: 'Cliente de paso',
      });
    });

    expect(venta.customer_id).toBeNull();
    expect(venta.customer_name_snapshot).toBe('Cliente de paso');
    expect(venta.customer_doc_number).toBe('27345678');
  });

  it('un cliente de OTRO comercio no se puede asociar', async () => {
    const otroTenant = crypto.randomUUID();
    await db.insert(companies).values({
      id: otroTenant,
      name: 'Ajeno',
      legal_name: 'Ajeno SRL',
      cuit: '20' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
      tax_regime: 'responsable_inscripto',
      merchant_jurisdiction_province: 'TIERRA_DEL_FUEGO',
      merchant_special_regime: null,
      afip_environment: 'homologacion',
      afip_sale_point: '0001',
      demo_status: 'trial',
    });
    const [ajeno] = await db
      .insert(customers)
      .values({ tenant_id: otroTenant, name: 'Cliente ajeno' })
      .returning();

    try {
      const draft = await withCtx(() => createDraftSale(userId, 1));
      await expect(
        withCtx(() => setSaleCustomer({ sale_id: draft.id, customer_id: ajeno!.id }))
      ).rejects.toThrow();
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
        await tx.delete(customers).where(eq(customers.tenant_id, otroTenant));
        await tx.delete(companies).where(eq(companies.id, otroTenant));
      });
    }
  });
});

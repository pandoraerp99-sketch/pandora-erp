'use server';

/**
 * Server Actions de Clientes. Mismo patrón que /productos: tracing + envelope,
 * cero lógica de negocio (eso vive en customer.service.ts).
 */
import { revalidatePath } from 'next/cache';
import { withServerActionTracing } from '@/lib/tracing/server-action-tracing';
import { DomainError } from '@/lib/multi_tenant/errors';
import {
  createCustomer,
  updateCustomer,
  deactivateCustomer,
  CustomerValidationError,
} from '@/lib/services/customers/customer.service';
import type { Customer } from '@/lib/db/schema/customers';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await withServerActionTracing(fn, { requireAuth: true });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof CustomerValidationError) {
      return {
        ok: false,
        error: e.messageEs,
        code: e.code,
        ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
      };
    }
    if (e instanceof DomainError) {
      return { ok: false, error: e.messageEs, code: e.code };
    }
    throw e;
  }
}

export interface CustomerFormInput {
  name: string;
  doc_type?: 'DNI' | 'CUIT' | 'CUIL' | 'none';
  doc_number?: string;
  tax_condition?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  tags?: string[];
}

export async function createCustomerAction(
  input: CustomerFormInput
): Promise<ActionResult<Customer>> {
  return runAction(async () => {
    const creado = await createCustomer(input);
    revalidatePath('/clientes');
    return creado;
  });
}

export async function updateCustomerAction(
  id: string,
  input: Partial<CustomerFormInput>
): Promise<ActionResult<Customer>> {
  return runAction(async () => {
    const actualizado = await updateCustomer(id, input);
    revalidatePath('/clientes');
    return actualizado;
  });
}

/** Baja LÓGICA: el cliente puede estar en ventas viejas, no se borra. */
export async function deactivateCustomerAction(
  id: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await deactivateCustomer(id);
    revalidatePath('/clientes');
    return null;
  });
}

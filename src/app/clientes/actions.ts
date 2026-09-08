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
import {
  getDebtorsWithAge,
  settleAccount,
  SETTLEMENT_METHODS,
  type SettlementMethod,
} from '@/lib/services/customers/account.service';
import { getActiveCashSession } from '@/lib/cash/sessions';

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

// F0: un unico punto de venta (Caja 1), igual que /caja y el POS.
const SALE_POINT = 1;

/** Lo que la pantalla necesita saber del cliente despues de cobrarle. */
export interface DeudaActualizada {
  saldo: string;
  dias: number | null;
}

/**
 * Registrar que un cliente pago (parte de) su cuenta corriente.
 *
 * El `cash_session_id` NO viaja desde el navegador: lo resuelve el servidor
 * con la caja abierta del punto de venta. Si el cliente pudiera elegir a que
 * caja imputar la plata, podria mandarla a una sesion vieja y ensuciar un
 * arqueo ya cerrado.
 *
 * Solo el EFECTIVO necesita caja: es plata que entra al cajon. Transferencia y
 * tarjeta no la tocan (si todo cobro fuera al cajon, el arqueo contaria plata
 * que nunca entro).
 *
 * Devuelve el saldo y la antiguedad RECALCULADOS por el servidor, no una
 * resta hecha en el navegador: el saldo sale del libro, y la antiguedad
 * depende de a que cargos se imputo el pago (FIFO). Restar en el cliente daria
 * un numero que despues no coincide al recargar.
 */
export async function settleAccountAction(input: {
  customerId: string;
  amount: string;
  method: SettlementMethod;
}): Promise<ActionResult<DeudaActualizada>> {
  return runAction(async () => {
    if (!SETTLEMENT_METHODS.includes(input.method)) {
      throw new CustomerValidationError('Medio de pago no válido');
    }

    let cashSessionId: string | undefined;
    if (input.method === 'efectivo') {
      const sesion = await getActiveCashSession(SALE_POINT);
      if (sesion === null) {
        throw new CustomerValidationError(
          'No hay una caja abierta. Un cobro en efectivo tiene que entrar a la caja del día.'
        );
      }
      cashSessionId = sesion.id;
    }

    await settleAccount({
      customer_id: input.customerId,
      amount: input.amount,
      method: input.method,
      ...(cashSessionId !== undefined ? { cash_session_id: cashSessionId } : {}),
    });

    const deuda = (await getDebtorsWithAge()).get(input.customerId);
    revalidatePath('/clientes');
    return {
      saldo: (deuda?.saldo ?? 0).toString(),
      dias: deuda?.dias ?? null,
    };
  });
}

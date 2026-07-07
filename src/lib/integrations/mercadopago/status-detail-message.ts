/**
 * Mapeo de `status_detail` de MercadoPago → mensaje claro para el CAJERO (rioplatense).
 * Sprint 5 Sales+MP — Integrations context.
 *
 * Idea de producto (CLAUDE.md §1.7 "el comerciante primero"): cuando un pago con
 * tarjeta se rechaza, el cajero necesita saber POR QUE en criollo para decidir que
 * hacer con el cliente (reintentar, pedir otra tarjeta, cobrar efectivo) — no un
 * "error 400" generico. MP ya nos da el motivo estructurado en `status_detail`.
 *
 * Codigos oficiales: repo oficial MP `mercadopago/cart-magento2`
 * (StatusDetailMessage.php) + doc "reasons for rejection" / "collection-results".
 *
 * `recoverable`:
 *   true  → reintentar con el MISMO medio puede funcionar (corregir datos, autorizar
 *           con el banco, esperar). El cajero puede reintentar.
 *   false → conviene OTRO medio (sin fondos, tarjeta inhabilitada, alto riesgo, etc.).
 *           El cajero debe pedir otra tarjeta o cobrar efectivo.
 */
export type StatusDetailCategory = 'approved' | 'pending' | 'rejected' | 'unknown';

export interface StatusDetailInfo {
  message: string;
  category: StatusDetailCategory;
  recoverable: boolean;
}

const MESSAGES: Record<string, StatusDetailInfo> = {
  // aprobado
  accredited: { message: 'Pago acreditado.', category: 'approved', recoverable: false },

  // pendiente / en proceso
  pending_contingency: {
    message: 'Estamos procesando el pago. Puede demorar unos minutos.',
    category: 'pending',
    recoverable: false,
  },
  pending_review_manual: {
    message: 'El pago está en revisión. Te avisamos cuando se apruebe.',
    category: 'pending',
    recoverable: false,
  },
  pending_waiting_payment: {
    message: 'Esperando que el cliente complete el pago.',
    category: 'pending',
    recoverable: true,
  },
  pending_waiting_transfer: {
    message: 'Esperando la transferencia del cliente.',
    category: 'pending',
    recoverable: true,
  },

  // rechazado — reintentable con el mismo medio
  cc_rejected_bad_filled_card_number: {
    message: 'Revisá el número de la tarjeta.',
    category: 'rejected',
    recoverable: true,
  },
  cc_rejected_bad_filled_date: {
    message: 'Revisá la fecha de vencimiento.',
    category: 'rejected',
    recoverable: true,
  },
  cc_rejected_bad_filled_security_code: {
    message: 'Revisá el código de seguridad.',
    category: 'rejected',
    recoverable: true,
  },
  cc_rejected_bad_filled_other: {
    message: 'Revisá los datos de la tarjeta.',
    category: 'rejected',
    recoverable: true,
  },
  cc_rejected_call_for_authorize: {
    message: 'El cliente tiene que autorizar el pago con su banco.',
    category: 'rejected',
    recoverable: true,
  },
  cc_rejected_card_error: {
    message: 'No pudimos procesar el pago. Probá de nuevo.',
    category: 'rejected',
    recoverable: true,
  },
  cc_rejected_invalid_installments: {
    message: 'La tarjeta no acepta esa cantidad de cuotas.',
    category: 'rejected',
    recoverable: true,
  },

  // rechazado — conviene otro medio
  cc_rejected_insufficient_amount: {
    message: 'La tarjeta no tiene fondos suficientes. Probá con otra.',
    category: 'rejected',
    recoverable: false,
  },
  cc_rejected_card_disabled: {
    message: 'La tarjeta está inhabilitada. El cliente debe llamar al banco.',
    category: 'rejected',
    recoverable: false,
  },
  cc_rejected_blacklist: {
    message: 'No pudimos procesar el pago. Probá otro medio.',
    category: 'rejected',
    recoverable: false,
  },
  cc_rejected_high_risk: {
    message: 'Pago rechazado. Recomendamos cobrar en efectivo.',
    category: 'rejected',
    recoverable: false,
  },
  cc_rejected_duplicated_payment: {
    message: 'Ya se hizo un pago por ese monto. Usá otra tarjeta u otro medio.',
    category: 'rejected',
    recoverable: false,
  },
  cc_rejected_max_attempts: {
    message: 'Se alcanzó el límite de intentos. Usá otra tarjeta u otro medio.',
    category: 'rejected',
    recoverable: false,
  },
  cc_rejected_other_reason: {
    message: 'El banco rechazó el pago. El cliente debe contactar al emisor.',
    category: 'rejected',
    recoverable: false,
  },
};

const UNKNOWN: StatusDetailInfo = {
  message: 'El pago no se pudo completar.',
  category: 'unknown',
  recoverable: false,
};

/**
 * Traduce un `status_detail` de MP a info accionable para el cajero.
 * Codigo desconocido / vacio → fallback generico seguro (nunca throw).
 */
export function statusDetailMessage(code: string | null | undefined): StatusDetailInfo {
  if (!code) return UNKNOWN;
  return MESSAGES[code.trim().toLowerCase()] ?? UNKNOWN;
}

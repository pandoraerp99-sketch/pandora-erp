/**
 * Resumen del período para la contadora.
 *
 * ── SOLO SALE LO QUE SE PUEDE CALCULAR ────────────────────────────────────
 * La maqueta muestra 12 paneles. Siete no tienen dato detrás: no existen
 * compras (así que no hay IVA crédito ni posición de IVA completa), ni plan de
 * cuentas, ni retenciones, ni extractos bancarios. Esos NO se dibujan vacíos:
 * un panel en cero se lee como "no hubo movimiento", que es una afirmación
 * distinta de "todavía no lo calculamos", y a un contador esa diferencia le
 * importa mucho.
 *
 * Lo que sí sale, sale del mismo lugar que el resto de la app: las ventas
 * cerradas, el libro de cuentas corrientes y los cierres de caja.
 *
 * ── ES SOLO LECTURA ───────────────────────────────────────────────────────
 * Acá no hay ninguna mutación, y no es un descuido: el rol `accountant` mira y
 * exporta. Pandora prepara borradores, la matriculada firma (Ley 20.488).
 */
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'accountant.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

export interface Periodo {
  /** Primer día, inclusive. */
  desde: Date;
  /** Primer día del mes siguiente, EXCLUSIVE. */
  hasta: Date;
  etiqueta: string;
}

/** El mes calendario de una fecha. Por defecto, el corriente. */
export function mesDe(fecha: Date = new Date()): Periodo {
  const desde = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1)
  );
  const hasta = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 1)
  );
  return {
    desde,
    hasta,
    etiqueta: new Intl.DateTimeFormat('es-AR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(desde),
  };
}

export interface ResumenContable {
  periodo: Periodo;
  ventas: {
    cantidad: number;
    /** Suma de `total`. Strings: es plata. */
    total: string;
    /** Neto gravado (base imponible). */
    neto: string;
    /** IVA débito fiscal. */
    iva: string;
    /** Exento — en TDF, lo amparado por Ley 19.640. */
    exento: string;
  };
  /** Cuánto se cobró con cada medio, en el período. */
  medios: Array<{ medio: string; total: string; cantidad: number }>;
  cuentasCorrientes: {
    /** Saldo deudor total, a HOY (no al cierre del período: es un stock). */
    porCobrar: string;
    deudores: number;
  };
  caja: {
    cierres: number;
    conDescuadre: number;
    /** Suma de los descuadres en valor absoluto. */
    descuadreTotal: string;
  };
}

/**
 * Todo el resumen en cuatro consultas, no una por tarjeta.
 *
 * Las ventas se filtran por estado cerrado (`cobrada`/`terminada`), igual que
 * el resto de la app: un carrito abandonado no es una venta, y para un
 * contador contarlo sería directamente un error de declaración.
 */
export async function getResumenContable(
  periodo: Periodo = mesDe()
): Promise<ResumenContable> {
  const tenantId = requireTenantId();
  // ISO strings, NO objetos Date: el driver (postgres-js) no sabe serializar
  // un Date como parametro y falla con 'Received an instance of Date' — un
  // error que no menciona la fecha ni la consulta. Se castea en el SQL.
  const desde = periodo.desde.toISOString();
  const hasta = periodo.hasta.toISOString();

  const [ventas] = await db.execute<{
    cantidad: number;
    total: string;
    neto: string;
    iva: string;
    exento: string;
  }>(
    sql`SELECT count(*)::int                        AS cantidad,
               coalesce(sum(total), 0)::text        AS total,
               coalesce(sum(subtotal), 0)::text     AS neto,
               coalesce(sum(tax_amount), 0)::text   AS iva,
               coalesce(sum(exempt_amount), 0)::text AS exento
        FROM sales
        WHERE tenant_id = ${tenantId}
          AND commercial_status IN ('cobrada', 'terminada')
          AND created_at >= ${desde}::timestamptz
          AND created_at <  ${hasta}::timestamptz`
  );

  const medios = await db.execute<{
    medio: string;
    total: string;
    cantidad: number;
  }>(
    sql`SELECT sp.method AS medio,
               sum(sp.amount)::text AS total,
               count(*)::int        AS cantidad
        FROM sale_payments sp
        JOIN sales s ON s.id = sp.sale_id
        WHERE s.tenant_id = ${tenantId}
          AND s.commercial_status IN ('cobrada', 'terminada')
          AND s.created_at >= ${desde}::timestamptz
          AND s.created_at <  ${hasta}::timestamptz
          -- Activo = fila que nadie apunta con su corrects_id. Es el mismo
          -- criterio que usa el cierre de caja: si se contaran las dos, un
          -- medio reclasificado aparecerian DOS veces.
          AND NOT EXISTS (
            SELECT 1 FROM sale_payments c WHERE c.corrects_id = sp.id
          )
        GROUP BY sp.method
        ORDER BY 2 DESC`
  );

  // El saldo deudor es un STOCK, no un flujo: es lo que deben HOY, no lo que
  // debían al cierre del período. Mezclarlo con las ventas del mes seria
  // comparar cosas distintas.
  const [deuda] = await db.execute<{ por_cobrar: string; deudores: number }>(
    sql`SELECT coalesce(sum(saldo), 0)::text AS por_cobrar,
               count(*)::int                 AS deudores
        FROM (
          SELECT customer_id,
                 sum(CASE WHEN type = 'payment' THEN -amount ELSE amount END) AS saldo
          FROM customer_account_movements
          WHERE tenant_id = ${tenantId}
          GROUP BY customer_id
          HAVING sum(CASE WHEN type = 'payment' THEN -amount ELSE amount END) > 0
        ) deudores`
  );

  const [caja] = await db.execute<{
    cierres: number;
    con_descuadre: number;
    descuadre_total: string;
  }>(
    // Se usa la columna `descuadre` que YA calculo el cierre, en vez de restar
    // final_amount - expected_amount otra vez. Recalcular seria una segunda
    // definicion del mismo numero, y cuando dos definiciones se separan gana
    // la que nadie mira.
    sql`SELECT count(*)::int AS cierres,
               count(*) FILTER (WHERE descuadre <> 0)::int      AS con_descuadre,
               coalesce(sum(abs(descuadre)), 0)::text           AS descuadre_total
        FROM cash_sessions
        WHERE tenant_id = ${tenantId}
          AND closed_at IS NOT NULL
          AND closed_at >= ${desde}::timestamptz
          AND closed_at <  ${hasta}::timestamptz`
  );

  return {
    periodo,
    ventas: {
      cantidad: ventas?.cantidad ?? 0,
      total: ventas?.total ?? '0',
      neto: ventas?.neto ?? '0',
      iva: ventas?.iva ?? '0',
      exento: ventas?.exento ?? '0',
    },
    medios: medios.map((m) => ({
      medio: m.medio,
      total: m.total,
      cantidad: m.cantidad,
    })),
    cuentasCorrientes: {
      porCobrar: deuda?.por_cobrar ?? '0',
      deudores: deuda?.deudores ?? 0,
    },
    caja: {
      cierres: caja?.cierres ?? 0,
      conDescuadre: caja?.con_descuadre ?? 0,
      descuadreTotal: caja?.descuadre_total ?? '0',
    },
  };
}

/**
 * Las ventas del período, línea por línea, para exportar.
 *
 * Sin límite a propósito: si el contador pide el mes, quiere el mes entero.
 * Recortarlo en silencio le daría una declaración incompleta, que es peor que
 * una consulta lenta.
 *
 * FALTA el número de comprobante, y se nota: para un contador es la columna
 * que ata cada línea con el libro IVA ventas. No está porque todavía no se
 * emite nada — vive en `fiscal_snapshots`, que se escribe recién cuando AFIP
 * devuelve el CAE. Se agrega en el mismo slice que enciende la emisión, no
 * antes: una columna vacía sería peor que su ausencia.
 */
export interface FilaExport {
  // Index signature: `db.execute<T>` exige que T sea indexable por string.
  [k: string]: string;
  fecha: string;
  cliente: string;
  doc: string;
  condicion: string;
  neto: string;
  iva: string;
  exento: string;
  total: string;
  medio: string;
}

export async function getVentasParaExport(
  periodo: Periodo = mesDe()
): Promise<FilaExport[]> {
  const tenantId = requireTenantId();
  return db.execute<FilaExport>(
    sql`SELECT to_char(s.created_at, 'YYYY-MM-DD')       AS fecha,
               coalesce(s.customer_name_snapshot, '')    AS cliente,
               coalesce(s.customer_doc_number, '')       AS doc,
               coalesce(s.customer_tax_condition_snapshot, '') AS condicion,
               s.subtotal::text      AS neto,
               s.tax_amount::text    AS iva,
               s.exempt_amount::text AS exento,
               s.total::text         AS total,
               coalesce(s.payment_method, '') AS medio
        FROM sales s
        WHERE s.tenant_id = ${tenantId}
          AND s.commercial_status IN ('cobrada', 'terminada')
          AND s.created_at >= ${periodo.desde.toISOString()}::timestamptz
          AND s.created_at <  ${periodo.hasta.toISOString()}::timestamptz
        ORDER BY s.created_at`
  );
}

/**
 * CSV con separador `;` y coma decimal.
 *
 * No es capricho: Excel en configuración regional argentina abre con `;` y lee
 * `1234,56` como número. Con `,` y punto decimal, el contador ve una sola
 * columna de texto y tiene que reimportar a mano — y ese es exactamente el
 * trabajo que esto viene a sacarle.
 */
export function armarCsv(filas: FilaExport[]): string {
  const cabecera = [
    'Fecha',
    'Cliente',
    'Documento',
    'Condición IVA',
    'Neto',
    'IVA',
    'Exento',
    'Total',
    'Medio de pago',
  ];

  const num = (v: string) => new Decimal(v || '0').toFixed(2).replace('.', ',');
  const txt = (v: string) =>
    /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

  const lineas = filas.map((f) =>
    [
      f.fecha,
      txt(f.cliente),
      txt(f.doc),
      txt(f.condicion),
      num(f.neto),
      num(f.iva),
      num(f.exento),
      num(f.total),
      txt(f.medio),
    ].join(';')
  );

  // BOM: sin el, Excel abre el archivo en ANSI y rompe los acentos y la ñ.
  return '﻿' + [cabecera.join(';'), ...lineas].join('\r\n') + '\r\n';
}

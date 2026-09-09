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
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { csvArmar, csvNum, csvTxt } from './csv.js';

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

/**
 * Los tres de la maqueta, más `ejercicio`.
 *
 * `ejercicio` NO estaba: lo trajo el pedido real de la contadora, que es por el
 * "ejercicio iniciado el 01/08/2025 y finalizado el 31/07/2026". Para esa
 * empresa, ninguno de los otros tres coincide con el balance.
 */
export const GRANOS = ['mes', 'trimestre', 'anio', 'ejercicio'] as const;
export type Grano = (typeof GRANOS)[number];

/**
 * El período que corresponde a un grano.
 *
 * Trimestre y año son CALENDARIO (ene-mar, abr-jun...), no "los ultimos 3
 * meses": el contador declara por trimestre calendario, y un rango movil le
 * daria un numero que no coincide con ninguna presentacion.
 */
export function periodoDe(
  grano: Grano,
  fecha: Date = new Date(),
  /**
   * Mes de cierre del ejercicio (1-12), de `companies.fiscal_year_end_month`.
   * Sólo lo usa el grano `ejercicio`. El default 12 hace que sin el dato el
   * ejercicio sea el año calendario anterior — que es lo correcto para la
   * mayoría, y visible en la etiqueta si no lo fuera.
   */
  mesCierreEjercicio = 12
): Periodo {
  if (grano === 'mes') return mesDe(fecha);
  if (grano === 'ejercicio') return periodoDeEjercicio(mesCierreEjercicio, fecha);

  const y = fecha.getUTCFullYear();
  if (grano === 'anio') {
    return {
      desde: new Date(Date.UTC(y, 0, 1)),
      hasta: new Date(Date.UTC(y + 1, 0, 1)),
      etiqueta: String(y),
    };
  }

  const primerMes = Math.floor(fecha.getUTCMonth() / 3) * 3;
  const trimestre = primerMes / 3 + 1;
  return {
    desde: new Date(Date.UTC(y, primerMes, 1)),
    hasta: new Date(Date.UTC(y, primerMes + 3, 1)),
    etiqueta: `${trimestre}º trimestre ${y}`,
  };
}

/**
 * El último ejercicio CERRADO, dado el mes en que la empresa cierra.
 *
 * ── POR QUE EL CERRADO Y NO EL EN CURSO ───────────────────────────────────
 * Los otros tres granos devuelven el período CORRIENTE (este mes, este
 * trimestre, este año). Éste devuelve el ANTERIOR, a propósito: un ejercicio
 * sirve cuando terminó. Es el recorte con el que la contadora arma el balance
 * y el que pide por escrito; el ejercicio en curso no tiene destinatario.
 *
 * Que rompa la simetría con los otros tres es incómodo, y por eso la pantalla
 * muestra el rango exacto al lado del título en vez de decir sólo "Ejercicio".
 *
 * ── EL MES, NO LA FECHA ───────────────────────────────────────────────────
 * `mesCierre` es 1-12 y se asume el ÚLTIMO DÍA de ese mes (ver migration
 * 0027). Con mesCierre=7 y hoy en septiembre de 2026, el último cerrado va del
 * 01/08/2025 al 31/07/2026 — que es exactamente el del pedido.
 *
 * `hasta` es EXCLUSIVE (el 01/08/2026), como en el resto de este archivo: así
 * el rango no depende de cuántos días tiene el mes ni de la hora del día.
 */
export function periodoDeEjercicio(
  mesCierre: number,
  fecha: Date = new Date()
): Periodo {
  if (!Number.isInteger(mesCierre) || mesCierre < 1 || mesCierre > 12) {
    throw new RangeError(
      `mesCierre tiene que ser un mes (1-12), llegó ${String(mesCierre)}`
    );
  }

  // El ejercicio en curso TERMINA el último día de `mesCierre`. Si hoy ya pasó
  // ese mes, el último cerrado es el de este año; si todavía no llegó, es el
  // del año pasado.
  //   mesCierre=7, hoy sep-2026  -> cerró el 31/07/2026 (ya pasó)
  //   mesCierre=7, hoy may-2026  -> cerró el 31/07/2025 (todavía no llegó)
  const y = fecha.getUTCFullYear();
  const mesActual = fecha.getUTCMonth() + 1; // 1-12
  const anioDeCierre = mesActual > mesCierre ? y : y - 1;

  // Fin EXCLUSIVE = el día 1 del mes SIGUIENTE al de cierre. `Date.UTC` con
  // mes 12 rueda solo al enero siguiente, así que diciembre no es un caso
  // aparte.
  const hasta = new Date(Date.UTC(anioDeCierre, mesCierre, 1));
  const desde = new Date(Date.UTC(anioDeCierre - 1, mesCierre, 1));

  const ultimoDia = new Date(hasta.getTime() - 86400000);
  const dma = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

  return {
    desde,
    hasta,
    etiqueta: `ejercicio ${dma(desde)} al ${dma(ultimoDia)}`,
  };
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
  /**
   * Gastos del período. `credito` es el IVA computable: SOLO de los gastos con
   * comprobante fiscal (`en_iva_compras`). Un gasto sin factura no da credito
   * por mas IVA que tenga adentro el precio.
   */
  gastos: {
    total: string;
    cantidad: number;
    credito: string;
    /** Cuantos gastos aportan credito fiscal. */
    comprobantes: number;
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

  const [gastos] = await db.execute<{
    total: string;
    cantidad: number;
    credito: string;
    comprobantes: number;
  }>(
    sql`SELECT coalesce(sum(total), 0)::text AS total,
               count(*)::int                 AS cantidad,
               coalesce(sum(iva) FILTER (WHERE en_iva_compras), 0)::text AS credito,
               count(*) FILTER (WHERE en_iva_compras)::int              AS comprobantes
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND fecha >= ${desde}::date AND fecha < ${hasta}::date`
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
    gastos: {
      total: gastos?.total ?? '0',
      cantidad: gastos?.cantidad ?? 0,
      credito: gastos?.credito ?? '0',
      comprobantes: gastos?.comprobantes ?? 0,
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
  // La receta (separador, decimales, CRLF, BOM) vive en `csv.ts` y la comparte
  // con el export de gastos. Dos copias derivan, y el test de cada una pasa
  // igual porque mide su propio archivo, no el otro.
  return csvArmar(
    [
      'Fecha',
      'Cliente',
      'Documento',
      'Condición IVA',
      'Neto',
      'IVA',
      'Exento',
      'Total',
      'Medio de pago',
    ],
    filas.map((f) => [
      f.fecha,
      csvTxt(f.cliente),
      csvTxt(f.doc),
      csvTxt(f.condicion),
      csvNum(f.neto),
      csvNum(f.iva),
      csvNum(f.exento),
      csvNum(f.total),
      csvTxt(f.medio),
    ])
  );
}

export interface DeudorDelPeriodo {
  // Index signature: db.execute<T> exige que T sea indexable por string.
  [k: string]: string;
  nombre: string;
  saldo: string;
}

/**
 * Los que deben, con nombre, para la tarjeta de cuentas corrientes.
 *
 * Es un STOCK (lo que deben hoy), no del periodo: la deuda no se reinicia
 * cada mes. Va aparte del resumen porque son filas, no un total.
 */
export async function getDeudores(limite = 6): Promise<DeudorDelPeriodo[]> {
  const tenantId = requireTenantId();
  return db.execute<DeudorDelPeriodo>(
    sql`SELECT c.name AS nombre,
               sum(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END)::text AS saldo
        FROM customer_account_movements m
        JOIN customers c ON c.id = m.customer_id
        WHERE m.tenant_id = ${tenantId}
        GROUP BY c.id, c.name
        HAVING sum(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END) > 0
        ORDER BY 2 DESC
        LIMIT ${limite}`
  );
}

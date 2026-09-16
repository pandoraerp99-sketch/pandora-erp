/**
 * Lo que la contadora pide **a la fecha de cierre**: caja (ítem 1) y deudores
 * con CUIT (ítem 5).
 *
 * ── POR QUE NO ALCANZABA CON LO QUE YA HABIA ──────────────────────────────
 * Los dos ítems figuraban ✅ en la evidencia, y el dato está en la base — pero
 * ninguna pantalla lo entregaba:
 *   - de caja, `getResumenContable` devuelve cuántos cierres hubo y el
 *     descuadre; el **saldo** no salía por ningún lado;
 *   - `getDeudores` calcula el saldo **a HOY**, sin CUIT y sin export. El
 *     balance necesita el saldo **al 31/07**.
 *
 * Es una FOTO a un día, como el inventario del ítem 8, no un flujo del período.
 * La aritmética y los estados viven en `domain/caja-al-cierre.ts` (puros).
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireTracingContext } from '../../tracing/context.js';
import { CrossTenantAccessError } from '../../multi_tenant/errors.js';
import { csvArmar, csvNum, csvTxt } from './csv.js';
import { TZ_COMERCIO } from './panel.report.js';
import {
  armarCajaAlCierre,
  type CajaAbierta,
  type CajaAlCierre,
  type ArqueoDePunto,
} from '../../domain/caja-al-cierre.js';

function requireTenantId(): string {
  const ctx = requireTracingContext();
  if (!ctx.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'cierre.report (sin tenant en el context)'
    );
  }
  return ctx.tenant_id;
}

/**
 * El instante en que TERMINA, en Ushuaia, el día de cierre — o sea el comienzo
 * del día siguiente. Todo lo de acá compara `< finDelDia`.
 *
 * Contra `timestamptz` no se puede comparar con la medianoche UTC: el día del
 * comercio arranca a las 03:00 UTC, así que un cierre de caja de las 22:00 del
 * 31/07 caería del lado de agosto y desaparecería del ejercicio.
 */
function finDelDia(fechaCierre: string) {
  return sql`((${fechaCierre}::date + 1)::timestamp AT TIME ZONE ${TZ_COMERCIO})`;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function exigirFecha(fechaCierre: string): void {
  if (!FECHA_ISO.test(fechaCierre)) {
    throw new RangeError(
      `fechaCierre tiene que ser 'AAAA-MM-DD', llegó ${JSON.stringify(fechaCierre)}`
    );
  }
}

/**
 * El saldo de caja a la fecha: el último arqueo de CADA punto de venta.
 *
 * `DISTINCT ON (sale_point)` con `ORDER BY sale_point, closed_at DESC` devuelve
 * exactamente una fila por caja: la del cierre más fresco que entra en la fecha.
 * Sumar todos los cierres del período daría la suma de todos los turnos del año,
 * que no es un saldo de nada.
 */
export async function getCajaAlCierre(fechaCierre: string): Promise<CajaAlCierre> {
  exigirFecha(fechaCierre);
  const tenantId = requireTenantId();

  const arqueos = await db.execute<{
    punto: number;
    fecha: string;
    contado: string;
    descuadre: string;
  }>(sql`
    SELECT DISTINCT ON (sale_point)
           sale_point AS punto,
           to_char(closed_at AT TIME ZONE ${TZ_COMERCIO}, 'YYYY-MM-DD') AS fecha,
           final_amount::text AS contado,
           descuadre::text    AS descuadre
      FROM cash_sessions
     WHERE tenant_id = ${tenantId}
       AND closed_at IS NOT NULL
       AND closed_at < ${finDelDia(fechaCierre)}
     ORDER BY sale_point, closed_at DESC
  `);

  // Las que en ese instante estaban ABIERTAS. Incluye las que cerraron después:
  // al cierre del ejercicio esa plata todavía no se había contado, así que para
  // el balance no hay número — aunque hoy exista uno.
  const abiertas = await db.execute<{
    punto: number;
    desde: string;
    cerro_despues: string | null;
  }>(sql`
    SELECT sale_point AS punto,
           to_char(opened_at AT TIME ZONE ${TZ_COMERCIO}, 'YYYY-MM-DD') AS desde,
           CASE WHEN closed_at IS NULL THEN NULL
                ELSE to_char(closed_at AT TIME ZONE ${TZ_COMERCIO}, 'YYYY-MM-DD')
           END AS cerro_despues
      FROM cash_sessions
     WHERE tenant_id = ${tenantId}
       AND opened_at < ${finDelDia(fechaCierre)}
       AND (closed_at IS NULL OR closed_at >= ${finDelDia(fechaCierre)})
     ORDER BY sale_point, opened_at
  `);

  return armarCajaAlCierre({
    fechaCierre,
    arqueos: arqueos.map(
      (a): ArqueoDePunto => ({
        punto: a.punto,
        fecha: a.fecha,
        contado: a.contado,
        descuadre: a.descuadre,
      })
    ),
    abiertas: abiertas.map(
      (a): CajaAbierta => ({
        punto: a.punto,
        desde: a.desde,
        cerroDespues: a.cerro_despues,
      })
    ),
  });
}

export interface DeudorAlCierre {
  // Index signature: `db.execute<T>` exige que T sea indexable por string.
  [k: string]: string;
  nombre: string;
  /** 'cuit' | 'dni' | 'none' — de `customers.doc_type`. */
  doc_tipo: string;
  doc_numero: string;
  saldo: string;
}

/**
 * Los deudores **a la fecha de cierre**, con razón social, documento e importe
 * — las tres columnas que pide el ítem 5, textual.
 *
 * ── EL CORTE ES POR FECHA DE REGISTRACION, Y SE DECLARA ───────────────────
 * El libro de cuenta corriente (ADR-0027) no tiene fecha de negocio: sólo
 * `created_at`, cuándo se cargó el movimiento. Un fiado del 30/07 cargado el
 * 02/08 cae en el ejercicio siguiente. Es una limitación real y la aclara el
 * CSV, igual que el de proveedores aclara la suya. Agregar la columna de fecha
 * es una migración que este pedido no bloquea.
 *
 * El saldo se calcula (nunca se guarda) con la MISMA expresión que el resto de
 * la app: el signo lo da el `type`, porque `amount` es siempre positivo.
 */
export async function getDeudoresAlCierre(
  fechaCierre: string
): Promise<DeudorAlCierre[]> {
  exigirFecha(fechaCierre);
  const tenantId = requireTenantId();

  return db.execute<DeudorAlCierre>(sql`
    SELECT c.name                       AS nombre,
           c.doc_type                   AS doc_tipo,
           COALESCE(c.doc_number, '')   AS doc_numero,
           SUM(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END)::text AS saldo
      FROM customer_account_movements m
      JOIN customers c ON c.id = m.customer_id
     WHERE m.tenant_id = ${tenantId}
       AND m.created_at < ${finDelDia(fechaCierre)}
     GROUP BY c.id, c.name, c.doc_type, c.doc_number
    HAVING SUM(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END) > 0
     ORDER BY SUM(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END) DESC,
              c.name
  `);
}

/**
 * `customers.doc_type` ya viene como lo lee un humano ('DNI' | 'CUIT' | 'CUIL'
 * | 'none', por el CHECK de la migration 0023). Sólo hay que traducir el
 * 'none': un mapa de etiquetas sería una segunda lista que puede derivar de la
 * del CHECK sin que ningún test lo note.
 */
function etiquetaDoc(docTipo: string): string {
  return docTipo === 'none' ? 'sin documento' : docTipo;
}

/**
 * El CSV que va al estudio.
 *
 * La advertencia del corte va AL PIE y no en la primera celda: la columna A es
 * la que se ordena y filtra en Excel, y tiene que llamarse "Cliente". Mismo
 * lugar que la nota del inventario y la del CSV de proveedores.
 */
export function armarCsvDeudores(
  fechaCierre: string,
  filas: DeudorAlCierre[]
): string {
  const tabla = csvArmar(
    ['Cliente', 'Tipo de documento', 'Documento', 'Saldo deudor'],
    filas.map((f) => [
      csvTxt(f.nombre),
      csvTxt(etiquetaDoc(f.doc_tipo)),
      csvTxt(f.doc_numero),
      csvNum(f.saldo),
    ])
  );

  const nota =
    `Deudores al ${fechaCierre}. ` +
    'El corte usa la fecha en que se REGISTRO cada movimiento: el libro de ' +
    'cuenta corriente no guarda la fecha de la operacion. Un fiado del 30/07 ' +
    'cargado el 02/08 cuenta en el ejercicio siguiente.';
  return `${tabla}\r\n${csvTxt(nota)}\r\n`;
}

/**
 * El CSV de la caja: una fila por punto de venta, con la fecha de SU arqueo.
 *
 * Las cajas que quedaron abiertas también salen, **sin importe**: que el estudio
 * vea que faltó contar una caja es el dato, no un renglón de menos.
 */
export function armarCsvCaja(caja: CajaAlCierre): string {
  const filas: string[][] = caja.puntos.map((p) => [
    String(p.punto),
    p.fecha,
    csvNum(p.contado),
    csvNum(p.descuadre),
    p.fecha === caja.fecha ? 'arqueo del dia' : 'ultimo arqueo anterior',
  ]);

  for (const a of caja.abiertas) {
    filas.push([
      String(a.punto),
      '',
      '',
      '',
      a.cerroDespues === null
        ? `caja abierta desde el ${a.desde}: nunca se conto`
        : `caja abierta al cierre (se conto recien el ${a.cerroDespues})`,
    ]);
  }

  const tabla = csvArmar(
    ['Punto de venta', 'Fecha del arqueo', 'Efectivo contado', 'Descuadre', 'Estado'],
    filas
  );

  const nota =
    `Saldo de caja al ${caja.fecha}. Es el EFECTIVO contado en el arqueo ` +
    'de cada caja. Lo cobrado con tarjeta, QR o transferencia no esta en el ' +
    'cajon: es un credito contra el banco o la billetera.';
  return `${tabla}\r\n${csvTxt(nota)}\r\n`;
}

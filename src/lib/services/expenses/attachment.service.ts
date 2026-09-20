/**
 * Adjuntar el comprobante a un gasto (ítem 12, slice 2).
 *
 * El slice 1 dejó la base: bucket privado, tabla append-only, RLS por el
 * primer segmento del path y FK compuestas. Esto es lo que finalmente escribe
 * y lee esos bytes.
 *
 * ── QUIÉN DECIDE EL PATH ──────────────────────────────────────────────────
 * El `tenant_id` del path sale de `ctx()` (AsyncLocalStorage), NUNCA de un
 * argumento. No es estilo: una firma `adjuntarComprobante(tenantId, ...)`
 * pondría el límite entre comercios en manos de quien llama, y nada más lo
 * atraparía. La FK compuesta de la 0041 sí atrapa un `expense_id` ajeno, pero
 * no mira el path; el test T-ADJ-01 del slice 1 insertaba las filas de
 * `storage.objects` a mano, así que probó "la policy es correcta si el path es
 * correcto" y no que el path se arme bien. Eso lo prueba T-ADJ-02.
 *
 * Quedan dos capas, no una:
 *   1. el path lo arma el servidor desde el context
 *   2. el almacén usa el cliente del USUARIO, así que la policy
 *      `comprobantes_tenant_insert` vuelve a comparar el primer segmento
 *      contra `current_company_ids()` (ver `attachment.storage.ts`)
 *
 * ── ORDEN: PRIMERO EL ARCHIVO, DESPUÉS LA FILA ────────────────────────────
 * Si se cae entre medio, las dos mitades fallan distinto:
 *   - objeto sin fila → bytes que nadie ve ni encuentra. Invisible.
 *   - fila sin objeto → la pantalla dice "comprobante adjunto" y no hay nada.
 *     Eso es mentirle a la contadora en la única pantalla donde vino a
 *     buscarlo.
 * Además, insertar primero obligaría a tener la transacción abierta durante
 * una subida HTTP, que es lo que CLAUDE.md §15.2 dice que no se hace.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../../db/client.js';
import {
  attachments,
  MAX_BYTES_ADJUNTO,
  TIPOS_DE_ARCHIVO_PERMITIDOS,
} from '../../db/schema/attachments.js';
import { expenses } from '../../db/schema/expenses.js';
import { terceros } from '../../db/schema/terceros.js';
import type { AlmacenDeComprobantes } from './attachment.storage.js';
import { requireTracingContext } from '../../tracing/context.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { CrossTenantAccessError, DomainError } from '../../multi_tenant/errors.js';
import { logger } from '../../observability/logger.js';

/**
 * Cuánto vive el link de descarga.
 *
 * Una URL firmada es un BEARER TOKEN: el que la tiene baja el archivo, sin
 * login y sin RLS, hasta que vence. Se elige corto a propósito —el usuario
 * hace click y el navegador va al toque— en vez de tomar el default de la
 * librería, que es una decisión que no tomó nadie.
 *
 * Por lo mismo la URL NO se loguea: un contrato de locación lleva los datos
 * personales del locador (B-11), y eso cae en la lista del CLAUDE.md §10.5.
 */
export const SEGUNDOS_DE_VIDA_DEL_LINK = 60;

export class AttachmentError extends DomainError {
  constructor(messageEs: string, code = 'ATTACHMENT_ERROR') {
    super(code, messageEs, 400);
  }
}

function ctx() {
  const c = requireTracingContext();
  if (!c.tenant_id) {
    throw new CrossTenantAccessError(
      'desconocido',
      null,
      'attachment.service (sin tenant en el context)'
    );
  }
  if (!c.actor_user_id) {
    throw new AttachmentError('No hay usuario en la sesión', 'SIN_USUARIO');
  }
  return { tenantId: c.tenant_id, userId: c.actor_user_id };
}

export interface ArchivoASubir {
  nombre: string;
  /** Lo que DECLARA el navegador. No está verificado contra el contenido. */
  contentType: string;
  bytes: Uint8Array;
}

export interface AdjuntoDeGasto {
  id: string;
  nombre_original: string;
  content_type: string;
  bytes: number;
  created_at: Date;
  /**
   * `false` cuando la fila existe pero el objeto no está en el bucket.
   * Ver `listarAdjuntosDeGasto`.
   */
  archivo_presente: boolean;
}

/**
 * Valida lo que se puede validar sin tocar la base ni el storage.
 *
 * Separado y puro para poder probar los bordes (vacío, 15MB+1, un .exe
 * renombrado) sin levantar nada.
 *
 * ⚠️ `contentType` es lo que declara el navegador en el `FormData`. Acá NO se
 * inspecciona el contenido, así que esto NO prueba que un `application/pdf`
 * sea un PDF. El riesgo es bajo porque el archivo se guarda y se devuelve,
 * nunca se ejecuta ni se parsea — pero queda dicho en vez de dejar creer que
 * el tipo se verificó.
 */
export function validarArchivo(archivo: ArchivoASubir): string | null {
  if (archivo.bytes.byteLength === 0) {
    return 'El archivo está vacío';
  }
  if (archivo.bytes.byteLength > MAX_BYTES_ADJUNTO) {
    const mb = (MAX_BYTES_ADJUNTO / 1024 / 1024).toFixed(0);
    return `El archivo supera los ${mb} MB`;
  }
  if (!(TIPOS_DE_ARCHIVO_PERMITIDOS as readonly string[]).includes(archivo.contentType)) {
    return 'Sólo se puede adjuntar PDF o una foto (JPG, PNG, WEBP, HEIC)';
  }
  if (archivo.nombre.trim() === '') {
    return 'El archivo no tiene nombre';
  }
  return null;
}

/**
 * Sube el comprobante de un gasto y deja la fila que lo referencia.
 *
 * NO recibe `tenant_id`: ver el encabezado.
 */
export async function adjuntarComprobante(
  input: { expense_id: string; archivo: ArchivoASubir },
  almacen: AlmacenDeComprobantes
): Promise<{ id: string; storage_path: string }> {
  const { tenantId, userId } = ctx();

  const problema = validarArchivo(input.archivo);
  if (problema !== null) {
    throw new AttachmentError(problema, 'ARCHIVO_INVALIDO');
  }

  // Se chequea ANTES de subir aunque la FK compuesta de la 0041 ya lo impida
  // al insertar: sin esto, un expense_id ajeno o inexistente deja los bytes
  // arriba y recién falla al final. El chequeo no es la garantía —la garantía
  // es la FK— pero evita el huérfano en el caso que sí pasa seguido: un gasto
  // que se anuló en otra pestaña.
  const [gasto] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, input.expense_id), eq(expenses.tenant_id, tenantId)))
    .limit(1);

  if (!gasto) {
    throw new AttachmentError('Ese gasto no existe', 'GASTO_NO_ENCONTRADO');
  }

  // El id se genera acá porque el path lo necesita antes del INSERT, y porque
  // el nombre en el bucket NO puede ser el del usuario: dos "factura.pdf" se
  // pisarían, y un nombre que viene de afuera es por donde entra un `../`.
  const id = crypto.randomUUID();
  const storagePath = `${tenantId}/${id}`;

  const sha256 = createHash('sha256').update(input.archivo.bytes).digest('hex');

  const { error: errorSubida } = await almacen.subir(
    storagePath,
    input.archivo.bytes,
    input.archivo.contentType
  );

  if (errorSubida) {
    logger.error(
      { err: errorSubida, expense_id: input.expense_id },
      'no se pudo subir el comprobante al bucket'
    );
    throw new AttachmentError('No se pudo guardar el archivo', 'FALLO_SUBIDA');
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(attachments).values({
        id,
        tenant_id: tenantId,
        tipo: 'comprobante',
        expense_id: input.expense_id,
        nombre_original: input.archivo.nombre,
        content_type: input.archivo.contentType,
        bytes: input.archivo.bytes.byteLength,
        sha256,
        storage_path: storagePath,
        uploaded_by: userId,
      });

      await writeAuditLog(
        {
          event_name: 'expense.attachment_added',
          payload: {
            attachment_id: id,
            expense_id: input.expense_id,
            nombre_original: input.archivo.nombre,
            content_type: input.archivo.contentType,
            bytes: input.archivo.bytes.byteLength,
            // El hash identifica el contenido sin guardarlo: alcanza para
            // decir años después "el archivo es el que se subió".
            sha256,
          },
          pii_level: 'pii_high',
        },
        tx
      );
    });
  } catch (e) {
    // Compensación: la fila no entró, así que los bytes que quedaron arriba no
    // los referencia nadie. Se borran — y si el borrado TAMBIÉN falla, se
    // grita. Un catch mudo acá dejaría basura invisible en el bucket para
    // siempre y nadie se enteraría nunca (CLAUDE.md §20.4).
    const { error: errorBorrado } = await almacen.borrar(storagePath);
    if (errorBorrado) {
      logger.error(
        { storage_path: storagePath, err: errorBorrado },
        'quedó un objeto HUÉRFANO en el bucket: falló el insert y también la compensación'
      );
    }
    throw e;
  }

  return { id, storage_path: storagePath };
}

/**
 * Los comprobantes vigentes de un gasto, diciendo cuáles están de verdad.
 *
 * `archivo_presente` existe porque la fila y el objeto viven en dos lugares
 * distintos y pueden divergir (un borrado manual desde el dashboard de
 * Supabase, una restauración de base sin el bucket). Sin este chequeo la
 * pantalla mostraría "comprobante adjunto" y el click terminaría en un 404 —
 * el resultado de imagen rota que el brief §7 descartó.
 *
 * Cuesta una llamada al almacén por adjunto. Es aceptable porque un gasto
 * tiene uno o dos comprobantes, no cien; si deja de ser cierto, esto pasa a
 * ser una sola llamada por carpeta.
 */
export async function listarAdjuntosDeGasto(
  expenseId: string,
  almacen: AlmacenDeComprobantes
): Promise<AdjuntoDeGasto[]> {
  const { tenantId } = ctx();

  const filas = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.tenant_id, tenantId),
        eq(attachments.expense_id, expenseId),
        isNull(attachments.removed_at)
      )
    );

  return Promise.all(
    filas.map(async (f) => {
      const esta = await almacen.existe(f.tenant_id, f.id);
      if (esta === null) {
        // No se pudo preguntar. NO se asume que está: decir "está" sin saberlo
        // es volver al 404 que esto viene a evitar.
        logger.warn(
          { attachment_id: f.id },
          'no se pudo verificar si el comprobante está en el bucket'
        );
      }
      return {
        id: f.id,
        nombre_original: f.nombre_original,
        content_type: f.content_type,
        bytes: f.bytes,
        created_at: f.created_at,
        archivo_presente: esta === true,
      };
    })
  );
}

/**
 * El contrato que respalda los pagos a un proveedor (slice 3).
 *
 * ── Por qué es otra función y no un parámetro de la de arriba ─────────────
 * Comparten el mecanismo —validar, hashear, subir, insertar, compensar— pero
 * no comparten las reglas: un comprobante cuelga del GASTO y no lleva
 * vigencia; un contrato cuelga del TERCERO y sin vigencia no sirve para lo que
 * se lo pide. El CHECK de la 0040 ya impide mezclarlos, así que una sola
 * función con banderas terminaría armando estados que la base rechaza.
 *
 * ── La vigencia NO decide si el contrato cuenta ───────────────────────────
 * Un contrato vencido siguió respaldando los doce pagos que cubrió. Igual que
 * "lo pagado" no es "lo gastado", *cuándo rige* no es *si vale*: por eso los
 * vencidos se listan igual, marcados, y no se esconden.
 */
export async function adjuntarContrato(
  input: {
    tercero_id: string;
    archivo: ArchivoASubir;
    vigencia_desde: string;
    vigencia_hasta: string;
  },
  almacen: AlmacenDeComprobantes
): Promise<{ id: string; storage_path: string }> {
  const { tenantId, userId } = ctx();

  const problema = validarArchivo(input.archivo);
  if (problema !== null) {
    throw new AttachmentError(problema, 'ARCHIVO_INVALIDO');
  }

  if (input.vigencia_hasta < input.vigencia_desde) {
    throw new AttachmentError(
      'La vigencia termina antes de empezar',
      'VIGENCIA_INVALIDA'
    );
  }

  const [tercero] = await db
    .select({ id: terceros.id })
    .from(terceros)
    .where(and(eq(terceros.id, input.tercero_id), eq(terceros.tenant_id, tenantId)))
    .limit(1);

  if (!tercero) {
    throw new AttachmentError('Ese proveedor no existe', 'TERCERO_NO_ENCONTRADO');
  }

  const id = crypto.randomUUID();
  const storagePath = `${tenantId}/${id}`;
  const sha256 = createHash('sha256').update(input.archivo.bytes).digest('hex');

  const { error: errorSubida } = await almacen.subir(
    storagePath,
    input.archivo.bytes,
    input.archivo.contentType
  );
  if (errorSubida) {
    logger.error(
      { err: errorSubida, tercero_id: input.tercero_id },
      'no se pudo subir el contrato al bucket'
    );
    throw new AttachmentError('No se pudo guardar el archivo', 'FALLO_SUBIDA');
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(attachments).values({
        id,
        tenant_id: tenantId,
        tipo: 'contrato',
        tercero_id: input.tercero_id,
        nombre_original: input.archivo.nombre,
        content_type: input.archivo.contentType,
        bytes: input.archivo.bytes.byteLength,
        sha256,
        storage_path: storagePath,
        vigencia_desde: input.vigencia_desde,
        vigencia_hasta: input.vigencia_hasta,
        uploaded_by: userId,
      });

      await writeAuditLog(
        {
          // El mismo evento del catálogo, que es cerrado: un contrato es un
          // adjunto del dominio gastos igual que un comprobante. Lo que cambia
          // es de qué cuelga, y eso lo dice el payload.
          event_name: 'expense.attachment_added',
          payload: {
            attachment_id: id,
            tipo: 'contrato',
            tercero_id: input.tercero_id,
            nombre_original: input.archivo.nombre,
            content_type: input.archivo.contentType,
            bytes: input.archivo.bytes.byteLength,
            vigencia_desde: input.vigencia_desde,
            vigencia_hasta: input.vigencia_hasta,
            sha256,
          },
          // Un contrato de locación lleva los datos personales del locador
          // (B-11, pendiente del abogado). Mismo nivel que el comprobante, y
          // el payload no suma nada de eso más allá de lo que ya hay.
          pii_level: 'pii_high',
        },
        tx
      );
    });
  } catch (e) {
    const { error: errorBorrado } = await almacen.borrar(storagePath);
    if (errorBorrado) {
      logger.error(
        { storage_path: storagePath, err: errorBorrado },
        'quedó un objeto HUÉRFANO en el bucket: falló el insert del contrato y también la compensación'
      );
    }
    throw e;
  }

  return { id, storage_path: storagePath };
}

export interface ContratoDeTercero extends AdjuntoDeGasto {
  vigencia_desde: string | null;
  vigencia_hasta: string | null;
  /** `true` si la vigencia ya terminó. NO significa que no valga. */
  vencido: boolean;
}

/**
 * Los contratos vigentes de un proveedor, los vencidos incluidos.
 *
 * `hoy` entra por parámetro y no se lee acá adentro: el día del comercio es
 * America/Argentina/Ushuaia y esto corre en UTC — ya hubo dos relojes
 * desincronizados en este proyecto por resolver la fecha en el lugar
 * equivocado.
 */
export async function listarContratosDeTercero(
  terceroId: string,
  hoy: string,
  almacen: AlmacenDeComprobantes
): Promise<ContratoDeTercero[]> {
  const { tenantId } = ctx();

  const filas = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.tenant_id, tenantId),
        eq(attachments.tercero_id, terceroId),
        isNull(attachments.removed_at)
      )
    );

  return Promise.all(
    filas.map(async (f) => {
      const esta = await almacen.existe(f.tenant_id, f.id);
      if (esta === null) {
        logger.warn(
          { attachment_id: f.id },
          'no se pudo verificar si el contrato está en el bucket'
        );
      }
      return {
        id: f.id,
        nombre_original: f.nombre_original,
        content_type: f.content_type,
        bytes: f.bytes,
        created_at: f.created_at,
        archivo_presente: esta === true,
        vigencia_desde: f.vigencia_desde,
        vigencia_hasta: f.vigencia_hasta,
        vencido: f.vigencia_hasta !== null && f.vigencia_hasta < hoy,
      };
    })
  );
}

/**
 * Cuántos contratos vigentes tiene cada proveedor de la lista.
 *
 * Mismo criterio que `contarAdjuntosPorGasto`: cuenta FICHAS, no archivos
 * presentes en el bucket.
 */
export async function contarContratosPorTercero(
  terceroIds: string[]
): Promise<Record<string, number>> {
  const { tenantId } = ctx();
  if (terceroIds.length === 0) return {};

  const filas = await db.execute<{ tercero_id: string; cantidad: string }>(sql`
    SELECT tercero_id::text AS tercero_id, count(*)::text AS cantidad
      FROM attachments
     WHERE tenant_id = ${tenantId}
       AND removed_at IS NULL
       AND tercero_id IN (${sql.join(
         terceroIds.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
     GROUP BY tercero_id
  `);

  return Object.fromEntries(filas.map((f) => [f.tercero_id, Number(f.cantidad)]));
}

/**
 * Cuántos comprobantes vigentes tiene cada gasto de la lista.
 *
 * Es para que la pantalla pueda mostrar de un vistazo cuáles ya tienen
 * respaldo — que es literalmente lo que la contadora viene a buscar — sin
 * pedir el detalle de todos. Mismo patrón que `getItemCountsByExpense`.
 *
 * ⚠️ Cuenta FILAS, no archivos presentes en el bucket. Un gasto puede figurar
 * con 1 y que el objeto no esté; eso lo dice `listarAdjuntosDeGasto` cuando se
 * abre. Preguntarle al storage por cada gasto de la lista serían decenas de
 * llamadas para pintar un clip, y el número no promete "el archivo está" sino
 * "acá se cargó un comprobante".
 */
export async function contarAdjuntosPorGasto(
  expenseIds: string[]
): Promise<Record<string, number>> {
  const { tenantId } = ctx();
  if (expenseIds.length === 0) return {};

  const filas = await db.execute<{ expense_id: string; cantidad: string }>(sql`
    SELECT expense_id::text AS expense_id, count(*)::text AS cantidad
      FROM attachments
     WHERE tenant_id = ${tenantId}
       AND removed_at IS NULL
       AND expense_id IN (${sql.join(
         expenseIds.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
     GROUP BY expense_id
  `);

  return Object.fromEntries(filas.map((f) => [f.expense_id, Number(f.cantidad)]));
}

/**
 * Un link firmado para bajar el comprobante.
 *
 * El chequeo de a quién pertenece va ANTES de firmar: una vez firmada, la URL
 * ya no pregunta nada. El `where` filtra por el tenant del context (no compara
 * después de leer), así que un id ajeno devuelve cero filas.
 */
export async function urlParaDescargar(
  attachmentId: string,
  almacen: AlmacenDeComprobantes
): Promise<{ url: string; nombre: string } | { falta: true }> {
  const { tenantId } = ctx();

  const [fila] = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.tenant_id, tenantId),
        isNull(attachments.removed_at)
      )
    )
    .limit(1);

  if (!fila) {
    throw new AttachmentError('Ese comprobante no existe', 'NO_ENCONTRADO');
  }

  const url = await almacen.firmar(fila.storage_path, SEGUNDOS_DE_VIDA_DEL_LINK);

  if (url === null) {
    // El archivo no está o el storage no contesta. Se devuelve un ESTADO, no
    // un link roto: la pantalla tiene que poder decirlo.
    logger.warn({ attachment_id: attachmentId }, 'no se pudo firmar la descarga');
    return { falta: true };
  }

  return { url, nombre: fila.nombre_original };
}

/**
 * Baja LÓGICA del comprobante. El archivo no se borra del bucket.
 *
 * Ver el encabezado del schema: mientras A-31 no se responda, la copia digital
 * se trata como el respaldo del gasto, y un respaldo no se destruye porque
 * alguien se equivocó de archivo. Queda fuera de la vista y auditado.
 */
export async function quitarComprobante(input: {
  attachment_id: string;
  motivo: string;
}): Promise<void> {
  const { tenantId, userId } = ctx();

  const motivo = input.motivo.trim();
  if (motivo === '') {
    throw new AttachmentError('Hace falta decir por qué se quita', 'SIN_MOTIVO');
  }

  await db.transaction(async (tx) => {
    const filas = await tx
      .update(attachments)
      .set({ removed_at: new Date(), removed_by: userId, removed_reason: motivo })
      .where(
        and(
          eq(attachments.id, input.attachment_id),
          eq(attachments.tenant_id, tenantId),
          // Sin esto, quitar dos veces pisaría la fecha y el autor de la
          // primera baja — que es el dato que la hace auditable.
          isNull(attachments.removed_at)
        )
      )
      .returning({
        id: attachments.id,
        tipo: attachments.tipo,
        expense_id: attachments.expense_id,
        // Sin esto, la baja de un CONTRATO quedaba auditada con
        // `expense_id: null` y nada más: el evento no decía de qué colgaba lo
        // que se sacó, que es justo lo que un audit tiene que poder contestar.
        tercero_id: attachments.tercero_id,
      });

    if (filas.length === 0) {
      throw new AttachmentError('Ese comprobante no existe', 'NO_ENCONTRADO');
    }

    await writeAuditLog(
      {
        event_name: 'expense.attachment_removed',
        payload: {
          attachment_id: input.attachment_id,
          tipo: filas[0]!.tipo,
          expense_id: filas[0]!.expense_id,
          tercero_id: filas[0]!.tercero_id,
          motivo,
        },
        pii_level: 'pii_high',
      },
      tx
    );
  });
}

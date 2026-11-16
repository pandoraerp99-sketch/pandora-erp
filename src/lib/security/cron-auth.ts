/**
 * ¿Puede este request disparar un cron? Fail-closed (H-15, 2026-11-16).
 *
 * ── Las dos mitades del problema ──────────────────────────────────────────
 * Las rutas `/api/internal/cron/*` las llama Vercel Cron con
 * `Authorization: Bearer ${CRON_SECRET}` y SIN sesión de Supabase.
 *
 *   1. El proxy las trataba como pantallas: sin sesión → 307 a /login. O
 *      sea que el cron de MercadoPago (vercel.json, cada 2 min) NUNCA iba a
 *      correr en producción: Vercel recibe el HTML del login y lo da por
 *      bueno. Verificado con curl contra el dev server.
 *   2. La ruta exigía el secreto sólo SI estaba configurado. Mientras el
 *      proxy la tapaba no se notaba; pero el arreglo obvio de (1) —sacarla
 *      del login— la dejaba abierta a cualquiera el día que alguien se
 *      olvidara de configurar CRON_SECRET en el deploy. El comentario decía
 *      "fail-closed"; el código era lo contrario.
 *
 * Se arreglan juntas: la ruta pasa a pública en el proxy, y la autenticación
 * vive acá, sin rama abierta. Sin secreto configurado el cron está APAGADO
 * (503), no abierto.
 *
 * La comparación es en tiempo constante: el secreto es lo único que separa
 * a internet de una ruta que escribe en la base.
 */
import { timingSafeEqual } from 'node:crypto';

export type ResultadoCron =
  | { ok: true }
  | { ok: false; status: 401 | 503; motivo: string };

export function autorizarCron(
  authorization: string | null,
  secretoConfigurado: string | undefined
): ResultadoCron {
  if (!secretoConfigurado) {
    return { ok: false, status: 503, motivo: 'CRON_SECRET no configurado: cron apagado' };
  }
  const esperado = Buffer.from(`Bearer ${secretoConfigurado}`);
  const recibido = Buffer.from(authorization ?? '');
  // timingSafeEqual exige el mismo largo; el largo distinto ya es un "no".
  if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) {
    return { ok: false, status: 401, motivo: 'credencial de cron inválida' };
  }
  return { ok: true };
}

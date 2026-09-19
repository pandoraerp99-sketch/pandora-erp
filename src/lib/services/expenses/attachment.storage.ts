/**
 * El almacén donde viven los bytes del comprobante.
 *
 * Está separado del service por dos razones distintas:
 *
 * 1. **Para poder probarlo.** El cliente de Supabase se arma con `next/headers`,
 *    que fuera de un request de Next no existe. Con el almacén adentro, el
 *    service entero quedaba imposible de correr en la suite de integración — y
 *    lo que hay que probar es justamente que el path lleve el tenant correcto.
 *    CLAUDE.md §15.1 ya lo pide así ("services testeables sin DB").
 *
 * 2. **Para que haya un solo lugar donde se elige el cliente.** Acá se usa el
 *    cliente del USUARIO (anon key + su cookie), que corre como `authenticated`
 *    y por lo tanto pasa por las policies del bucket. El service role las
 *    ignora: si alguien lo usara para subir, la segunda capa de defensa
 *    desaparecería sin un solo error visible. Con un único implementador, esa
 *    decisión está en un archivo de veinte líneas y no repartida.
 *
 * `scripts/suite-completa.sh` verifica que ningún archivo de adjuntos importe
 * el service role, porque esto último es una afirmación y las afirmaciones se
 * chequean.
 */
import { createSupabaseServerClient } from '../../auth/supabase-server.js';

export const BUCKET_COMPROBANTES = 'comprobantes';

/**
 * Lo que el service necesita del almacén, y nada más.
 *
 * Los errores vuelven como mensaje y no como excepción para que el service
 * decida qué hacer con cada uno: un fallo al subir aborta, uno al verificar si
 * el archivo está es apenas "no lo sé".
 */
export interface AlmacenDeComprobantes {
  subir(
    path: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<{ error: string | null }>;
  borrar(path: string): Promise<{ error: string | null }>;
  /** `null` = no se pudo preguntar. Distinto de `false` = no está. */
  existe(carpeta: string, nombre: string): Promise<boolean | null>;
  /** `null` = no se pudo firmar (no está, o el storage no contesta). */
  firmar(path: string, segundos: number): Promise<string | null>;
}

export async function almacenSupabase(): Promise<AlmacenDeComprobantes> {
  const supabase = await createSupabaseServerClient();
  const bucket = supabase.storage.from(BUCKET_COMPROBANTES);

  return {
    async subir(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, {
        contentType,
        // Sin upsert: el id es nuevo, así que si el objeto ya existe algo está
        // muy mal y es mejor enterarse que pisarlo.
        upsert: false,
      });
      return { error: error ? error.message : null };
    },

    async borrar(path) {
      const { data, error } = await bucket.remove([path]);
      if (error) return { error: error.message };
      // 🔴 `remove()` devuelve `{ data: [], error: null }` cuando el RLS le
      // filtra las filas: no borra NADA y no se queja. Mirar sólo `error`
      // dejaba la compensación muda — el objeto quedaba arriba y el
      // `logger.error` del huérfano no se disparaba nunca.
      //
      // Probado contra la base real (`scripts/probar-storage-real.sh`) antes
      // de la migration 0042, que es la que le dio el permiso de borrar
      // huérfanos. Este chequeo se queda igual: si mañana alguien toca esa
      // policy, la compensación tiene que gritar y no volver a callarse.
      if ((data ?? []).length === 0) {
        return { error: 'el storage no borró nada (¿la policy de DELETE?)' };
      }
      return { error: null };
    },

    async existe(carpeta, nombre) {
      const { data, error } = await bucket.list(carpeta, { limit: 1, search: nombre });
      if (error) return null;
      return (data ?? []).some((o) => o.name === nombre);
    },

    async firmar(path, segundos) {
      const { data, error } = await bucket.createSignedUrl(path, segundos);
      if (error || !data) return null;
      return data.signedUrl;
    },
  };
}

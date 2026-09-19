-- 0042 — La compensación puede borrar el huérfano, y NADA MÁS que el huérfano.
--
-- ── El bug ────────────────────────────────────────────────────────────────
-- La 0040 creó dos policies sobre `storage.objects` (SELECT e INSERT) y
-- ninguna de DELETE, a propósito. Pero el service sube el archivo ANTES de
-- insertar la fila y, si el INSERT falla, compensa borrando el objeto — con el
-- cliente del usuario, que pasa por RLS. Sin policy de DELETE ese borrado no
-- podía funcionar.
--
-- Y no fallaba ruidosamente: `supabase-js.remove()` devuelve
-- `{ data: [], error: null }` cuando el RLS le filtra las filas. El código
-- miraba sólo `error`, así que el `logger.error` del huérfano NO se disparaba
-- nunca, con un comentario arriba afirmando lo contrario.
--
-- Probado contra la base real con `scripts/probar-storage-real.sh`:
--     remove devolvió: data=[] error=null
--     ¿el objeto sigue ahí? SÍ
--
-- Apareció porque `almacenSupabase()` —el único camino que corre en
-- producción— no se ejecutaba en ningún test: T-ADJ-01 escribe las filas de
-- `storage.objects` a mano y T-ADJ-02 usa un almacén falso. El falso probaba
-- que el service LLAMA a borrar, no que borrar pueda borrar.
--
-- ── Por qué esta policy y no una de DELETE por tenant ─────────────────────
-- Una policy "podés borrar lo de tu carpeta" dejaría que un usuario destruya
-- un objeto que SÍ tiene ficha, y eso produce el estado peligroso: la pantalla
-- diciendo "comprobante adjunto" sin comprobante. Es exactamente la mitad que
-- el orden subir-primero elige evitar.
--
-- Entonces el permiso se ata a la condición que define al huérfano: se puede
-- borrar un objeto de tu carpeta SI Y SÓLO SI no hay ninguna fila de
-- `attachments` que lo referencie. Con eso:
--   · la compensación borra (la fila no llegó a entrar, o se hizo rollback)
--   · un comprobante vivo NO se puede borrar, ni por error ni a propósito
--   · uno dado de baja lógica TAMPOCO: su fila sigue existiendo, que es
--     justamente lo que la baja lógica quiere decir
--
-- El filtro por carpeta va igual y primero: sin él, un objeto ajeno sin ficha
-- visible para mí pasaría el `NOT EXISTS` (el RLS de `attachments` me lo
-- esconde) y sería borrable. Las dos condiciones, no una.

DROP POLICY IF EXISTS comprobantes_borrar_huerfano ON storage.objects;
CREATE POLICY comprobantes_borrar_huerfano ON storage.objects
  FOR DELETE USING (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[1] IN (
      SELECT cid::text FROM pandora.current_company_ids() AS cid
    )
    AND NOT EXISTS (
      SELECT 1 FROM attachments a WHERE a.storage_path = storage.objects.name
    )
  );

-- Sin `COMMENT ON POLICY`: comentar un objeto de `storage.objects` exige ser
-- DUEÑO de esa tabla, y el dueño es `supabase_storage_admin`, no `postgres`.
-- El DROP y el CREATE pasan igual (van por grants), así que la migración se
-- aplicaba bien la primera vez y explotaba al re-aplicarse — que es justo lo
-- que hacen `aplicar-adjuntos.sh` y la guardia de mutaciones. La explicación
-- vive en el encabezado de este archivo, que es donde se lee de todos modos.

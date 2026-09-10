-- 0030 — Pendientes (la agenda del comercio).
--
-- Slice 2 de RESEARCH-BRIEF-calendario-y-proyecciones.md. La maqueta del panel
-- ya tenia la lista de pendientes dibujada; esto es lo que la respalda.
--
-- ── ESTA TABLA **SI** SE EDITA ────────────────────────────────────────────
-- Es la primera tabla del mes que NO es append-only, y es a proposito. Todo lo
-- demas que se construyo (audit_log, stock_movements, expenses,
-- customer_account_movements) registra HECHOS: pasaron, y corregir es
-- registrar otro hecho. Un pendiente no es un hecho, es una INTENCION: se
-- tacha, se destacha porque uno se equivoco de fila, se corrige el titulo, se
-- pasa para el jueves. Poner un trigger de inmutabilidad aca obligaria a
-- "corregir" una tarea creando una tarea de ajuste, que no significa nada.
--
-- Lo que se pierde con eso, dicho: NO queda historia de los cambios.
-- `created_by` dice quien la creo y `done_by` quien la tacho, y nada mas — si
-- alguien reescribe el titulo o mueve la fecha, lo de antes no queda en ningun
-- lado. Es deliberado: el catalogo de `audit_log` esta CERRADO
-- (EVENT-TAXONOMY, regla de eventos) y un pendiente no toca plata, ni stock,
-- ni nada fiscal; `expenses`, que pesa bastante mas que esto, tampoco audita.
-- Si algun dia hace falta saber quien movio una fecha, eso es un evento nuevo
-- con su PR, no algo que se pueda suponer hoy.
--
-- ── LO QUE EL SISTEMA YA SABE NO SE GUARDA ACA ────────────────────────────
-- "Caja abierta de un dia anterior" NO es una fila de esta tabla: es una
-- consulta. Guardarlo seria duplicar un dato que ya existe en `cash_sessions`
-- y abrir la posibilidad de que la copia diga una cosa y el original otra.
-- Esos pendientes se DERIVAN al leer y se muestran sin casilla para tachar:
-- no se resuelven tachandolos, se resuelven cerrando la caja.

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  titulo text NOT NULL,
  detalle text,

  -- El tipo pinta la etiqueta y permite filtrar. Lista cerrada: un campo de
  -- texto libre termina con 'proveedor', 'Proveedor' y 'proveedores' como tres
  -- categorias distintas.
  tipo text NOT NULL DEFAULT 'general',

  -- Nullable a proposito: "alguna vez hay que llamar al gasista" es un
  -- pendiente valido. Sin fecha cae en el grupo "sin fecha", no en el de hoy.
  due_date date,

  -- Recurrencia simple. NO es un motor de calendario (nada de "el 3er martes"):
  -- son las tres cadencias que un comercio usa de verdad.
  recurrencia text,

  -- Tachado. Los dos campos viajan juntos (constraint mas abajo): un done_at
  -- sin done_by es una tarea que se hizo sola.
  done_at timestamptz,
  done_by uuid REFERENCES users(id) ON DELETE RESTRICT,

  -- Tachar una tarea que se repite CREA la ocurrencia siguiente. Sin este
  -- puntero, destachar (que casi siempre es "me equivoque de fila") deja
  -- la ocurrencia futura suelta y el usuario tiene que ir a borrarla a mano
  -- sin entender de donde salio. Con el puntero, destachar la borra — pero
  -- solo si sigue intacta, porque si ya la tacharon o la editaron paso a ser
  -- de alguien mas.
  spawned_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,

  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_tipo_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_tipo_check
  CHECK (tipo IN (
    'general', 'stock', 'caja', 'proveedor', 'cliente', 'fiscal', 'contador'
  ));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_recurrencia_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_recurrencia_check
  CHECK (recurrencia IS NULL OR recurrencia IN ('diaria', 'semanal', 'mensual'));

-- Una tarea que se repite necesita un ancla. Sin `due_date` no hay desde donde
-- avanzar, y "se repite todos los meses" sin decir que dia no quiere decir nada.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_recurrencia_necesita_fecha;
ALTER TABLE tasks ADD CONSTRAINT tasks_recurrencia_necesita_fecha
  CHECK (recurrencia IS NULL OR due_date IS NOT NULL);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_done_completo;
ALTER TABLE tasks ADD CONSTRAINT tasks_done_completo
  CHECK ((done_at IS NULL AND done_by IS NULL)
      OR (done_at IS NOT NULL AND done_by IS NOT NULL));

-- Un titulo en blanco deja una fila fantasma que ocupa lugar y no dice nada.
-- El tope de largo es para que la lista siga siendo una lista.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_titulo_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_titulo_check
  CHECK (length(btrim(titulo)) BETWEEN 1 AND 200);

-- El indice que importa: la pantalla siempre pide "lo que falta hacer".
-- Parcial, porque las tachadas crecen para siempre y casi nunca se leen.
CREATE INDEX IF NOT EXISTS tasks_pendientes_idx
  ON tasks (tenant_id, due_date) WHERE done_at IS NULL;

-- Para la vista "que se hizo" y para el calendario de un mes cerrado.
CREATE INDEX IF NOT EXISTS tasks_tenant_done_idx
  ON tasks (tenant_id, done_at DESC) WHERE done_at IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_tenant_isolation ON tasks;
CREATE POLICY tasks_tenant_isolation ON tasks
  FOR ALL
  USING (tenant_id IN (SELECT pandora.current_company_ids()))
  WITH CHECK (tenant_id IN (SELECT pandora.current_company_ids()));

COMMENT ON TABLE tasks IS
  'Pendientes del comercio. UNICA tabla de negocio que se EDITA: un pendiente '
  'es una intencion, no un hecho — se tacha, se destacha y se reprograma. NO '
  'hay historia de los cambios: solo created_by y done_by (decision explicita, '
  'ver el encabezado de la migration). Los '
  'pendientes que el sistema ya sabe (caja sin cerrar) NO son filas: se '
  'derivan al leer y no tienen casilla.';

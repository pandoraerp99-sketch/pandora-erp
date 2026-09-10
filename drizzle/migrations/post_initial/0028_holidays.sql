-- ============================================================================
-- Migration: 0028_holidays
-- Feriados y asuetos, como DATO VERIFICADO.
--
-- ── POR QUE NO SE CALCULAN ──────────────────────────────────────────────────
-- La Ley 27399 trae una regla de traslado tentadora ("los que coincidan con
-- martes y miercoles se trasladan al lunes anterior; jueves y viernes, al lunes
-- siguiente"). Es EXACTAMENTE la misma forma que la regla de vencimientos por
-- terminacion de CUIT que este proyecto ya probo FALSA
-- (RESEARCH-BRIEF-vencimientos-fiscales): una regla que todo el mundo repite y
-- que el dato oficial contradice.
--
-- Aca la contradice el propio Ejecutivo: la misma Ley 27399 lo habilita a fijar
-- hasta TRES dias turisticos por anio por decreto, y ademas puede mover cosas.
-- Al 2026-09-10 el calendario 2027 todavia NO esta publicado.
--
-- Entonces: se CARGAN, con su fuente y su fecha de verificacion. Nunca se
-- derivan de la regla.
--
-- ── POR QUE HAY UNA TABLA DE COBERTURA ──────────────────────────────────────
-- Si `holidays` no tiene filas para 2027, un calendario ingenuo dibujaria
-- diciembre de 2027 sin ningun feriado — o sea afirmando que no hay ninguno.
-- Es el mismo error que rellenar un KPI sin dato con un cero.
--
-- `holiday_calendars` dice explicitamente QUE anio esta cargado, de donde salio,
-- cuando se verifico, y si esta COMPLETO. Sin esa fila, la pantalla no dibuja
-- feriados: dice que no los tiene. Fail-closed (CLAUDE.md §8.12).
--
-- ── POR QUE NO LLEVAN tenant_id ─────────────────────────────────────────────
-- Un feriado nacional es el mismo para todos los comercios. Es dato de
-- referencia, no dato del tenant: no hay nada que aislar y no hay fuga posible.
-- Se lee desde cualquier sesion autenticada; se escribe SOLO con service_role
-- (la carga es una operacion de mantenimiento, no del comercio).
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------
-- Cobertura: que anios tenemos cargados y con que grado de confianza
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holiday_calendars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio          smallint NOT NULL,
  jurisdiction  text NOT NULL DEFAULT 'nacional',

  -- De donde salio y cuando se miro. Sin esto no se puede auditar una fecha.
  source_url    text NOT NULL,
  verified_at   date NOT NULL,

  -- false = hay feriados de ese anio que NO estan cargados. La pantalla lo dice
  -- en vez de mostrar el mes como si estuviera completo.
  completo      boolean NOT NULL DEFAULT false,

  -- Que falta, en castellano, para que se pueda mostrar tal cual.
  nota          text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT holiday_calendars_anio_jurisdiction_unique UNIQUE (anio, jurisdiction),
  CONSTRAINT chk_holiday_calendars_anio CHECK (anio BETWEEN 2020 AND 2100),
  CONSTRAINT chk_holiday_calendars_jurisdiction
    CHECK (jurisdiction IN ('nacional', 'TIERRA_DEL_FUEGO'))
);

-- ----------------------------------------------------------------
-- Los dias
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         date NOT NULL,
  nombre        text NOT NULL,

  -- Las cuatro categorias oficiales de argentina.gob.ar/feriados, mas el asueto
  -- provincial, que NO es lo mismo (ver la nota de abajo).
  tipo          text NOT NULL,
  jurisdiction  text NOT NULL DEFAULT 'nacional',

  -- Aclaracion para el comerciante cuando el dia no significa lo obvio.
  nota          text,

  source_url    text NOT NULL,
  verified_at   date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT holidays_fecha_jurisdiction_nombre_unique
    UNIQUE (fecha, jurisdiction, nombre),
  CONSTRAINT chk_holidays_tipo CHECK (tipo IN (
    'inamovible',        -- no se mueve nunca
    'trasladable',       -- la fecha OBSERVADA puede diferir de la nominal
    'no_laborable',      -- Jueves Santo, festividades religiosas
    'turistico',         -- los hasta 3 por anio que fija el Ejecutivo
    'asueto_provincial'  -- ver nota
  )),
  CONSTRAINT chk_holidays_jurisdiction
    CHECK (jurisdiction IN ('nacional', 'TIERRA_DEL_FUEGO'))
);

COMMENT ON COLUMN holidays.tipo IS
  'asueto_provincial NO es un feriado: la facultad de decretar feriados es de la '
  'Nacion. Es un receso administrativo del sector publico, y el comercio ELIGE '
  'si adhiere. Marcarlo como feriado le diria al comerciante que esta cerrado '
  'cuando en realidad es su decision.';

CREATE INDEX IF NOT EXISTS holidays_fecha_idx ON holidays (fecha);

-- ----------------------------------------------------------------
-- RLS: lectura para cualquier sesion autenticada, escritura solo service_role
-- ----------------------------------------------------------------
ALTER TABLE holidays          ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS holidays_select ON holidays;
CREATE POLICY holidays_select ON holidays
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS holiday_calendars_select ON holiday_calendars;
CREATE POLICY holiday_calendars_select ON holiday_calendars
  FOR SELECT TO authenticated
  USING (true);

-- INSERT / UPDATE / DELETE intencionalmente SIN policy: la carga del calendario
-- es mantenimiento verificado, no una accion del comercio. Sin policy, ninguna
-- sesion `authenticated` puede escribir; solo service_role, que salta RLS.

COMMIT;

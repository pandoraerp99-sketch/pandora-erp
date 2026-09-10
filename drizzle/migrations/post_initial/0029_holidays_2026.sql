-- ============================================================================
-- Migration: 0029_holidays_2026
-- Carga del calendario 2026. PARCIAL, y la fila de cobertura lo dice.
--
-- ── QUE SE PUDO VERIFICAR Y QUE NO ──────────────────────────────────────────
-- La pagina oficial (argentina.gob.ar/feriados) renderiza las fechas por
-- JavaScript: no se puede leer el listado como texto. Asi que la fuente usada
-- es la NORMA, que si es texto citable: Ley 27399, BO 18/10/2017.
--
-- De ahi salen con certeza los feriados INAMOVIBLES DE FECHA FIJA: por
-- definicion no se mueven, y la ley los enumera con dia y mes.
--
-- NO se cargan, y por eso `completo = false`:
--   - Carnaval (lunes y martes) y Viernes Santo / Jueves Santo: se mueven con
--     la Pascua, que es un calculo lunar. La ley los nombra, no los fecha.
--   - Los TRASLADABLES (17/6 Guemes, 17/8 San Martin, 12/10 Diversidad
--     Cultural, 20/11 Soberania): la ley da la fecha NOMINAL, pero la fecha
--     OBSERVADA depende de la regla de traslado — que es justo lo que este
--     proyecto decidio no calcular (ver 0028).
--   - Los TURISTICOS: hasta 3 por anio, por decreto del Ejecutivo.
--   - Las festividades judias e islamicas (dias no laborables): calendarios
--     lunares.
--
-- Cargar la mitad y callarlo seria peor que no cargar nada. Por eso la fila de
-- `holiday_calendars` lleva `completo = false` y una nota que la pantalla
-- muestra tal cual.
--
-- Idempotente: los feriados con DO NOTHING; las filas de cobertura con DO
-- UPDATE, para que una nota mal escrita se pueda corregir re-corriendo esto
-- en vez de quedar clavada.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------
-- Cobertura NACIONAL 2026 — parcial y declarada como tal
-- ----------------------------------------------------------------
INSERT INTO holiday_calendars (anio, jurisdiction, source_url, verified_at, completo, nota)
VALUES (
  2026,
  'nacional',
  'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018',
  DATE '2026-09-10',
  false,
  'Cargados solo los feriados inamovibles de fecha fija (Ley 27399). Faltan '
  'Carnaval y Semana Santa (dependen de la Pascua), los trasladables '
  '(17/6, 17/8, 12/10, 20/11 — la fecha observada la fija el calendario '
  'oficial del año) y los turísticos (por decreto).'
)
ON CONFLICT (anio, jurisdiction) DO UPDATE
  SET source_url  = EXCLUDED.source_url,
      verified_at = EXCLUDED.verified_at,
      completo    = EXCLUDED.completo,
      nota        = EXCLUDED.nota;

-- ----------------------------------------------------------------
-- Feriados nacionales INAMOVIBLES de fecha fija — Ley 27399
-- ----------------------------------------------------------------
INSERT INTO holidays (fecha, nombre, tipo, jurisdiction, source_url, verified_at)
VALUES
  (DATE '2026-01-01', 'Año Nuevo',                                            'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia','inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas','inamovible','nacional','https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-05-01', 'Día del Trabajo',                                      'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-05-25', 'Día de la Revolución de Mayo',                         'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-06-20', 'Paso a la Inmortalidad del General Manuel Belgrano',   'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-07-09', 'Día de la Independencia',                              'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-12-08', 'Día de la Inmaculada Concepción de María',             'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10'),
  (DATE '2026-12-25', 'Navidad',                                              'inamovible', 'nacional', 'https://www.boletinoficial.gob.ar/detalleAviso/primera/172415/20171018', DATE '2026-09-10')
ON CONFLICT (fecha, jurisdiction, nombre) DO NOTHING;

-- ----------------------------------------------------------------
-- TIERRA DEL FUEGO — 1 de junio
--
-- Ojo con este: NO es un feriado. La facultad de decretar feriados es de la
-- Nacion, asi que el 1 de junio (Dia de la Provincia, aniversario de la jura de
-- la Constitucion fueguina en 1991) es un RECESO ADMINISTRATIVO del sector
-- publico. **El empleador elige si adhiere.**
--
-- Marcarlo como feriado le diria al comercio que esta cerrado cuando en realidad
-- es su decision — que es justo el tipo de afirmacion falsa que este proyecto
-- evita. Va como `asueto_provincial`, con la nota visible.
--
-- 🟡 FUENTE SECUNDARIA: la referencia a la Ley Provincial 007/92 y al Decreto
-- 748/92 viene de la Cámara de Comercio de Ushuaia, no del texto de la norma.
-- No se encontro el texto primario publicado. Por eso `completo = false` y la
-- nota lo dice. Confirmar antes de darlo por cerrado.
-- ----------------------------------------------------------------
INSERT INTO holiday_calendars (anio, jurisdiction, source_url, verified_at, completo, nota)
VALUES (
  2026,
  'TIERRA_DEL_FUEGO',
  'https://camaradecomercioush.com.ar/alcances-del-feriado-administrativo-por-el-dia-de-la-provincia-de-tdf/',
  DATE '2026-09-10',
  false,
  'Solo el 1 de junio. Fuente secundaria (Cámara de Comercio de Ushuaia): '
  'refiere a la Ley Provincial 007/92 y al Decreto 748/92, cuyo texto no se '
  'pudo verificar. Falta confirmar contra la norma provincial.'
)
ON CONFLICT (anio, jurisdiction) DO UPDATE
  SET source_url  = EXCLUDED.source_url,
      verified_at = EXCLUDED.verified_at,
      completo    = EXCLUDED.completo,
      nota        = EXCLUDED.nota;

INSERT INTO holidays (fecha, nombre, tipo, jurisdiction, nota, source_url, verified_at)
VALUES (
  DATE '2026-06-01',
  'Día de la Provincia de Tierra del Fuego',
  'asueto_provincial',
  'TIERRA_DEL_FUEGO',
  'Receso administrativo del sector público, no un feriado nacional. '
  'El comercio elige si adhiere.',
  'https://camaradecomercioush.com.ar/alcances-del-feriado-administrativo-por-el-dia-de-la-provincia-de-tdf/',
  DATE '2026-09-10'
)
ON CONFLICT (fecha, jurisdiction, nombre) DO NOTHING;

COMMIT;

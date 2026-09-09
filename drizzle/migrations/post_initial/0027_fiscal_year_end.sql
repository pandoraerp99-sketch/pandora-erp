-- 0027 — Mes de cierre del ejercicio comercial.
--
-- Nace de evidencia. El pedido de la contadora a ROMERO & RUIZ SAS es por el
-- "ejercicio regular N° 2 iniciado el 01/08/2025 y finalizado el 31/07/2026".
-- O sea: el recorte con el que ella trabaja NO es el año calendario.
--
-- Sin este dato, la app sólo sabe ofrecer mes, trimestre y año calendario, y
-- para esta empresa ninguno de los tres coincide con el balance. El export de
-- gastos salía por meses sueltos que después hay que pegar a mano — que es
-- justo el trabajo que el módulo vino a sacar.
-- Ver EVIDENCIA-pedido-contadora-2026-09.md §2.a.
--
-- ── POR QUE EL MES Y NO LA FECHA ──────────────────────────────────────────
-- Se guarda el MES de cierre y se asume el ÚLTIMO DÍA de ese mes. Es una
-- decisión de modelado, no una afirmación legal: el estatuto fija la fecha, y
-- en la práctica se fija a fin de mes (el de este pedido cierra el 31/07).
--
-- Si aparece una sociedad que cierra a mitad de mes, esto NO alcanza y hace
-- falta agregar el día — está escrito acá para que quien lo encuentre sepa que
-- fue una simplificación consciente y no un olvido. No se agrega hoy porque no
-- hay ningún caso (CLAUDE.md §5.5: la opción más simple que resuelve el
-- problema).
--
-- ── EL DEFAULT ES 12 Y ESO ES UNA AFIRMACION ──────────────────────────────
-- 12 = cierra el 31/12, que es lo más común y lo que hace que el ejercicio
-- coincida con el año calendario. Es un default que puede estar MAL para una
-- empresa concreta, y por eso la pantalla muestra el rango exacto en pantalla
-- en vez de decir sólo "Ejercicio": si dice el 01/08 al 31/07 y la empresa
-- cierra en otro mes, se ve de una.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS fiscal_year_end_month smallint NOT NULL DEFAULT 12;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_fiscal_year_end_month_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_fiscal_year_end_month_check
      CHECK (fiscal_year_end_month BETWEEN 1 AND 12);
  END IF;
END $$;

COMMENT ON COLUMN companies.fiscal_year_end_month IS
  'Mes en que cierra el ejercicio comercial (1-12). Se asume el ULTIMO DIA de ese mes. 12 = 31/12 (coincide con el ano calendario).';

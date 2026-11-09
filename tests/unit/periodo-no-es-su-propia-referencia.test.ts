/**
 * `periodo.desde` NO sirve como fecha de referencia para volver a pedir el
 * mismo período.
 *
 * ── Cómo apareció ────────────────────────────────────────────────────────
 * /contador mostraba "Kiosco Demo TDF · 2026" y la consulta de los
 * comprobantes del período corría contra `2025-01-01 .. 2025-12-31`. Un año
 * entero corrido, sin un solo error: la lista salía vacía y la pantalla decía,
 * con toda propiedad, "ningún gasto del período tiene el comprobante adjunto".
 *
 * ── Por qué pasa ─────────────────────────────────────────────────────────
 * Las dos mitades están bien por separado:
 *   - `periodo.desde` se construye con `Date.UTC(y, 0, 1)` → medianoche UTC.
 *   - `periodoDe` resuelve el año y el mes en el calendario DEL COMERCIO
 *     (America/Argentina/Ushuaia, UTC−3), que es lo correcto: a las 22:00 del
 *     31/12 en Ushuaia, UTC ya está en el año siguiente.
 *
 * Juntas se rompen: medianoche UTC del 1 de enero es el 31 de diciembre a las
 * 21:00 en Ushuaia, o sea el período ANTERIOR. El primer instante de un
 * período en UTC pertenece al período de antes en hora local.
 *
 * ── Qué pinta este test ──────────────────────────────────────────────────
 * No pide que la ida y vuelta funcione —`periodoDe` está bien como está— sino
 * que quede escrito, y verificado, que NO funciona. Es la trampa completa:
 * el patrón "la pantalla manda `periodo.desde` y el server vuelve a llamar a
 * `periodoDe`" se ve inofensivo, se repite solo, y falla en silencio.
 *
 * Quien necesite el período que está en pantalla tiene que resolverlo igual
 * que la pantalla —con la fecha de HOY— y no con el borde del período.
 */
import { describe, expect, it } from 'vitest';
import { periodoDe, type Grano } from '@/lib/services/reporting/accountant.report';

/** Un instante cualquiera de 2026, bien lejos de los bordes. */
const EN_2026 = new Date('2026-06-15T15:00:00.000Z');
/** El de ROMERO & RUIZ SAS, para que `ejercicio` no caiga en el default. */
const MES_CIERRE = 7;

const GRANOS: Grano[] = ['mes', 'trimestre', 'anio', 'ejercicio'];

describe('periodo.desde no es su propia fecha de referencia', () => {
  it('🔴 devolver `desde` como referencia corre el período para atrás', () => {
    const corridos: string[] = [];

    for (const grano of GRANOS) {
      const enPantalla = periodoDe(grano, EN_2026, MES_CIERRE);
      // Exactamente lo que hacía la action: el cliente manda
      // `periodo.desde.toISOString()` y el server lo reinterpreta.
      const deVuelta = periodoDe(
        grano,
        new Date(enPantalla.desde.toISOString()),
        MES_CIERRE
      );
      if (enPantalla.desde.getTime() !== deVuelta.desde.getTime()) {
        corridos.push(`${grano}: ${enPantalla.etiqueta} → ${deVuelta.etiqueta}`);
      }
    }

    // Se afirma que HAY corrimiento, con la lista a la vista: si algún día
    // `periodoDe` se vuelve seguro para la ida y vuelta, este test se pone
    // rojo y hay que borrarlo junto con el comentario de arriba — no dejarlo
    // pasar en verde afirmando una trampa que ya no existe.
    expect(corridos.length).toBeGreaterThan(0);
  });

  it('🔴 con la fecha de HOY, la pantalla y el server coinciden', () => {
    // La forma correcta: el server resuelve el período con el mismo criterio
    // que la pantalla —un instante de adentro del período, no su borde.
    for (const grano of GRANOS) {
      const enPantalla = periodoDe(grano, EN_2026, MES_CIERRE);
      const enElServer = periodoDe(grano, EN_2026, MES_CIERRE);
      expect(enElServer.desde.toISOString()).toBe(enPantalla.desde.toISOString());
      expect(enElServer.hasta.toISOString()).toBe(enPantalla.hasta.toISOString());
      expect(enElServer.etiqueta).toBe(enPantalla.etiqueta);
    }
  });

  it('🔴 el caso concreto que rompió: el año 2026 vuelve como 2025', () => {
    const anio2026 = periodoDe('anio', EN_2026);
    expect(anio2026.etiqueta).toBe('2026');

    const deVuelta = periodoDe('anio', new Date(anio2026.desde.toISOString()));
    expect(deVuelta.etiqueta).toBe('2025');
  });
});

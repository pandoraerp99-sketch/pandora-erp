// Modo oscuro de las pantallas de gestión: dos regresiones que ya pasaron.
//
// 1. Una pantalla sin bloque oscuro: /productos y /contador se quedaron en
//    claro con el tema oscuro puesto hasta 2026-09-14, y nada lo decía.
// 2. Un color escrito a mano en style={{}}: un inline le gana a cualquier
//    regla y no puede tener variante de tema. Rompió el modo oscuro en
//    /gastos, en los días de stock del Panel y en /productos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OSCURO_GESTION, OSCURO_NUCLEO } from '../../src/app/_css/tema-oscuro';
import { CLIENTES_CSS } from '../../src/app/clientes/clientesCss';
import { CONTADOR_CSS } from '../../src/app/contador/contadorCss';
import { GASTOS_CSS } from '../../src/app/gastos/gastosCss';
import { PRODUCTOS_CSS } from '../../src/app/productos/productosCss';

const PANTALLAS = {
  clientes: CLIENTES_CSS,
  gastos: GASTOS_CSS,
  productos: PRODUCTOS_CSS,
  contador: CONTADOR_CSS,
} as const;

describe('bloque oscuro en cada pantalla de gestión', () => {
  for (const [nombre, css] of Object.entries(PANTALLAS)) {
    it(`${nombre} trae los tokens oscuros y la barra de título`, () => {
      expect(css).toContain(OSCURO_NUCLEO);
      expect(css).toContain(OSCURO_GESTION);
    });

    it(`${nombre}: los tokens oscuros van DESPUÉS del :root claro`, () => {
      // Igual especificidad no es el caso (html[data-theme] le gana a :root),
      // pero si el bloque quedara antes de un :root redefinido más abajo con
      // !important o con el mismo selector, perdería en silencio.
      expect(css.lastIndexOf(':root{')).toBeLessThan(css.indexOf(OSCURO_NUCLEO));
    });
  }
});

describe('sin colores escritos a mano en style inline', () => {
  const RAIZ = join(__dirname, '../../src/app');
  const ARCHIVOS = [
    'clientes/ClientesClient.tsx',
    'gastos/GastosClient.tsx',
    'productos/ProductosClient.tsx',
    'productos/AjusteStockModal.tsx',
    'productos/HistorialModal.tsx',
    'contador/ContadorClient.tsx',
  ];
  // color / background / borderColor con un literal hex o rgb(a). Los var(--x)
  // sí se permiten: esos cambian con el tema.
  const INLINE = /\b(color|background|backgroundColor|borderColor|border)\s*:\s*['"`][^'"`]*(#[0-9a-fA-F]{3,8}\b|rgba?\()/;
  // El mismo error con el color en una VARIABLE: style={{ color, background:
  // `${color}14` }} — así estaba el rubro en /productos. Un string que empieza
  // con comilla (literal o 'var(--x)') lo juzga la regex de arriba.
  const INLINE_VARIABLE = /style=\{\{[^}]*\b(color|background|backgroundColor)\s*(,|\}|:\s*[`A-Za-z_$])/;

  // Excepciones con motivo. Agregar una acá es una decisión, no un atajo:
  // medir el caso en oscuro (scripts/contraste-png.ps1) antes.
  const PERMITIDOS: ReadonlyArray<{ archivo: string; contiene: string; porque: string }> = [
    // colorCondicion(): en oscuro clientesCss aplana TODAS las .pill con
    // color:#dbe2f7 !important, y el fondo es un tinte translúcido.
    { archivo: 'clientes/ClientesClient.tsx', contiene: "background: 'rgba(91,140,255,0.16)'", porque: '.pill aplanada en oscuro' },
    { archivo: 'clientes/ClientesClient.tsx', contiene: "background: 'rgba(52,199,125,0.14)'", porque: '.pill aplanada en oscuro' },
    { archivo: 'clientes/ClientesClient.tsx', contiene: "background: 'rgba(14,143,158,0.14)'", porque: '.pill aplanada en oscuro' },
    { archivo: 'clientes/ClientesClient.tsx', contiene: "background: 'rgba(13,20,36,0.06)'", porque: '.pill aplanada en oscuro' },
    { archivo: 'clientes/ClientesClient.tsx', contiene: "background: 'rgba(13,20,36,0.05)'", porque: '.pill aplanada en oscuro' },
    // Iniciales en blanco sobre el degradado del avatar: el fondo es el
    // mismo en los dos temas.
    { archivo: 'clientes/ClientesClient.tsx', contiene: "color: '#fff'", porque: 'blanco sobre degradado propio' },
    { archivo: 'clientes/ClientesClient.tsx', contiene: 'background: gradienteDe(', porque: 'degradado del avatar, igual en los dos temas' },
    // Puntos de color de las etiquetas de KPI: decorativos, sin texto.
    { archivo: 'gastos/GastosClient.tsx', contiene: '<i className="d" style={{ background:', porque: 'punto decorativo' },
  ];

  for (const archivo of ARCHIVOS) {
    it(archivo, () => {
      const lineas = readFileSync(join(RAIZ, archivo), 'utf8').split('\n');
      const culpables = lineas
        .map((l, i) => ({ n: i + 1, l: l.trim() }))
        .filter(({ l }) => INLINE.test(l) || INLINE_VARIABLE.test(l))
        .filter(({ l }) => !PERMITIDOS.some((p) => p.archivo === archivo && l.includes(p.contiene)));
      expect(culpables).toEqual([]);
    });
  }
});

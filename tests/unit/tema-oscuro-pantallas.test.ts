// Modo oscuro de las pantallas de gestión: dos regresiones que ya pasaron.
//
// 1. Una pantalla sin bloque oscuro: /productos y /contador se quedaron en
//    claro con el tema oscuro puesto hasta 2026-09-14, y nada lo decía.
// 2. Un color escrito a mano en style={{}}: un inline le gana a cualquier
//    regla y no puede tener variante de tema. Rompió el modo oscuro en
//    /gastos, en los días de stock del Panel y en /productos.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OSCURO_CTA, OSCURO_GESTION, OSCURO_MODAL, OSCURO_NUCLEO } from '../../src/app/_css/tema-oscuro';
import { PANEL_CSS } from '../../src/app/panel/panelCss';
import { CLIENTES_CSS } from '../../src/app/clientes/clientesCss';
import { CONTADOR_CSS } from '../../src/app/contador/contadorCss';
import { PEDIDOS_CSS } from '../../src/app/pedidos/pedidosCss';
import { GASTOS_CSS } from '../../src/app/gastos/gastosCss';
import { PRODUCTOS_CSS } from '../../src/app/productos/productosCss';
import { CAJA_CSS } from '../../src/app/caja/cajaCss';
import { POS_CSS } from '../../src/app/pos/posCss';
import { SHELL_CSS } from '../../src/components/shell/shellCss';

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

  it('el modal de alta/edición toma el bloque compartido, no una copia', () => {
    // Estas reglas vivían SOLO en productosCss. El mismo modal en /clientes
    // —y en /gastos, que concatena CLIENTES_CSS— quedaba en claro: el input
    // medía fondo #fff sólido con texto #eef2ff. Casi blanco sobre blanco en
    // el alta de un cliente y en el importe de un gasto.
    expect(PRODUCTOS_CSS).toContain(OSCURO_MODAL);
    expect(CLIENTES_CSS).toContain(OSCURO_MODAL);
    expect(GASTOS_CSS).toContain(OSCURO_MODAL);
  });

  it('el Panel (bloque oscuro propio) toma el arreglo del boton principal del modulo', () => {
    // Si el Panel tuviera su propia copia, cambiar el degradado en el modulo
    // lo dejaria con el violeta que medía 2,24:1.
    expect(PANEL_CSS).toContain(OSCURO_CTA);
    expect(OSCURO_NUCLEO).toContain(OSCURO_CTA);
  });
});


describe('botón con degradado de --purple y texto blanco', () => {
  // Esta FORMA ya mordió cuatro veces: .cta en /productos (2,05:1), .cta en el
  // Panel (2,24:1), .pm-btn.primary en el modal, y .btn-primary en /caja
  // (~1,6:1) — este último en TODOS los botones que ejecutan algo: abrir caja,
  // cerrar caja, confirmar movimiento, aplicar al arqueo. Tardó en aparecer
  // porque viven dentro de modales y ninguna captura había abierto uno; se
  // midió recién con CLICS= en scripts/shot-pos.mjs.
  //
  // En claro var(--purple) es un violeta fuerte; en oscuro el token se aclara
  // y el mismo blanco se apaga. Se busca la forma, no los nombres: un botón
  // nuevo con este degradado falla acá el día que se escribe.
  //
  // Lo que esta guardia NO hace: calcular contraste. Se probó, y medía bien
  // pero gateaba de más — .cta da 3,60:1 en el tema CLARO, que es la identidad
  // Dawn Sky (ADR-0016), decisión del owner y no un bug de modo oscuro. Los
  // números quedaron anotados como pendientes, que es donde sirven.
  const MODULOS = {
    shell: SHELL_CSS,
    caja: CAJA_CSS,
    pos: POS_CSS,
    panel: PANEL_CSS,
    // /pedidos (2026-11-18): tiene su bloque oscuro propio, no OSCURO_GESTION.
    pedidos: PEDIDOS_CSS,
    ...PANTALLAS,
  } as const;

  // Excepciones con el número medido. Escribir una acá es declarar un defecto,
  // no taparlo: si el motivo fuera "está roto y elegimos no arreglarlo",
  // entonces se arregla.
  const SIN_VARIANTE_OK: ReadonlyArray<{ sel: string; porque: string }> = [
    // Iniciales decorativas sobre el avatar violeta→azul. Fallan en los DOS
    // temas (3,16:1 en claro, ~2,4:1 en oscuro): no son una regresión del modo
    // oscuro, van al balde de contraste junto a --ink-3 4,28.
    { sel: '.cashier-av', porque: 'iniciales decorativas; falla AA también en claro (3,16:1)' },
    { sel: '.cc-av', porque: 'iniciales decorativas; falla AA también en claro' },
    { sel: '.alivio-av', porque: 'iniciales decorativas; falla AA también en claro' },
    { sel: '.mini-ava', porque: 'iniciales decorativas; falla AA también en claro' },
    // Definido en shellCss y sin un solo uso en ningún .tsx (verificado
    // 2026-09-16). Limpiar selectores muertos del shell es otra pasada: ese
    // archivo lo carga toda la app.
    { sel: '.btn-solid', porque: 'CSS muerto del shell: ningún .tsx lo usa' },
  ];

  for (const [nombre, css] of Object.entries(MODULOS)) {
    it(`${nombre}: cada degradado de --purple con texto blanco tiene variante oscura`, () => {
      const sinVariante: string[] = [];
      // La llave de cierre de la regla anterior se MIRA (lookbehind), no se
      // consume. La versión anterior la consumía: cada match se comía el "}"
      // que el siguiente necesitaba, y el test revisaba una regla sí y una no.
      // Se descubrió el 2026-11-18 al agregar una regla a cajaCss: cambió la
      // paridad y aparecieron dos avatares que nunca se habían revisado.
      for (const [, selector, cuerpo] of css.matchAll(/(?:^|(?<=\}))\s*([^{}@]+?)\{([^{}]*)\}/g)) {
        const sel = (selector ?? '').trim();
        const cuerpoTexto = cuerpo ?? '';
        if (!sel || sel.includes('data-theme')) continue;
        if (SIN_VARIANTE_OK.some((p) => sel.split(',').some((s) => s.trim() === p.sel))) continue;
        if (!/linear-gradient\([^)]*var\(--purple/.test(cuerpoTexto)) continue;
        if (!/(?<![.\w])color\s*:\s*(#fff\b|#ffffff\b|white\b)/i.test(cuerpoTexto)) continue;
        // El override puede vivir en el núcleo o en OSCURO_MODAL (los montan
        // las pantallas con tema) o en el bloque oscuro del propio módulo.
        const cubierto = [OSCURO_NUCLEO, OSCURO_MODAL, css].some((donde) =>
          sel.split(',').every((s) => donde.includes(`html[data-theme="dark"] ${s.trim()}`)),
        );
        if (!cubierto) sinVariante.push(sel);
      }
      expect(sinVariante).toEqual([]);
    });
  }
});

describe('sin color de texto/ícono escrito a mano en style inline', () => {
  const SRC = join(__dirname, '../../src');
  // Todo lo que se pinta dentro de una pantalla CON modo oscuro. Se recorre la
  // carpeta entera: una lista de archivos a mano ya dejó afuera al Panel, que
  // es justo donde el error había pasado antes.
  //
  // `app/caja` y `app/pos` entraron el 2026-09-16, cuando se les dio paleta
  // oscura. Estaban afuera con el motivo escrito ("medido: NO tienen modo
  // oscuro"), y al entrar fallaron — que era exactamente lo que ese comentario
  // anticipaba: el verde de `.mov-ic` en Caja y el ámbar de "Modo consulta"
  // en el POS.
  const CARPETAS = [
    'app/clientes',
    'app/gastos',
    'app/productos',
    'app/contador',
    'app/pedidos',
    'app/panel',
    'app/caja',
    'app/pos',
    'components',
  ];
  const ARCHIVOS = CARPETAS.flatMap((c) =>
    readdirSync(join(SRC, c), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `${c}/${f.split('\\').join('/')}`),
  );

  // Se mira el COLOR (texto, trazo de ícono): es lo que se vuelve ilegible.
  // Un fondo translúcido o un puntito de color no tapan nada en ningún tema.
  // `(?<![.\w])` = que `color` sea la PROPIEDAD CSS y no el campo de un objeto.
  // Sin eso, `style={{ background: b.color }}` (el puntito de color por medio
  // de pago en /caja) se marcaba como texto ilegible: un fondo, no un color de
  // letra. Trece falsos positivos en una pantalla.
  const INLINE = /(?<![.\w])color\s*:\s*['"`][^'"`]*(#[0-9a-fA-F]{3,8}\b|rgba?\()/;
  // El mismo error con el color en una VARIABLE: style={{ color, background:
  // `${color}14` }} — así estaba el rubro en /productos. Un string con comilla
  // (literal o 'var(--x)') lo juzga la regex de arriba.
  const INLINE_VARIABLE = /style=\{\{[^}]*(?<![.\w])color\s*(,|\}|:\s*[`A-Za-z_$])/;

  // Excepciones con motivo. Agregar una acá es una decisión, no un atajo:
  // medir el caso en oscuro (scripts/contraste-png.ps1) antes.
  const PERMITIDOS: ReadonlyArray<{ archivo: string; contiene: string; porque: string }> = [
    // colorCondicion(): en oscuro clientesCss aplana TODAS las .pill con
    // color:#dbe2f7 !important.
    { archivo: 'app/clientes/ClientesClient.tsx', contiene: "color: '#3b6fd4'", porque: '.pill aplanada en oscuro' },
    { archivo: 'app/clientes/ClientesClient.tsx', contiene: "rgba(52,199,125,0.14)', color: '#1a8e5a'", porque: '.pill aplanada en oscuro' },
    { archivo: 'app/clientes/ClientesClient.tsx', contiene: "color: '#0e8f9e'", porque: '.pill aplanada en oscuro' },
    // Iniciales en blanco sobre el degradado del avatar: el fondo es el
    // mismo en los dos temas.
    { archivo: 'app/clientes/ClientesClient.tsx', contiene: "color: '#fff'", porque: 'blanco sobre degradado propio' },
    // Mapas de color por medio de pago: se usan como FONDO de puntitos.
    { archivo: 'app/panel/PanelClient.tsx', contiene: "{ label: '", porque: 'color de punto, no de texto' },
    // Idem en Caja. Verificado uso por uso (2026-09-16): los seis colores del
    // mapa MEDIOS entran como `background` de .pay-dot / .fsw / .medio-sw /
    // .reasign-sw / .rm-dot / .lx-pago .d y como `stroke` del donut SVG. En
    // ningún lado pintan texto, así que no hay nada que se vuelva ilegible.
    { archivo: 'app/caja/CajaClient.tsx', contiene: "{ label: '", porque: 'color de punto/arco, no de texto' },
    { archivo: 'app/caja/CajaClient.tsx', contiene: "label: 'Sin asignar'", porque: 'color de punto, no de texto' },
  ];

  it('encuentra archivos (si la carpeta cambia de lugar, esto no pasa en falso)', () => {
    expect(ARCHIVOS).toContain('app/panel/PanelClient.tsx');
    expect(ARCHIVOS).toContain('components/tasks/Pendientes.tsx');
  });

  for (const archivo of ARCHIVOS) {
    it(archivo, () => {
      const lineas = readFileSync(join(SRC, archivo), 'utf8').split('\n');
      const culpables = lineas
        .map((l, i) => ({ n: i + 1, l: l.trim() }))
        .filter(({ l }) => INLINE.test(l) || INLINE_VARIABLE.test(l))
        .filter(({ l }) => !PERMITIDOS.some((p) => p.archivo === archivo && l.includes(p.contiene)));
      expect(culpables).toEqual([]);
    });
  }
});

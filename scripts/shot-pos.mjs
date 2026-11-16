/**
 * Captura del POS logueado, vía Chrome DevTools Protocol sobre WebSocket.
 *
 * No hay Playwright ni puppeteer en el repo y no vale la pena agregarlos para
 * verificar una pantalla: se habla CDP directo con el Chrome del sistema.
 *
 * Uso:  node scripts/shot-pos.mjs <archivo.png> [#accion]
 *   accion: 'cobro' abre la hoja de cobro con un producto cargado.
 *
 * Notas aprendidas a los golpes:
 *   - Perfil FRESCO por corrida: si no, Chrome devuelve "Multiple targets" y
 *     el attach falla.
 *   - Ancho >= 1500px: abajo de eso el layout colapsa y la captura no
 *     representa lo que ve el owner.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


const OUT = process.argv[2] ?? 'pos.png';
const ACCION = process.argv[3] ?? '';
// BASE=http://localhost:3100 para capturar el build de PRODUCCIÓN (scripts/smoke-prod.sh).
const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = 'operador@pandora.dev';
const PASS = 'pandora-dev-1234';

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

const perfil = mkdtempSync(join(tmpdir(), 'pandora-shot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${perfil}`,
    // El alto se puede subir (VENTANA=1600x2200) para que una pantalla larga
    // entre ENTERA en la foto. El shell scrollea adentro de `main`, no en
    // `window`, así que un `scrollIntoView` mueve el contenedor pero la captura
    // sigue saliendo desde arriba: agrandar la ventana es lo que funciona.
    // El ancho no baja de 1500 — abajo de eso el layout colapsa.
    `--window-size=${process.env.VENTANA || '1600,1000'}`,
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json');
      const targets = await r.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* todavía no levantó */
    }
    await dormir(250);
  }
  throw new Error('Chrome no expuso ningún target');
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let id = 0;
const pendientes = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pendientes.has(msg.id)) {
    const { res, rej } = pendientes.get(msg.id);
    pendientes.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
});
const cmd = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pendientes.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const evaluar = async (expr) => {
  const r = await cmd('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.value;
};

await cmd('Page.enable');
await cmd('Runtime.enable');

async function ir(url) {
  if (process.env.ESPIAR) {
    await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__scrollLog = [];
      window.__frames = [];
      (function loop(){
        const m = document.querySelector('.main');
        if (m) window.__frames.push(Math.round(performance.now()) + ':' + m.scrollTop + '/' + m.scrollHeight);
        if (performance.now() < 3000) requestAnimationFrame(loop);
      })();
      document.addEventListener('scroll', (e) => {
        const t = e.target;
        const cls = (t && t.className && String(t.className).slice(0,30)) || String(t);
        window.__scrollLog.push(cls + '->' + (t.scrollTop ?? '-') + ' @' + Math.round(performance.now()));
      }, true);
    ` });
  }
  await cmd('Page.navigate', { url });
  await dormir(2200);
  if (process.env.TEMA) {
    await evaluar(`localStorage.setItem('pandora-theme', '${process.env.TEMA}')`);
    await cmd('Page.reload');
    await dormir(2200);
  }
}

// ── Login ──
await ir(`${BASE}/login`);
await evaluar(`(() => {
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(document.querySelector('input[type=email], input[name=email]'), ${JSON.stringify(EMAIL)});
  set(document.querySelector('input[type=password], input[name=password]'), ${JSON.stringify(PASS)});
  document.querySelector('form').requestSubmit();
  return true;
})()`);
await dormir(3500);

// ── POS ──
await ir(`${BASE}${process.env.RUTA || '/pos'}`);

// Clics previos, componibles con CUALQUIER acción (incluida "computados:").
// Lo que vive detrás de un click —un modal— no se mide si no se abre primero,
// y medir es lo único que no miente: el modal de denominaciones de /caja es
// donde se cuenta la plata y nunca había entrado a ninguna captura.
// Uso:  CLICS='Lectura X' RUTA=/caja TEMA=dark node scripts/shot-pos.mjs out.png "computados:.modal-card"
if (process.env.CLICS) {
  for (const texto of process.env.CLICS.split('|')) {
    // Un .click() sintético NO alcanza acá: el botón responde, React no. Se
    // despachan eventos de mouse reales por CDP sobre el centro del botón.
    const donde = JSON.parse(await evaluar(`JSON.stringify((()=>{
      const t = ${JSON.stringify(texto.trim())};
      const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.includes(t));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), que: b.tagName + '.' + String(b.className || '') };
    })())`));
    if (!donde.ok) { console.log(`CLIC>>> ${texto.trim()}: NO ENCONTRADO`); continue; }
    // Esperar la hidratación: sin esto el clic sale antes de que React escuche
    // y la medición posterior reporta "no encontrado" — una falla que se lee
    // igual que "el elemento no existe".
    for (let i = 0; i < 20; i++) {
      if (await evaluar(`(()=>{const b=[...document.querySelectorAll('button, a')].find((x)=>x.textContent.includes(${JSON.stringify(texto.trim())})); return !!b && Object.keys(b).some((k)=>k.startsWith('__react'));})()`) === true) break;
      await dormir(250);
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cmd('Input.dispatchMouseEvent', { type, x: donde.x, y: donde.y, button: 'left', clickCount: 1 });
    }
    console.log(`CLIC>>> ${texto.trim()}: ${donde.que} @${donde.x},${donde.y}`);
    await dormir(1200);
    // Qué quedó bajo el puntero: si el clic no abrió nada, esto dice si el
    // botón estaba tapado o si simplemente no pasó nada.
    console.log('CLIC-TRAS>>>', await evaluar(`JSON.stringify((()=>{
      const e = document.elementFromPoint(${donde.x}, ${donde.y});
      return { enPunto: e ? e.tagName + '.' + String(e.className || '') : null };
    })())`));
  }
}

if (ACCION === 'cliente') {
  // Cargar un producto, abrir el selector de cliente y elegir uno.
  await evaluar(`document.querySelector('.card')?.click(), true`);
  await dormir(2500);
  await evaluar(`[...document.querySelectorAll('.cust-cta')][0]?.click(), true`);
  await dormir(900);
  await evaluar(`(()=>{const b=[...document.querySelectorAll('.custsheet .pmrow')].find(x=>x.textContent.includes('Distribuidora')); b&&b.click(); return !!b;})()`);
  await dormir(2500);
  console.log('CLIENTE>>>', await evaluar(`JSON.stringify({
    nombre: document.querySelector('.cust-name')?.textContent.trim() ?? null,
    sub: document.querySelector('.cust-sub')?.textContent.trim() ?? null,
    boton: document.querySelector('.cust-cta')?.textContent.trim() ?? null,
  })`));
}

if (ACCION === 'carrito') {
  // /pos con una venta a medio armar: es como la cajera ve la pantalla la
  // mayor parte del día, y la versión vacía esconde la mitad del diseño (el
  // carrito, las líneas, el total). Agrega varias tarjetas con stock —una dos
  // veces, para que se vea una cantidad > 1— y no abre el cobro.
  for (let i = 0; i < 20; i += 1) {
    if (await evaluar(`!!document.querySelector('.card')`)) break;
    await dormir(500);
  }
  // Esperar la hidratación: un click previo se pierde sin avisar.
  for (let i = 0; i < 40; i += 1) {
    const listo = await evaluar(`(() => {
      const c = document.querySelector('.card');
      const k = c && Object.keys(c).find(x => x.startsWith('__reactProps'));
      return !!(k && typeof c[k].onClick === 'function');
    })()`);
    if (listo) break;
    await dormir(500);
  }
  for (const n of [0, 1, 0, 4, 5]) {
    await evaluar(`(() => {
      const cs = [...document.querySelectorAll('.card')].filter(c => !/agotado|0 uds/i.test(c.textContent));
      cs[${n}] && cs[${n}].click();
      return !!cs[${n}];
    })()`);
    await dormir(350);
  }
  await dormir(1200);
  console.log('CARRITO>>>', await evaluar(`JSON.stringify({
    lineas: document.querySelectorAll('.item').length,
    total: document.querySelector('.total')?.textContent?.replace(/\\s+/g,' ').slice(0,60) ?? null,
  })`));
}

if (ACCION === 'cobro') {
  // ESPERAR a que el catálogo esté pintado antes de clickear.
  //
  // Antes clickeaba `.card` de una. Si el catálogo todavía no había llegado,
  // el click no agarraba nada: el carrito quedaba en $0, el botón Cobrar
  // deshabilitado y la hoja NUNCA abría — pero la captura salía igual, con la
  // hoja abajo y a media opacidad. Eso se lee como "los textos quedaron
  // apagados en modo oscuro", que es una conclusión falsa sobre el CSS.
  for (let i = 0; i < 20; i += 1) {
    if (await evaluar(`!!document.querySelector('.card')`)) break;
    await dormir(500);
  }
  await evaluar(`document.querySelector('.card')?.click(), true`);
  await dormir(2500);
  await evaluar(`(() => {
    const b = [...document.querySelectorAll('button.cobrar')].pop();
    b && b.click();
    return !!b;
  })()`);
  await dormir(900);
  // Cargar un monto parcial en Efectivo para que se vea el estado "falta".
  await evaluar(`(() => {
    const inp = document.querySelector('.pmrow[data-k="efectivo"] .pmin');
    if (!inp) return false;
    inp.focus();
    const proto = Object.getPrototypeOf(inp);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, '500');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await dormir(600);
}

if (ACCION === 'gasto') {
  // /gastos: abrir el alta, ponerla en mercaderia y cargar un renglon del
  // detalle. Es la parte que el typecheck no puede verificar: que el buscador
  // traiga productos de verdad y que la suma del detalle cierre en vivo.
  const set = `(sel, v) => {
    const el = document.querySelector(sel); if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }`;
  // Parametrizable para poder CARGAR compras de verdad por la pantalla, que es
  // la unica forma de sembrar data que no miente: pasa por el service, deja el
  // lote y mueve el stock. Env: PROD (que buscar), QTY, COSTO, FECHA, TOTAL,
  // GUARDAR=1 para confirmar.
  const PROD = process.env.PROD || 'a';
  const QTY = process.env.QTY || '10';
  const COSTO = process.env.COSTO || '1000';
  const TOTAL = process.env.TOTAL || '12100';
  // Esperar la HIDRATACION antes de clickear. Sin esto el click sale antes de
  // que React escuche y el modal no abre — y todo lo que sigue reporta "sin
  // selector", que se lee como "el campo no existe" en vez de "llegue temprano".
  for (let i = 0; i < 24; i++) {
    const listo = await evaluar(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Nuevo gasto/i.test(b.textContent||''));
      return !!b && Object.keys(b).some(k=>k.startsWith('__react'));})()`);
    if (listo === true) break;
    await dormir(250);
  }
  await evaluar(`[...document.querySelectorAll('button')].find(b=>/Nuevo gasto/i.test(b.textContent||''))?.click(), true`);
  await dormir(1200);
  if ((await evaluar(`!!document.querySelector('#gMedio')`)) !== true) {
    console.log('🔴 el alta de gasto NO abrio: todo lo que sigue es ruido');
  }
  await evaluar(`((set) => { set('#gCat','mercaderia'); set('#gTotal',${JSON.stringify(TOTAL)});
    ${process.env.FECHA ? `set('#gFecha', ${JSON.stringify(process.env.FECHA)});` : ''}
    return true; })(${set})`);
  await dormir(500);
  // MEDIO=cuenta_corriente + PROVEEDOR=<parte del nombre>: carga la compra A
  // CUENTA CORRIENTE por la pantalla. Es la única forma de probar que el camino
  // del usuario existe de verdad — el service tenía 20 tests en verde mientras
  // el desplegable no ofrecía la opción y la deuda no podía nacer.
  if (process.env.MEDIO) {
    await evaluar(`((set) => set('#gMedio', ${JSON.stringify(process.env.MEDIO)}))(${set})`);
    await dormir(500);
  }
  if (process.env.PROVEEDOR) {
    console.log('PROVEEDOR>>>', await evaluar(`((set) => {
      const s = document.querySelector('#gProv'); if (!s) return 'sin selector';
      const o = [...s.options].find(o => o.textContent.includes(${JSON.stringify(process.env.PROVEEDOR)}));
      if (!o) return 'NO ESTA EN LA LISTA: ' + [...s.options].map(o=>o.textContent).join(' / ');
      set('#gProv', o.value); return 'elegido: ' + o.textContent;
    })(${set})`));
    await dormir(500);
  }
  console.log('FORM>>>', await evaluar(`JSON.stringify({
    etiquetaProv: document.querySelector('label[for="gProv"]')?.textContent ?? null,
    etiquetaTotal: document.querySelector('label[for="gTotal"]')?.textContent ?? null,
    medios: [...document.querySelectorAll('#gMedio option')].map(o=>o.value),
    avisoCaja: [...document.querySelectorAll('.pm-warn, .pm-note')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,110)),
    guardarHabilitado: !([...document.querySelectorAll('.pm-btn.primary')].pop()?.disabled ?? true),
  })`));
  await evaluar(`((set) => set('.det-busc input', ${JSON.stringify(PROD)}))(${set})`);
  await dormir(1500);
  console.log('OPCIONES>>>', await evaluar(`JSON.stringify([...document.querySelectorAll('.det-opi .det-opn')].map(e=>e.textContent))`));
  await evaluar(`document.querySelector('.det-opi')?.click(), true`);
  await dormir(700);
  await evaluar(`((set) => {
    const ins = [...document.querySelectorAll('.det-in')];
    const poner = (el, v) => { const p = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(p,'value').set.call(el, v);
      el.dispatchEvent(new Event('input',{bubbles:true})); };
    if (ins[0]) poner(ins[0], ${JSON.stringify(QTY)});
    if (ins[1]) poner(ins[1], ${JSON.stringify(COSTO)});
    return ins.length;
  })(${set})`);
  await dormir(700);
  console.log('DETALLE>>>', await evaluar(`JSON.stringify({
    renglones: document.querySelectorAll('.det-tr').length,
    subtotal: document.querySelector('.det-sub')?.textContent ?? null,
    suma: document.querySelector('.det-sum b')?.textContent ?? null,
    avisos: [...document.querySelectorAll('.det .pm-warn, .pm-warn')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,120)),
    guardar: (()=>{const b=[...document.querySelectorAll('.pm-btn.primary')].pop(); return b ? (b.disabled ? 'DESHABILITADO' : 'habilitado') : null;})(),
  })`));
  // ¿Se llega al boton de guardar con el detalle cargado? El modal crece y el
  // detalle lo empuja: si no scrollea, el boton queda fuera de la pantalla y
  // la pantalla no se puede usar aunque todo lo demas este bien.
  console.log('ALCANZABLE>>>', await evaluar(`(() => {
    const m = document.querySelector('.pmod');
    if (!m) return 'sin modal';
    m.scrollTop = m.scrollHeight;
    const b = [...document.querySelectorAll('.pm-btn.primary')].pop();
    if (!b) return 'sin boton';
    const r = b.getBoundingClientRect();
    return 'scrollea=' + (m.scrollHeight > m.clientHeight) +
      ' botonVisible=' + (r.top >= 0 && r.bottom <= window.innerHeight) +
      ' top=' + Math.round(r.top);
  })()`));
  await dormir(400);

  if (process.env.GUARDAR) {
    await evaluar(`(()=>{const b=[...document.querySelectorAll('.pm-btn.primary')].pop();
      if(!b || b.disabled) return 'no se puede guardar';
      b.click(); return 'guardado';})()`);
    await dormir(2600);
    console.log('GUARDADO>>>', await evaluar(`JSON.stringify({
      modalAbierto: !!document.querySelector('.pmod'),
      error: document.querySelector('.card.glass div[style*="c0384a"]')?.textContent ?? null,
      filas: document.querySelectorAll('.cl-list .clrow').length,
    })`));
  }
}

if (ACCION === 'inventario') {
  // /contador: leer el bloque del item 8 y dejarlo a la vista para la captura.
  // Se leen los NUMEROS, no se mira la foto: una captura linda con la cuenta
  // mal se ve igual de linda.
  await evaluar(`(()=>{const t=document.querySelector('.inv-tab'); t && t.scrollIntoView({block:'center'}); return !!t;})()`);
  await dormir(800);
  console.log('INVENTARIO>>>', await evaluar(`JSON.stringify({
    titulo: [...document.querySelectorAll('.card-title h3')].map(h=>h.textContent).find(t=>/Valorizado/.test(t)) ?? null,
    fecha: [...document.querySelectorAll('.card-title .upper-mini')].map(e=>e.textContent).find(t=>/^al /.test(t)) ?? null,
    kpis: (()=>{ const t=document.querySelector('.inv-tab'); if(!t) return null;
      const sec=t.closest('section'); return [...sec.querySelectorAll('.conc-stats > div')].map(d=>
        d.querySelector('.cs-k').textContent + ': ' + d.querySelector('.cs-v').textContent); })(),
    filas: [...document.querySelectorAll('.inv-tr')].map(r=>[...r.children].map(c=>c.textContent.replace(/\\s+/g,' ').trim()).join(' | ')),
    avisos: (()=>{ const t=document.querySelector('.inv-tab'); if(!t) return null;
      return [...t.closest('section').querySelectorAll('.label-sm')].map(p=>p.textContent.replace(/\\s+/g,' ').trim().slice(0,150)); })(),
  })`));
}

if (ACCION === 'anular') {
  // /gastos: abrir la confirmacion de anulacion de la primera fila. Es la que
  // dice QUE va a pasar antes de que pase (vuelve la plata, vuelve el stock).
  await evaluar(`(() => {
    const b = [...document.querySelectorAll('.gact.danger')][0];
    b && b.click();
    return !!b;
  })()`);
  await dormir(800);
  console.log('ANULAR>>>', await evaluar(`JSON.stringify({
    titulo: document.querySelector('.pmod .pm-title')?.textContent ?? null,
    sub: document.querySelector('.pmod .pm-sub')?.textContent ?? null,
    consecuencias: [...document.querySelectorAll('.pm-lista li')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,110)),
    confirmar: (()=>{const b=document.querySelector('.pm-btn.danger'); return b ? (b.disabled ? 'DESHABILITADO (falta motivo)' : 'habilitado') : null;})(),
  })`));
}

if (ACCION === 'comprobantes') {
  // /gastos: abrir los comprobantes de la primera fila (item 12).
  // Vive DETRAS DE UN CLICK, que es justo lo que en este proyecto nunca se
  // habia medido: el input del alta de cliente era #fff con texto casi blanco
  // en una pantalla que figuraba OK. Por eso esto no saca la foto nomas —
  // imprime los colores COMPUTADOS de lo que el modal dibuja.
  console.log('CLIP>>>', await evaluar(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('.gclip')][0];
    b && b.click();
    return { habia: !!b, total: document.querySelectorAll('.gclip').length };
  })())`));
  // 3500 y no 900: en dev el chunk del modal se compila recien en el primer
  // render, y con 900 la sonda volvia con TODO en null — que es justo el
  // "vacio que parece que paso algo" contra el que avisa la memoria.
  await dormir(3500);
  console.log('COMPROBANTES>>>', await evaluar(`JSON.stringify((()=>{
    const col = (sel, prop) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e)[prop] : null;
    };
    return {
      titulo: document.querySelector('.pmod .pm-title')?.textContent ?? null,
      zona: document.querySelector('.cmp-zona-txt')?.textContent?.replace(/\\s+/g,' ') ?? null,
      ocr: /OCR/i.test(document.querySelector('.pmod')?.textContent ?? '') ? 'HAY BADGE OCR' : 'sin OCR',
      boton: document.querySelector('.cmp-zona .pm-btn')?.textContent ?? null,
      filas: [...document.querySelectorAll('.cmp-fila')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,90)),
      // Lo que se mide, no lo que se cree: el texto de la zona sobre su fondo.
      zona_fg: col('.cmp-zona-txt small', 'color'),
      zona_bg: col('.cmp-zona', 'backgroundColor'),
      zona_borde: col('.cmp-zona', 'borderTopColor'),
      titulo_fg: col('.cmp-zona-txt b', 'color'),
      falta_fg: col('.cmp-falta', 'color'),
      modal_bg: col('.pmod', 'backgroundColor'),
      // Rectangulos para medir el contraste sobre PIXELES con
      // scripts/contraste-png.ps1. El CSS miente cuando atras hay degradado y
      // vidrio: en esta pantalla el fondo del modal es translucido.
      rects: Object.fromEntries(['.cmp-zona-txt small', '.cmp-zona-txt b', '.cmp-falta', '.cmp-datos b']
        .map(s => {
          const e = document.querySelector(s);
          if (!e) return [s, null];
          const r = e.getBoundingClientRect();
          return [s, [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]];
        })),
    };
  })())`));
}

if (ACCION === 'adjuntos-contador') {
  // /contador: abrir la lista de comprobantes adjuntos del periodo (slice 4).
  // Otra cosa que vive DETRAS DE UN CLICK. Y ademas hay que verificar la
  // clase del boton: `.pm-btn` no existe en esta pantalla y un boton con una
  // clase ajena se dibuja como texto pelado sin que nada falle.
  // ¿Hidrato ALGO de la pantalla? Si el selector de periodo —que existe desde
  // mucho antes de este slice— tampoco tiene onClick, el problema no es del
  // bloque nuevo.
  console.log('HIDRATACION>>>', await evaluar(`JSON.stringify((() => {
    const conOnClick = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return 'no existe';
      const k = Object.keys(e).find(x => x.startsWith('__reactProps'));
      return k ? (typeof e[k].onClick === 'function' ? 'SI' : 'sin onClick') : 'sin fiber';
    };
    return {
      seg_periodo: conOnClick('.seg button'),
      exportar: conOnClick('.exp-btn'),
      // OJO: 'nextjs-portal' NO indica un error. Es tambien el indicador de
      // dev de Next, asi que esta presente siempre; mirarlo me hizo perder un
      // rato creyendo que habia un overlay de error. Lo que decide es el
      // fiber de arriba, no esto.
      portal_dev: !!document.querySelector('nextjs-portal'),
      scripts: document.querySelectorAll('script[src]').length,
    };
  })())`));
  // Esperar a que React le cuelgue el onClick ANTES de clickear. /contador
  // hace muchas consultas y con la espera fija de arriba a veces el click cae
  // antes de la hidratacion: se pierde en silencio y la lista "no aparece",
  // que desde afuera se ve igual que un bug. Se espera la condicion, no un
  // numero de milisegundos.
  for (let i = 0; i < 40; i++) {
    const listo = await evaluar(`(() => {
      const b = document.querySelector('.adj-bloque button');
      if (!b) return false;
      const k = Object.keys(b).find(x => x.startsWith('__reactProps'));
      return !!(k && typeof b[k].onClick === 'function');
    })()`);
    if (listo) break;
    await dormir(500);
  }
  console.log('BOTON>>>', await evaluar(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('.adj-bloque button')][0];
    if (!b) return { habia: false };
    const cs = getComputedStyle(b);
    const estaba = b.disabled;
    // ¿React le colgo un onClick? Sin esto, "la pantalla no hidrato" y "la
    // accion no devolvio nada" se ven EXACTAMENTE igual desde afuera.
    const props = Object.keys(b).find(k => k.startsWith('__reactProps'));
    const hidratado = props ? typeof b[props].onClick === 'function' : false;
    b.click();
    return { habia: true, disabled: estaba, hidratado, clases: b.className,
             texto: b.textContent, bg: cs.backgroundColor, borde: cs.borderTopColor };
  })())`));
  // 9000 y no 3500: el server action se compila recien en el primer uso y
  // ademas consulta la base. Un numero corto devuelve todo vacio, que es
  // indistinguible de "no hay comprobantes" — el falso negativo de siempre.
  await dormir(9000);
  console.log('ADJUNTOS>>>', await evaluar(`JSON.stringify((()=>{
    const col = (sel, prop) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e)[prop] : null;
    };
    return {
      filas: [...document.querySelectorAll('.adj-lista li')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,90)),
      pie: [...document.querySelectorAll('.adj-bloque .label-sm')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,140)),
      // Si la accion fallo la pantalla lo dice acá. Sin esto, "no renderizo
      // nada" y "renderizo el error" se ven igual desde la sonda.
      err: document.querySelector('.label-sm.err')?.textContent?.replace(/\\s+/g,' ') ?? null,
      bloque_existe: !!document.querySelector('.adj-bloque'),
      tema: document.documentElement.getAttribute('data-theme'),
      fecha_fg: col('.adj-fecha', 'color'),
      nro_fg: col('.adj-nro', 'color'),
      quien_fg: col('.adj-quien', 'color'),
      bajar_bg: col('.adj-bajar', 'backgroundColor'),
      // Rectangulos para medir sobre PIXELES: el CSS miente sobre vidrio.
      rects: Object.fromEntries(['.adj-fecha', '.adj-nro', '.adj-quien', '.adj-bloque .label-sm', '.adj-bajar']
        .map(s => {
          const e = document.querySelector(s);
          if (!e) return [s, null];
          const r = e.getBoundingClientRect();
          return [s, [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]];
        })),
    };
  })())`));
}

if (ACCION === 'contratos') {
  // /gastos: abrir los contratos del primer proveedor que tenga ficha.
  //
  // Se espera ANTES de clickear: un `.click()` sobre un boton que React
  // todavia no hidrato no hace nada y no avisa, y la sonda vuelve con todo en
  // null — que se lee como "el modal esta roto" cuando el problema es el
  // timing del instrumento.
  await dormir(2500);
  console.log('CLIP>>>', await evaluar(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('.gprov .gclip')][0];
    b && b.click();
    return { habia: !!b, total: document.querySelectorAll('.gprov .gclip').length };
  })())`));
  await dormir(3500);
  console.log('CONTRATOS>>>', await evaluar(`JSON.stringify((()=>{
    const col = (sel, prop) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e)[prop] : null;
    };
    const rect = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    };
    return {
      titulo: document.querySelector('.pmod .pm-title')?.textContent ?? null,
      zona: document.querySelector('.cmp-zona-txt')?.textContent?.replace(/\\s+/g,' ') ?? null,
      filas: [...document.querySelectorAll('.cmp-fila')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,95)),
      vencidos: document.querySelectorAll('.cmp-vencido').length,
      boton_bloqueado: document.querySelector('.cmp-zona .pm-btn')?.disabled ?? null,
      vencido_fg: col('.cmp-vencido', 'color'),
      vencido_bg: col('.cmp-vencido', 'backgroundColor'),
      vig_label_fg: col('.cmp-vig label', 'color'),
      rects: { vencido: rect('.cmp-vencido'), vig: rect('.cmp-vig label'), fila: rect('.cmp-datos b') },
    };
  })())`));
}

if (ACCION === 'ajuste' || ACCION === 'historial') {
  // /productos: seleccionar el producto PROD (por nombre) en la lista.
  const PROD = process.env.PROD || 'Yerba';
  const elegido = await evaluar(`(() => {
    const fila = [...document.querySelectorAll('.prow')].find(r => r.textContent.includes(${JSON.stringify(PROD)}));
    fila && fila.click();
    return fila ? fila.textContent.replace(/\\s+/g,' ').slice(0,60) : null;
  })()`);
  console.log('PRODUCTO>>>', elegido);
  await dormir(600);
  // Un click antes de que React hidrate se pierde en silencio y la pantalla
  // queda en el primer producto: se lee la fila SELECCIONADA, no la clickeada.
  for (let i = 0; i < 5; i++) {
    const sel = await evaluar(`document.querySelector('.prow.sel')?.textContent ?? ''`);
    if (sel.includes(PROD)) break;
    await evaluar(`[...document.querySelectorAll('.prow')].find(r => r.textContent.includes(${JSON.stringify(PROD)}))?.click(), true`);
    await dormir(800);
  }
  console.log('SELECCIONADO>>>', await evaluar(`(document.querySelector('.prow.sel')?.textContent ?? 'ninguno').replace(/\\s+/g,' ').slice(0,40)`));
  // El tema se FUERZA en el atributo, además del localStorage de ir(): si la
  // pantalla no lee esa clave al arrancar, una captura "oscura" sale clara y no
  // prueba nada. Y se leen COLORES CALCULADOS, no la foto.
  if (process.env.TEMA) {
    await evaluar(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(process.env.TEMA)}), true`);
    await dormir(400);
  }
  console.log('TEMA>>>', await evaluar(`JSON.stringify({
    atributo: document.documentElement.getAttribute('data-theme'),
    fondoCard: (()=>{const c=document.querySelector('.cli-grid > .card'); return c ? getComputedStyle(c).backgroundColor : null;})(),
    textoFila: (()=>{const r=document.querySelector('.prow'); return r ? getComputedStyle(r).color : null;})(),
    fondoBody: getComputedStyle(document.body).backgroundColor,
  })`));
}

if (ACCION === 'ajuste') {
  // Abrir el ajuste, elegir motivo (MOTIVO = texto del botón), sentido
  // (SENTIDO=sumar|restar) y cantidad (QTY). GUARDAR=1 lo registra de verdad,
  // por la pantalla — la única forma de sembrar un ajuste que no miente.
  const set = `(sel, v) => {
    const el = document.querySelector(sel); if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }`;
  const clickTexto = (sel, texto) =>
    `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => (b.textContent||'').includes(${JSON.stringify(texto)}))?.click(), true`;
  await evaluar(clickTexto('.cd-btns button', 'Ajustar'));
  await dormir(700);
  if (process.env.MOTIVO) await evaluar(clickTexto('.aj-motivo', process.env.MOTIVO));
  await dormir(300);
  if (process.env.SENTIDO === 'sumar') await evaluar(clickTexto('.aj-seg button', 'Sumar'));
  await evaluar(`((set) => set('#ajCant', ${JSON.stringify(process.env.QTY || '2')}))(${set})`);
  if (process.env.DETALLE) await evaluar(`((set) => set('#ajDet', ${JSON.stringify(process.env.DETALLE)}))(${set})`);
  await dormir(500);
  const leerModal = `JSON.stringify({
    abierto: !!document.querySelector('.pmod'),
    sub: document.querySelector('.pmod .pm-sub')?.textContent ?? null,
    motivo: document.querySelector('.aj-motivo.on')?.textContent ?? null,
    sumarDeshabilitado: [...document.querySelectorAll('.aj-seg button')].find(b=>/Sumar/.test(b.textContent))?.disabled ?? null,
    preview: [...document.querySelectorAll('.pmod .pm-prev .pv')].map(e=>e.textContent),
    errores: [...document.querySelectorAll('.pmod .aj-err, .pmod .pm-warn.show')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,140)),
    registrar: (()=>{const b=document.querySelector('.pmod .pm-btn.primary'); return b ? (b.disabled ? 'DESHABILITADO' : 'habilitado') : null;})(),
  })`;
  console.log('AJUSTE>>>', await evaluar(leerModal));
  if (process.env.GUARDAR === '1') {
    await evaluar(`document.querySelector('.pmod .pm-btn.primary')?.click(), true`);
    await dormir(2500);
    console.log('DESPUES>>>', await evaluar(`JSON.stringify({
      modalSigueAbierto: !!document.querySelector('.pmod'),
      errores: [...document.querySelectorAll('.pmod .aj-err, .pmod .pm-warn.show')].map(e=>e.textContent.slice(0,140)),
      stockDetalle: [...document.querySelectorAll('.kv b.tnum')].map(e=>e.textContent)[0] ?? null,
    })`));
  }
}

if (ACCION === 'historial') {
  await evaluar(`[...document.querySelectorAll('.cd-btns button')].find(b => /Historial/.test(b.textContent||''))?.click(), true`);
  await dormir(2000);
  console.log('HISTORIAL>>>', await evaluar(`JSON.stringify({
    sub: document.querySelector('.pmod .pm-sub')?.textContent ?? null,
    filas: [...document.querySelectorAll('.hs-row')].map(r => [...r.children].map(c => c.textContent.replace(/\\s+/g,' ').trim()).join(' | ')),
    pie: [...document.querySelectorAll('.pmod .pm-note, .pmod .pm-warn.show')].map(e=>e.textContent.replace(/\\s+/g,' ').slice(0,120)),
  })`));
}

if (ACCION === 'anulados') {
  // /gastos: abrir la pestaña Anulados y leer las filas como las ve el usuario.
  for (let i = 0; i < 5; i++) {
    const on = await evaluar(`document.querySelector('.gf.on')?.textContent ?? ''`);
    if (/Anulados/.test(on)) break;
    await evaluar(`[...document.querySelectorAll('.gf')].find(b => /Anulados/.test(b.textContent||''))?.click(), true`);
    await dormir(800);
  }
  console.log('ANULADOS>>>', await evaluar(`JSON.stringify({
    pestania: document.querySelector('.gf.on')?.textContent ?? null,
    filas: [...document.querySelectorAll('.clrow.anulada')].map(r => r.textContent.replace(/\\s+/g,' ').trim().slice(0, 140)),
  })`));
}

if (ACCION === 'export-ventas') {
  // /contador: apretar "Exportar ventas" y leer QUÉ archivo baja (H-02).
  // El CSV se arma con un Blob y un <a download> que se clickea solo: se
  // intercepta ese click para quedarse con el nombre y el contenido. Es la
  // única forma de ver el bug del año corrido, que no daba ningún error —
  // el archivo salía bien formado con el año equivocado.
  for (let i = 0; i < 40; i++) {
    const listo = await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Exportar ventas/.test(x.textContent || ''));
      const k = b && Object.keys(b).find(x => x.startsWith('__reactProps'));
      return !!(k && typeof b[k].onClick === 'function');
    })()`);
    if (listo) break;
    await dormir(500);
  }
  // 🔴 El Blob se captura en createObjectURL, NO con fetch(href) en el click:
  // la pantalla hace a.click() y en la línea siguiente revokeObjectURL, así
  // que un fetch asincrónico llega con el link ya revocado. La primera
  // versión de esta sonda volvía `descarga: null` en los cuatro granos y se
  // leía igual que "el botón no exporta".
  await evaluar(`(() => {
    window.__descarga = null;
    const blobs = new Map();
    const crear = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = crear(b); blobs.set(u, b); return u; };
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        const nombre = this.download;
        const blob = blobs.get(this.href);
        (blob ? blob.text() : Promise.resolve('')).then(t => {
          // Las FILAS, no sólo el nombre: el nombre y la consulta salen del
          // mismo período y no pueden contradecirse. Lo que puede fallar es
          // que las filas caigan fuera del rango que el nombre promete.
          const fechas = t.split('\\n').slice(1)
            .map(l => (l.split(';')[0] || '').trim())
            .filter(f => /^\\d{4}-\\d{2}-\\d{2}$/.test(f))
            .sort();
          window.__descarga = {
            nombre,
            lineas: t.split('\\n').length,
            filas_con_fecha: fechas.length,
            fecha_min: fechas[0] ?? null,
            fecha_max: fechas[fechas.length - 1] ?? null,
            cabecera: t.split('\\n')[0].slice(0, 100),
            ultima: t.trim().split('\\n').pop().slice(0, 120),
          };
        });
        return;
      }
      return original.call(this);
    };
    [...document.querySelectorAll('button')].find(x => /Exportar ventas/.test(x.textContent || ''))?.click();
    return true;
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await evaluar(`!!window.__descarga`)) break;
    await dormir(500);
  }
  console.log('DESCARGA>>>', await evaluar(`JSON.stringify({
    etiqueta: document.querySelector('.bar-sub')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
    descarga: window.__descarga,
    error: document.querySelector('.label-sm.err')?.textContent ?? null,
  })`));
}

if (ACCION === 'export') {
  // /gastos: abrir "Exportar para el estudio" y leer los cuatro items como los
  // ve quien exporta. Sus subtextos describen QUE LLEVA cada archivo, y uno de
  // ellos decia "lo que se les pago" sobre una consulta que no filtra por pago.
  // Sin abrir el menu eso no se mide nunca — vive detras de un click.
  for (let i = 0; i < 5; i++) {
    const abierto = await evaluar(`document.querySelector('.tipo-dd.open') ? '1' : ''`);
    if (abierto === '1') break;
    await evaluar(`[...document.querySelectorAll('button')].find(b=>/Exportar para el estudio/.test(b.textContent||''))?.click(), true`);
    await dormir(700);
  }
  const abierto = await evaluar(`document.querySelector('.tipo-dd.open') ? '1' : ''`);
  if (abierto !== '1') console.log('🔴 el menu de export NO abrio');
  console.log('EXPORT>>>', await evaluar(`JSON.stringify(
    [...document.querySelectorAll('.tipo-menu .tm-item')].map(b => ({
      titulo: b.querySelector('.tt')?.textContent ?? null,
      sub: (b.querySelector('.ss')?.textContent ?? '').replace(/\\s+/g,' ').trim(),
      deshabilitado: b.disabled,
    }))
  )`));
}

if (ACCION === 'modal') {
  // Abrir el alta y cargar precio/costo para ver el calculo en vivo.
  await evaluar(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Nuevo producto'))?.click(), true`);
  await dormir(900);
  await evaluar(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel); if (!el) return false;
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, v);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    };
    set('#pmName','Coca-Cola 2,25L');
    set('#pmPrecio','1890');
    set('#pmCosto','1285');
    return true;
  })()`);
  await dormir(700);
}
// Scrollear al fondo para comprobar que la reposicion es ALCANZABLE.
// SOLO bajo pedido (FONDO=1): dejarlo siempre encendido hacia que despues yo
// mismo midiera ese scroll y lo reportara como un bug de la pantalla. La
// herramienta de diagnostico no puede mover lo que esta midiendo.
if (process.env.FONDO) {
  await evaluar(`(()=>{ const b=document.querySelector('.quick'); b && b.scrollIntoView({block:'center'}); return true; })()`);
  await dormir(700);
}
// VER=<selector>: traer a cuadro algo que quedo abajo del pliegue.
//
// Sin esto, una tarjeta al pie de una pantalla larga sale fuera de la captura y
// "no se ve en la foto" se confunde con "no existe" — que es la misma trampa
// que tuvo lo que vive detras de un click. Dice explicitamente si lo encontro.
if (process.env.VER) {
  const hallado = await evaluar(
    `(()=>{const e=document.querySelector(${JSON.stringify(process.env.VER)});
           if(!e) return false; e.scrollIntoView({block:'center'}); return true;})()`
  );
  console.log(`VER>>> ${process.env.VER}: ${hallado === true ? 'en cuadro' : '🔴 NO ENCONTRADO'}`);
  await dormir(700);
}
console.log('SCROLL>>>', await evaluar(`JSON.stringify({
  paginaScrollea: document.documentElement.scrollHeight > window.innerHeight,
  scrollY: Math.round(window.scrollY),
  ordenAhoraVisible: (()=>{const b=document.querySelector('.quick');if(!b)return null;const r=b.getBoundingClientRect();return r.top>=0 && r.bottom<=window.innerHeight;})(),
})`));
const cuerpo = await evaluar("document.body.innerText.slice(0,400)");
console.log('BODY>>>', JSON.stringify(cuerpo));
if (process.env.TECLADO) {
  await evaluar(`document.querySelector('.tipo-btn')?.focus()`);
  await dormir(300);
  const tecla = async (key, code, vk) => {
    for (const type of ['keyDown','keyUp']) {
      await cmd('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }
    await dormir(250);
  };
  await tecla('ArrowDown','ArrowDown',40); // abre
  await tecla('ArrowDown','ArrowDown',40); // -> Estudiantes
  await tecla('ArrowDown','ArrowDown',40); // -> Jubilados
  await tecla('Enter','Enter',13);         // elige
  await dormir(600);
} else if (process.env.MODAL) {
  await evaluar(`(()=>{const bs=[...document.querySelectorAll('button')];
    const b=bs.find(x=>/Nuevo (cliente|producto)/i.test(x.textContent||'')); if(b) b.click(); return !!b;})()`);
  await dormir(900);
} else if (process.env.ABRIR_DD) {
  await evaluar(`(()=>{const b=document.querySelector('.tipo-btn'); if(b) b.click(); return !!b;})()`);
  await dormir(1200);
}

const alin = await evaluar(`(()=>{
  const h=document.querySelector('.cl-colhead');
  const r=document.querySelector('.cl-list button, .cl-list > div[class*=row]');
  if(!h||!r) return 'sin tabla';
  const hs=[...h.children].map(e=>Math.round(e.getBoundingClientRect().left));
  const rs=[...r.children].map(e=>Math.round(e.getBoundingClientRect().left));
  return 'titulos='+hs.join(',')+' | celdas='+rs.join(',')+' | nHead='+hs.length+' nFila='+rs.length;
})()`);
console.log('ALINEACION', alin);
const tb = await evaluar(`(()=>{const t=document.querySelector('.topbar'); if(!t) return 'NO ESTA EN EL DOM';
 const r=t.getBoundingClientRect(); const cs=getComputedStyle(t);
 return 'alto='+Math.round(r.height)+' top='+Math.round(r.top)+' display='+cs.display+' vis='+cs.visibility+' opacity='+cs.opacity+' hijos='+t.children.length;})()`);
console.log('TOPBAR', tb);
const lay = await evaluar(`(()=>{const sh=document.querySelector('.shell'),mn=document.querySelector('.main');
 const q=e=>e?Math.round(e.getBoundingClientRect().height)+'/scroll'+e.scrollHeight+'/top'+e.scrollTop:'-';
 return 'shell='+q(sh)+' main='+q(mn)+' rows='+(sh?getComputedStyle(sh).gridTemplateRows:'-')+' winScroll='+window.scrollY+' docScroll='+document.documentElement.scrollTop;})()`);
console.log('LAYOUT', lay);
const foc = await evaluar(`(()=>{const a=document.activeElement; if(!a) return 'ninguno';
 const r=a.getBoundingClientRect();
 return a.tagName+'.'+(a.className||'')+'#'+(a.id||'')+' top='+Math.round(r.top);})()`);
console.log('FOCO', foc);
const evo = await evaluar(`(async()=>{const m=document.querySelector('.main');const o=[];
 for(let i=0;i<6;i++){o.push(m.scrollTop+'@'+m.scrollHeight); await new Promise(r=>setTimeout(r,400));}
 m.scrollTop=0; await new Promise(r=>setTimeout(r,600)); o.push('tras-poner-0:'+m.scrollTop);
 return o.join(' ');})()`);
console.log('EVOLUCION', evo);
const md = await evaluar(`(()=>{const ov=document.querySelector('[class*=modal],[class*=ov],.pm-head');
 const ins=[...document.querySelectorAll('input,select,textarea')].map(e=>e.id||e.name||e.tagName);
 const bajo=[...document.querySelectorAll('.main *')].filter(e=>e.getBoundingClientRect().bottom>1100).length;
 return 'modalEnDom='+!!ov+' inputs='+ins.join(',')+' | elementosMuyAbajo='+bajo;})()`);
console.log('MODAL', md);
if (process.env.MODAL) {
  const mm = await evaluar(`(()=>{const m=document.querySelector('.pmod,.modal');
   if(!m) return 'sin modal';
   const r=m.getBoundingClientRect(); const cs=getComputedStyle(m);
   const ov=document.querySelector('.pm-backdrop,.pmov,.modal-ov');
   const ocs=ov?getComputedStyle(ov):null;
   return 'clase='+m.className+' ancho='+Math.round(r.width)+' alto='+Math.round(r.height)
    +' x='+Math.round(r.left)+' y='+Math.round(r.top)
    +' pos='+cs.position+' radio='+cs.borderRadius+' pad='+cs.padding
    +' anim='+(cs.animationName||'none')+'/'+cs.animationDuration
    +' || overlay='+(ov?ov.className+' z='+ocs.zIndex+' bg='+ocs.backgroundColor+' blur='+ocs.backdropFilter+' display='+ocs.display:'NINGUNO');})()`);
  console.log('MODALINFO', mm);
}
if (process.env.ESPIAR) {
  const sl = await evaluar(`JSON.stringify((window.__scrollLog||[]).slice(0,12))`);
  console.log('SCROLLLOG', sl);
  const fr = await evaluar(`(()=>{const f=window.__frames||[];const out=[];let ant=null;
    for(const x of f){const v=x.split(':')[1]; if(v!==ant){out.push(x); ant=v;}}
    return out.slice(0,20).join('  ');})()`);
  console.log('FRAMES', fr);
}
const diag = await evaluar(process.env.RUTA === '/clientes' ? `JSON.stringify({
  url: location.pathname,
  filas: document.querySelectorAll('.clrow').length,
  avatares: document.querySelectorAll('.clrow .clav').length,
  buscadorTopbar: document.querySelector('.topbar .search input')?.placeholder ?? null,
  filtrosTopbar: [...document.querySelectorAll('.topbar .seg button')].map(b=>b.textContent.trim()),
  tipoDD: document.querySelector('.topbar .tipo-btn') !== null,
  barIcon: document.querySelector('.bar-icon') !== null,
  barBotones: [...document.querySelectorAll('.bar-actions button')].map(b=>b.textContent.trim()+(b.disabled?' [off]':'')),
  detTipoComercial: document.querySelector('.cd-tipos .upper-mini')?.textContent.trim() ?? null,
  detContacto: document.querySelectorAll('.cd-contact div').length,
  tituloLista: document.querySelector('.card-title h3')?.textContent.trim() ?? null,
  chevrons: document.querySelectorAll('.clrow .clgo').length,
  compras: [...document.querySelectorAll('.clcompras')].map(e=>e.textContent.trim()).slice(0,3),
  ultimas: [...document.querySelectorAll('.clult')].map(e=>e.textContent.trim()).slice(0,3),
  pillFondo: (()=>{const e=document.querySelector('.clrow .pill');return e?getComputedStyle(e).backgroundColor:null;})(),
  kpis: [...document.querySelectorAll('.kpis .k-v')].map(e=>e.textContent.trim()),
  condiciones: [...document.querySelectorAll('.seg button')].map(b=>b.textContent.trim()),
  segmentos: [...new Set([...document.querySelectorAll('.clrow .tag-com')].map(e=>e.textContent.trim()))],
  pillsFiscales: [...new Set([...document.querySelectorAll('.clrow .pill')].map(e=>e.textContent.trim()))],
  detalle: document.querySelector('.cd-name')?.textContent.trim() ?? null,
  navActivo: document.querySelector('.nav-item.active')?.textContent.trim() ?? null,
  kpiBadColor: (()=>{const e=document.querySelector('.k.bad .k-v');return e?getComputedStyle(e).color:null;})(),
  tema: document.documentElement.getAttribute('data-theme'),
  chips: [...document.querySelectorAll('.seg.glass button')].map(b=>b.textContent.trim()),
  tipoLbl: document.querySelector('.tipo-btn .tb-lbl')?.textContent.trim() ?? null,
  tipoSvgs: document.querySelectorAll('.tipo-btn svg').length,
  alineacion: (()=>{
    const h=[...document.querySelectorAll('.cl-colhead > span')].map(e=>Math.round(e.getBoundingClientRect().left));
    const r=document.querySelector('.clrow');
    if(!r) return 'sin filas';
    const kids=[...r.children];
    // La fila arranca con avatar+main donde el encabezado tiene un solo hueco.
    const cel=[kids[0], kids[2], kids[3], kids[4], kids[5], kids[6]].map(e=>e?Math.round(e.getBoundingClientRect().left):null);
    return h.map((x,i)=>x+'/'+cel[i]+(x===cel[i]?'=':' DESFASE '+(cel[i]-x))).join(' | ');
  })(),
  btnLbl: document.querySelector('.tipo-btn .tb-lbl')?.textContent.trim() ?? null,
  filas: document.querySelectorAll('.clrow').length,
  focoEnBoton: document.activeElement === document.querySelector('.tipo-btn'),
  ddOnBg: (()=>{const e=document.querySelector('.tm-item.on');return e?getComputedStyle(e).backgroundColor+' | '+getComputedStyle(e).color+' | '+getComputedStyle(e).fontSize:null;})(),
  ddAria: (()=>{const b=document.querySelector('.tipo-btn');const m=document.querySelector('.tipo-menu');return b?[b.getAttribute('aria-expanded'),b.getAttribute('aria-haspopup'),b.getAttribute('aria-activedescendant')?'act':'sin-act',m?.getAttribute('role')].join('/'):null;})(),
  ddBtn: !!document.querySelector('.tipo-btn'),
  ddMenuEnDom: !!document.querySelector('.tipo-menu'),
  ddAbierto: !!document.querySelector('.tipo-dd.open'),
  ddItems: [...document.querySelectorAll('.tipo-menu .tm-item')].map(e=>e.textContent.trim()),
  ddItemFont: (()=>{const e=document.querySelector('.tm-item');return e?getComputedStyle(e).fontSize+' / '+getComputedStyle(e).fontFamily.split(',')[0]:null;})(),
  ddMenuBg: (()=>{const e=document.querySelector('.tipo-menu');return e?getComputedStyle(e).backdropFilter:null;})(),
  toolsTopbar: document.querySelectorAll('.topbar .top-tools .iconbtn').length,
  kpiCards: [...document.querySelectorAll('.kpis .k')].map(k=>({
     t:k.querySelector('.k-k')?.textContent.trim(),
     v:k.querySelector('.k-v')?.textContent.trim(),
     f:k.querySelector('.k-f')?.textContent.trim(),
     spark: !!k.querySelector('.k-spark')})),
  deudoresCard: (()=>{const t=[...document.querySelectorAll('.card-title h3')].find(h=>/Deudores/.test(h.textContent));
    if(!t) return 'NO ESTA';
    const card=t.closest('.card');
    const total=card.querySelector('.pill')?.textContent.trim();
    const filas=[...card.querySelectorAll('.stock-row')].map(r=>r.querySelector('.stock-name')?.textContent.trim()+' = '+r.querySelector('.stock-q')?.textContent.trim());
    return 'total='+total+' | '+filas.join(' | ');})(),
  spark: (()=>{const p=document.querySelector('.cd-spark path:last-of-type');return p?p.getAttribute('d').slice(0,60)+'...':'sin curva';})(),
  saldos: [...document.querySelectorAll('.clrow .cc')].map(e=>e.textContent.trim()).slice(0,4),
  altoFila: Math.round(document.querySelector('.clrow')?.getBoundingClientRect().height ?? 0),
  shellH: Math.round(document.querySelector('.shell')?.getBoundingClientRect().height ?? 0),
  mainH: Math.round(document.querySelector('.main')?.getBoundingClientRect().height ?? 0),
  errores: window.__errs ?? 0,
})` : process.env.RUTA === '/productos' ? `JSON.stringify({
  url: location.pathname,
  filas: document.querySelectorAll('.prow').length,
  chips: [...document.querySelectorAll('.seg button')].map(b=>b.textContent.trim()),
  rubros: [...document.querySelectorAll('.prow .pill')].map(p=>p.textContent.trim()).filter((v,i,a)=>a.indexOf(v)===i),
  margenes: [...document.querySelectorAll('.pmargen')].map(m=>m.textContent.trim()).slice(0,4),
  estados: [...document.querySelectorAll('.prow .estado')].map(e=>e.textContent.trim()).filter((v,i,a)=>a.indexOf(v)===i),
  ley19: document.querySelectorAll('.prow .ley19').length,
  kpiValores: [...document.querySelectorAll('.kpis .k-v')].map(e=>e.textContent.trim()),
  botonesBarra: [...document.querySelectorAll('.bar-actions button')].map(b=>b.textContent.trim()+(b.disabled?' [off]':'')),
  altoFila: Math.round(document.querySelector('.stock-row')?.getBoundingClientRect().height ?? 0),
  sideRect: (()=>{const e=document.querySelector('.col-side');if(!e)return null;const r=e.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height)};})(),
  gridScroll: (()=>{const e=document.querySelector('.cli-grid');return e?{sh:e.scrollHeight,ch:e.clientHeight}:null;})(),
  ordenVisible: (()=>{const b=document.querySelector('.quick');if(!b)return null;const r=b.getBoundingClientRect();return {bottom:Math.round(r.bottom), dentro:r.bottom<=window.innerHeight};})(),
  estilos: (()=>{
    const cs = (sel, props) => { const e=document.querySelector(sel); if(!e) return null;
      const c=getComputedStyle(e); const o={}; props.forEach(p=>o[p]=c[p]); return o; };
    return {
      fila: cs('.stock-row',['fontSize','padding','height','backgroundColor']),
      nombre: cs('.stock-name',['fontSize','fontWeight']),
      thumb: cs('.rthumb',['width','height','fontSize']),
      monto: cs('.repoped',['fontSize','padding','backgroundColor']),
      boton: cs('.quick',['fontSize','backgroundColor','borderRadius','opacity','padding']),
      card: cs('.col-side .card.glass:last-of-type',['padding']),
    };
  })(),
  navActivo: document.querySelector('.nav-item.active')?.textContent.trim() ?? null,
  navItems: [...document.querySelectorAll('.nav-item')].map(a=>a.textContent.trim()+'->'+(a.getAttribute('href')||'SIN-HREF')),
  repoFilas: document.querySelectorAll('.stock-row').length,
  repoSugeridos: [...document.querySelectorAll('.repoped')].map(e=>e.textContent.trim()),
  repoDetalles: [...document.querySelectorAll('.stock-row .stock-name span')].map(e=>e.textContent.trim()),
  ordenCompraDeshab: document.querySelector('.quick')?.disabled ?? null,
  historialDeshab: document.querySelector('.hbtn')?.disabled ?? null,
  detalle: document.querySelector('.pd-name')?.textContent.trim() ?? null,
  pie: document.querySelector('.cl-foot')?.textContent.trim() ?? null,
  innerH: window.innerHeight,
  shellH: Math.round(document.querySelector('.shell')?.getBoundingClientRect().height ?? 0),
  mainH: Math.round(document.querySelector('.main')?.getBoundingClientRect().height ?? 0),
  errores: window.__errs ?? 0,
})` : `JSON.stringify({
  url: location.pathname,
  filas: document.querySelectorAll('.pmrow').length,
  inputs: document.querySelectorAll('.pmin').length,
  numpad: document.querySelectorAll('.numpad button').length,
  apagada: document.querySelectorAll('.pmrow[data-off="1"]').length,
  activa: document.querySelector('.pmrow.active')?.dataset.k ?? null,
  paystat: document.querySelector('.paystat')?.innerText.replace(/\\n/g,' | ') ?? null,
  confirmar: [...document.querySelectorAll('.paysheet button.cobrar')].map(b=>b.innerText.trim())[0] ?? null,
  innerH: window.innerHeight,
  shellH: Math.round(document.querySelector('.shell')?.getBoundingClientRect().height ?? 0),
  mainH: Math.round(document.querySelector('.main')?.getBoundingClientRect().height ?? 0),
  sheetScroll: (()=>{const e=document.querySelector('.paysheet');return e?{sh:e.scrollHeight,ch:e.clientHeight}:null;})(),
  errores: window.__errs ?? 0,
  cartClases: document.querySelector('.cart')?.className ?? null,
  sheetTransform: (()=>{const e=document.querySelector('.paysheet');return e?getComputedStyle(e).transform:null;})(),
  sheetRect: (()=>{const e=document.querySelector('.paysheet');if(!e)return null;const r=e.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height)};})(),
  cartRect: (()=>{const e=document.querySelector('.cart');if(!e)return null;const r=e.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom)};})(),
  confirmVisible: (()=>{const b=[...document.querySelectorAll('.paysheet button.cobrar')][0];if(!b)return null;const r=b.getBoundingClientRect();return {top:Math.round(r.top),dentro:r.bottom<=window.innerHeight};})(),
})`);
console.log('DIAG', diag);

// Las mediciones de arriba dejan el scroll en 0 (el bloque EVOLUCION lo
// resetea a propósito). Si lo que se está mirando está más abajo, hay que
// volver a traerlo ANTES de la foto, o se captura el encabezado.
if (ACCION === 'inventario') {
  // El atributo, además del localStorage: si la pantalla lo lee en el boot y
  // la navegación pasó por otro lado, la captura sale en claro y la variante
  // oscura queda sin verificar — que es justo donde este proyecto se equivocó
  // tres veces.
  if (process.env.TEMA) {
    await evaluar(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(process.env.TEMA)}), true`);
    await dormir(400);
  }
  await evaluar(`(()=>{const t=document.querySelector('.inv-tab'); t && t.scrollIntoView({block:'center'}); return !!t;})()`);
  await dormir(700);
  console.log('CONTRASTE>>>', await evaluar(`JSON.stringify((()=>{
    const tema = document.documentElement.getAttribute('data-theme');
    const falta = document.querySelector('.inv-falta');
    const alerta = document.querySelector('.label-sm.alerta');
    const fila = document.querySelector('.inv-tr');
    const col = (e) => e ? getComputedStyle(e).color : null;
    return { tema, sinCosto: col(falta), alerta: col(alerta), fila: col(fila),
             fondoTabla: fila ? getComputedStyle(fila.parentElement).backgroundColor : null };
  })())`));
}

// /contador → la lista de comprobantes adjuntos (ítem 12, slice 4).
// Los rects que imprime ADJUNTOS>>> más arriba se leen ANTES de que EVOLUCION
// ponga el scroll en 0, así que apuntan afuera de la foto: medir ahí dio
// 1,6:1 sobre píxeles que no eran el texto. Acá se re-aplica el tema, se trae
// la lista a la vista y se vuelven a leer, que es lo que vale para medir.
if (ACCION === 'adjuntos-contador') {
  if (process.env.TEMA) {
    await evaluar(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(process.env.TEMA)}), true`);
    await dormir(400);
  }
  const ancla = process.env.ANCLA === 'pie' ? '.adj-bloque .label-sm:last-child' : '.adj-lista';
  await evaluar(`(()=>{const t=document.querySelector(${JSON.stringify(ancla)}); t && t.scrollIntoView({block:'center'}); return !!t;})()`);
  await dormir(700);
  // ABRIR=1: apretar "Abrir" en la primera fila. Con la ficha de demo, que
  // a proposito NO tiene archivo, tiene que aparecer el aviso de que falta —
  // no una pestaña en blanco ni un link roto.
  if (process.env.ABRIR === '1') {
    await evaluar(`(() => { const b = document.querySelector('.adj-bajar'); b && b.click(); return !!b; })()`);
    await dormir(5000);
    console.log('ABRIR>>>', await evaluar(`JSON.stringify({
      err: document.querySelector('.label-sm.err')?.textContent?.replace(/\\s+/g,' ') ?? null,
      linkSuelto: document.querySelector('.adj-bloque a')?.textContent ?? null,
    })`));
  }
  console.log('MEDIR>>>', await evaluar(`JSON.stringify((()=>{
    // La ÚLTIMA de cada clase: con el pie centrado, la primera fila de una
    // lista larga queda arriba, fuera de la foto.
    const r = (s) => { const e = [...document.querySelectorAll(s)].pop(); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { color: getComputedStyle(e).color, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] }; };
    return {
      tema: document.documentElement.getAttribute('data-theme'),
      fecha: r('.adj-fecha'), nro: r('.adj-nro'), quien: r('.adj-quien'),
      importe: r('.adj-importe'), bajar: r('.adj-bajar'),
      pie: r('.adj-bloque .label-sm:last-child'),
    };
  })())`));
}

// Panel → tarjeta "Stock y merma" (RESEARCH-BRIEF-panel §8.e).
// Uso: RUTA=/panel TEMA=dark node scripts/shot-pos.mjs merma.png merma
if (ACCION === 'merma') {
  if (process.env.TEMA) {
    await evaluar(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(process.env.TEMA)}), true`);
    await dormir(400);
  }
  console.log('MERMA>>>', await evaluar(`JSON.stringify((()=>{
    const card = [...document.querySelectorAll('section.card')].find(s => s.querySelector('h3')?.textContent.trim() === 'Stock y merma');
    if (!card) return { encontrada: false };
    card.scrollIntoView({ block: 'center' });
    const col = (sel) => { const e = card.querySelector(sel); return e ? getComputedStyle(e).color : null; };
    return {
      encontrada: true,
      tema: document.documentElement.getAttribute('data-theme'),
      texto: card.innerText.replace(/\\n+/g, ' | '),
      colores: { numero: col('.pr-num'), aviso: col('.pr-aviso'), k: col('.pr-k'), n: col('.pr-n'), tabla: col('.mg-nombre') },
      // Rectángulos para medir el contraste sobre PÍXELES (scripts/contraste-png.ps1):
      // con fondo translúcido, el color declarado no dice contra qué se ve.
      rects: ['.pr-n', '.pr-aviso'].map((sel) => {
        const r = card.querySelector(sel)?.getBoundingClientRect();
        return r ? { sel, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
      }),
      errores: window.__errs ?? 0,
    };
  })())`));
  await dormir(700);
}

// Genérico: qué color TERMINA teniendo cada elemento, con el tema puesto.
// Uso: RUTA=/pos TEMA=dark node scripts/shot-pos.mjs out.png "computados:.numpad button|.pmrow .pmn|.paystat"
//
// Sirve para no discutir contra una captura: si un texto se ve apagado, esto
// dice si es el color, el fondo o la opacidad heredada del contenedor.
if (ACCION.startsWith('computados:')) {
  const sels = ACCION.slice('computados:'.length).split('|');
  if (process.env.TEMA) {
    await evaluar(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(process.env.TEMA)}), true`);
    await dormir(400);
  }
  console.log('COMPUTADOS>>>', await evaluar(`JSON.stringify((()=>{
    const sels = ${JSON.stringify(sels)};
    const tokens = getComputedStyle(document.documentElement);
    return {
      tema: document.documentElement.getAttribute('data-theme'),
      ink: tokens.getPropertyValue('--ink').trim(),
      ink3: tokens.getPropertyValue('--ink-3').trim(),
      elementos: sels.map((s) => {
        const e = document.querySelector(s);
        if (!e) return { sel: s, encontrado: false };
        const cs = getComputedStyle(e);
        // La opacidad heredada apaga TODO lo de adentro sin tocar el color.
        let op = 1, p = e;
        while (p && p !== document.documentElement) {
          op *= parseFloat(getComputedStyle(p).opacity || '1');
          p = p.parentElement;
        }
        // Un degradado NO aparece en backgroundColor (queda transparente): sin
        // esta linea, un boton con texto blanco sobre violeta claro se reporta
        // como "fondo transparente" y parece sano.
        const grad = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : null;
        return { sel: s, color: cs.color, fondo: cs.backgroundColor, degradado: grad, opacidadAcumulada: Number(op.toFixed(3)) };
      }),
    };
  })())`));
  await dormir(300);
}

// Genérico: traer a la vista el primer elemento que matchee un selector.
// Uso: RUTA=/contador TEMA=dark node scripts/shot-pos.mjs out.png "ver:.cc-list"
// Imprime el rectángulo para medir contraste sobre píxeles.
if (ACCION.startsWith('ver:')) {
  const sel = ACCION.slice(4);
  if (process.env.TEMA) {
    await evaluar(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(process.env.TEMA)}), true`);
    await dormir(400);
  }
  console.log('VER>>>', await evaluar(`JSON.stringify((()=>{
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return { encontrado: false };
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { encontrado: true, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  })())`));
  await dormir(700);
}

const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('OK ->', OUT);

ws.close();
chrome.kill();
try {
  rmSync(perfil, { recursive: true, force: true });
} catch {
  /* best effort */
}

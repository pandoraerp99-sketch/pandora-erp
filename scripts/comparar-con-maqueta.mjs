/**
 * Compara la pantalla REAL contra su MAQUETA, midiendo en el mismo navegador,
 * al mismo ancho, los mismos selectores.
 *
 * Nace de un reclamo repetido ("¿por qué sigue tan diferente?") que yo venía
 * contestando mirando capturas. Mirar no alcanza: las diferencias de
 * proporción (altura de una tarjeta, padding, gap, tamaño de un número) se ven
 * pero no se nombran. Esto las nombra.
 *
 *   node comparar.mjs <ruta-app> <archivo-maqueta.html>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUTA = process.argv[2] ?? '/clientes';
const MAQUETA = process.argv[3];
const BASE = 'http://localhost:3000';
const EMAIL = 'operador@pandora.dev';
const PASS = 'pandora-dev-1234';
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

// Qué se mide. Cada entrada: selector + las props que importan para "proporción".
const OBJETIVOS = [
  ['.topbar', ['height', 'gap', 'marginBottom']],
  ['.search', ['height', 'borderRadius', 'fontSize']],
  ['.seg', ['height', 'padding', 'borderRadius']],
  ['.seg button', ['height', 'padding', 'fontSize', 'lineHeight', 'borderTopWidth', 'borderBottomWidth', 'boxSizing', 'fontFamily']],
  ['.bar', ['height', 'padding', 'borderRadius', 'marginBottom']],
  ['.bar-id', ['gap']],
  ['.bar-icon', ['width', 'height', 'borderRadius']],
  ['.bar h1, .bar .bar-t', ['fontSize', 'fontWeight', 'letterSpacing']],
  ['.kpis', ['height', 'gap', 'marginBottom', 'gridTemplateColumns']],
  ['.kpis .k', ['width', 'height', 'padding', 'borderRadius']],
  ['.kpis .k-k', ['fontSize', 'letterSpacing']],
  ['.kpis .k-v', ['fontSize', 'marginTop', 'lineHeight']],
  ['.kpis .k.lead .k-v', ['fontSize']],
  ['.kpis .k-f', ['fontSize', 'marginTop']],
  ['.main', ['padding', 'gap', 'display', 'flexDirection']],
  ['html', ['fontSize', 'lineHeight']],
  ['body', ['fontSize', 'lineHeight', 'fontFamily', 'letterSpacing']],
  ['.shell', ['gridTemplateRows', 'gap', 'padding', 'height']],
];

// Separaciones REALES entre los tres bloques de arriba.
const FUENTE = `(() => {
  const cargadas = [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.status);
  const c = document.createElement('span');
  c.style.cssText = 'position:absolute;font-size:12.5px;font-weight:500;font-family:Inter,sans-serif';
  c.textContent = 'Monotributo';
  document.body.appendChild(c);
  const anchoInter = c.getBoundingClientRect().width.toFixed(2);
  c.style.fontFamily = 'sans-serif';
  const anchoFallback = c.getBoundingClientRect().width.toFixed(2);
  c.remove();
  const links = [...document.querySelectorAll('link[rel=stylesheet],link[rel=preconnect]')].map(l=>l.href).filter(h=>/font/i.test(h));
  return 'links=' + (links.join(' ')||'NINGUNO')
       + ' | interListo=' + document.fonts.check('500 12.5px Inter')
       + ' anchoInter=' + anchoInter + ' anchoSans=' + anchoFallback
       + ' | faces=' + (cargadas.length ? cargadas.slice(0,4).join(' / ') : 'ninguna');
})()`;

const CRUDO = `(() => {
  const e = document.querySelector('.seg button');
  const s = document.querySelector('.seg');
  if (!e) return 'sin seg';
  return 'boton=' + e.getBoundingClientRect().height.toFixed(3)
       + ' seg=' + s.getBoundingClientRect().height.toFixed(3);
})()`;

const HUECOS = `(() => {
  const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
  const tb = r('.topbar'), ba = r('.bar'), kp = r('.kpis');
  if (!tb || !ba || !kp) return 'faltan bloques';
  return 'topbar->bar=' + Math.round(ba.top - tb.bottom)
       + ' bar->kpis=' + Math.round(kp.top - ba.bottom)
       + ' | topbarTop=' + Math.round(tb.top)
       + ' kpisBottom=' + Math.round(kp.bottom);
})()`;

const perfil = mkdtempSync(join(tmpdir(), 'pandora-cmp-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=9337',
    `--user-data-dir=${perfil}`,
    '--window-size=1600,1000',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9337/json');
      const t = (await r.json()).find((x) => x.type === 'page');
      if (t) return t.webSocketDebuggerUrl;
    } catch {
      /* todavia no levanto */
    }
    await dormir(250);
  }
  throw new Error('Chrome no expuso target');
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
const cmd = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluar = async (e) => {
  const r = await cmd('Runtime.evaluate', {
    expression: e,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.value;
};

await cmd('Page.enable');
await cmd('Runtime.enable');
const ir = async (url, ms = 2400) => {
  await cmd('Page.navigate', { url });
  await dormir(ms);
};

const MEDIR = (objetivos) => `(() => {
  const O = ${JSON.stringify(objetivos)};
  const out = {};
  for (const [sel, props] of O) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const v = {};
    for (const p of props) {
      if (p === 'width') v.width = Math.round(r.width);
      else if (p === 'height') v.height = Math.round(r.height);
      else v[p] = cs[p];
    }
    out[sel] = v;
  }
  return JSON.stringify(out);
})()`;

// ── App (requiere login) ──
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
await ir(`${BASE}${RUTA}`);
const dondeEstoy = await evaluar(`location.pathname + ' | topbar=' + !!document.querySelector('.topbar')`);
console.log('APP EN:', dondeEstoy);
const app = JSON.parse(await evaluar(MEDIR(OBJETIVOS)));
const huecosApp = await evaluar(HUECOS);
const crudoApp = await evaluar(CRUDO);
const fuenteApp = await evaluar(FUENTE);

// ── Maqueta ──
const fileUrl = 'file:///' + MAQUETA.replace(/\\/g, '/');
await ir(fileUrl);
const maq = JSON.parse(await evaluar(MEDIR(OBJETIVOS)));
const huecosMaq = await evaluar(HUECOS);
const crudoMaq = await evaluar(CRUDO);
const fuenteMaq = await evaluar(FUENTE);

// ── Diff ──
let dif = 0;
console.log('SELECTOR / PROP'.padEnd(42), 'APP'.padEnd(22), 'MAQUETA');
console.log('-'.repeat(92));
for (const [sel] of OBJETIVOS) {
  const a = app[sel];
  const m = maq[sel];
  if (a === null && m === null) continue;
  if (a === null || m === null) {
    console.log(`${sel}`.padEnd(42), String(a === null ? 'NO EXISTE' : 'ok').padEnd(22), m === null ? 'NO EXISTE' : 'ok');
    dif++;
    continue;
  }
  for (const k of Object.keys(m)) {
    const va = String(a[k] ?? '-');
    const vm = String(m[k] ?? '-');
    if (va !== vm) {
      console.log(`  ${sel} · ${k}`.padEnd(42), va.padEnd(22), vm);
      dif++;
    }
  }
}
console.log('-'.repeat(92));
console.log(dif === 0 ? 'IDENTICOS' : `${dif} diferencias`);
console.log('HUECOS app    :', huecosApp);
console.log('HUECOS maqueta:', huecosMaq);
console.log('CRUDO app    :', crudoApp);
console.log('CRUDO maqueta:', crudoMaq);
console.log('FUENTE app    :', fuenteApp);
console.log('FUENTE maqueta:', fuenteMaq);

ws.close();
chrome.kill();

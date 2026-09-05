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
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'pos.png';
const ACCION = process.argv[3] ?? '';
const BASE = 'http://localhost:3000';
const EMAIL = 'operador@pandora.dev';
const PASS = 'pandora-dev-1234';

const CHROME =
  process.env.CHROME_BIN ??
  [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // WSL: no suele haber Chrome adentro, se usa el de Windows.
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  ].find((p) => existsSync(p));

const perfil = mkdtempSync(join(tmpdir(), 'pandora-shot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${perfil}`,
    '--window-size=1600,1000',
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
  await cmd('Page.navigate', { url });
  await dormir(2200);
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
await ir(`${BASE}/pos`);

if (ACCION === 'cobro') {
  // Un producto al carrito y abrir la hoja de cobro.
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

const diag = await evaluar(`JSON.stringify({
  url: location.pathname,
  filas: document.querySelectorAll('.pmrow').length,
  inputs: document.querySelectorAll('.pmin').length,
  numpad: document.querySelectorAll('.numpad button').length,
  apagada: document.querySelectorAll('.pmrow[data-off="1"]').length,
  activa: document.querySelector('.pmrow.active')?.dataset.k ?? null,
  paystat: document.querySelector('.paystat')?.innerText.replace(/\\n/g,' | ') ?? null,
  confirmar: [...document.querySelectorAll('.paysheet button.cobrar')].map(b=>b.innerText.trim())[0] ?? null,
  errores: window.__errs ?? 0,
})`);
console.log('DIAG', diag);

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

/**
 * Recorrido de mostrador, punta a punta, en el navegador real (ADR-0029):
 *   tomar un pedido con seña (con DOBLE click en Guardar) → recargar y verlo
 *   → abrir el detalle → intentar una edición inválida y ver el error →
 *   cobrar a cuenta → "Cobrar saldo y entregar" → encontrarlo en /caja.
 *
 * Mismo enfoque que shot-pos.mjs: Chrome headless por CDP, clicks de mouse
 * reales (un .click() sintético no siempre lo escucha React) y esperando la
 * hidratación antes de cada uno. Cada paso imprime OK o FALLA; el código de
 * salida es la cantidad de fallas.
 *
 * Corre desde Windows (usa el Chrome del sistema):
 *   node scripts/recorrido-pedidos.mjs <carpeta-de-capturas>
 *
 * ⚠️ Escribe en la base de DEV (pedidos de prueba, cobros en la caja abierta).
 * Nunca apuntarlo a producción.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'recorrido';
mkdirSync(DIR, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error('Este recorrido escribe datos de prueba: sólo corre contra localhost.');
  process.exit(99);
}
const CLIENTE = process.env.CLIENTE || 'García SRL';
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

const perfil = mkdtempSync(join(tmpdir(), 'pandora-rec-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${perfil}`,
   `--window-size=${process.env.VENTANA || '1600,1000'}`, '--no-sandbox', '--disable-gpu',
   '--hide-scrollbars', 'about:blank'],
  { stdio: 'ignore' }
);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((x) => x.type === 'page');
      if (t) return t.webSocketDebuggerUrl;
    } catch { /* todavía no */ }
    await dormir(250);
  }
  throw new Error('Chrome no expuso ningún target');
}
const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const cmd = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluar = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
await cmd('Page.enable');
await cmd('Runtime.enable');

let fallas = 0;
const check = (nombre, ok, detalle = '') => {
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ' — ' + detalle : ''}`);
};
const texto = () => evaluar('document.body.innerText');
async function ir(url) { await cmd('Page.navigate', { url }); await dormir(2600); }
async function foto(nombre) {
  const s = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(DIR, nombre), Buffer.from(s.data, 'base64'));
  console.log('      foto ->', nombre);
}

/** Busca por selector CSS, o por texto si empieza con "txt:". Espera hidratación. */
async function ubicar(q) {
  const js = q.startsWith('txt:')
    ? `[...document.querySelectorAll('button, a, tr.po-row')].filter((x) => x.offsetParent !== null).find((x) => x.textContent.includes(${JSON.stringify(q.slice(4))}))`
    : `document.querySelector(${JSON.stringify(q)})`;
  for (let i = 0; i < 30; i++) {
    const r = JSON.parse(await evaluar(`JSON.stringify((()=>{ const b = ${js}; if (!b) return null;
      const hid = Object.keys(b).some((k) => k.startsWith('__react'));
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect();
      return { hid, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })())`));
    if (r && r.hid) return r;
    await dormir(250);
  }
  return null;
}
async function clic(q, veces = 1) {
  const p = await ubicar(q);
  if (!p) { check(`encontrar ${q}`, false); return false; }
  for (let n = 0; n < veces; n++) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cmd('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    }
    if (veces > 1) await dormir(40);
  }
  await dormir(900);
  return true;
}
/** Escribe en un input/select controlado por React. */
async function escribir(sel, valor) {
  const ok = await evaluar(`(()=>{ const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valor)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
  if (!ok) check(`escribir en ${sel}`, false);
  await dormir(150);
}

// ── Login ──
await ir(`${BASE}/login`);
await evaluar(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[type=email], input[name=email]'), 'operador@pandora.dev');
  set(document.querySelector('input[type=password], input[name=password]'), 'pandora-dev-1234');
  document.querySelector('form').requestSubmit(); return true; })()`);
await dormir(3500);

// ── 1. El libro ──
await ir(`${BASE}/pedidos`);
const filasAntes = await evaluar(`document.querySelectorAll('tr.po-row').length`);
check('la pantalla /pedidos carga', (await texto()).includes('Historial de pedidos'));
await foto('01-pedidos.png');

// ── 2. Nuevo pedido con seña, y DOBLE click en Guardar ──
await clic('txt:Nuevo pedido');
check('se abre el alta', (await texto()).includes('¿Qué encarga?'));
await escribir('#p-cliente', CLIENTE);
await escribir('#p-item-1', 'Tafeta roja — tono bordó');
await escribir('#p-cant-1', '50');
await escribir('#p-precio-1', '3200');
await clic('txt:Agregar ítem');
const k2 = await evaluar(`(document.querySelectorAll('input[id^="p-item-"]')[1] || {}).id`);
await escribir(`#${k2}`, 'Forrado de botones (x100)');
await escribir(`#${k2.replace('item', 'cant')}`, '1');
await escribir(`#${k2.replace('item', 'precio')}`, '1.800');
await escribir('#p-sena', '20.000');
await escribir('#p-medio', 'efectivo');
const retiro = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
await escribir('#p-retiro', retiro);
await clic('button.sw');
const resumen = await evaluar(`document.querySelector('.m-summary.form')?.innerText.replace(/\\s+/g, ' ')`);
check('el resumen del alta cierra con el detalle', /\$161\.800/.test(resumen) && /\$20\.000/.test(resumen) && /\$141\.800/.test(resumen), resumen);
await foto('02-nuevo-pedido.png');
await clic('txt:Guardar pedido', 2);
// La lista se refresca cuando vuelve el servidor: se espera (hasta 10 s) en
// vez de mirar a ciegas. La prueba de que NO se duplicó es la de después de
// recargar, contra lo que dice la base.
let filasDespues = filasAntes;
for (let i = 0; i < 40 && filasDespues === filasAntes; i++) {
  await dormir(250);
  filasDespues = await evaluar(`document.querySelectorAll('tr.po-row').length`);
}
check('la lista muestra el pedido nuevo sin recargar', filasDespues === filasAntes + 1, `${filasAntes} → ${filasDespues}`);
await foto('03-libro-con-pedido.png');

// ── 3. Recargar: sigue ahí, y hay UNO solo ──
await ir(`${BASE}/pedidos`);
const t3 = await texto();
check('al recargar el pedido sigue', t3.includes(CLIENTE) && t3.includes('$161.800'));
const filasRecargadas = await evaluar(`document.querySelectorAll('tr.po-row').length`);
check('doble click en Guardar: UN pedido nuevo (contado tras recargar)', filasRecargadas === filasAntes + 1, `${filasAntes} → ${filasRecargadas}`);
const numero = await evaluar(`document.querySelector('tr.po-row .po-num')?.textContent`);
console.log('      pedido:', numero);

// ── 4. Detalle ──
await clic('tr.po-row');
const t4 = await texto();
// innerText respeta text-transform: el título se lee en mayúsculas.
check('el detalle muestra la seña y el saldo', /historial de pagos/i.test(t4) && t4.includes('$20.000') && t4.includes('$141.800'));
await foto('04-detalle.png');

// ── 5. Error visible: editar por debajo de lo cobrado ──
await clic('txt:Editar');
await dormir(800);
await escribir('#p-cant-1', '1');
await clic('txt:Guardar cambios');
await dormir(1200);
const err = await evaluar(`document.querySelector('.m-err')?.textContent || ''`);
check('el error de guardado se muestra claro', err.includes('por debajo de lo ya cobrado'), err);
await foto('05-error-al-editar.png');
await clic('.modal .m-acts .m-btn.ghost'); // Cancelar → vuelve al detalle
await dormir(800);

// ── 6. Cobro a cuenta por transferencia ──
await clic('txt:Registrar cobro');
await escribir('#d-importe', '40000');
await escribir('#d-medio', 'transferencia');
await clic('.modal .m-acts .m-btn.primary');
await dormir(1500);
const t6 = await texto();
check('el cobro a cuenta queda en el historial', t6.includes('A cuenta') && t6.includes('$40.000') && t6.includes('$101.800'));

// ── 7. Cobrar saldo y entregar (efectivo) ──
await clic('txt:Cobrar saldo y entregar');
await escribir('#d-medio', 'efectivo');
await foto('06-cobrar-y-entregar.png');
await clic('.modal .m-acts .m-btn.primary');
await dormir(1800);
const t7 = await texto();
check('queda entregado y saldado', t7.includes('Entregado') && t7.includes('Saldo') && !t7.includes('Saldo pendiente'));
await foto('07-entregado.png');

// ── 8. La operación en la caja ──
await ir(`${BASE}/caja`);
const t8 = await texto();
const n = (numero || '').replace('#', '');
check('/caja lista la seña del pedido', t8.includes(`Pedido #${n} · Seña`));
check('/caja lista el cobro a cuenta', t8.includes(`Pedido #${n} · A cuenta`));
check('/caja lista el saldo cobrado', t8.includes(`Pedido #${n} · Saldo`));
check('el cajón muestra "Señas de pedidos"', t8.includes('Señas de pedidos'));
console.log('      efectivo esperado en pantalla:', await evaluar(`document.querySelector('.cash-num')?.textContent`));
await foto('08-caja.png');

console.log(fallas === 0 ? '\nRECORRIDO OK' : `\nRECORRIDO CON ${fallas} FALLA(S)`);
ws.close();
chrome.kill();
try { rmSync(perfil, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(fallas);

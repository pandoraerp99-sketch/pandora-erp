/**
 * Recorrido de la tarjeta "Alivios de caja" en el navegador real (0044):
 * registra alivios desde "Nuevo alivio" (con DOBLE click en Confirmar), elige
 * uno, "Marcar retirados", recarga y verifica que siga retirado.
 *
 * Desde Windows:  node scripts/recorrido-alivios.mjs <carpeta> [montos]
 *   montos: lista separada por comas (default "30000,18000,25000,15000").
 * ⚠️ Escribe en la base de DEV (retiros en la caja abierta). Sólo localhost.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'alivios';
// "-" = no registrar ninguno (sólo probar el retiro sobre los que ya hay).
const MONTOS = (process.argv[3] ?? '30000,18000,25000,15000').split(',').filter((x) => x && x !== '-');
mkdirSync(DIR, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
if (!/localhost|127\.0\.0\.1/.test(BASE)) process.exit(99);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const perfil = mkdtempSync(join(tmpdir(), 'pandora-ali-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${perfil}`,
  `--window-size=${process.env.VENTANA || '1618,1152'}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try { const t = (await (await fetch('http://127.0.0.1:9335/json')).json()).find((x) => x.type === 'page'); if (t) return t.webSocketDebuggerUrl; } catch { /* */ }
    await dormir(250);
  }
  throw new Error('sin target');
}
const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const cmd = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluar = async (e) => (await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
await cmd('Page.enable'); await cmd('Runtime.enable');
let fallas = 0;
const check = (n, ok, d = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${n}${d ? ' — ' + d : ''}`); };
const ir = async (u) => { await cmd('Page.navigate', { url: u }); await dormir(2800); };

async function clic(js, veces = 1) {
  for (let i = 0; i < 30; i++) {
    const r = JSON.parse(await evaluar(`JSON.stringify((()=>{ const b = ${js}; if (!b) return null; const hid = Object.keys(b).some((k) => k.startsWith('__react'));
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { hid, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })())`));
    if (r && r.hid) {
      for (let n = 0; n < veces; n++) {
        for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
        if (veces > 1) await dormir(40);
      }
      await dormir(900);
      return true;
    }
    await dormir(250);
  }
  check(`clic ${js.slice(0, 60)}`, false);
  return false;
}
const porTexto = (t, sel = 'button') => `[...document.querySelectorAll('${sel}')].filter((x) => x.offsetParent !== null).find((x) => x.textContent.includes(${JSON.stringify(t)}))`;
async function escribir(sel, v) {
  await evaluar(`(()=>{ const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await dormir(150);
}
const filas = () => evaluar(`document.querySelectorAll('.alivio').length`);
async function foto(n, sel) {
  if (sel) await evaluar(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center' })`);
  await dormir(500);
  const s = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(DIR, n), Buffer.from(s.data, 'base64'));
  console.log('      foto ->', n);
}

await ir(`${BASE}/login`);
await evaluar(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[type=email]'), 'operador@pandora.dev'); set(document.querySelector('input[type=password]'), 'pandora-dev-1234'); document.querySelector('form').requestSubmit(); return true; })()`);
await dormir(3500);
await ir(`${BASE}/caja`);
check('la tarjeta "Alivios de caja" está', (await evaluar('document.body.innerText')).includes('Alivios de caja'));

for (const [i, m] of MONTOS.entries()) {
  const antes = await filas();
  await clic(porTexto('Nuevo alivio'));
  // Acotado al modal: el arqueo también usa .rm-input.
  await escribir('.modal-ov.open .rm-input', m);
  await clic(porTexto('Confirmar', '.modal-ov.open button'), i === 0 ? 2 : 1); // el primero, con doble click
  let despues = antes;
  for (let k = 0; k < 40 && despues === antes; k++) { await dormir(250); despues = await filas(); }
  check(`alivio de $${m} registrado${i === 0 ? ' (doble click → uno solo)' : ''}`, despues === antes + 1, `${antes} → ${despues}`);
}

await ir(`${BASE}/caja`);
const totalFilas = await filas();
check('al recargar no hay duplicados', totalFilas >= MONTOS.length, String(totalFilas));
// Se retira el PRIMERO de los pendientes, como el de la maqueta.
// SOLO_VER=1: no retira nada, sólo verifica lo que ya está en la base.
if (!process.env.SOLO_VER) {
  await clic(`document.querySelector('.alivio.pend input')`);
  const txtBtn = await evaluar(`document.querySelector('.alivio-btn')?.textContent`);
  check('el botón cuenta lo elegido', /Marcar retirados \(1\)/.test(txtBtn || ''), txtBtn);
  await foto('01-alivio-elegido.png', '.alivios');
  await clic(`document.querySelector('.alivio-btn')`);
  await dormir(1500);
  await ir(`${BASE}/caja`);
}
const hechos = await evaluar(`document.querySelectorAll('.alivio.done').length`);
check('tras recargar, el alivio sigue retirado', hechos >= 1, String(hechos));
const sub = await evaluar(`document.querySelector('.alivio.done .alivio-sub')?.textContent`);
check('dice quién lo retiró y a qué hora', /retirado por .+ \d{2}:\d{2}/.test(sub || ''), sub);
console.log('      barra:', await evaluar(`document.querySelector('.ali-bar')?.textContent`));
await foto('02-alivios.png', '.alivios');

console.log(fallas === 0 ? '\nRECORRIDO OK' : `\nRECORRIDO CON ${fallas} FALLA(S)`);
ws.close(); chrome.kill(); try { rmSync(perfil, { recursive: true, force: true }); } catch { /* */ }
process.exit(fallas);

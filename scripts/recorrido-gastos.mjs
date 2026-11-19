/**
 * Recorrido de "Cargar gasto" (/gastos) en el navegador real.
 *
 * Prueba cada rama del formulario y después REGISTRA un gasto de verdad, con
 * doble click y un comprobante adjunto:
 *   - "38.500" se lee como treinta y ocho mil quinientos;
 *   - cuenta corriente: sin proveedor no deja registrar, con proveedor muestra
 *     la deuda de hoy + la compra;
 *   - factura: IVA compras sin número no deja; neto + IVA que no cierra avisa;
 *   - mercadería: aparece el detalle y desaparece fijo/variable;
 *   - registrar en efectivo: un solo gasto, la caja baja exactamente el
 *     monto, aparece en "Últimos gastos" y en el libro, y el comprobante sube.
 *
 * Desde Windows:  node scripts/recorrido-gastos.mjs <carpeta>
 * ⚠️ Escribe en la base de DEV (un gasto en efectivo en la caja abierta).
 *    Sólo corre contra localhost.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DIR = resolve(process.argv[2] ?? 'recorrido-gastos');
mkdirSync(DIR, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
if (!/localhost|127\.0\.0\.1/.test(BASE)) process.exit(99);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const perfil = mkdtempSync(join(tmpdir(), 'pandora-gas-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${perfil}`,
  `--window-size=${process.env.VENTANA || '1600,1500'}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try { const t = (await (await fetch('http://127.0.0.1:9336/json')).json()).find((x) => x.type === 'page'); if (t) return t.webSocketDebuggerUrl; } catch { /* */ }
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
await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('DOM.enable');
let fallas = 0;
const check = (n, ok, d = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${n}${d ? ' — ' + d : ''}`); };
const ir = async (u) => { await cmd('Page.navigate', { url: u }); await dormir(3200); };

async function clic(js, veces = 1) {
  for (let i = 0; i < 30; i++) {
    const r = JSON.parse(await evaluar(`JSON.stringify((()=>{ const b = ${js}; if (!b) return null; const hid = Object.keys(b).some((k) => k.startsWith('__react'));
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { hid, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })())`));
    if (r && r.hid) {
      for (let n = 0; n < veces; n++) {
        for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
        if (veces > 1) await dormir(40);
      }
      await dormir(500);
      return true;
    }
    await dormir(250);
  }
  check(`clic ${js.slice(0, 70)}`, false);
  return false;
}
const porTexto = (t, sel = 'button') => `[...document.querySelectorAll('${sel}')].filter((x) => x.offsetParent !== null).find((x) => x.textContent.includes(${JSON.stringify(t)}))`;
async function escribir(sel, v) {
  await evaluar(`(()=>{ const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await dormir(200);
}
const texto = (sel) => evaluar(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
const apagado = () => evaluar(`document.querySelector('.reg-btn')?.disabled`);
/** "$ 467.923,50" / "−$ 1.234,50" → centavos (BigInt). Sin Number: es plata. */
const centavos = (s) => {
  const neg = /[−-]/.test(s);
  const d = BigInt((s.match(/\d/g) || ['0']).join(''));
  return neg ? -d : d;
};
async function foto(n, sel) {
  if (sel) await evaluar(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'start' })`);
  await dormir(500);
  const s = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(DIR, n), Buffer.from(s.data, 'base64'));
  console.log('      foto ->', n);
}

/**
 * MEDIR=1: no registra nada. Saca una foto de la pantalla entera en cada tema
 * y anota dónde está cada texto chico, para medir el contraste sobre PÍXELES
 * (scripts/contraste-png.ps1): con fondos de vidrio, medir por CSS miente.
 */
const ZONAS = ['.cg .field > label', '.fhint', '.cgfac-s', '.cgfac-cta', '.gdrop-s', '.ci-head',
  '.ci-row .mono.neg', '.ci-pie', '.cg-motivo', '#cgCat', '#cgTipo', '.reg-btn', '.upper-mini',
  '.gsub', '.gmonto', '.cg-ult .gcat', '.gsname', '.ptabs button:not(.on)'];
async function medirTema(tema) {
  await evaluar(`localStorage.setItem('pandora-theme', '${tema}')`);
  await ir(`${BASE}/gastos`);
  await escribir('#cgTotal', '38.500');
  await evaluar(`document.querySelector('main')?.scrollTo?.(0, 0); window.scrollTo(0, 0)`);
  await dormir(600);
  const zonas = await evaluar(`JSON.stringify(${JSON.stringify(ZONAS)}.map((q) => { const e = document.querySelector(q); if (!e) return q + ':-'; const r = e.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; return q.replace(/[:;]/g, '_') + ':' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v * dpr)).join(','); }).join(';'))`);
  writeFileSync(join(DIR, `zonas-${tema}.txt`), JSON.parse(zonas));
  const s = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(DIR, `medir-${tema}.png`), Buffer.from(s.data, 'base64'));
  console.log('      foto ->', `medir-${tema}.png`);
}
await ir(`${BASE}/login`);
await evaluar(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[type=email]'), 'operador@pandora.dev'); set(document.querySelector('input[type=password]'), 'pandora-dev-1234'); document.querySelector('form').requestSubmit(); return true; })()`);
await dormir(3500);
if (process.env.MEDIR) {
  await medirTema('light');
  await medirTema('dark');
  // La pestaña se anota en la URL sin navegar: recargar tiene que volver a ella.
  await ir(`${BASE}/gastos`);
  await clic(porTexto('Libro de gastos', '.ptabs button'));
  const url = await evaluar('location.href');
  await ir(url);
  check('tocar "Libro de gastos" y recargar deja el libro', /vista=libro/.test(url) && (await evaluar(`document.querySelector('.ptabs [aria-selected="true"]')?.textContent`)) === 'Libro de gastos', url);
  await evaluar(`localStorage.setItem('pandora-theme', 'light')`);
  ws.close(); chrome.kill(); try { rmSync(perfil, { recursive: true, force: true }); } catch { /* */ }
  process.exit(fallas);
}
await ir(`${BASE}/gastos`);
check('abre en "Cargar gasto"', (await evaluar(`document.querySelector('.ptabs [aria-selected="true"]')?.textContent`)) === 'Cargar gasto');
check('el formulario está', (await evaluar(`!!document.querySelector('.cg #cgTotal')`)) === true);
check('sin monto, el botón está apagado y dice por qué', (await apagado()) === true && (await texto('.cg-motivo')) === 'Falta el monto.');

// ── 38.500 son treinta y ocho mil quinientos ──
await escribir('#cgTotal', '38.500');
const esteGasto = await evaluar(`[...document.querySelectorAll('.cimpact .ci-row')].find((r) => r.innerText.includes('Este gasto'))?.innerText`);
check('"38.500" se lee como $38.500,00', /38\.500,00/.test(esteGasto || ''), esteGasto);
await foto('01-efectivo.png', '.cg');

// ── cuenta corriente ──
await escribir('#cgMedio', 'cuenta_corriente');
check('a cuenta corriente sin proveedor: no deja registrar', (await apagado()) === true && /proveedor/.test((await texto('.cg-motivo')) || ''));
check('el recuadro pasa a la deuda', /Deuda con el proveedor/i.test((await texto('.cimpact')) || ''));
const primerProv = await evaluar(`document.querySelector('#cgProv option:nth-child(2)')?.value ?? ''`);
if (primerProv !== '') {
  await escribir('#cgProv', primerProv);
  const imp = (await texto('.cimpact')) || '';
  check('con proveedor: muestra hoy, la compra y lo que va a deber', /Le debés hoy/.test(imp) && /Vas a deber/.test(imp), imp.replace(/\n/g, ' | '));
  check('con proveedor, ya se puede registrar', (await apagado()) === false);
  await foto('02-cuenta-corriente.png', '.cg');
  await escribir('#cgProv', '');
} else {
  check('hay al menos un proveedor cargado en dev', false);
}

// ── el tipo se completa solo ──
await escribir('#cgCat', 'alquiler');
check('alquiler: el tipo se pone solo en Fijo', (await evaluar("document.querySelector('#cgTipo').value")) === 'fijo');
await escribir('#cgCat', 'servicios');
check('servicios: el tipo se pone solo en Mixto', (await evaluar("document.querySelector('#cgTipo').value")) === 'mixto');
await escribir('#cgCat', 'impuestos_y_tasas');
check('impuestos: sin tipo, pide elegir y no deja registrar', (await evaluar("document.querySelector('#cgTipo').value")) === '' && (await apagado()) === true);
await escribir('#cgTipo', 'variable');
check('elegido a mano, lo dice', /a mano/.test((await texto('.fhint')) || ''));
// Memoria por proveedor: el primer proveedor de la lista con un gasto anterior.
const provs = await evaluar("[...document.querySelectorAll('#cgProv option')].map((o) => o.value).filter(Boolean)");
let probado = false;
for (const idProv of provs) {
  await escribir('#cgProv', idProv);
  const pista = (await texto('.fhint')) || '';
  if (/última vez/.test(pista)) {
    probado = true;
    check('elegir un proveedor ya usado completa categoría y tipo', true, pista);
    await foto('02b-memoria-proveedor.png', '.cg');
    break;
  }
}
check('hay al menos un proveedor con gastos anteriores para probar la memoria', probado);
await escribir('#cgProv', '');
await escribir('#cgCat', 'servicios');

// ── otro medio ──
await escribir('#cgMedio', 'transferencia');
check('transferencia: no toca la caja', /no toca el efectivo/.test((await texto('.cimpact')) || ''));

// ── la factura ──
check('plegada, la factura igual dice a dónde va', /export para el estudio/.test((await texto('.cgfac-s')) || ''));
await clic(`document.querySelector('.cgfac-head')`);
await clic(`document.querySelector('#cgArca')`);
check('IVA compras sin número: no deja', (await apagado()) === true && /número/.test((await texto('.cg-motivo')) || ''));
check('el resumen avisa que falta el número', /falta el número/.test((await texto('.cgfac-s')) || ''));
await escribir('#cgCompNro', '0003-00012345');
await clic(`document.querySelector('#cgDisc')`);
await escribir('#cgNeto', '30000');
await escribir('#cgIva', '1000');
check('neto + IVA que no cierra: avisa', /Tienen que coincidir/.test((await texto('.cgfac-body')) || ''));
await clic(porTexto('Calcular al 21%'));
const neto = await evaluar(`document.querySelector('#cgNeto').value`);
const iva = await evaluar(`document.querySelector('#cgIva').value`);
check('"Calcular al 21%" cierra exacto contra el monto', neto === '31818.18' && iva === '6681.82', `${neto} + ${iva}`);
check('y con eso se puede registrar', (await apagado()) === false);
check('el resumen dice que entra al IVA compras', /entra al IVA compras/.test((await texto('.cgfac-s')) || ''));
await foto('03-factura.png', '.cgfac');

// ── mercadería ──
await escribir('#cgCat', 'mercaderia');
check('mercadería: aparece el detalle', (await evaluar(`!!document.querySelector('.cg .det')`)) === true);
check('mercadería: no se pregunta fijo/variable', (await evaluar(`!!document.querySelector('#cgTipo')`)) === false);
await foto('04-mercaderia.png', '.cg .det');

// ── registrar de verdad: efectivo, doble click, con comprobante ──
await ir(`${BASE}/gastos`);
const desc = `Recorrido ${new Date().toISOString().slice(0, 19)}`;
const cajaAntes = await evaluar(`[...document.querySelectorAll('.cimpact .ci-row')].find((r) => r.innerText.includes('Efectivo en caja'))?.querySelector('.mono')?.innerText ?? null`);
if (cajaAntes === null) {
  check('hay una caja abierta en dev para probar el efectivo', false);
} else {
  await escribir('#cgCat', 'servicios');
  await escribir('#cgDesc', desc);
  await escribir('#cgMedio', 'efectivo');
  await escribir('#cgTotal', '1.234,50');
  // Comprobante: un PNG de 1x1 escrito en la carpeta del recorrido.
  const png = join(DIR, 'comprobante-prueba.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const { root } = await cmd('DOM.getDocument', {});
  const { nodeId } = await cmd('DOM.querySelector', { nodeId: root.nodeId, selector: '.cg input[type=file]' });
  await cmd('DOM.setFileInputFiles', { nodeId, files: [png] });
  await dormir(400);
  check('el archivo elegido se ve antes de registrar', /comprobante-prueba\.png/.test((await texto('.gdrop')) || ''));
  await clic(`document.querySelector('.reg-btn')`, 2); // doble click a propósito
  let ok = null;
  for (let k = 0; k < 60 && !ok; k++) { await dormir(250); ok = await texto('.cg-ok'); }
  check('confirma lo que se registró', /Listo: gasto de \$\s?1\.234,50 en Servicios/.test(ok || ''), ok?.replace(/\n/g, ' '));
  check('el comprobante quedó adjunto', /comprobante quedó adjunto/.test(ok || ''), ok?.replace(/\n/g, ' '));
  check('el formulario quedó vacío para el próximo', (await evaluar(`document.querySelector('#cgTotal').value`)) === '');
  await foto('05-registrado.png', '.cg-ok');
  await dormir(1500);
  const cajaDespues = await evaluar(`[...document.querySelectorAll('.cimpact .ci-row')].find((r) => r.innerText.includes('Efectivo en caja'))?.querySelector('.mono')?.innerText ?? null`);
  check('la caja bajó EXACTAMENTE $1.234,50 (una vez, no dos)', cajaDespues !== null && centavos(cajaAntes) - centavos(cajaDespues) === 123450n, `${cajaAntes} → ${cajaDespues}`);
  check('aparece en "Últimos gastos"', ((await texto('.cg-ult')) || '').includes(desc));
  await foto('06-ultimos.png', '.cg-side');

  // El libro: el gasto está UNA vez.
  await ir(`${BASE}/gastos?periodo=mes&vista=libro`);
  check('el link abre el libro', (await evaluar(`document.querySelector('.ptabs [aria-selected="true"]')?.textContent`)) === 'Libro de gastos');
  const veces = await evaluar(`(document.body.innerText.match(new RegExp(${JSON.stringify(desc)}, 'g')) || []).length`);
  check('en el libro está una sola vez', veces === 1, String(veces));
  await foto('07-libro.png');
}

// ── oscuro ──
await evaluar(`localStorage.setItem('pandora-theme', 'dark')`);
await ir(`${BASE}/gastos`);
await escribir('#cgTotal', '38.500');
await foto('08-oscuro.png', '.cg');
await clic(`document.querySelector('.cgfac-head')`);
await escribir('#cgMedio', 'cuenta_corriente');
await foto('09-oscuro-factura.png', '.cgfac');
await evaluar(`localStorage.setItem('pandora-theme', 'light')`);

console.log(fallas === 0 ? '\nRECORRIDO OK' : `\nRECORRIDO CON ${fallas} FALLA(S)`);
ws.close(); chrome.kill(); try { rmSync(perfil, { recursive: true, force: true }); } catch { /* */ }
process.exit(fallas);

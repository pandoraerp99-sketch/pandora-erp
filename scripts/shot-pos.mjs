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
const BASE = 'http://localhost:3000';
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
  await evaluar(`[...document.querySelectorAll('button')].find(b=>/Nuevo gasto/i.test(b.textContent||''))?.click(), true`);
  await dormir(900);
  await evaluar(`((set) => { set('#gCat','mercaderia'); set('#gTotal',${JSON.stringify(TOTAL)});
    ${process.env.FECHA ? `set('#gFecha', ${JSON.stringify(process.env.FECHA)});` : ''}
    return true; })(${set})`);
  await dormir(500);
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

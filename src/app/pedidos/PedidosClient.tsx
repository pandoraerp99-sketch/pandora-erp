'use client';

/**
 * /pedidos — libro de encargos. Port de pos-preview/pedidos.html (ADR-0029).
 *
 * La pantalla no decide nada de plata: muestra lo que le manda el servidor y
 * dispara acciones. Los estados "señado", "saldado" y "vencido" se derivan con
 * la MISMA función que usa el service (domain/pedidos), con el día del
 * comercio que calcula el servidor.
 */
import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import { estadoDerivado, estaVivo } from '@/lib/domain/pedidos';
import type { OrderStatus } from '@/lib/db/schema/orders';
import { PEDIDOS_CSS } from './pedidosCss';
import {
  colorDe,
  ddmm,
  diaDe,
  ESTADO_CLASE,
  ESTADO_TEXTO,
  iniciales,
  nombreDelMes,
  plata,
  restarDias,
} from './formato';
import { ModalDetalle, ModalPedido, type Cliente, type Producto } from './PedidoModales';

export interface PedidoFilaDTO {
  id: string;
  number: number;
  createdAtIso: string;
  deliveredAtIso: string | null;
  customerName: string;
  status: OrderStatus;
  total: string;
  cobrado: string;
  /** Importe de la seña (primer cobro), si hubo. */
  sena: string | null;
  pickupDate: string | null;
  primerItem: string | null;
  cantidadItems: number;
  tomadoPor: string | null;
}

type Filtro = 'todos' | 'activo' | 'sena' | 'entregado' | 'cancelado';
type Rango = 'todo' | 'mes' | 'sem' | 'hoy';
type Columna = 'fecha' | 'saldo' | 'entrega' | 'tomo';
type Modal = { tipo: 'nuevo' } | { tipo: 'detalle'; id: string } | { tipo: 'editar'; id: string } | null;

const Icono = {
  bolsa: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
  ),
  mas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  persona: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>
  ),
  calendario: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
  ),
  chev: (
    <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  ),
  lista: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
  ),
  columnas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="18" rx="1" /></svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
  ),
  bajar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
  ),
  csv: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
  ),
  imprimir: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
  ),
  lupa: (
    <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
  ),
  ok: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  ),
};

interface Fila extends PedidoFilaDTO {
  dia: string;
  conSena: boolean;
  saldado: boolean;
  vencido: boolean;
  retiraHoy: boolean;
  saldo: Decimal;
}

function primerNombre(s: string | null): string {
  if (!s) return '—';
  const base = s.includes('@') ? s.split('@')[0]! : s;
  return base.trim().split(/\s+/)[0] ?? base;
}

export function PedidosClient(props: {
  pedidos: PedidoFilaDTO[];
  hoy: string;
  hayCajaAbierta: boolean;
  clientes: Cliente[];
  productos: Producto[];
  userName: string;
  userRole: string;
}) {
  const { pedidos, hoy } = props;
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [tomador, setTomador] = useState<string>('todos');
  const [rango, setRango] = useState<Rango>('todo');
  const [vista, setVista] = useState<'dia' | 'lista'>('dia');
  const [busqueda, setBusqueda] = useState('');
  const [ocultas, setOcultas] = useState<Set<Columna>>(new Set());
  const [menu, setMenu] = useState<null | 'taker' | 'range' | 'cols' | 'exp'>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Un click afuera cierra el menú abierto (como la maqueta).
  useEffect(() => {
    if (!menu) return;
    const cerrar = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.po-dd, .po-cols, .po-exp')) setMenu(null);
    };
    document.addEventListener('click', cerrar);
    return () => document.removeEventListener('click', cerrar);
  }, [menu]);

  const filas: Fila[] = useMemo(
    () =>
      pedidos.map((p) => {
        const e = estadoDerivado({
          status: p.status,
          total: p.total,
          cobrado: p.cobrado,
          pickup_date: p.pickupDate,
          hoy,
        });
        return { ...p, dia: diaDe(p.createdAtIso), ...e };
      }),
    [pedidos, hoy]
  );

  const tomadores = useMemo(
    () => [...new Set(filas.map((f) => f.tomadoPor).filter((x): x is string => !!x))],
    [filas]
  );

  const mes = hoy.slice(0, 7);
  const kpis = useMemo(() => {
    const delMes = filas.filter((f) => f.dia.startsWith(mes));
    const activos = filas.filter((f) => estaVivo(f.status));
    const entregados = filas.filter(
      (f) => f.status === 'entregado' && f.deliveredAtIso && diaDe(f.deliveredAtIso).startsWith(mes)
    );
    const conSena = activos.filter((f) => f.conSena);
    const comprometido = conSena.reduce((a, f) => a.plus(f.saldo), new Decimal(0));
    // Sparkline: pedidos tomados por día en lo que va del mes.
    const dias = parseInt(hoy.slice(8, 10), 10);
    const porDia = Array.from({ length: dias }, (_, i) => {
      const d = `${mes}-${String(i + 1).padStart(2, '0')}`;
      return delMes.filter((f) => f.dia === d).length;
    });
    return { delMes: delMes.length, activos: activos.length, entregados: entregados.length, conSena: conSena.length, comprometido, porDia };
  }, [filas, mes, hoy]);

  const spark = useMemo(() => {
    const v = kpis.porDia;
    if (v.length < 2) return 'M0 20 L70 20';
    const max = Math.max(1, ...v);
    return v
      .map((n, i) => `${i === 0 ? 'M' : 'L'}${((i / (v.length - 1)) * 70).toFixed(1)} ${(22 - (n / max) * 19).toFixed(1)}`)
      .join(' ');
  }, [kpis.porDia]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase().replace(/^#/, '');
    const desde =
      rango === 'hoy' ? hoy : rango === 'sem' ? restarDias(hoy, 6) : rango === 'mes' ? `${mes}-01` : null;
    return filas.filter((f) => {
      if (filtro === 'activo' && !estaVivo(f.status)) return false;
      if (filtro === 'sena' && f.sena === null) return false;
      if (filtro === 'entregado' && f.status !== 'entregado') return false;
      if (filtro === 'cancelado' && f.status !== 'cancelado') return false;
      if (tomador !== 'todos' && f.tomadoPor !== tomador) return false;
      if (desde && f.dia < desde) return false;
      if (q) {
        const texto = `${f.customerName} ${f.primerItem ?? ''} ${String(f.number).padStart(4, '0')} ${f.tomadoPor ?? ''}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [filas, filtro, tomador, rango, busqueda, hoy, mes]);

  const toggleCol = (c: Columna) =>
    setOcultas((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  function exportarCsv() {
    const cab = ['Número', 'Fecha', 'Cliente', 'Detalle', 'Estado', 'Total', 'Cobrado', 'Saldo', 'Retira', 'Tomó'];
    // Un nombre que empieza con = + - @ se ejecutaría como FÓRMULA al abrir el
    // CSV en Excel (inyección CSV). Se antepone un apóstrofo, que Excel oculta.
    const esc = (s: string) => {
      const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${seguro.replace(/"/g, '""')}"`;
    };
    const lineas = visibles.map((f) =>
      [
        `#${String(f.number).padStart(4, '0')}`,
        f.dia,
        f.customerName,
        f.primerItem ?? '',
        ESTADO_TEXTO[f.status],
        new Decimal(f.total).toFixed(2),
        new Decimal(f.cobrado).toFixed(2),
        estaVivo(f.status) ? f.saldo.toFixed(2) : '0.00',
        f.pickupDate ?? '',
        f.tomadoPor ?? '',
      ]
        .map(esc)
        .join(';')
    );
    const blob = new Blob(['﻿' + [cab.map(esc).join(';'), ...lineas].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos-${hoy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMenu(null);
    setToast(`Exportados ${visibles.length} pedidos (CSV)`);
  }

  // Filas con encabezados por día (vista "Por día").
  const cuerpo: Array<{ tipo: 'dia'; dia: string } | { tipo: 'fila'; f: Fila }> = [];
  let ultimo = '';
  for (const f of visibles) {
    if (vista === 'dia' && f.dia !== ultimo) {
      cuerpo.push({ tipo: 'dia', dia: f.dia });
      ultimo = f.dia;
    }
    cuerpo.push({ tipo: 'fila', f });
  }
  const resumenDia = new Map<string, { n: number; total: Decimal }>();
  for (const f of visibles) {
    const r = resumenDia.get(f.dia) ?? { n: 0, total: new Decimal(0) };
    resumenDia.set(f.dia, { n: r.n + 1, total: r.total.plus(f.total) });
  }
  const ayer = restarDias(hoy, 1);
  const etiquetaDia = (d: string) => (d === hoy ? `Hoy · ${ddmm(d)}` : d === ayer ? `Ayer · ${ddmm(d)}` : ddmm(d));

  const tablaClase = ['po-table', ...[...ocultas].map((c) => `h-${c}`)].join(' ');
  const rangoTexto: Record<Rango, string> = {
    todo: 'Todo el período',
    mes: `Este mes (${nombreDelMes(hoy)})`,
    sem: 'Últimos 7 días',
    hoy: 'Hoy',
  };

  const contenido = (
    <div className="po-page">
      <style>{PEDIDOS_CSS}</style>

      <div className="po-head glass">
        <div className="po-head-l">
          <span className="po-head-ic">{Icono.bolsa}</span>
          <div>
            <h1 className="po-title">Pedidos</h1>
            <p className="po-sub">
              Libro completo de encargos — todo lo que se tomó, con o sin seña. Los señados también viven en <b>Señas</b>.
            </p>
          </div>
        </div>
        <button type="button" className="po-new" onClick={() => setModal({ tipo: 'nuevo' })}>
          {Icono.mas}Nuevo pedido
        </button>
      </div>

      <div className="po-kpis">
        <div className="po-kpi glass">
          <div className="upper-mini">Pedidos del mes</div>
          <div className="v tnum">{kpis.delMes}</div>
          <div className="foot">tomados en {nombreDelMes(hoy)}</div>
          <svg className="spark" width="70" height="26" viewBox="0 0 70 26" preserveAspectRatio="none" aria-hidden="true">
            <path d={spark} fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="po-kpi glass">
          <div className="upper-mini">Activos</div>
          <div className="v tnum violeta">{kpis.activos}</div>
          <div className="foot">en preparación o por retirar</div>
        </div>
        <div className="po-kpi glass">
          <div className="upper-mini">Entregados</div>
          <div className="v tnum verde">{kpis.entregados}</div>
          <div className="foot">cerrados este mes</div>
        </div>
        <div className="po-kpi glass">
          <div className="upper-mini">Comprometido con seña</div>
          <div className="v tnum">{plata(kpis.comprometido)}</div>
          <div className="foot">saldo por cobrar · {kpis.conSena} con seña</div>
        </div>
      </div>

      <div className="po-controls glass">
        <div className="po-chips" role="group" aria-label="Filtrar por estado">
          {(
            [
              ['todos', 'Todos', null],
              ['activo', 'Activos', 'violeta'],
              ['sena', 'Señados', 'verde'],
              ['entregado', 'Terminados', 'gris'],
              ['cancelado', 'Cancelados', 'rojo'],
            ] as const
          ).map(([k, txt, c]) => (
            <button key={k} type="button" className={`po-chip${filtro === k ? ' on' : ''}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
              {c ? <span className={`c ${c}`} /> : null}
              {txt}
            </button>
          ))}
        </div>

        <div className={`po-dd${menu === 'taker' ? ' open' : ''}`}>
          <button type="button" className="po-dd-btn" aria-expanded={menu === 'taker'} onClick={() => setMenu(menu === 'taker' ? null : 'taker')}>
            <span className="who">{Icono.persona}<span>Tomado por: {tomador === 'todos' ? 'todos' : primerNombre(tomador)}</span></span>
            {Icono.chev}
          </button>
          <div className="po-dd-menu">
            <button type="button" className={`po-dd-item${tomador === 'todos' ? ' on' : ''}`} onClick={() => { setTomador('todos'); setMenu(null); }}>
              <span className="tk all">•</span>Todos los vendedores
            </button>
            {tomadores.map((t) => (
              <button key={t} type="button" className={`po-dd-item${tomador === t ? ' on' : ''}`} onClick={() => { setTomador(t); setMenu(null); }}>
                <span className={`tk c${colorDe(t, 3)}`}>{iniciales(t.includes('@') ? primerNombre(t) : t)}</span>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className={`po-dd${menu === 'range' ? ' open' : ''}`}>
          <button type="button" className="po-dd-btn" aria-expanded={menu === 'range'} onClick={() => setMenu(menu === 'range' ? null : 'range')}>
            <span className="who">{Icono.calendario}<span>{rangoTexto[rango]}</span></span>
            {Icono.chev}
          </button>
          <div className="po-dd-menu">
            {(['todo', 'mes', 'sem', 'hoy'] as const).map((r) => (
              <button key={r} type="button" className={`po-dd-item${rango === r ? ' on' : ''}`} onClick={() => { setRango(r); setMenu(null); }}>
                {rangoTexto[r]}
              </button>
            ))}
          </div>
        </div>

        <div className="po-view" role="group" aria-label="Vista">
          <button type="button" className={vista === 'dia' ? 'on' : ''} aria-pressed={vista === 'dia'} onClick={() => setVista('dia')}>
            {Icono.calendario}Por día
          </button>
          <button type="button" className={vista === 'lista' ? 'on' : ''} aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>
            {Icono.lista}Lista
          </button>
        </div>
      </div>

      <div className="po-card glass">
        <div className="po-cardhead">
          <h3>Historial de pedidos</h3>
          <div className="po-hcs">
            <span className="po-count">
              {visibles.length} {visibles.length === 1 ? 'pedido' : 'pedidos'}
            </span>
            <div className={`po-cols${menu === 'cols' ? ' open' : ''}`}>
              <button type="button" className="po-cols-btn" aria-expanded={menu === 'cols'} onClick={() => setMenu(menu === 'cols' ? null : 'cols')}>
                {Icono.columnas}Columnas
              </button>
              <div className="po-cols-menu">
                {(
                  [
                    ['fecha', 'Fecha'],
                    ['saldo', 'Saldo'],
                    ['entrega', 'Entrega'],
                    ['tomo', 'Tomó'],
                  ] as const
                ).map(([c, txt]) => (
                  <button key={c} type="button" className={ocultas.has(c) ? '' : 'on'} onClick={() => toggleCol(c)}>
                    <span className="po-chk">{Icono.check}</span>
                    {txt}
                  </button>
                ))}
              </div>
            </div>
            <div className={`po-exp${menu === 'exp' ? ' open' : ''}`}>
              <button type="button" className="po-exp-btn" aria-expanded={menu === 'exp'} onClick={() => setMenu(menu === 'exp' ? null : 'exp')}>
                {Icono.bajar}Exportar
              </button>
              <div className="po-exp-menu">
                <button type="button" onClick={exportarCsv}>{Icono.csv}CSV</button>
                <button type="button" onClick={() => { setMenu(null); window.print(); }}>{Icono.imprimir}Imprimir</button>
              </div>
            </div>
          </div>
        </div>

        <table className={tablaClase}>
          <thead>
            <tr>
              <th style={{ width: 52 }}>#</th>
              <th style={{ width: 60 }}>Fecha</th>
              <th>Cliente</th>
              <th>Detalle</th>
              <th style={{ width: 122 }}>Estado</th>
              <th style={{ width: 116 }}>Seña</th>
              <th className="r" style={{ width: 84 }}>Total</th>
              <th className="r" style={{ width: 84 }}>Saldo</th>
              <th style={{ width: 80 }}>Entrega</th>
              <th style={{ width: 98 }}>Tomó</th>
            </tr>
          </thead>
          <tbody>
            {cuerpo.map((c) =>
              c.tipo === 'dia' ? (
                <tr key={`d-${c.dia}`} className="po-daygroup">
                  <td colSpan={10}>
                    <div className="po-dg">
                      <span className={`lbl${c.dia === hoy ? ' hoy' : ''}`}>{etiquetaDia(c.dia)}</span>
                      <span className="meta">
                        {resumenDia.get(c.dia)?.n ?? 0} {resumenDia.get(c.dia)?.n === 1 ? 'pedido' : 'pedidos'} · {plata(resumenDia.get(c.dia)?.total ?? '0')}
                      </span>
                      <span className="line" />
                    </div>
                  </td>
                </tr>
              ) : (
                <FilaPedido key={c.f.id} f={c.f} hoy={hoy} onAbrir={() => setModal({ tipo: 'detalle', id: c.f.id })} />
              )
            )}
          </tbody>
        </table>
        {visibles.length === 0 ? (
          <div className="po-empty">
            {pedidos.length === 0
              ? 'Todavía no se tomó ningún pedido. Empezá con "Nuevo pedido".'
              : 'No hay pedidos que coincidan con el filtro.'}
          </div>
        ) : null}
      </div>

      <div className={`po-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">
        {Icono.ok}
        <span className="tmsg">{toast ?? ''}</span>
      </div>
    </div>
  );

  const buscador = (
    <div className="search glass">
      {Icono.lupa}
      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar pedido, cliente o #…"
        aria-label="Buscar pedido, cliente o número"
      />
    </div>
  );

  return (
    <AppShell
      storeName="Caja 1"
      userName={props.userName}
      userRole={props.userRole}
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
      scroll="pagina"
      topbarLeft={buscador}
    >
      {contenido}
      {modal?.tipo === 'nuevo' ? (
        <ModalPedido
          modo={{ tipo: 'nuevo' }}
          clientes={props.clientes}
          productos={props.productos}
          hayCajaAbierta={props.hayCajaAbierta}
          onCerrar={() => setModal(null)}
          onListo={(msg) => {
            setModal(null);
            setToast(msg);
          }}
        />
      ) : null}
      {modal?.tipo === 'editar' ? (
        <ModalPedido
          modo={{ tipo: 'editar', id: modal.id }}
          clientes={props.clientes}
          productos={props.productos}
          hayCajaAbierta={props.hayCajaAbierta}
          onCerrar={() => setModal({ tipo: 'detalle', id: modal.id })}
          onListo={(msg) => {
            setModal({ tipo: 'detalle', id: modal.id });
            setToast(msg);
          }}
        />
      ) : null}
      {modal?.tipo === 'detalle' ? (
        <ModalDetalle
          id={modal.id}
          hoy={hoy}
          hayCajaAbierta={props.hayCajaAbierta}
          onCerrar={() => setModal(null)}
          onEditar={() => setModal({ tipo: 'editar', id: modal.id })}
          onAviso={setToast}
        />
      ) : null}
    </AppShell>
  );
}

function FilaPedido({ f, hoy, onAbrir }: { f: Fila; hoy: string; onAbrir: () => void }) {
  const vivo = estaVivo(f.status);
  const textoEstado =
    f.status === 'listo' && f.saldado ? 'Listo · saldado' : ESTADO_TEXTO[f.status];
  const detalle =
    (f.primerItem ?? '—') + (f.cantidadItems > 1 ? ` + ${f.cantidadItems - 1} más` : '');
  const entrega = !vivo
    ? { txt: f.status === 'entregado' && f.deliveredAtIso ? ddmm(diaDe(f.deliveredAtIso)) : '—', cls: '' }
    : f.vencido
      ? { txt: `venc. ${ddmm(f.pickupDate)}`, cls: ' over' }
      : f.pickupDate === hoy
        ? { txt: 'Hoy', cls: ' hoy' }
        : { txt: ddmm(f.pickupDate), cls: '' };
  const saldo = f.status === 'cancelado'
    ? { txt: '—', cls: 'na' }
    : f.status === 'entregado'
      ? { txt: '$0', cls: 'ok' }
      : f.saldado
        ? { txt: '$0', cls: 'ok' }
        : { txt: plata(f.saldo), cls: 'pend' };
  return (
    <tr
      className="po-row"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAbrir();
        }
      }}
      aria-label={`Pedido ${f.number} de ${f.customerName}`}
    >
      <td className="po-num">#{String(f.number).padStart(4, '0')}</td>
      <td className="po-date">{ddmm(f.dia)}</td>
      <td>
        <div className="po-cli">
          <span className={`po-av c${colorDe(f.customerName, 6)}`}>{iniciales(f.customerName)}</span>
          <span className="po-cli-n">{f.customerName}</span>
        </div>
      </td>
      <td className="po-det" title={detalle}>{detalle}</td>
      <td>
        <span className={`po-est ${ESTADO_CLASE[f.status]}`}>
          <span className="d" />
          {textoEstado}
        </span>
      </td>
      <td>
        {/* Como la maqueta: con seña se muestra LA SEÑA (no lo cobrado);
            "Pagado" cuando un pedido vivo ya está saldado; y un pedido que se
            pagó entero al retirar dice "Sin seña", porque no dejó seña. */}
        {vivo && f.saldado ? (
          <span className="po-sena si">Pagado <b>{plata(f.cobrado)}</b></span>
        ) : f.sena !== null ? (
          <span className="po-sena si">Seña <b>{plata(f.sena)}</b></span>
        ) : (
          <span className="po-sena no">Sin seña</span>
        )}
      </td>
      <td className="r po-tot">{plata(f.total)}</td>
      <td className={`r po-saldo ${saldo.cls}`}>{saldo.txt}</td>
      <td className={`po-ent${entrega.cls}`}>{entrega.txt}</td>
      <td>
        <span className="po-tomo">
          <span className={`tk c${colorDe(f.tomadoPor ?? '', 3)}`}>{iniciales(primerNombre(f.tomadoPor))}</span>
          <span className="nm">{primerNombre(f.tomadoPor)}</span>
        </span>
      </td>
    </tr>
  );
}

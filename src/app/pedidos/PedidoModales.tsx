'use client';

/**
 * Modales de /pedidos: alta/edición (formulario de pedidos-senados.html,
 * extendido a varias líneas), detalle (pedidos.html + historial de pagos de
 * pedidos-senados.html), cobro a cuenta y "Cobrar saldo y entregar".
 *
 * Doble click y reintento: cada operación con plata lleva una clave de
 * idempotencia. Se REUSA mientras el pedido que se manda sea el mismo (un
 * reintento tras un error de red no duplica), y se renueva si la persona
 * cambia algo (si no, el servidor lo rechazaría como reuso de clave).
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { estadoDerivado, estaVivo, totalDelPedido } from '@/lib/domain/pedidos';
import { normalizarMontoTipeado } from '@/lib/money/monto-tipeado';
import type { OrderPaymentMethod, OrderStatus } from '@/lib/db/schema/orders';
import {
  cambiarEstadoAction,
  cobrarPedidoAction,
  crearPedidoAction,
  detallePedidoAction,
  editarPedidoAction,
  entregarPedidoAction,
  type DetalleDTO,
  type PedidoForm,
} from './actions';
import {
  cantidad as fmtCantidad,
  COBRO_TEXTO,
  ddmm,
  diaDe,
  ESTADO_CLASE,
  ESTADO_TEXTO,
  hora,
  MEDIO_TEXTO,
  plata,
} from './formato';

export interface Cliente {
  id: string;
  name: string;
  phone: string | null;
}
export interface Producto {
  id: string;
  name: string;
  price: string;
}

const MEDIOS: OrderPaymentMethod[] = ['efectivo', 'debito', 'credito', 'transferencia'];

const X = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const MAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);
const TACHO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
);

/** Clave de idempotencia que se reusa mientras el contenido no cambie. */
function useClave() {
  const ref = useRef<{ firma: string; clave: string } | null>(null);
  return (contenido: unknown) => {
    const firma = JSON.stringify(contenido);
    if (!ref.current || ref.current.firma !== firma) {
      ref.current = { firma, clave: crypto.randomUUID() };
    }
    return ref.current.clave;
  };
}

/** Cierra con Escape. */
function useEscape(onCerrar: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [onCerrar]);
}

function Overlay({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  useEscape(onCerrar);
  return (
    <div
      className="modal-ov"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      {children}
    </div>
  );
}

function Cabeza({ titulo, sub, onCerrar, id }: { titulo: string; sub: string; onCerrar: () => void; id: string }) {
  return (
    <div className="m-head">
      <div>
        <div className="m-title" id={id}>{titulo}</div>
        <div className="m-sub">{sub}</div>
      </div>
      <button type="button" className="m-x" aria-label="Cerrar" onClick={onCerrar}>{X}</button>
    </div>
  );
}

function SelectorMedio({ valor, onCambio, id }: { valor: OrderPaymentMethod; onCambio: (m: OrderPaymentMethod) => void; id: string }) {
  return (
    <select id={id} value={valor} onChange={(e) => onCambio(e.target.value as OrderPaymentMethod)}>
      {MEDIOS.map((m) => (
        <option key={m} value={m}>{MEDIO_TEXTO[m]}</option>
      ))}
    </select>
  );
}

const AVISO_SIN_CAJA = 'No hay caja abierta. Para cobrar, primero abrí la caja en "Caja".';

// ─────────────────────────────────────────────────────────────────────────────
// Alta / edición
// ─────────────────────────────────────────────────────────────────────────────

interface LineaUI {
  k: number;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
}

export function ModalPedido(props: {
  modo: { tipo: 'nuevo' } | { tipo: 'editar'; id: string };
  clientes: Cliente[];
  productos: Producto[];
  hayCajaAbierta: boolean;
  onCerrar: () => void;
  onListo: (mensaje: string) => void;
}) {
  const { modo, clientes, productos } = props;
  const router = useRouter();
  const [pendiente, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(modo.tipo === 'editar');
  const [numero, setNumero] = useState<number | null>(null);
  const [cobradoYa, setCobradoYa] = useState('0');

  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [lineas, setLineas] = useState<LineaUI[]>([
    { k: 1, product_id: null, description: '', quantity: '1', unit_price: '' },
  ]);
  const [sena, setSena] = useState('');
  const [medio, setMedio] = useState<OrderPaymentMethod>('efectivo');
  const [retiro, setRetiro] = useState('');
  const [congela, setCongela] = useState(false);
  const clave = useClave();
  const sig = useRef(2);

  // Edición: se trae el pedido tal como está en la base.
  useEffect(() => {
    if (modo.tipo !== 'editar') return;
    let vivo = true;
    void detallePedidoAction(modo.id).then((r) => {
      if (!vivo) return;
      setCargando(false);
      if (!r.ok || !r.data) {
        setError(r.ok ? 'Ese pedido no existe.' : r.error);
        return;
      }
      const d = r.data;
      setNumero(d.order.number);
      setCobradoYa(d.order.cobrado);
      setCliente(d.order.customer_name);
      setTelefono(d.order.customer_phone ?? '');
      setRetiro(d.order.pickup_date ?? '');
      setCongela(d.order.price_freezes);
      setLineas(
        d.items.map((it, i) => ({
          k: i + 1,
          product_id: it.product_id,
          description: it.description,
          quantity: new Decimal(it.quantity).toString().replace('.', ','),
          unit_price: new Decimal(it.unit_price).toFixed(2).replace('.', ','),
        }))
      );
      sig.current = d.items.length + 1;
    });
    return () => {
      vivo = false;
    };
  }, [modo]);

  const clienteDelLibro = clientes.find((c) => c.name.trim().toLowerCase() === cliente.trim().toLowerCase()) ?? null;

  // Previsualización. El servidor recalcula; esto es lo que se ve mientras se tipea.
  const leidas = lineas.map((l) => ({
    ...l,
    q: normalizarMontoTipeado(l.quantity),
    p: normalizarMontoTipeado(l.unit_price),
  }));
  const total = useMemo(
    () =>
      totalDelPedido(
        leidas
          .filter((l) => l.q !== null && l.p !== null)
          .map((l) => ({ quantity: l.q as string, unit_price: l.p as string }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas]
  );
  const senaLeida = sena.trim() === '' ? null : normalizarMontoTipeado(sena);
  const senaD = senaLeida ? new Decimal(senaLeida) : new Decimal(0);
  const saldo = Decimal.max(total.minus(senaD).minus(modo.tipo === 'editar' ? cobradoYa : 0), 0);
  const cobraSena = modo.tipo === 'nuevo' && senaD.gt(0);

  function actualizar(k: number, campo: keyof Omit<LineaUI, 'k'>, valor: string) {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.k !== k) return l;
        if (campo !== 'description') return { ...l, [campo]: valor };
        // Si lo que se escribe es un producto del catálogo, se toma su precio
        // (sólo si todavía no se puso uno: el precio de un encargo se negocia).
        const p = productos.find((x) => x.name.toLowerCase() === valor.trim().toLowerCase());
        if (!p) return { ...l, description: valor, product_id: null };
        return {
          ...l,
          description: p.name,
          product_id: p.id,
          unit_price: l.unit_price.trim() === '' ? new Decimal(p.price).toFixed(2).replace('.', ',') : l.unit_price,
        };
      })
    );
  }

  function validar(): string | null {
    if (cliente.trim() === '') return 'Decí a nombre de quién es el pedido.';
    for (const [i, l] of leidas.entries()) {
      if (l.description.trim() === '') return `Ítem ${i + 1}: decí qué se encarga.`;
      if (l.q === null || new Decimal(l.q).lte(0)) return `Ítem ${i + 1}: la cantidad tiene que ser mayor a cero.`;
      if (l.p === null) return `Ítem ${i + 1}: falta el precio.`;
    }
    if (total.lte(0)) return 'El total del pedido tiene que ser mayor a cero.';
    if (sena.trim() !== '' && senaLeida === null) return 'La seña no es un importe válido.';
    if (senaD.gt(total)) return 'La seña no puede superar el total.';
    if (cobraSena && !props.hayCajaAbierta) return AVISO_SIN_CAJA;
    return null;
  }

  function guardar() {
    const problema = validar();
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    const pedido: PedidoForm = {
      customer_id: clienteDelLibro?.id ?? null,
      customer_name: cliente.trim(),
      customer_phone: telefono.trim() || clienteDelLibro?.phone || null,
      pickup_date: retiro || null,
      notes: null,
      price_freezes: congela,
      items: leidas.map((l) => ({
        product_id: l.product_id,
        description: l.description.trim(),
        quantity: l.q as string,
        unit_price: l.p as string,
      })),
    };
    start(async () => {
      if (modo.tipo === 'nuevo') {
        const pago = cobraSena ? { amount: senaD.toFixed(2), method: medio } : null;
        const r = await crearPedidoAction(pedido, pago, clave({ pedido, pago }));
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
        props.onListo(`Pedido #${String(r.data.number).padStart(4, '0')} guardado${pago ? ` · seña ${plata(pago.amount)} en caja` : ''}`);
      } else {
        const r = await editarPedidoAction(modo.id, pedido);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
        props.onListo('Cambios guardados');
      }
    });
  }

  const titulo =
    modo.tipo === 'nuevo' ? 'Nuevo pedido' : `Editar pedido${numero ? ` #${String(numero).padStart(4, '0')}` : ''}`;
  const sub =
    modo.tipo === 'nuevo'
      ? 'Encargo para retirar después. La seña es opcional.'
      : `Ya cobrado: ${plata(cobradoYa)}. El total no puede quedar por debajo.`;

  return (
    <Overlay onCerrar={props.onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="m-pedido-t">
        <Cabeza titulo={titulo} sub={sub} onCerrar={props.onCerrar} id="m-pedido-t" />
        {cargando ? (
          <div className="po-empty">Cargando el pedido…</div>
        ) : (
          <>
            <div className="fld-row">
              <div className="fld desc">
                <label htmlFor="p-cliente">Cliente</label>
                <input id="p-cliente" list="p-clientes" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre del cliente" autoComplete="off" autoFocus />
                <datalist id="p-clientes">
                  {clientes.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
              <div className="fld">
                <label htmlFor="p-tel">Teléfono</label>
                <input id="p-tel" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder={clienteDelLibro?.phone ?? 'Opcional'} />
              </div>
            </div>

            {lineas.map((l, i) => (
              <div className="fld-row" key={l.k}>
                <div className="fld desc">
                  {i === 0 ? <label htmlFor={`p-item-${l.k}`}>¿Qué encarga?</label> : null}
                  <input id={`p-item-${l.k}`} list="p-productos" value={l.description} onChange={(e) => actualizar(l.k, 'description', e.target.value)} placeholder="Ej: 50 m de tafeta roja — tono bordó" aria-label={`Ítem ${i + 1}`} />
                </div>
                <div className="fld chico">
                  {i === 0 ? <label htmlFor={`p-cant-${l.k}`}>Cantidad</label> : null}
                  <input id={`p-cant-${l.k}`} inputMode="decimal" value={l.quantity} onChange={(e) => actualizar(l.k, 'quantity', e.target.value)} aria-label={`Cantidad del ítem ${i + 1}`} />
                </div>
                <div className="fld">
                  {i === 0 ? <label htmlFor={`p-precio-${l.k}`}>Precio unit.</label> : null}
                  <input id={`p-precio-${l.k}`} inputMode="decimal" value={l.unit_price} onChange={(e) => actualizar(l.k, 'unit_price', e.target.value)} placeholder="0" aria-label={`Precio del ítem ${i + 1}`} />
                </div>
                <button
                  type="button"
                  className={`quitar${lineas.length === 1 ? ' ocupa' : ''}`}
                  aria-label={`Quitar ítem ${i + 1}`}
                  onClick={() => setLineas((prev) => prev.filter((x) => x.k !== l.k))}
                  disabled={lineas.length === 1}
                >
                  {TACHO}
                </button>
              </div>
            ))}
            <datalist id="p-productos">
              {productos.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <button
              type="button"
              className="m-add"
              onClick={() => {
                const k = sig.current++;
                setLineas((prev) => [...prev, { k, product_id: null, description: '', quantity: '1', unit_price: '' }]);
              }}
            >
              {MAS}Agregar ítem
            </button>

            <div className="fld-row">
              {modo.tipo === 'nuevo' ? (
                <>
                  <div className="fld">
                    <label htmlFor="p-sena">Seña</label>
                    <input id="p-sena" inputMode="decimal" value={sena} onChange={(e) => setSena(e.target.value)} placeholder="0" />
                  </div>
                  <div className="fld">
                    <label htmlFor="p-medio">Medio de la seña</label>
                    <SelectorMedio id="p-medio" valor={medio} onCambio={setMedio} />
                  </div>
                </>
              ) : null}
              <div className="fld">
                <label htmlFor="p-retiro">Fecha de retiro</label>
                <input id="p-retiro" type="date" value={retiro} onChange={(e) => setRetiro(e.target.value)} />
              </div>
            </div>

            <div className="m-toggle">
              <div>
                <div className="t" id="p-congela-t">La seña congela el precio</div>
                <div className="s">Queda anotado. La factura de la seña todavía no se emite: lo define la contadora (RG 707/1999).</div>
              </div>
              <button
                type="button"
                className={`sw${congela ? ' on' : ''}`}
                role="switch"
                aria-checked={congela}
                aria-labelledby="p-congela-t"
                onClick={() => setCongela((v) => !v)}
              />
            </div>

            {cobraSena && !props.hayCajaAbierta ? <div className="m-aviso">{AVISO_SIN_CAJA}</div> : null}

            <div className="m-summary form">
              <div className="s-cell"><div className="s-k">Total</div><div className="s-v tnum">{plata(total)}</div></div>
              <div className="s-cell">
                <div className="s-k">{modo.tipo === 'nuevo' ? 'Seña' : 'Cobrado'}</div>
                <div className="s-v tnum verde">{plata(modo.tipo === 'nuevo' ? senaD : cobradoYa)}</div>
              </div>
              <div className="s-cell"><div className="s-k">Saldo</div><div className="s-v tnum">{plata(saldo)}</div></div>
            </div>

            {error ? <div className="m-err" role="alert">{error}</div> : null}

            <div className="m-acts">
              <button type="button" className="m-btn ghost" onClick={props.onCerrar}>Cancelar</button>
              <button type="button" className="m-btn primary" onClick={guardar} disabled={pendiente}>
                {pendiente ? 'Guardando…' : modo.tipo === 'nuevo' ? 'Guardar pedido' : 'Guardar cambios'}
              </button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalle + acciones
// ─────────────────────────────────────────────────────────────────────────────

type Sub = null | 'cobro' | 'entregar' | 'cancelar';

export function ModalDetalle(props: {
  id: string;
  hoy: string;
  hayCajaAbierta: boolean;
  onCerrar: () => void;
  onEditar: () => void;
  onAviso: (msg: string) => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<DetalleDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [pendiente, start] = useTransition();
  const [importe, setImporte] = useState('');
  const [medio, setMedio] = useState<OrderPaymentMethod>('efectivo');
  const clave = useClave();

  const cargar = () =>
    detallePedidoAction(props.id).then((r) => {
      if (!r.ok) setError(r.error);
      else if (!r.data) setError('Ese pedido no existe.');
      else setD(r.data);
    });

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  if (!d) {
    return (
      <Overlay onCerrar={props.onCerrar}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Pedido">
          <Cabeza titulo="Pedido" sub="—" onCerrar={props.onCerrar} id="m-det-t" />
          {error ? <div className="m-err" role="alert">{error}</div> : <div className="po-empty">Cargando…</div>}
        </div>
      </Overlay>
    );
  }

  const o = d.order;
  const status = o.status as OrderStatus;
  const vivo = estaVivo(status);
  const e = estadoDerivado({ status, total: o.total, cobrado: o.cobrado, pickup_date: o.pickup_date, hoy: props.hoy });
  const num = `#${String(o.number).padStart(4, '0')}`;

  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSub(null);
      setImporte('');
      router.refresh();
      props.onAviso(ok);
      await cargar();
    });
  }

  const cambiar = (hacia: OrderStatus, ok: string) => correr(() => cambiarEstadoAction(o.id, hacia), ok);

  function cobrar() {
    const leido = normalizarMontoTipeado(importe);
    if (!leido || new Decimal(leido).lte(0)) {
      setError('Poné un importe mayor a cero.');
      return;
    }
    const pago = { amount: new Decimal(leido).toFixed(2), method: medio };
    correr(() => cobrarPedidoAction(o.id, pago, clave({ id: o.id, pago })), `Cobro de ${plata(pago.amount)} registrado en caja`);
  }

  function entregar() {
    const metodo = e.saldo.gt(0) ? medio : null;
    correr(
      () => entregarPedidoAction(o.id, metodo, clave({ id: o.id, metodo, entregar: true })),
      e.saldo.gt(0) ? `Cobrado ${plata(e.saldo)} y entregado` : 'Pedido entregado'
    );
  }

  const pasos: Array<[OrderStatus, string]> = [
    ['tomado', 'Tomado'],
    ['en_preparacion', 'En preparación'],
    ['listo', 'Listo para retirar'],
    ['entregado', 'Entregado'],
  ];
  const idx = pasos.findIndex(([s]) => s === status);

  return (
    <Overlay onCerrar={props.onCerrar}>
      <div className="modal ancho" role="dialog" aria-modal="true" aria-labelledby="m-det-t">
        <Cabeza
          titulo={o.customer_name}
          sub={`Pedido ${num} · ${ddmm(diaDe(o.created_at))}${o.pickup_date ? ` · retira ${ddmm(o.pickup_date)}` : ''}${o.customer_phone ? ` · ${o.customer_phone}` : ''}`}
          onCerrar={props.onCerrar}
          id="m-det-t"
        />

        <div className="d-sec">Detalle del encargo</div>
        <div>
          {d.items.map((it, i) => (
            <div className="d-item" key={i}>
              <div>
                <div>{it.description}</div>
                <div className="q">{fmtCantidad(it.quantity)} × {plata(it.unit_price)}</div>
              </div>
              <span className="a">{plata(it.line_total)}</span>
            </div>
          ))}
          <div className="d-item total"><div>Total</div><span className="a">{plata(o.total)}</span></div>
        </div>

        <div className="d-sec">Estados</div>
        <div className="d-tl">
          {status === 'cancelado' ? (
            <div className="row"><span className="dot no" />Pedido cancelado</div>
          ) : (
            pasos.map(([s, txt], i) => (
              <div key={s} className={`row${i <= idx ? '' : ' pend'}`}>
                <span className={`dot${i <= idx ? ' ok' : ''}`} />
                {txt}
                {i === idx ? <b>· actual</b> : null}
                {s === 'entregado' && o.delivered_at ? <span className="dt">{ddmm(diaDe(o.delivered_at))}</span> : null}
              </div>
            ))
          )}
        </div>

        <div className="d-sec">Historial de pagos</div>
        <div>
          {d.payments.length === 0 ? (
            <div className="d-pay pend"><span className="pd" /><div><div className="t">Sin seña</div><div className="s">todavía no se cobró nada</div></div></div>
          ) : (
            d.payments.map((p) => (
              <div className="d-pay" key={p.id}>
                <span className="pd" />
                <div>
                  <div className="t">{COBRO_TEXTO[p.kind] ?? p.kind}</div>
                  <div className="s">{MEDIO_TEXTO[p.method] ?? p.method} · {ddmm(diaDe(p.created_at))} {hora(p.created_at)}{p.por ? ` · ${p.por.split('@')[0]}` : ''}</div>
                </div>
                <span className="amt">{plata(p.amount)}</span>
              </div>
            ))
          )}
          {vivo && e.saldo.gt(0) ? (
            <div className="d-pay pend"><span className="pd" /><div><div className="t">Saldo pendiente</div><div className="s">se cobra al retirar</div></div><span className="amt">{plata(e.saldo)}</span></div>
          ) : null}
        </div>

        <div className="m-summary">
          <div className="s-cell"><div className="s-k">Estado</div><div className={`s-v chico e-${ESTADO_CLASE[status]}`}>{status === 'listo' && e.saldado ? 'Listo · saldado' : ESTADO_TEXTO[status]}{e.vencido ? ' · vencido' : ''}</div></div>
          <div className="s-cell"><div className="s-k">{e.saldado ? 'Pagado' : 'Seña'}</div><div className="s-v tnum verde">{e.conSena ? plata(o.cobrado) : 'Sin seña'}</div></div>
          <div className="s-cell"><div className="s-k">Tomado por</div><div className="s-v chico">{o.tomado_por ? o.tomado_por.split('@')[0] : '—'}</div></div>
        </div>

        {o.price_freezes && e.conSena ? (
          <div className="m-aviso">La seña congela el precio. La factura de la seña todavía no se emite: queda pendiente de la contadora.</div>
        ) : null}

        {sub === 'cobro' || sub === 'entregar' ? (
          <>
            {!props.hayCajaAbierta && (sub === 'cobro' || e.saldo.gt(0)) ? <div className="m-aviso">{AVISO_SIN_CAJA}</div> : null}
            <div className="fld-row">
              {sub === 'cobro' ? (
                <div className="fld">
                  <label htmlFor="d-importe">Importe (falta {plata(e.saldo)})</label>
                  <input id="d-importe" inputMode="decimal" value={importe} onChange={(ev) => setImporte(ev.target.value)} placeholder={e.saldo.toFixed(2).replace('.', ',')} autoFocus />
                </div>
              ) : null}
              {sub === 'cobro' || e.saldo.gt(0) ? (
                <div className="fld">
                  <label htmlFor="d-medio">Medio de pago</label>
                  <SelectorMedio id="d-medio" valor={medio} onCambio={setMedio} />
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {sub === 'cancelar' ? (
          <div className="m-aviso">¿Cancelar el pedido {num}? No se puede deshacer.</div>
        ) : null}

        {error ? <div className="m-err" role="alert">{error}</div> : null}

        <div className="m-acts">
          {sub === null ? (
            <>
              {vivo ? (
                <div className="izq">
                  <button type="button" className="m-btn ghost" onClick={props.onEditar}>Editar</button>
                  <button type="button" className="m-btn peligro" onClick={() => { setError(null); setSub('cancelar'); }}>Cancelar pedido</button>
                </div>
              ) : null}
              <button type="button" className="m-btn ghost" onClick={props.onCerrar}>Cerrar</button>
              {status === 'tomado' ? (
                <button type="button" className="m-btn ghost" disabled={pendiente} onClick={() => cambiar('en_preparacion', `${num} en preparación`)}>En preparación</button>
              ) : null}
              {status === 'tomado' || status === 'en_preparacion' ? (
                <button type="button" className="m-btn ghost" disabled={pendiente} onClick={() => cambiar('listo', `${num} listo para retirar`)}>Marcar listo</button>
              ) : null}
              {vivo && e.saldo.gt(0) ? (
                <button type="button" className="m-btn ghost" onClick={() => { setError(null); setImporte(''); setSub('cobro'); }}>Registrar cobro</button>
              ) : null}
              {vivo ? (
                <button type="button" className="m-btn primary" onClick={() => { setError(null); setSub('entregar'); }}>
                  {e.saldo.gt(0) ? 'Cobrar saldo y entregar' : 'Marcar entregado'}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" className="m-btn ghost" onClick={() => { setSub(null); setError(null); }}>Volver</button>
              {sub === 'cobro' ? (
                <button type="button" className="m-btn primary" disabled={pendiente || !props.hayCajaAbierta} onClick={cobrar}>
                  {pendiente ? 'Registrando…' : 'Registrar cobro'}
                </button>
              ) : null}
              {sub === 'entregar' ? (
                <button type="button" className="m-btn primary" disabled={pendiente || (e.saldo.gt(0) && !props.hayCajaAbierta)} onClick={entregar}>
                  {pendiente ? 'Guardando…' : e.saldo.gt(0) ? `Cobrar ${plata(e.saldo)} y entregar` : 'Confirmar entrega'}
                </button>
              ) : null}
              {sub === 'cancelar' ? (
                <button type="button" className="m-btn peligro" disabled={pendiente} onClick={() => cambiar('cancelado', `${num} cancelado`)}>
                  {pendiente ? 'Cancelando…' : 'Sí, cancelar'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

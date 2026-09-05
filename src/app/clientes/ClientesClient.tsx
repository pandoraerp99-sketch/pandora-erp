'use client';

/**
 * Clientes — lista maestra + detalle, sobre <AppShell>.
 * Maqueta: `pos-preview/clientes-v6.html`.
 *
 * ── LAS DOS CLASIFICACIONES SE VEN DISTINTO A PROPÓSITO ──────────────────
 * (research CLIENTES 2026-07-03)
 *   - Condición de IVA (FISCAL, una sola): pill SÓLIDA. Decide el tipo de
 *     comprobante y viaja a ARCA. Es un dato duro.
 *   - Segmentos (COMERCIAL, varios): chip con borde punteado. Los inventa el
 *     comerciante y sirven para promos.
 * De un vistazo tiene que quedar claro cuál es cuál: si se ven iguales,
 * alguien va a tratar "Jubilados" como si fuera una condición fiscal.
 *
 * ── LO QUE LA MAQUETA MUESTRA Y ACÁ NO ESTÁ ──────────────────────────────
 *   - "Cta. corriente" y el KPI "Por cobrar": la DEUDA es un dominio de
 *     dinero que no existe (necesita libro append-only propio y toca el
 *     cierre de caja). No se pone ni apagado: no es un botón que falta, es un
 *     dominio entero. Un "$0" implicaría que hay un número calculado.
 *   - Sparkline "+8,3% este mes": necesita el histórico de clientes activos
 *     por mes, que no se guarda.
 */
import { useMemo, useState, useTransition } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CLIENTES_CSS } from './clientesCss';
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerFormInput,
} from './actions';

export interface ClienteDTO {
  id: string;
  name: string;
  doc_type: string;
  doc_number: string | null;
  tax_condition: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  compras: number;
  ultima_compra: string | null;
}

interface Props {
  clientes: ClienteDTO[];
  cashierName: string;
  salePointLabel: string;
}

/** Condiciones de IVA. El valor guardado es el slug; se muestra la etiqueta. */
const CONDICIONES: Array<{ valor: string; label: string }> = [
  { valor: 'consumidor_final', label: 'Consumidor final' },
  { valor: 'responsable_inscripto', label: 'Resp. Inscripto' },
  { valor: 'monotributo', label: 'Monotributo' },
  { valor: 'exento', label: 'Exento' },
];
const etiquetaCondicion = (v: string | null) =>
  v === null ? 'Sin definir' : (CONDICIONES.find((c) => c.valor === v)?.label ?? v);

const DOC_TIPOS = ['none', 'DNI', 'CUIT', 'CUIL'] as const;

const fechaCorta = (iso: string | null) =>
  iso === null
    ? '—'
    : new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        timeZone: 'America/Argentina/Ushuaia',
      }).format(new Date(iso));

export function ClientesClient({ clientes, cashierName, salePointLabel }: Props) {
  const [lista, setLista] = useState<ClienteDTO[]>(clientes);
  const [condActiva, setCondActiva] = useState('Todos');
  const [segmentoActivo, setSegmentoActivo] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [selId, setSelId] = useState<string | null>(clientes[0]?.id ?? null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<ClienteDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Segmentos en uso — se derivan, no hay catálogo (ver migration 0023). */
  const segmentos = useMemo(() => {
    const set = new Set<string>();
    for (const c of lista) for (const t of c.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [lista]);

  /** Condiciones que EXISTEN en el padrón, no la lista teórica. */
  const condiciones = useMemo(() => {
    const set = new Set<string>();
    for (const c of lista) if (c.tax_condition) set.add(c.tax_condition);
    return ['Todos', ...Array.from(set)];
  }, [lista]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lista.filter((c) => {
      if (condActiva !== 'Todos' && c.tax_condition !== condActiva) return false;
      if (segmentoActivo !== '' && !c.tags.includes(segmentoActivo)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.doc_number ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      );
    });
  }, [lista, condActiva, segmentoActivo, busqueda]);

  const sel = lista.find((c) => c.id === selId) ?? null;

  /**
   * KPIs. Los tres salen del padrón que ya está en memoria.
   *
   * El 4º de la maqueta ("Por cobrar $487.000 · 9 deudores") NO está: no hay
   * cuenta corriente. En su lugar va "Sin identificar", que sí es real y
   * además es el número que importa para el análisis de compras: sin cliente
   * identificado no hay historial que mirar.
   */
  const kpis = useMemo(() => {
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const inicioMesPasado = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);

    let nuevosMes = 0;
    let nuevosMesPasado = 0;
    let conDoc = 0;
    for (const c of lista) {
      const alta = new Date(c.created_at);
      if (alta >= inicioMes) nuevosMes++;
      else if (alta >= inicioMesPasado) nuevosMesPasado++;
      if (c.doc_number !== null) conDoc++;
    }
    return {
      total: lista.length,
      conDoc,
      sinDoc: lista.length - conDoc,
      nuevosMes,
      nuevosMesPasado,
      segmentos: segmentos.length,
    };
  }, [lista, segmentos]);

  function guardar(form: CustomerFormInput) {
    setError(null);
    startTransition(async () => {
      const res = editando
        ? await updateCustomerAction(editando.id, form)
        : await createCustomerAction(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const g = res.data;
      const dto: ClienteDTO = {
        id: g.id,
        name: g.name,
        doc_type: g.doc_type,
        doc_number: g.doc_number,
        tax_condition: g.tax_condition,
        email: g.email,
        phone: g.phone,
        address: g.address,
        notes: g.notes,
        tags: g.tags,
        created_at:
          g.created_at instanceof Date ? g.created_at.toISOString() : String(g.created_at),
        // El agregado de compras lo calcula el server; en un alta es 0 y en una
        // edición se conserva el que ya se había cargado.
        compras: editando?.compras ?? 0,
        ultima_compra: editando?.ultima_compra ?? null,
      };
      setLista((prev) =>
        editando ? prev.map((c) => (c.id === dto.id ? dto : c)) : [dto, ...prev]
      );
      setSelId(dto.id);
      setModalAbierto(false);
      setEditando(null);
    });
  }

  const contenido = (
    <>
      <style>{CLIENTES_CSS}</style>

      <div className="bar">
        <div className="bar-id">
          <div>
            <div className="bar-title">Clientes</div>
            <div className="bar-sub">
              Padrón · <b>{kpis.total} clientes</b> ·{' '}
              {kpis.segmentos === 1 ? '1 segmento' : `${kpis.segmentos} segmentos`}
            </div>
          </div>
        </div>
        <div className="bar-actions">
          <button
            type="button"
            className="b primary"
            onClick={() => {
              setEditando(null);
              setModalAbierto(true);
            }}
            disabled={pending}
          >
            + Nuevo cliente
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="k lead">
          <div className="k-k">Clientes</div>
          <div className="k-v">{kpis.total}</div>
          <div className="k-f">
            {kpis.conDoc} con documento · {kpis.sinDoc} sin identificar
          </div>
        </div>
        <div className="k">
          <div className="k-k">Nuevos este mes</div>
          <div className="k-v">{kpis.nuevosMes}</div>
          <div className="k-f">
            {kpis.nuevosMesPasado} el mes pasado
          </div>
        </div>
        <div className="k">
          <div className="k-k">Segmentos</div>
          <div className="k-v">{kpis.segmentos}</div>
          <div className="k-f">
            {segmentos.length > 0 ? segmentos.slice(0, 3).join(' · ') : 'sin etiquetar'}
          </div>
        </div>
        {/* El 4º KPI de la maqueta es "Por cobrar", que necesita cuenta
            corriente. En su lugar va uno real: sin cliente identificado no hay
            historial de compras que analizar. */}
        <div className="k">
          <div className="k-k">Sin identificar</div>
          <div className="k-v">{kpis.sinDoc}</div>
          <div className="k-f">no tienen documento cargado</div>
        </div>
      </div>

      <div className="cli-head">
        <div className="seg glass">
          {condiciones.map((c) => (
            <button
              key={c}
              type="button"
              className={condActiva === c ? 'on' : undefined}
              onClick={() => setCondActiva(c)}
            >
              {c === 'Todos' ? 'Todos' : etiquetaCondicion(c)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          {segmentos.length > 0 ? (
            <select
              value={segmentoActivo}
              onChange={(e) => setSegmentoActivo(e.target.value)}
              aria-label="Filtrar por segmento"
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid rgba(13,20,36,0.12)',
                background: '#fff',
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            >
              <option value="">Todos los segmentos</option>
              {segmentos.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : null}
          <div className="search glass" style={{ maxWidth: 280 }}>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar nombre, documento o email…"
              aria-label="Buscar cliente"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="card glass" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="cli-grid">
        <div className="card glass" style={{ padding: '6px 6px 10px' }}>
          <div className="card-title" style={{ padding: '13px 16px 11px' }}>
            <h3>Padrón</h3>
            <span className="label-sm">
              {visibles.length} de {lista.length}
            </span>
          </div>

          <div className="cl-colhead">
            <span style={{ flex: 1 }}>Cliente</span>
            <span style={{ width: 140 }}>Condición</span>
            <span style={{ width: 150 }}>Segmentos</span>
            <span style={{ width: 82, textAlign: 'right' }}>Compras</span>
            <span style={{ width: 92 }}>Última</span>
          </div>

          <div className="cl-list">
            {visibles.length === 0 ? (
              <p className="label-sm" style={{ padding: 16 }}>
                {lista.length === 0
                  ? 'Todavía no hay clientes cargados.'
                  : 'Ningún cliente coincide con el filtro.'}
              </p>
            ) : (
              visibles.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={c.id === selId ? 'crow sel' : 'crow'}
                  onClick={() => setSelId(c.id)}
                >
                  <div className="clmain">
                    <div className="clname">{c.name}</div>
                    <div className="clid">
                      {c.doc_number !== null
                        ? `${c.doc_type} ${c.doc_number}`
                        : 'sin documento'}
                    </div>
                  </div>
                  {/* Pill SÓLIDA = condición fiscal. */}
                  <span className="pill" style={{ width: 140 }}>
                    {etiquetaCondicion(c.tax_condition)}
                  </span>
                  {/* Chips PUNTEADOS = segmentos comerciales. Distintos a
                      propósito: no son el mismo eje. */}
                  <span style={{ width: 150, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.tags.length === 0 ? (
                      <i className="label-sm">—</i>
                    ) : (
                      c.tags.slice(0, 2).map((t) => (
                        <span key={t} className="tag-com">
                          {t}
                        </span>
                      ))
                    )}
                  </span>
                  <span className="tnum" style={{ width: 82, textAlign: 'right' }}>
                    {c.compras}
                  </span>
                  <span className="label-sm" style={{ width: 92 }}>
                    {fechaCorta(c.ultima_compra)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <aside className="col-side" style={{ width: 'auto' }}>
          <div className="card glass cdetail">
            {sel === null ? (
              <p className="label-sm">Elegí un cliente para ver el detalle.</p>
            ) : (
              <>
                <div className="cd-name">{sel.name}</div>
                <div className="cd-id">
                  {sel.doc_number !== null
                    ? `${sel.doc_type} ${sel.doc_number}`
                    : 'sin documento'}
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <span className="pill">{etiquetaCondicion(sel.tax_condition)}</span>
                  {sel.tags.map((t) => (
                    <span key={t} className="tag-com">
                      {t}
                    </span>
                  ))}
                </div>

                <div className="cd-stats">
                  <div>
                    <div className="upper-mini">Compras</div>
                    <div className="tnum cd-sv">{sel.compras}</div>
                  </div>
                  <div>
                    <div className="upper-mini">Última</div>
                    <div className="tnum cd-sv">{fechaCorta(sel.ultima_compra)}</div>
                  </div>
                  <div>
                    <div className="upper-mini">Alta</div>
                    <div className="tnum cd-sv">{fechaCorta(sel.created_at)}</div>
                  </div>
                </div>

                {sel.email !== null || sel.phone !== null || sel.address !== null ? (
                  <div style={{ marginTop: 14 }}>
                    {sel.phone !== null ? (
                      <div className="kv">
                        <span className="label-sm">Teléfono</span>
                        <b>{sel.phone}</b>
                      </div>
                    ) : null}
                    {sel.email !== null ? (
                      <div className="kv">
                        <span className="label-sm">Email</span>
                        <b>{sel.email}</b>
                      </div>
                    ) : null}
                    {sel.address !== null ? (
                      <div className="kv">
                        <span className="label-sm">Dirección</span>
                        <b>{sel.address}</b>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {sel.notes !== null ? (
                  <p className="label-sm" style={{ marginTop: 12 }}>
                    {sel.notes}
                  </p>
                ) : null}

                <div className="cd-btns">
                  <button
                    type="button"
                    className="cta"
                    style={{ flex: 1, fontSize: 13, padding: 11 }}
                    onClick={() => {
                      setEditando(sel);
                      setModalAbierto(true);
                    }}
                    disabled={pending}
                  >
                    Editar
                  </button>
                  {/* Las compras del cliente SE CUENTAN (la columna sale de
                      sales.customer_id) pero no hay pantalla que las liste. */}
                  <button
                    type="button"
                    className="hbtn"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled
                    title="Falta la pantalla de historial de compras"
                  >
                    Ver compras
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {modalAbierto ? (
        <ClienteModal
          cliente={editando}
          segmentosExistentes={segmentos}
          pending={pending}
          onCancelar={() => {
            setModalAbierto(false);
            setEditando(null);
          }}
          onGuardar={guardar}
        />
      ) : null}
    </>
  );

  return (
    // 'pagina' como Caja y Productos: pantalla de GESTIÓN, el contenido pasa
    // el alto del viewport. 'fijo' es SOLO para el POS, donde el cajero no
    // puede scrollear para llegar a "Cobrar".
    <AppShell
      storeName={salePointLabel}
      userName={cashierName}
      userRole="Cajero"
      afipConnected={false}
      afipDetail="WSFEv1 · sin certificado"
      scroll="pagina"
    >
      {contenido}
    </AppShell>
  );
}

// ════════════════════════ Modal alta / edición ════════════════════════

interface ModalProps {
  cliente: ClienteDTO | null;
  segmentosExistentes: string[];
  pending: boolean;
  onCancelar: () => void;
  onGuardar: (form: CustomerFormInput) => void;
}

function ClienteModal({
  cliente,
  segmentosExistentes,
  pending,
  onCancelar,
  onGuardar,
}: ModalProps) {
  const [form, setForm] = useState<CustomerFormInput>({
    name: cliente?.name ?? '',
    doc_type: (cliente?.doc_type as CustomerFormInput['doc_type']) ?? 'none',
    doc_number: cliente?.doc_number ?? '',
    tax_condition: cliente?.tax_condition ?? '',
    email: cliente?.email ?? '',
    phone: cliente?.phone ?? '',
    address: cliente?.address ?? '',
    notes: cliente?.notes ?? '',
    tags: cliente?.tags ?? [],
  });
  const [nuevoTag, setNuevoTag] = useState('');

  const set = <K extends keyof CustomerFormInput>(k: K, v: CustomerFormInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const tags = form.tags ?? [];
  const toggleTag = (t: string) =>
    set('tags', tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);

  const agregarTag = () => {
    const t = nuevoTag.trim();
    if (t === '' || tags.includes(t)) {
      setNuevoTag('');
      return;
    }
    set('tags', [...tags, t]);
    setNuevoTag('');
  };

  return (
    <>
      <div className="pm-backdrop" onClick={onCancelar} />
      <div className="pmod glass-strong" role="dialog" aria-modal="true">
        <div className="pm-head">
          <div>
            <div className="pm-title">
              {cliente ? 'Editar cliente' : 'Nuevo cliente'}
            </div>
            <div className="pm-sub">
              La condición de IVA decide el comprobante; los segmentos son para
              promociones.
            </div>
          </div>
          <button type="button" className="pm-x" onClick={onCancelar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="pm-fld">
          <label htmlFor="cmName">Nombre o razón social</label>
          <input
            id="cmName"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ej: Rosa Giménez"
          />
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="cmDocTipo">Tipo de documento</label>
            <select
              id="cmDocTipo"
              value={form.doc_type ?? 'none'}
              onChange={(e) =>
                set('doc_type', e.target.value as CustomerFormInput['doc_type'])
              }
            >
              {DOC_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t === 'none' ? 'Sin documento' : t}
                </option>
              ))}
            </select>
          </div>
          <div className="pm-fld">
            <label htmlFor="cmDoc">Número</label>
            <input
              id="cmDoc"
              value={form.doc_number ?? ''}
              onChange={(e) => set('doc_number', e.target.value)}
              placeholder="27345678"
              disabled={form.doc_type === 'none'}
            />
          </div>
        </div>

        <div className="pm-fld">
          <label htmlFor="cmCond">Condición frente al IVA</label>
          <select
            id="cmCond"
            value={form.tax_condition ?? ''}
            onChange={(e) => set('tax_condition', e.target.value)}
          >
            <option value="">Sin definir</option>
            {CONDICIONES.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.label}
              </option>
            ))}
          </select>
          <small className="pm-note">
            Es el dato FISCAL: define si el comprobante sale A, B o C.
          </small>
        </div>

        {/* Segmentos: multi-tag, texto libre. El comerciante escribe "Vecinos"
            y el segmento existe — no hay catálogo que administrar. */}
        <div className="pm-fld">
          <label>Segmentos comerciales</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {segmentosExistentes.map((t) => (
              <button
                key={t}
                type="button"
                className={tags.includes(t) ? 'tag-com on' : 'tag-com'}
                onClick={() => toggleTag(t)}
              >
                {t}
              </button>
            ))}
            {tags
              .filter((t) => !segmentosExistentes.includes(t))
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  className="tag-com on"
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </button>
              ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={nuevoTag}
              onChange={(e) => setNuevoTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  agregarTag();
                }
              }}
              placeholder="Nuevo segmento (ej: Jubilados)"
              aria-label="Nuevo segmento"
            />
            <button type="button" className="b ghost" onClick={agregarTag}>
              Agregar
            </button>
          </div>
        </div>

        <div className="pm-row">
          <div className="pm-fld">
            <label htmlFor="cmTel">Teléfono</label>
            <input
              id="cmTel"
              value={form.phone ?? ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="2964-556677"
            />
          </div>
          <div className="pm-fld">
            <label htmlFor="cmMail">Email</label>
            <input
              id="cmMail"
              value={form.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
              placeholder="cliente@correo.com"
            />
          </div>
        </div>

        <div className="pm-fld">
          <label htmlFor="cmDir">Dirección</label>
          <input
            id="cmDir"
            value={form.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
            placeholder="San Martín 123"
          />
        </div>

        <div className="pm-fld">
          <label htmlFor="cmNotas">Notas</label>
          <input
            id="cmNotas"
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Ej: compra los jueves"
          />
        </div>

        <div className="pm-acts">
          <button type="button" className="b ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="b primary"
            onClick={() => onGuardar(form)}
            disabled={pending || form.name.trim() === ''}
          >
            {pending ? 'Guardando…' : 'Guardar cliente'}
          </button>
        </div>
      </div>
    </>
  );
}

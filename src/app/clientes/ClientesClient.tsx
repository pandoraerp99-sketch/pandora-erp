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
 *   - "Ver historial": no existe la pantalla de historial de compras del
 *     cliente. Se muestra el botón apagado con el motivo, no escondido.
 *   - "Gestionar tipos…": los segmentos se DERIVAN de los clientes que ya los
 *     tienen; no hay tabla de catálogo donde guardar uno suelto (migration
 *     0023). Mismo criterio: apagado con el motivo.
 *
 * (Cta. corriente, "Por cobrar" y las curvas ya existen: ADR-0027 trajo el
 * libro de fiado y las series salen de `sales`. Este bloque decía que faltaban
 * — se corrigió el 2026-09-06 al construirlas.)
 */
import { useMemo, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { AppShell } from '@/components/shell/AppShell';
import { TipoDropdown } from '@/components/ui/tipo-dropdown';
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
  tickets: number;
  compras_monto: string;
  ultima_compra: string | null;
  /** Saldo de cuenta corriente. Positivo = DEBE. Calculado, no guardado. */
  saldo: string;
  /** Días del cargo más viejo sin pagar (FIFO). null si no debe. */
  dias_deuda: number | null;
  /** Compras de los últimos 12 meses, de la más vieja a la más nueva. */
  serie: number[];
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
/** Etiquetas CORTAS para los chips del filtro, como la maqueta. */
const COND_CHIP: Record<string, string> = {
  responsable_inscripto: 'Resp. Insc.',
  monotributo: 'Monotributo',
  consumidor_final: 'Cons. Final',
  exento: 'Exento',
};
const etiquetaCorta = (v: string) => COND_CHIP[v] ?? v;

const etiquetaCondicion = (v: string | null) =>
  v === null ? 'Sin definir' : (CONDICIONES.find((c) => c.valor === v)?.label ?? v);


/** Iniciales para el avatar, como la maqueta (GS, MS, DA...). */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return (partes[0]![0]! + partes[1]![0]!).toUpperCase();
}

/**
 * Degradado del avatar, derivado del NOMBRE. Mismo criterio que el color de
 * rubro en Productos: el mismo cliente se ve igual siempre, sin guardar nada.
 */
const PARES: Array<[string, string]> = [
  ['#34c77d', '#5b8cff'],
  ['#6b5fff', '#9088ff'],
  ['#0e8f9e', '#34c77d'],
  ['#f7984a', '#ee6a8e'],
  ['#5b8cff', '#6b5fff'],
  ['#ee6a8e', '#f7984a'],
];
function gradienteDe(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  const par = PARES[h % PARES.length]!;
  return `linear-gradient(135deg, ${par[0]}, ${par[1]})`;
}

/**
 * Color de la pill por CONDICION FISCAL. No es aleatorio a proposito: la
 * misma condicion tiene que verse igual en toda la app, porque es el dato que
 * decide el tipo de comprobante.
 */
function colorCondicion(cond: string | null): React.CSSProperties {
  switch (cond) {
    case 'responsable_inscripto':
      return { background: 'rgba(91,140,255,0.16)', color: '#3b6fd4' };
    case 'monotributo':
      return { background: 'rgba(52,199,125,0.14)', color: '#1a8e5a' };
    case 'exento':
      return { background: 'rgba(14,143,158,0.14)', color: '#0e8f9e' };
    case 'consumidor_final':
      return { background: 'rgba(13,20,36,0.06)', color: 'var(--ink-2)' };
    default:
      return { background: 'rgba(13,20,36,0.05)', color: 'var(--ink-3)' };
  }
}

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const plata = (v: string) => PESOS.format(Number(v));

/** Saldo positivo = el cliente DEBE. Comparar plata con Decimal, no con `>`. */
const debe = (saldo: string) => new Decimal(saldo).gt(0);

/** "hoy" / "ayer" / "hace N dias", como la maqueta. */
function haceCuanto(iso: string | null): string {
  if (iso === null) return 'sin compras';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`;
}

const DOC_TIPOS = ['none', 'DNI', 'CUIT', 'CUIL'] as const;

/** "ago 2022", como la maqueta. */
const mesAno = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' })
    .format(new Date(iso))
    .replace('.', '');

/**
 * Curva de compras por mes. SVG a mano, sin libreria (ADR-0014).
 *
 * El viewBox es el de la maqueta (252x52) con preserveAspectRatio="none": el
 * ancho lo pone el contenedor y los puntos se calculan sobre esa grilla.
 *
 * Escala al maximo de la serie. Si el cliente no compro nada, la curva va
 * plana ABAJO y no en el medio: una linea al medio se lee como "compro algo
 * constante", que es exactamente lo contrario.
 */
function Sparkline({
  serie,
  w = 252,
  h = 52,
  className,
}: {
  serie: number[];
  w?: number;
  h?: number;
  className?: string;
}) {
  const W = w;
  const H = h;
  const TECHO = 8; // margen arriba, para que el pico no toque el borde
  const max = Math.max(...serie, 0);
  const min = Math.min(...serie, max);
  const paso = serie.length > 1 ? W / (serie.length - 1) : W;

  const puntos = serie.map((v, i) => {
    const x = i * paso;
    // Tres casos, y los dos degenerados importan:
    //   sin datos    -> plana ABAJO (una linea al medio se leeria como "algo
    //                   constante", que es lo contrario de "no compro nada")
    //   todo igual   -> plana AL MEDIO (escalar al maximo la pegaria arriba,
    //                   como si estuviera siempre en su techo)
    //   normal       -> escalada al maximo, con la BASE EN CERO. No al rango:
    //                   escalar al rango convierte una caida de 100 a 95 en un
    //                   derrumbe visual, y este grafico se mira de reojo.
    const y =
      max === 0
        ? H - 2
        : max === min
          ? H / 2
          : TECHO + (1 - v / max) * (H - TECHO - 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  const linea = 'M ' + puntos.join(' L ');
  const area = `M 0 ${H} L ${puntos.join(' L ')} L ${W} ${H} Z`;
  const id = `cdg-${W}-${serie.length}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      width={className ? W : undefined}
      height={className ? H : undefined}
      style={className ? undefined : { width: '100%', height: 48, display: 'block' }}
      role="img"
      aria-label={
        max === 0
          ? 'Sin compras en los ultimos 12 meses'
          : 'Compras de los ultimos 12 meses'
      }
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(107,95,255,0.26)" />
          <stop offset="100%" stopColor="rgba(107,95,255,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={linea}
        fill="none"
        stroke="var(--purple)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  // Arranca en el cliente con mas informacion, no en el primero alfabetico:
  // el panel de detalle se juzga por lo que muestra, y abrir en el mas vacio
  // (el "Cliente mostrador", sin telefono ni mail) lo hace parecer roto.
  const [selId, setSelId] = useState<string | null>(() => {
    const puntaje = (c: ClienteDTO) =>
      (c.email ? 1 : 0) + (c.phone ? 1 : 0) + (c.address ? 1 : 0) + c.tags.length;
    return [...clientes].sort((a, b) => puntaje(b) - puntaje(a))[0]?.id ?? null;
  });
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
    // Orden FIJO, el de la maqueta. Si sale del orden en que aparecen los
    // clientes, los chips se reacomodan solos cuando cambia el padron: el
    // filtro que estaba tercero pasa a estar primero y el que lo usa todos los
    // dias tiene que volver a leer la barra.
    const orden = Object.keys(COND_CHIP);
    return [
      'Todos',
      ...orden.filter((c) => set.has(c)),
      ...Array.from(set).filter((c) => !orden.includes(c)),
    ];
  }, [lista]);

  // Deudores ordenados por monto: el que mas debe, primero. Del mismo dato
  // que el KPI, no de una consulta aparte.
  const deudores = useMemo(
    () =>
      lista
        .filter((c) => debe(c.saldo))
        .sort((a, b) => new Decimal(b.saldo).comparedTo(new Decimal(a.saldo)))
        .slice(0, 6),
    [lista]
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lista.filter((c) => {
      if (condActiva === '__deuda__') {
        if (!debe(c.saldo)) return false;
      } else if (condActiva !== 'Todos' && c.tax_condition !== condActiva) {
        return false;
      }
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
    // Por cobrar: suma de los saldos POSITIVOS. Los saldos a favor no se
    // restan de la deuda de otros — son cosas distintas y mezclarlas daria un
    // numero que no significa nada.
    //
    // La suma va en Decimal. Es plata: acumular con `+` sobre float arrastra
    // error de redondeo (CLAUDE.md §9.8). Con los dos saldos redondos del demo
    // no se nota; con una cartera de 200 clientes con centavos, si.
    let porCobrar = new Decimal(0);
    let deudores = 0;
    for (const c of lista) {
      const saldo = new Decimal(c.saldo);
      if (saldo.gt(0)) {
        porCobrar = porCobrar.plus(saldo);
        deudores++;
      }
    }

    // Clientes ACTIVOS = los que compraron en el mes. Se deriva de la misma
    // serie que dibuja el grafico, asi el numero y la curva no pueden
    // contradecirse (salen del mismo dato, no de dos consultas).
    const meses = lista[0]?.serie.length ?? 0;
    const serieActivos = Array.from({ length: meses }, (_, i) =>
      lista.reduce((n, c) => n + ((c.serie[i] ?? 0) > 0 ? 1 : 0), 0)
    );
    const activos = serieActivos[meses - 1] ?? 0;
    const activosPrev = serieActivos[meses - 2] ?? 0;
    // Sin mes anterior no hay porcentaje que calcular. Mostrar "0%" o un 100%
    // inventado seria peor que decir que todavia no hay con que comparar.
    const variacion =
      activosPrev > 0
        ? ((activos - activosPrev) / activosPrev) * 100
        : null;

    // "B2B" = el que factura como negocio (tiene condicion fiscal propia).
    // "Mostrador" = consumidor final o sin definir.
    const b2b = lista.filter(
      (c) =>
        c.tax_condition === 'responsable_inscripto' ||
        c.tax_condition === 'monotributo' ||
        c.tax_condition === 'exento'
    ).length;

    return {
      total: lista.length,
      serieActivos,
      activos,
      variacion,
      b2b,
      mostrador: lista.length - b2b,
      conDoc,
      sinDoc: lista.length - conDoc,
      nuevosMes,
      nuevosMesPasado,
      segmentos: segmentos.length,
      porCobrar: porCobrar.toFixed(2),
      deudores,
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
        tickets: editando?.tickets ?? 0,
        compras_monto: editando?.compras_monto ?? '0',
        saldo: editando?.saldo ?? '0',
        dias_deuda: editando?.dias_deuda ?? null,
        // Serie vacía en un alta: el cliente recién creado no compró nada. Al
        // editar se conserva la que ya venía del server.
        serie: editando?.serie ?? Array.from({ length: 12 }, () => 0),
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


  /**
   * Topbar PROPIA. En la maqueta de Clientes el buscador y los filtros viven
   * en la barra superior, no en una fila aparte — por eso la pantalla se veia
   * completamente distinta aunque la lista fuera parecida. AppShell acepta
   * `topbar` justamente para esto.
   */
  const topbarIzq = (
    <>
      <div className="search glass">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar cliente, CUIT o DNI…"
          aria-label="Buscar cliente"
        />
      </div>

      <div className="seg glass">
        {condiciones.map((c) => (
          <button
            key={c}
            type="button"
            className={condActiva === c ? 'on' : undefined}
            onClick={() => setCondActiva(c)}
          >
            {c === 'Todos' ? 'Todos' : etiquetaCorta(c)}
          </button>
        ))}
        {/* Filtro de la maqueta que ahora SI se puede: hay dominio de deuda. */}
        <button
          type="button"
          className={condActiva === '__deuda__' ? 'on' : undefined}
          onClick={() => setCondActiva('__deuda__')}
        >
          Con deuda
        </button>
      </div>

      {/* "Tipo" = segmento comercial. Menu propio, no <select> nativo: el
          nativo dibuja su lista con el sistema operativo y no hay forma de
          darle el glass de la maqueta. */}
      <TipoDropdown
        opciones={segmentos}
        valor={segmentoActivo}
        onChange={setSegmentoActivo}
        ariaLabel="Filtrar por tipo comercial"
        // Los tipos se DERIVAN de los clientes: no hay tabla de catalogo (ver
        // el encabezado de la migration 0023). Crear un tipo que ningun
        // cliente tiene no tendria donde guardarse. Se muestra deshabilitado
        // con el motivo en vez de esconderlo: asi se ve que existe y por que
        // todavia no se puede.
        motivoGestionarDeshabilitado="Los tipos salen de los clientes que ya los tienen. Para crearlos o borrarlos sueltos falta la pantalla de gestión."
      />

    </>
  );

  const contenido = (
    <>
      <style>{CLIENTES_CSS}</style>

      <div className="bar">
        <div className="bar-id">
          <span className="bar-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <div>
            <div className="bar-title">Clientes</div>
            <div className="bar-sub">
              Cartera · <b>{kpis.total} clientes</b> · cuentas corrientes
            </div>
          </div>
        </div>
        <div className="bar-actions">
          {/* Exportar necesita generar y descargar un archivo: no existe ese
              flujo todavia. Se muestra apagado con el motivo. */}
          <button
            type="button"
            className="b ghost"
            disabled
            title="Falta el flujo de exportacion (generar y descargar el archivo)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
            Exportar
          </button>
          <button
            type="button"
            className="b primary"
            onClick={() => {
              setEditando(null);
              setModalAbierto(true);
            }}
            disabled={pending}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M19 8v6M22 11h-6" />
            </svg>
            Nuevo cliente
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="k lead">
          <div className="k-k">Clientes activos</div>
          <div className="k-v">{kpis.activos}</div>
          <div className="k-f">
            {kpis.variacion === null ? (
              // Primer mes con datos: no hay contra que comparar.
              <span className="label-sm">compraron este mes</span>
            ) : (
              <>
                <span className={kpis.variacion >= 0 ? 'up' : 'dn'}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d={kpis.variacion >= 0 ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
                  </svg>
                  {Math.abs(kpis.variacion).toFixed(1).replace('.', ',')}%
                </span>{' '}
                este mes
              </>
            )}
          </div>
          <Sparkline serie={kpis.serieActivos} w={76} h={30} className="k-spark" />
        </div>
        <div className="k">
          <div className="k-k">Total registrados</div>
          <div className="k-v">{kpis.total}</div>
          <div className="k-f">
            {/* "B2B" = el que factura como negocio (tiene condicion fiscal
                propia). "Mostrador" = consumidor final o sin definir. */}
            {kpis.b2b} B2B · {kpis.mostrador} mostrador
          </div>
        </div>
        <div className="k">
          <div className="k-k">Nuevos del mes</div>
          <div className="k-v">{kpis.nuevosMes}</div>
          <div className="k-f">
            {/* Comparacion REAL contra el mes pasado: created_at existe, asi
                que este porcentaje no es inventado. Sin mes anterior no se
                muestra flecha — un "+100%" contra cero no informa nada. */}
            {kpis.nuevosMesPasado > 0 ? (
              <>
                <span
                  className={kpis.nuevosMes >= kpis.nuevosMesPasado ? 'up' : 'dn'}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path
                      d={
                        kpis.nuevosMes >= kpis.nuevosMesPasado
                          ? 'm6 15 6-6 6 6'
                          : 'm6 9 6 6 6-6'
                      }
                    />
                  </svg>
                  {Math.abs(
                    Math.round(
                      ((kpis.nuevosMes - kpis.nuevosMesPasado) /
                        kpis.nuevosMesPasado) *
                        100
                    )
                  )}
                  %
                </span>{' '}
                vs mes pasado
              </>
            ) : (
              `${kpis.nuevosMesPasado} el mes pasado`
            )}
          </div>
        </div>
        {/* "Por cobrar" — ahora con datos REALES (ADR-0027). Suma de los
            saldos deudores del padron, calculada del libro. */}
        <div className="k bad">
          <div className="k-k">
            <span className="d" style={{ background: 'var(--red)' }} />
            Por cobrar
          </div>
          {/* Sin color inline: `.kpis .k.bad .k-v` ya lo pinta, y ADEMAS tiene
              su variante de modo oscuro. Un inline la pisaria (gana siempre) y
              el KPI se quedaria con el rojo claro en oscuro. */}
          <div className="k-v">{plata(kpis.porCobrar)}</div>
          <div className="k-f">
            {kpis.deudores === 0 ? (
              'nadie debe'
            ) : (
              <span className="tag bad">
                {kpis.deudores === 1 ? '1 deudor' : `${kpis.deudores} deudores`}
              </span>
            )}
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
            <h3>Cartera de clientes</h3>
            <span className="label-sm">
              {visibles.length} de {lista.length}
            </span>
          </div>

          <div className="cl-colhead">
            <span style={{ flex: 1 }}>Cliente</span>
            <span style={{ width: 118 }}>Condición</span>
            <span style={{ width: 92, textAlign: 'right' }}>Compras</span>
            <span style={{ width: 92 }}>Última</span>
            <span style={{ width: 118, textAlign: 'right' }}>Cta. corriente</span>
            <span style={{ width: 16 }} />
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
                  className={c.id === selId ? 'clrow sel' : 'clrow'}
                  onClick={() => setSelId(c.id)}
                >
                  <span className="clav" style={{ background: gradienteDe(c.name) }}>
                    {iniciales(c.name)}
                  </span>
                  <div className="clmain">
                    <div className="clname">{c.name}</div>
                    <div className="clid">
                      {c.doc_number !== null
                        ? `${c.doc_type} ${c.doc_number}`
                        : 'sin documento'}
                    </div>
                    {/* Los segmentos van DEBAJO del nombre, como la maqueta —
                        no en una columna aparte. */}
                    {c.tags.length > 0 ? (
                      <div className="ctags" style={{ marginTop: 3 }}>
                        {c.tags.slice(0, 2).map((t) => (
                          <span key={t} className="ctag">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {/* Pill SÓLIDA = condición fiscal. Color por condición, no
                      al azar: la misma condición se ve igual en toda la app. */}
                  <span
                    className="pill"
                    style={{ ...colorCondicion(c.tax_condition), width: 118 }}
                  >
                    {etiquetaCondicion(c.tax_condition)}
                  </span>
                  <span className="clcompras tnum">{plata(c.compras_monto)}</span>
                  {/* "Última". Es una columna FIJA de 92px que el encabezado
                      declara: si la fila no la pone, .clmain (flex:1) se come
                      esos 92px y empuja todo lo de la derecha, dejando los
                      títulos sin nada debajo. Ya pasó. */}
                  <span className="clult">{haceCuanto(c.ultima_compra)}</span>
                  {/* Saldo REAL, calculado del libro (ADR-0027). Rojo si
                      debe, verde si esta al dia — igual que la maqueta. */}
                  <span className={debe(c.saldo) ? 'cc red' : 'cc ok'}>
                    {debe(c.saldo) ? plata(c.saldo) : 'al día'}
                  </span>
                  <svg className="clgo" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
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
                <div className="cd-top">
                  <span className="cd-av" style={{ background: gradienteDe(sel.name) }}>
                    {iniciales(sel.name)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cd-name">{sel.name}</div>
                    <div className="cd-id">
                  {sel.doc_number !== null
                    ? `${sel.doc_type} ${sel.doc_number}`
                    : 'sin documento'}
                    </div>
                  </div>
                </div>

                {/* La condicion FISCAL va sola, arriba. */}
                <div style={{ marginTop: 11 }}>
                  <span className="pill" style={colorCondicion(sel.tax_condition)}>
                    {etiquetaCondicion(sel.tax_condition)}
                  </span>
                </div>

                {/* El TIPO COMERCIAL va en su propio bloque, con su titulo:
                    la maqueta los separa a proposito para que no se lean como
                    lo mismo que la condicion de IVA. */}
                <div className="cd-tipos">
                  <div className="cd-tipos-head">
                    <span className="upper-mini">Tipo comercial</span>
                    <button
                      type="button"
                      className="cd-edit"
                      onClick={() => {
                        setEditando(sel);
                        setModalAbierto(true);
                      }}
                    >
                      Editar
                    </button>
                  </div>
                  <div className="ctags">
                    {sel.tags.length === 0 ? (
                      <span className="label-sm">sin etiquetar</span>
                    ) : (
                      sel.tags.map((t) => (
                        <span key={t} className="ctag">
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Caja de contacto. Solo se muestran los datos que hay: un
                    renglon vacio con un icono no informa nada. */}
                {sel.email !== null || sel.phone !== null || sel.address !== null ? (
                  <div className="cd-contact">
                    {sel.email !== null ? (
                      <div>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="4" width="20" height="16" rx="2" />
                          <path d="m2 7 10 6 10-6" />
                        </svg>
                        {sel.email}
                      </div>
                    ) : null}
                    {sel.phone !== null ? (
                      <div>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
                        </svg>
                        {sel.phone}
                      </div>
                    ) : null}
                    {/* Va SIEMPRE, aunque no haya direccion: "cliente desde"
                        es de las cosas que el comerciante mira primero, y sale
                        de created_at, que existe para todos. */}
                    <div>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {sel.address !== null ? (
                        <>
                          {sel.address} ·{' '}
                        </>
                      ) : null}
                      cliente desde {mesAno(sel.created_at)}
                    </div>
                  </div>
                ) : null}

                <div className="cd-stats">
                  <div>
                    <div className="upper-mini">Compras</div>
                    <div className="tnum cd-sv">{plata(sel.compras_monto)}</div>
                  </div>
                  <div>
                    <div className="upper-mini">Tickets</div>
                    <div className="tnum cd-sv">{sel.tickets}</div>
                  </div>
                  <div>
                    <div className="upper-mini">Ticket prom.</div>
                    <div className="tnum cd-sv">
                      {sel.tickets === 0
                        ? '—'
                        : plata(String(Number(sel.compras_monto) / sel.tickets))}
                    </div>
                  </div>
                </div>

                {/* Compras por mes. SVG propio, sin libreria (ADR-0014). */}
                <div className="cd-spark">
                  <div className="upper-mini" style={{ marginBottom: 5 }}>
                    Compras · últimos 12 meses
                  </div>
                  <Sparkline serie={sel.serie} />
                </div>

                {/* Saldo de cuenta corriente + antiguedad (ADR-0027). */}
                <div className="cd-cc">
                  <div>
                    <div className="upper-mini">Saldo cuenta corriente</div>
                    <div
                      className="tnum cd-ccv"
                      style={debe(sel.saldo) ? undefined : { color: '#1a8e5a' }}
                    >
                      {plata(sel.saldo)}
                    </div>
                  </div>
                  <span className="cd-ccage">
                    {sel.dias_deuda === null
                      ? 'al día'
                      : sel.dias_deuda === 0
                        ? 'hoy'
                        : sel.dias_deuda === 1
                          ? '1 día'
                          : `${sel.dias_deuda} días`}
                  </span>
                </div>

                {sel.notes !== null ? (
                  <p className="label-sm" style={{ marginTop: 12 }}>
                    {sel.notes}
                  </p>
                ) : null}

                <div className="cd-btns">
                  {/* La maqueta pone "Ver historial" aca, y "Editar" como el
                      link chico de arriba — que ya funciona. Se muestra
                      apagado con el motivo en vez de esconderlo: el historial
                      de compras del cliente todavia no tiene pantalla. */}
                  <button
                    type="button"
                    className="cta"
                    style={{ flex: 1, fontSize: 13, padding: 11 }}
                    disabled
                    title="Todavía no existe la pantalla de historial de compras del cliente."
                  >
                    Ver historial
                  </button>
                  <button
                    type="button"
                    className="hbtn"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => {
                      window.location.href = '/pos';
                    }}
                  >
                    Nueva venta
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Deudores — a quien hay que ir a cobrarle. Sale del mismo libro
              que el KPI "Por cobrar", ordenado por monto. */}
          {deudores.length > 0 ? (
            <div className="card glass">
              <div className="card-title">
                <h3>
                  <span
                    className="ic"
                    style={{ background: 'rgba(239,93,106,0.13)', color: '#c0384a' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <path d="M2 10h20" />
                    </svg>
                  </span>
                  Deudores
                </h3>
                <span
                  className="pill"
                  style={{ background: 'rgba(239,93,106,0.12)', color: '#c0384a' }}
                >
                  {plata(kpis.porCobrar)}
                </span>
              </div>
              {deudores.map((d) => (
                <button
                  type="button"
                  key={d.id}
                  className="stock-row"
                  onClick={() => setSelId(d.id)}
                >
                  <div
                    className="stock-thumb"
                    style={{
                      background: gradienteDe(d.name),
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {iniciales(d.name)}
                  </div>
                  <div className="stock-name">
                    {d.name}
                    <span
                      style={{
                        display: 'block',
                        fontSize: 10.5,
                        color: 'var(--ink-3)',
                        fontWeight: 400,
                      }}
                    >
                      {d.dias_deuda === null
                        ? 'sin fecha'
                        : d.dias_deuda === 0
                          ? 'hoy'
                          : d.dias_deuda === 1
                            ? '1 día'
                            : `${d.dias_deuda} días`}
                    </span>
                  </div>
                  <span className="stock-q" style={{ color: '#c0384a' }}>
                    {plata(d.saldo)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
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
      topbarLeft={topbarIzq}
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
      {/* .pmov es el overlay Y el que centra (es flex). Antes el backdrop iba
          como HERMANO del modal y el modal quedaba en flujo normal: 1336px de
          ancho al final de la pagina. */}
      <div className="pmov open" onClick={onCancelar}>
        <div
          className="pmod"
          role="dialog"
          aria-modal="true"
          aria-label={cliente ? 'Editar cliente' : 'Nuevo cliente'}
          onClick={(e) => e.stopPropagation()}
        >
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
                className={tags.includes(t) ? 'ctag on' : 'ctag'}
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
                  className="ctag on"
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

        {/* .pm-btn, no .b: es la clase de boton del modal en la maqueta. Ojo
            que .b esta DUPLICADA (botones y barras de grafico), asi que en un
            modal no se sabe cual gana. */}
        <div className="pm-acts">
          <button type="button" className="pm-btn ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="pm-btn primary"
            onClick={() => onGuardar(form)}
            disabled={pending || form.name.trim() === ''}
          >
            {pending ? 'Guardando…' : 'Guardar cliente'}
          </button>
        </div>
        </div>
      </div>
    </>
  );
}

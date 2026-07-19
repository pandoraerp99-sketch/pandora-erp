'use client';

/**
 * CajaClient (caja-real) — reconstrucción FIEL de la maqueta public/caja.html a
 * React, cableada a la app real. Reusa el CSS de la maqueta VERBATIM (mockupCss.ts)
 * y reproduce su estructura; los datos y acciones son reales (sesión, movimientos,
 * retiro con concepto+beneficiario, cierre, reclasificar medio).
 *
 * "De adorno" por ahora (sin backend, marcado): gráfico de evolución, comprobantes,
 * contar por denominación, Lectura X, alivios a caja fuerte, historial.
 * Lo que anda de verdad: abrir/cerrar caja, ingreso, retiro (concepto+beneficiario),
 * alivio, búsqueda de movimientos, arqueo del efectivo, reclasificar medio.
 */
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  BeneficiarioTipo,
  CashMovementType,
  SalePaymentMethod,
  TerceroType,
} from '@/lib/db/schema/_common';
import {
  openSessionAction,
  registerMovementAction,
  closeSessionAction,
  reclassifyPaymentAction,
  createReasonAction,
  deactivateReasonAction,
  createTerceroAction,
  deactivateTerceroAction,
} from './actions';
import { MOCKUP_CSS } from './mockupCss';

export interface CajaSessionDTO {
  id: string;
  salePoint: number;
  openedAtIso: string | null;
  initialAmount: string;
  totalDeposits: string;
  totalWithdraws: string;
  expectedFromMovements: string;
}
export interface CajaMovimientoDTO {
  id: string;
  total: string;
  method: string | null;
  customerName: string | null;
  finalizedAtIso: string | null;
}
export interface CajaMovManualDTO {
  id: string;
  type: string; // deposit | withdraw | provider_payment
  amount: string;
  reason: string;
  payeeName: string | null;
  timeIso: string | null;
}
export interface CajaReasonDTO {
  id: string;
  label: string;
  beneficiarioTipo: BeneficiarioTipo;
}
export interface CajaTerceroDTO {
  id: string;
  type: TerceroType;
  name: string;
  doc: string | null;
}
interface CajaClientProps {
  cashierName: string;
  salePointLabel: string;
  session: CajaSessionDTO | null;
  movimientos: CajaMovimientoDTO[];
  movimientosManuales: CajaMovManualDTO[];
  reasons: CajaReasonDTO[];
  empleados: CajaTerceroDTO[];
  proveedores: CajaTerceroDTO[];
  isOwner: boolean;
}

const OTRO_PAYEE = '__otro__';

const MEDIOS: Record<string, { label: string; color: string }> = {
  efectivo: { label: 'Efectivo', color: '#34c77d' },
  debito: { label: 'Débito', color: '#5b8cff' },
  credito: { label: 'Crédito', color: '#f7984a' },
  mp_qr: { label: 'QR / Transferencia', color: '#6b5fff' },
  tarjeta: { label: 'Tarjeta', color: '#7681a0' },
  mixto: { label: 'Mixto', color: '#9088ff' },
};
const MEDIO_FILTERS = ['efectivo', 'debito', 'credito', 'mp_qr', 'mixto'];
const RECLASS_OPTIONS: SalePaymentMethod[] = ['efectivo', 'debito', 'credito', 'mp_qr'];

const IC = {
  panel: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/></svg>',
  venta: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
  caja: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01"/><path d="M18 12h.01"/></svg>',
  prod: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.58a2 2 0 0 1 0 2.83z"/><circle cx="7" cy="7" r="1.5"/></svg>',
  cli: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>',
  stock: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  fact: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>',
  rep: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15v-3"/><path d="M12 15V8"/><path d="M16 15v-5"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  minus: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
  arqueo: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  lock: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="13" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.8 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.8-1.2 2 2 0 1 1-2.8-2.8A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.8 2 2 0 1 1 2.8-2.8A1.7 1.7 0 0 0 11 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.8 1.2 2 2 0 1 1 2.8 2.8A1.7 1.7 0 0 0 19.4 11a2 2 0 1 1 0 4z"/></svg>',
  config: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  cashsm: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
};
// Sparkline representativa de la maqueta (visual — pendiente datos reales).
const SPARK =
  '<svg class="cash-spark" viewBox="0 0 334 96" preserveAspectRatio="none"><defs><linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(107,95,255,0.30)"/><stop offset="100%" stop-color="rgba(107,95,255,0)"/></linearGradient></defs><path d="M 0 96 L 0 83.5 L 27.8 77.8 L 55.7 70.5 L 83.5 63.1 L 111.3 66.5 L 139.2 56.3 L 167 47.3 L 194.8 39.4 L 222.7 43.9 L 250.5 31.5 L 278.3 23 L 306.2 17.3 L 334 14.6 L 334 96 Z" fill="url(#cashFill)"/><path d="M 0 83.5 L 27.8 77.8 L 55.7 70.5 L 83.5 63.1 L 111.3 66.5 L 139.2 56.3 L 167 47.3 L 194.8 39.4 L 222.7 43.9 L 250.5 31.5 L 278.3 23 L 306.2 17.3 L 334 14.6" fill="none" stroke="#6b5fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
const NAV = [
  { k: 'Panel', ic: IC.panel },
  { k: 'Venta', ic: IC.venta },
  { k: 'Caja', ic: IC.caja, active: true },
  { k: 'Productos', ic: IC.prod },
  { k: 'Clientes', ic: IC.cli },
  { k: 'Stock', ic: IC.stock },
  { k: 'Facturas', ic: IC.fact },
  { k: 'Reportes', ic: IC.rep },
  { k: 'Configuración', ic: IC.config },
];

const ARS = new Intl.NumberFormat('es-AR');
const money = (v: string | number) => {
  const n = Math.round(typeof v === 'number' ? v : parseFloat(v || '0'));
  return '$' + (Number.isFinite(n) ? n : 0).toLocaleString('es-AR');
};
const hora = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};
const fechaLarga = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const inits = (name: string) => {
  const p = name.replace(/@.*/, '').split(/[.\s_-]+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'U';
};
const medioMeta = (m: string | null) =>
  !m ? { label: 'Sin asignar', color: '#e8973a' } : MEDIOS[m] ?? { label: m, color: '#7681a0' };

type MovMode = 'ingreso' | 'retiro' | 'alivio';

function Icon({ html, cls }: { html: string; cls?: string }) {
  return <span className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CajaClient({
  cashierName,
  salePointLabel,
  session,
  movimientos,
  movimientosManuales,
  reasons,
  empleados,
  proveedores,
  isOwner,
}: CajaClientProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [openAmount, setOpenAmount] = useState('');

  const [movMode, setMovMode] = useState<MovMode | null>(null);
  const [movAmount, setMovAmount] = useState('');
  const [movNote, setMovNote] = useState('');
  const [movConceptId, setMovConceptId] = useState<string | null>(null);
  const [movPayeeId, setMovPayeeId] = useState<string | null>(null);
  const [movPayeeName, setMovPayeeName] = useState('');

  const [countedAmount, setCountedAmount] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const [reclassSaleId, setReclassSaleId] = useState<string | null>(null);
  const [reclassMethod, setReclassMethod] = useState<SalePaymentMethod | null>(null);
  const [reclassReason, setReclassReason] = useState('');

  const [search, setSearch] = useState('');
  const [medioSel, setMedioSel] = useState<Set<string>>(new Set());

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'motivos' | 'empleado' | 'proveedor'>('motivos');
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [newReasonTipo, setNewReasonTipo] = useState<BeneficiarioTipo>('ninguno');
  const [newTerceroName, setNewTerceroName] = useState('');

  const concept = movConceptId ? reasons.find((r) => r.id === movConceptId) ?? null : null;
  const needsPayee = !!concept && concept.beneficiarioTipo !== 'ninguno';
  const payeeList = useMemo(
    () => (concept?.beneficiarioTipo === 'empleado' ? empleados : concept?.beneficiarioTipo === 'proveedor' ? proveedores : []),
    [concept, empleados, proveedores]
  );

  const ventasHoy = movimientos.reduce((a, m) => a + Math.round(parseFloat(m.total || '0')), 0);
  const tickets = movimientos.length;
  const ticketProm = tickets > 0 ? Math.round(ventasHoy / tickets) : 0;
  const ventasEfectivo = movimientos.filter((m) => m.method === 'efectivo').reduce((a, m) => a + parseFloat(m.total || '0'), 0);
  const ingEgr = session ? parseFloat(session.totalDeposits || '0') - parseFloat(session.totalWithdraws || '0') : 0;
  const efectivoEsperado = session ? parseFloat(session.initialAmount || '0') + ventasEfectivo + ingEgr : 0;
  const efDiff = countedAmount.trim() !== '' ? Math.round(parseFloat(countedAmount) || 0) - Math.round(efectivoEsperado) : null;

  const ingresosMan = movimientosManuales.filter((m) => m.type === 'deposit');
  const egresosMan = movimientosManuales.filter((m) => m.type !== 'deposit');
  const ingresosSum = ingresosMan.reduce((a, m) => a + parseFloat(m.amount || '0'), 0);
  const egresosSum = egresosMan.reduce((a, m) => a + parseFloat(m.amount || '0'), 0);

  const breakdown = useMemo(() => {
    const acc: Record<string, { amount: number; count: number }> = {};
    for (const m of movimientos) {
      const k = m.method ?? 'sin';
      acc[k] = acc[k] ?? { amount: 0, count: 0 };
      acc[k]!.amount += parseFloat(m.total || '0');
      acc[k]!.count += 1;
    }
    const order = ['efectivo', 'mp_qr', 'debito', 'credito', 'tarjeta', 'mixto', 'sin'];
    return order
      .filter((k) => acc[k])
      .map((k) => ({ key: k, ...medioMeta(k === 'sin' ? null : k), amount: acc[k]!.amount, count: acc[k]!.count }));
  }, [movimientos]);

  const donut = useMemo(() => {
    const C = 2 * Math.PI * 62;
    const total = breakdown.reduce((a, b) => a + b.amount, 0) || 1;
    let off = 0;
    return breakdown
      .filter((b) => b.amount > 0)
      .map((b) => {
        const dash = (b.amount / total) * C;
        const seg = { color: b.color, dash, gap: C - dash, offset: -off };
        off += dash;
        return seg;
      });
  }, [breakdown]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movimientos.filter((m) => {
      if (q && !(m.customerName ?? 'consumidor final').toLowerCase().includes(q)) return false;
      if (medioSel.size > 0 && !medioSel.has(m.method ?? 'sin')) return false;
      return true;
    });
  }, [movimientos, search, medioSel]);
  const filtersActive = search.trim() !== '' || medioSel.size > 0;
  const toggleMedio = (k: string) =>
    setMedioSel((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      setFeedback({ tone: 'ok', text: okMsg });
      router.refresh();
      return true;
    }
    setFeedback({ tone: 'err', text: res.error ?? 'Error' });
    return false;
  }

  function openMov(mode: MovMode) {
    setMovMode(mode);
    setMovAmount('');
    setMovNote('');
    setMovConceptId(null);
    setMovPayeeId(null);
    setMovPayeeName('');
    setFeedback(null);
  }

  function buildMovPayload(): Parameters<typeof registerMovementAction>[0] | null {
    if (!session || !movMode) return null;
    const amount = movAmount.trim();
    if (!amount) return null;
    if (movMode === 'ingreso') {
      const note = movNote.trim();
      return note ? { sessionId: session.id, type: 'deposit', amount, reason: note } : null;
    }
    if (movMode === 'alivio') {
      return { sessionId: session.id, type: 'withdraw', amount, reason: movNote.trim() || 'Alivio de caja' };
    }
    if (!concept) return null;
    const notes = movNote.trim() || null;
    const base = {
      sessionId: session.id,
      type: 'provider_payment' as CashMovementType,
      amount,
      reason: concept.label,
      conceptId: concept.id,
      notes,
    };
    if (!needsPayee) return base;
    if (movPayeeId === OTRO_PAYEE) {
      const name = movPayeeName.trim();
      return name ? { ...base, payeeId: null, payeeType: concept.beneficiarioTipo, payeeName: name } : null;
    }
    const t = payeeList.find((p) => p.id === movPayeeId);
    return t ? { ...base, payeeId: t.id, payeeType: t.type, payeeName: t.name } : null;
  }
  const movValid = buildMovPayload() !== null;

  async function submitMov() {
    const payload = buildMovPayload();
    if (!payload) return;
    const ok = await run(() => registerMovementAction(payload), 'Movimiento registrado.');
    if (ok) setMovMode(null);
  }
  async function submitOpen() {
    const ok = await run(() => openSessionAction({ initialAmount: openAmount.trim() }), 'Caja abierta.');
    if (ok) setOpenAmount('');
  }
  async function submitClose() {
    if (busy || !session) return;
    setBusy(true);
    setFeedback(null);
    const res = await closeSessionAction({
      sessionId: session.id,
      countedAmount: countedAmount.trim(),
      discrepancyReason: closeReason.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setCountedAmount('');
      setCloseReason('');
      setFeedback({ tone: 'ok', text: `Caja cerrada. Descuadre: ${money(res.data.descuadre)} · ${res.data.severity_label}.` });
      router.refresh();
    } else setFeedback({ tone: 'err', text: res.error });
  }
  async function submitReclass() {
    if (!reclassSaleId || !reclassMethod) return;
    const ok = await run(
      () => reclassifyPaymentAction({ saleId: reclassSaleId, newMethod: reclassMethod, reason: reclassReason.trim() }),
      'Medio corregido.'
    );
    if (ok) {
      setReclassSaleId(null);
      setReclassMethod(null);
      setReclassReason('');
    }
  }
  async function addReason() {
    const label = newReasonLabel.trim();
    if (!label) return;
    const ok = await run(() => createReasonAction({ label, beneficiarioTipo: newReasonTipo }), 'Motivo agregado.');
    if (ok) {
      setNewReasonLabel('');
      setNewReasonTipo('ninguno');
    }
  }
  async function addTercero(type: TerceroType) {
    const name = newTerceroName.trim();
    if (!name) return;
    const ok = await run(() => createTerceroAction({ type, name }), 'Beneficiario agregado.');
    if (ok) setNewTerceroName('');
  }

  return (
    <div className="caja-real-root">
      <style>{MOCKUP_CSS}</style>

      <aside className="side glass-strong">
        <div className="logo-row">
          <svg viewBox="0 0 32 32" width="26" height="26">
            <defs>
              <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#6b5fff" />
                <stop offset="100%" stopColor="#5b8cff" />
              </linearGradient>
            </defs>
            <g fill="url(#lg1)">
              <path d="M16 2 L18 14 L30 16 L18 18 L16 30 L14 18 L2 16 L14 14 Z" />
            </g>
          </svg>
          <span className="logo-text">Pandora</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <div key={n.k} className={'nav-item' + (n.active ? ' active' : '')}>
              <Icon html={n.ic} cls="nav-icon-box" />
              <span>{n.k}</span>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="afip">
            <div className="afip-top">
              <span className="afip-dot" />
              <span className="afip-name">AFIP conectado</span>
              <span className="afip-live">LIVE</span>
            </div>
            <div className="afip-sub">WSFEv1 · homologación</div>
          </div>
          <div className="cashier">
            <span className="avatar-ring"><span className="cashier-av">{inits(cashierName)}</span></span>
            <div>
              <div className="cashier-name">{cashierName.replace(/@.*/, '')}</div>
              <div className="cashier-role">{isOwner ? 'Dueño' : 'Cajero'}</div>
            </div>
            <span className="cashier-live" />
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="search glass">
            <Icon html={IC.search} />
            <input placeholder="Buscar por cliente, ticket o monto…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="kbd">⌘K</span>
          </div>
          <button className="lecturax glass" type="button" onClick={() => setFeedback({ tone: 'ok', text: 'Lectura X — reporte de control (pendiente de implementar).' })}>
            <Icon html={IC.eye} />Lectura X
          </button>
          <div className="top-tools">
            <button className="iconbtn glass" type="button" title="Notificaciones"><Icon html={IC.bell} /></button>
            {isOwner && (
              <button className="iconbtn glass" type="button" title="Motivos y beneficiarios" onClick={() => setAdminOpen(true)}>
                <Icon html={IC.gear} />
              </button>
            )}
            <div className="user-chip glass">
              <span className="avatar-ring"><span className="cashier-av">{inits(cashierName)}</span></span>
              <div>
                <div className="user-name">{cashierName.replace(/@.*/, '')}</div>
                <div className="user-role">{isOwner ? 'Dueño' : 'Cajero'}</div>
              </div>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className="glass"
            style={{
              padding: '11px 16px',
              borderRadius: 14,
              marginBottom: 14,
              fontSize: 12.5,
              fontWeight: 600,
              color: feedback.tone === 'ok' ? '#127a4b' : '#a8283a',
            }}
          >
            {feedback.text}
          </div>
        )}

        <div className="session-bar glass-strong">
          <div>
            <div className="session-title">Caja</div>
            <div className="session-sub">{session ? `Sesión abierta · ${fechaLarga(session.openedAtIso)}` : 'Caja cerrada'}</div>
          </div>
          <div className="session-glance">
            <div className="sg"><span className="sg-k">Ventas hoy</span><span className="sg-v tnum">{money(ventasHoy)}</span></div>
            <div className="sg-div" />
            <div className="sg"><span className="sg-k">Tickets</span><span className="sg-v tnum">{tickets}</span></div>
            <div className="sg-div" />
            <div className="sg"><span className="sg-k">Ticket prom.</span><span className="sg-v tnum">{money(ticketProm)}</span></div>
          </div>
          <div className="session-meta">
            <div className="meta-cell">
              <span className="meta-k">Cajero</span>
              <span className="meta-v"><span className="mini-ava">{inits(cashierName)}</span>{cashierName.replace(/@.*/, '')}</span>
            </div>
            <div className="meta-cell">
              <span className="meta-k">Punto de venta</span>
              <span className="meta-v">{salePointLabel}</span>
            </div>
            <div className="meta-cell">
              <span className="meta-k">Apertura</span>
              <span className="meta-v mono tnum">{session ? hora(session.openedAtIso) : '—'}</span>
            </div>
            {session ? (
              <div className="pill-open"><span className="live-dot" />Abierta</div>
            ) : (
              <div className="pill-closed">Cerrada</div>
            )}
          </div>
        </div>

        {!session ? (
          <section className="glass-strong" style={{ padding: 26, marginTop: 18, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="upper-mini">No hay caja abierta</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 6 }}>Abrí la caja con el fondo inicial para operar.</div>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="upper-mini">Fondo inicial</span>
              <div className="arq-input-wrap"><span className="arq-peso">$</span>
                <input className="arq-input tnum" inputMode="numeric" placeholder="0" value={openAmount} onChange={(e) => setOpenAmount(e.target.value)} />
              </div>
            </label>
            <button className="btn-primary" style={{ width: 'auto', padding: '12px 22px' }} disabled={busy} onClick={submitOpen}>
              {busy ? 'Abriendo…' : 'Abrir caja'}
            </button>
          </section>
        ) : (
          <div className="caja-grid" style={{ marginTop: 18 }}>
            <div className="col">
              <section className="glass-strong cash-card">
                <div className="cash-grid">
                  <div className="cash-left">
                    <span className="upper-mini">Efectivo en caja · esperado</span>
                    <div className="cash-num tnum">{money(efectivoEsperado)}</div>
                    <div className="cash-sub">
                      <div><div className="k">Fondo inicial</div><div className="v tnum">{money(session.initialAmount)}</div></div>
                      <div><div className="k">Ventas en efectivo</div><div className="v tnum">{money(ventasEfectivo)}</div></div>
                      <div><div className="k">Ingresos − Egresos</div><div className="v tnum">{(ingEgr < 0 ? '−' : ingEgr > 0 ? '+' : '') + money(Math.abs(ingEgr))}</div></div>
                    </div>
                    <div className="cash-actions">
                      <button className="btn" disabled={busy} onClick={() => openMov('ingreso')}><Icon html={IC.plus} />Ingreso</button>
                      <button className="btn" disabled={busy} onClick={() => openMov('retiro')}><Icon html={IC.minus} />Retiro / Gasto</button>
                      <button className="btn" disabled={busy} onClick={() => openMov('alivio')}><Icon html={IC.arqueo} />Alivio</button>
                    </div>
                  </div>
                  <div className="cash-right">
                    <div className="cash-right-head">
                      <span className="upper-mini">Evolución · hoy</span>
                      <div className="cash-icon"><Icon html={IC.cashsm} /></div>
                    </div>
                    <div className="cash-chart" dangerouslySetInnerHTML={{ __html: SPARK }} />
                    <div className="cash-right-foot">
                      <span>{hora(session.openedAtIso)} · apertura</span>
                      <span className="now tnum">{money(efectivoEsperado)} · ahora</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="glass" style={{ padding: '22px 24px' }}>
                <div className="card-title"><h3>Movimientos por medio de pago</h3><span className="upper-mini">Hoy</span></div>
                {breakdown.length === 0 ? (
                  <div className="mov-empty">Todavía no hay ventas hoy.</div>
                ) : (
                  <div className="pay-wrap">
                    <div className="donut-wrap">
                      <svg width="172" height="172" viewBox="0 0 172 172">
                        <g transform="rotate(-90 86 86)" fill="none" strokeWidth="20" strokeLinecap="butt">
                          <circle cx="86" cy="86" r="62" stroke="rgba(13,20,36,0.05)" strokeWidth="20" />
                          {donut.map((s, i) => (
                            <circle key={i} cx="86" cy="86" r="62" stroke={s.color} strokeDasharray={`${s.dash.toFixed(1)} ${s.gap.toFixed(1)}`} strokeDashoffset={s.offset.toFixed(1)} />
                          ))}
                        </g>
                      </svg>
                      <div className="donut-center"><span className="big tnum">{money(ventasHoy)}</span><span className="lbl">total</span></div>
                    </div>
                    <div className="pay-list">
                      {breakdown.map((b) => (
                        <div key={b.key} className="pay-row">
                          <span className="pay-dot" style={{ background: b.color }} />
                          <div><div className="pay-name">{b.label}</div><div className="pay-tick">{b.count} tickets</div></div>
                          <div><div className="pay-amt tnum">{money(b.amount)}</div><div className="pay-pct">{ventasHoy > 0 ? Math.round((b.amount / ventasHoy) * 100) : 0}%</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {movimientosManuales.length > 0 && (
                <section className="glass" style={{ padding: '22px 24px' }}>
                  <div className="mov-cols">
                    <div>
                      <div className="mov-head">
                        <span className="t"><span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--green)', display: 'inline-block' }} />Ingresos manuales</span>
                        <span className="sum c-green">+{money(ingresosSum)}</span>
                      </div>
                      {ingresosMan.length === 0 ? (
                        <div className="mov-h" style={{ padding: '8px 0' }}>Sin ingresos</div>
                      ) : (
                        ingresosMan.map((m) => (
                          <div key={m.id} className="mov-item">
                            <div className="mov-ic" style={{ background: 'rgba(52,199,125,0.12)', color: '#1a8e5a' }} dangerouslySetInnerHTML={{ __html: IC.plus }} />
                            <div className="mov-txt"><div className="mov-r">{m.reason}</div><div className="mov-h">{hora(m.timeIso)}</div></div>
                            <div className="mov-v c-green">+{money(m.amount)}</div>
                          </div>
                        ))
                      )}
                    </div>
                    <div>
                      <div className="mov-head">
                        <span className="t"><span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--red)', display: 'inline-block' }} />Egresos / Retiros</span>
                        <span className="sum c-red">−{money(egresosSum)}</span>
                      </div>
                      {egresosMan.length === 0 ? (
                        <div className="mov-h" style={{ padding: '8px 0' }}>Sin egresos</div>
                      ) : (
                        egresosMan.map((m) => (
                          <div key={m.id} className="mov-item">
                            <div className="mov-ic" style={{ background: 'rgba(239,93,106,0.12)', color: 'var(--red)' }} dangerouslySetInnerHTML={{ __html: IC.minus }} />
                            <div className="mov-txt"><div className="mov-r">{m.payeeName ? `${m.reason} · ${m.payeeName}` : m.reason}</div><div className="mov-h">{hora(m.timeIso)}</div></div>
                            <div className="mov-v c-red">−{money(m.amount)}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              )}

              <section className="glass" style={{ padding: '22px 24px' }}>
                <div className="card-title">
                  <h3>Últimos movimientos</h3>
                  <span className="upper-mini">{filtered.length}{filtersActive ? ` / ${movimientos.length}` : ''} ventas</span>
                </div>
                <div className="mov-filters">
                  {MEDIO_FILTERS.map((k) => (
                    <button key={k} className="mov-fchip" aria-pressed={medioSel.has(k)} onClick={() => toggleMedio(k)}>
                      <span className="fsw" style={{ background: MEDIOS[k]?.color }} />{MEDIOS[k]?.label}
                    </button>
                  ))}
                  {filtersActive && <button className="mov-fchip" onClick={() => { setSearch(''); setMedioSel(new Set()); }}>Limpiar</button>}
                </div>
                {filtered.length === 0 ? (
                  <div className="mov-empty">{movimientos.length === 0 ? 'Todavía no hay ventas hoy.' : 'Ninguna venta coincide.'}</div>
                ) : (
                  <div className="mov-scroll">
                    <table className="tbl">
                      <thead>
                        <tr><th style={{ width: 56 }}>Hora</th><th>Cliente</th><th>Medio de pago</th><th className="r">Monto</th><th className="r">Medio</th></tr>
                      </thead>
                      <tbody>
                        {filtered.map((m) => {
                          const md = medioMeta(m.method);
                          const editing = reclassSaleId === m.id;
                          return (
                            <Fragment key={m.id}>
                              <tr>
                                <td className="hora">{hora(m.finalizedAtIso)}</td>
                                <td>{m.customerName || 'Consumidor final'}</td>
                                <td><span className="medio-chip"><span className="medio-sw" style={{ background: md.color }} />{md.label}</span></td>
                                <td className="r amt c-green">{money(m.total)}</td>
                                <td className="r">
                                  <button className="denom-btn" style={{ margin: 0 }} disabled={busy} onClick={() => { setReclassSaleId(editing ? null : m.id); setReclassMethod(null); setReclassReason(''); }}>
                                    {editing ? 'Cerrar' : 'Cambiar'}
                                  </button>
                                </td>
                              </tr>
                              {editing && (
                                <tr>
                                  <td colSpan={5}>
                                    <div className="reasign-impact" style={{ margin: '4px 0 8px' }}>
                                      <div className="reasign-imp-h">Corregir medio de esta venta</div>
                                      <div className="reasign-pick">
                                        {RECLASS_OPTIONS.filter((o) => o !== m.method).map((o) => (
                                          <button key={o} className={'reasign-opt' + (reclassMethod === o ? ' sel' : '')} disabled={busy} onClick={() => setReclassMethod(o)}>
                                            <span className="reasign-sw" style={{ background: MEDIOS[o]?.color }} />{MEDIOS[o]?.label}
                                          </button>
                                        ))}
                                      </div>
                                      <input className="motivo-input" style={{ minHeight: 0, marginTop: 10 }} placeholder="Motivo (ej: abonó en efectivo, marqué débito)" value={reclassReason} onChange={(e) => setReclassReason(e.target.value)} />
                                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                                        <button className="btn" onClick={() => setReclassSaleId(null)}>Cancelar</button>
                                        <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} disabled={busy || !reclassMethod} onClick={submitReclass}>Guardar</button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="glass" style={{ padding: '22px 24px' }}>
                <div className="card-title"><h3>Alivios de caja</h3><span className="upper-mini">Retiros a caja fuerte</span></div>
                <div className="mov-empty">Sin alivios pendientes. Registrá un Alivio desde la card de Efectivo.</div>
              </section>

              <section className="glass" style={{ padding: '22px 24px' }}>
                <div className="card-title"><h3>Historial de cierres</h3><span className="upper-mini">Últimos días</span></div>
                <div className="mov-empty">Todavía no hay cierres registrados.</div>
              </section>
            </div>

            <div className="col">
              <section className="glass-strong arqueo">
                <div className="card-title"><h3><Icon html={IC.arqueo} /> Arqueo y cierre</h3></div>
                <div className="arq-cap">Contá el efectivo y cerrá el posnet de cada medio.</div>
                <div className="recon-methods">
                  <div className="rm">
                    <div className="rm-top">
                      <span className="rm-name"><span className="rm-dot" style={{ background: '#34c77d' }} />Efectivo</span>
                      <span className="rm-exp">esperado <b className="tnum">{money(efectivoEsperado)}</b></span>
                    </div>
                    <div className="rm-bot">
                      <div className="rm-inp"><span>$</span><input className="rm-input tnum" inputMode="numeric" placeholder="0" value={countedAmount} onChange={(e) => setCountedAmount(e.target.value)} /></div>
                      <span className={'rm-diff tnum ' + (efDiff === null ? '' : efDiff < 0 ? 'c-red' : efDiff > 0 ? 'c-green' : 'c-ink')}>
                        {efDiff === null ? '—' : (efDiff > 0 ? '+' : efDiff < 0 ? '−' : '') + money(Math.abs(efDiff))}
                      </span>
                    </div>
                    <button className="denom-btn" type="button" onClick={() => setFeedback({ tone: 'ok', text: 'Contar por denominación — pendiente de implementar.' })}>
                      Contar por denominación
                    </button>
                  </div>
                  {breakdown.filter((b) => b.key !== 'efectivo' && b.key !== 'sin').map((b) => (
                    <div className="rm" key={b.key}>
                      <div className="rm-top">
                        <span className="rm-name"><span className="rm-dot" style={{ background: b.color }} />{b.label}</span>
                        <span className="rm-exp">esperado <b className="tnum">{money(b.amount)}</b></span>
                      </div>
                      <div className="rm-bot">
                        <div className="rm-inp"><span>$</span><input className="rm-input tnum" inputMode="numeric" defaultValue={ARS.format(Math.round(b.amount))} /></div>
                        <span className="rm-diff tnum c-ink">$0</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className={'diff-box ' + (efDiff === null || efDiff === 0 ? 'ok' : efDiff < 0 ? 'faltante' : 'sobrante')}>
                  <span className={'diff-k ' + (efDiff && efDiff < 0 ? 'c-red' : 'c-green')}>
                    Diferencia total{efDiff && efDiff < 0 ? ' · faltante' : efDiff && efDiff > 0 ? ' · sobrante' : ''}
                  </span>
                  <span className={'diff-v tnum ' + (efDiff && efDiff < 0 ? 'c-red' : 'c-green')}>
                    {efDiff === null || efDiff === 0 ? '$0' : (efDiff > 0 ? '+' : '−') + money(Math.abs(efDiff))}
                  </span>
                </div>
                <div className="motivo-lbl">Motivo del descuadre <span className="req">si no cuadra</span></div>
                <textarea className="motivo-input" placeholder="Detallá el motivo de la diferencia…" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
                <div style={{ marginTop: 18 }}>
                  <button className="btn-primary" disabled={busy} onClick={submitClose}><Icon html={IC.lock} /> {busy ? 'Cerrando…' : 'Cerrar caja'}</button>
                </div>
              </section>

              <section className="glass" style={{ padding: '22px 24px' }}>
                <div className="card-title"><h3>Resumen de la sesión</h3></div>
                <div className="res-grid">
                  <div className="res-cell"><div className="res-k">Ventas del día</div><div className="res-v tnum">{money(ventasHoy)}</div></div>
                  <div className="res-cell"><div className="res-k">Tickets</div><div className="res-v tnum">{tickets}</div></div>
                  <div className="res-cell"><div className="res-k">Ticket promedio</div><div className="res-v tnum">{money(ticketProm)}</div></div>
                  <div className="res-cell"><div className="res-k">Apertura</div><div className="res-v tnum">{hora(session.openedAtIso)}</div></div>
                </div>
              </section>

              <section className="glass" style={{ padding: '22px 24px' }}>
                <div className="card-title"><h3>Comprobantes emitidos</h3><span className="upper-mini">Hoy</span></div>
                <div className="mov-empty">Sin comprobantes emitidos todavía.</div>
              </section>
            </div>
          </div>
        )}
      </main>

      {movMode && (
        <div className="modal-ov open" onClick={(e) => { if (e.target === e.currentTarget) setMovMode(null); }}>
          <div className="modal-card glass-strong" style={{ maxWidth: movMode === 'retiro' ? 440 : 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  <Icon html={movMode === 'ingreso' ? IC.plus : IC.minus} />
                  {movMode === 'ingreso' ? 'Registrar ingreso' : movMode === 'alivio' ? 'Alivio de caja' : 'Retiro / Gasto'}
                </div>
                <div className="modal-sub">{movMode === 'ingreso' ? 'Aporte de efectivo' : movMode === 'alivio' ? 'Extracción a caja fuerte / banco' : 'Pago desde caja'}</div>
              </div>
              <button className="modal-x" onClick={() => setMovMode(null)}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '6px 0 2px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="upper-mini">Monto</span>
                <div className="rm-inp"><span>$</span><input className="rm-input tnum" inputMode="numeric" placeholder="0" value={movAmount} onChange={(e) => setMovAmount(e.target.value)} /></div>
              </label>

              {movMode === 'retiro' ? (
                <>
                  <div>
                    <span className="upper-mini">Concepto</span>
                    <div className="reasign-pick" style={{ marginTop: 7 }}>
                      {reasons.map((r) => (
                        <button key={r.id} className={'reasign-opt' + (movConceptId === r.id ? ' sel' : '')} onClick={() => { setMovConceptId(r.id); setMovPayeeId(null); setMovPayeeName(''); }}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                    {reasons.length === 0 && <div className="mov-empty" style={{ padding: '8px 0' }}>No hay conceptos. {isOwner ? 'Cargalos en "Motivos y beneficiarios".' : 'Pedile al dueño que los cargue.'}</div>}
                  </div>
                  {needsPayee && (
                    <div>
                      <span className="upper-mini">{concept?.beneficiarioTipo === 'empleado' ? 'Empleado' : 'Proveedor'}</span>
                      <div className="reasign-pick" style={{ marginTop: 7 }}>
                        {payeeList.map((p) => (
                          <button key={p.id} className={'reasign-opt' + (movPayeeId === p.id ? ' sel' : '')} onClick={() => setMovPayeeId(p.id)}>{p.name}</button>
                        ))}
                        <button className={'reasign-opt' + (movPayeeId === OTRO_PAYEE ? ' sel' : '')} onClick={() => setMovPayeeId(OTRO_PAYEE)}>Otro…</button>
                      </div>
                      {movPayeeId === OTRO_PAYEE && (
                        <input className="motivo-input" style={{ minHeight: 0, marginTop: 8 }} placeholder={concept?.beneficiarioTipo === 'empleado' ? 'Nombre del empleado' : 'Nombre del proveedor'} value={movPayeeName} onChange={(e) => setMovPayeeName(e.target.value)} />
                      )}
                    </div>
                  )}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="upper-mini">Notas (opcional)</span>
                    <input className="motivo-input" style={{ minHeight: 0 }} placeholder="Detalle adicional" value={movNote} onChange={(e) => setMovNote(e.target.value)} />
                  </label>
                </>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="upper-mini">{movMode === 'ingreso' ? 'Concepto' : 'Nota (opcional)'}</span>
                  <input className="motivo-input" style={{ minHeight: 0 }} placeholder={movMode === 'ingreso' ? 'Ej: cobro cuenta corriente' : 'Alivio de caja'} value={movNote} onChange={(e) => setMovNote(e.target.value)} />
                </label>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setMovMode(null)}>Cancelar</button>
              <button className="btn-primary" disabled={busy || !movValid} onClick={submitMov}>{busy ? 'Registrando…' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}

      {adminOpen && isOwner && (
        <div className="modal-ov open" onClick={(e) => { if (e.target === e.currentTarget) setAdminOpen(false); }}>
          <div className="modal-card glass-strong" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <div><div className="modal-title">Motivos y beneficiarios</div><div className="modal-sub">Solo el dueño los administra</div></div>
              <button className="modal-x" onClick={() => setAdminOpen(false)}>×</button>
            </div>
            <div className="mov-filters" style={{ marginBottom: 14 }}>
              {(['motivos', 'empleado', 'proveedor'] as const).map((t) => (
                <button key={t} className="mov-fchip" aria-pressed={adminTab === t} onClick={() => setAdminTab(t)}>
                  {t === 'motivos' ? 'Motivos' : t === 'empleado' ? 'Empleados' : 'Proveedores'}
                </button>
              ))}
            </div>
            {adminTab === 'motivos' ? (
              <>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {reasons.map((r) => (
                    <li key={r.id} className="rm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                      <span className="lx-badge">{r.beneficiarioTipo === 'ninguno' ? '—' : r.beneficiarioTipo}</span>
                      <button className="denom-btn" style={{ margin: 0 }} disabled={busy} onClick={() => run(() => deactivateReasonAction({ id: r.id }), 'Motivo dado de baja.')}>Baja</button>
                    </li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <input className="motivo-input" style={{ minHeight: 0, flex: 1, minWidth: 140 }} placeholder="Nuevo motivo" value={newReasonLabel} onChange={(e) => setNewReasonLabel(e.target.value)} />
                  <select className="dq" style={{ width: 140, textAlign: 'left', paddingLeft: 10 }} value={newReasonTipo} onChange={(e) => setNewReasonTipo(e.target.value as BeneficiarioTipo)}>
                    <option value="ninguno">Sin beneficiario</option>
                    <option value="empleado">Empleado</option>
                    <option value="proveedor">Proveedor</option>
                  </select>
                  <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} disabled={busy || !newReasonLabel.trim()} onClick={addReason}>Agregar</button>
                </div>
              </>
            ) : (
              <>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(adminTab === 'empleado' ? empleados : proveedores).map((t) => (
                    <li key={t.id} className="rm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                      <button className="denom-btn" style={{ margin: 0 }} disabled={busy} onClick={() => run(() => deactivateTerceroAction({ id: t.id }), 'Beneficiario dado de baja.')}>Baja</button>
                    </li>
                  ))}
                  {(adminTab === 'empleado' ? empleados : proveedores).length === 0 && <li className="mov-empty">No hay {adminTab === 'empleado' ? 'empleados' : 'proveedores'}.</li>}
                </ul>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <input className="motivo-input" style={{ minHeight: 0, flex: 1, minWidth: 140 }} placeholder={adminTab === 'empleado' ? 'Nombre del empleado' : 'Nombre del proveedor'} value={newTerceroName} onChange={(e) => setNewTerceroName(e.target.value)} />
                  <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} disabled={busy || !newTerceroName.trim()} onClick={() => addTercero(adminTab as TerceroType)}>Agregar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

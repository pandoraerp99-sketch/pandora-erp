'use client';

/**
 * CajaClient — UI de la caja (port del mockup a React).
 *
 * - Barra de sesión + operaciones (abrir / ingreso / alivio / retiro-gasto / cierre).
 * - **Retiro/Gasto estructurado** (comprobante de egreso): el cajero SELECCIONA el
 *   concepto (no lo tipea) y, si el concepto pide beneficiario, elige el tercero
 *   (empleado/proveedor) o "Otro" y escribe el nombre; las notas van aparte. El
 *   dueño administra conceptos y beneficiarios (gate owner server-side).
 * - **Últimos movimientos** buscable: por nombre de cliente, rango de monto y
 *   medios (multi-select), con contador y "limpiar".
 * - Reclasificar medio de una venta (ADR-0026).
 *
 * Estilo Dawn Sky (glass sobre gradiente amanecer).
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
  updateReasonAction,
  deactivateReasonAction,
  createTerceroAction,
  updateTerceroAction,
  deactivateTerceroAction,
} from './actions';

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
  reasons: CajaReasonDTO[];
  empleados: CajaTerceroDTO[];
  proveedores: CajaTerceroDTO[];
  isOwner: boolean;
}

/** Sentinela: el beneficiario no está en la lista → nombre libre. */
const OTRO_PAYEE = '__otro__';

const MEDIOS: Record<string, { label: string; color: string }> = {
  efectivo: { label: 'Efectivo', color: '#34c77d' },
  debito: { label: 'Débito', color: '#5b8cff' },
  credito: { label: 'Crédito', color: '#f7984a' },
  tarjeta: { label: 'Tarjeta', color: '#7681a0' },
  mp_qr: { label: 'QR / MercadoPago', color: '#6b5fff' },
  mixto: { label: 'Mixto', color: '#9088ff' },
};

const RECLASS_OPTIONS: Array<{ key: SalePaymentMethod; label: string }> = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'debito', label: 'Débito' },
  { key: 'credito', label: 'Crédito' },
  { key: 'mp_qr', label: 'QR / MP' },
];

// Alivio (withdraw) = extracción a caja fuerte/banco, aparte. Retiro/Gasto
// (provider_payment) = egreso CON concepto + beneficiario. Ingreso = deposit.
const MOV_TYPES: Array<{ key: CashMovementType; label: string; hint: string; tone: 'green' | 'red' }> = [
  { key: 'deposit', label: 'Ingreso', hint: 'Aporte de efectivo a la caja', tone: 'green' },
  { key: 'withdraw', label: 'Alivio', hint: 'Extracción a caja fuerte / banco', tone: 'red' },
  { key: 'provider_payment', label: 'Retiro / Gasto', hint: 'Pago desde caja (concepto + a quién)', tone: 'red' },
];

const BENEF_TIPOS: Array<{ key: BeneficiarioTipo; label: string }> = [
  { key: 'ninguno', label: 'Sin beneficiario' },
  { key: 'empleado', label: 'Empleado' },
  { key: 'proveedor', label: 'Proveedor' },
];

const MEDIO_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'debito', label: 'Débito' },
  { key: 'credito', label: 'Crédito' },
  { key: 'mp_qr', label: 'QR / MP' },
  { key: 'mixto', label: 'Mixto' },
];

function money(raw: string | number): string {
  const n = Math.round(typeof raw === 'number' ? raw : parseFloat(raw || '0'));
  return '$ ' + (Number.isFinite(n) ? n : 0).toLocaleString('es-AR');
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function medioOf(m: string | null): { label: string; color: string } {
  if (!m) return { label: 'Sin asignar', color: '#e8973a' };
  return MEDIOS[m] ?? { label: m, color: '#7681a0' };
}

function benefLabel(t: BeneficiarioTipo): string {
  return t === 'empleado' ? 'Empleado' : t === 'proveedor' ? 'Proveedor' : '—';
}

export function CajaClient({
  cashierName,
  salePointLabel,
  session,
  movimientos,
  reasons,
  empleados,
  proveedores,
  isOwner,
}: CajaClientProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Abrir caja
  const [openAmount, setOpenAmount] = useState('');

  // Movimiento manual
  const [movType, setMovType] = useState<CashMovementType | null>(null);
  const [movAmount, setMovAmount] = useState('');
  const [movNote, setMovNote] = useState(''); // nota (ingreso/alivio) o notas (retiro)
  const [movConceptId, setMovConceptId] = useState<string | null>(null);
  const [movPayeeId, setMovPayeeId] = useState<string | null>(null); // id | OTRO_PAYEE
  const [movPayeeName, setMovPayeeName] = useState(''); // nombre libre para "Otro"
  const [payeeSearch, setPayeeSearch] = useState('');

  // Panel de administración (solo dueño): 'none' | 'motivos' | 'terceros'
  const [managePanel, setManagePanel] = useState<'none' | 'motivos' | 'terceros'>('none');
  // Motivos
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [newReasonTipo, setNewReasonTipo] = useState<BeneficiarioTipo>('ninguno');
  const [editReasonId, setEditReasonId] = useState<string | null>(null);
  const [editReasonLabel, setEditReasonLabel] = useState('');
  const [editReasonTipo, setEditReasonTipo] = useState<BeneficiarioTipo>('ninguno');
  // Terceros
  const [terceroTab, setTerceroTab] = useState<TerceroType>('empleado');
  const [newTerceroName, setNewTerceroName] = useState('');
  const [newTerceroDoc, setNewTerceroDoc] = useState('');
  const [editTerceroId, setEditTerceroId] = useState<string | null>(null);
  const [editTerceroName, setEditTerceroName] = useState('');
  const [editTerceroDoc, setEditTerceroDoc] = useState('');

  // Cierre
  const [closing, setClosing] = useState(false);
  const [countedAmount, setCountedAmount] = useState('');
  const [closeReason, setCloseReason] = useState('');

  // Reclasificar medio (ADR-0026)
  const [reclassSaleId, setReclassSaleId] = useState<string | null>(null);
  const [reclassMethod, setReclassMethod] = useState<SalePaymentMethod | null>(null);
  const [reclassReason, setReclassReason] = useState('');

  // Filtros de "Últimos movimientos"
  const [search, setSearch] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [medioSel, setMedioSel] = useState<Set<string>>(new Set());

  // ── Derivados del retiro/gasto ─────────────────────────────────
  const concept = movConceptId ? reasons.find((r) => r.id === movConceptId) ?? null : null;
  const needsPayee = !!concept && concept.beneficiarioTipo !== 'ninguno';
  const payeeList = useMemo(() => {
    if (!concept || concept.beneficiarioTipo === 'ninguno') return [];
    return concept.beneficiarioTipo === 'empleado' ? empleados : proveedores;
  }, [concept, empleados, proveedores]);
  const payeeVisible = useMemo(() => {
    const q = payeeSearch.trim().toLowerCase();
    return q ? payeeList.filter((p) => p.name.toLowerCase().includes(q)) : payeeList;
  }, [payeeList, payeeSearch]);

  /** Arma el payload del movimiento, o null si el form está incompleto. */
  function buildMovementPayload():
    | Parameters<typeof registerMovementAction>[0]
    | null {
    if (!session || !movType) return null;
    const amount = movAmount.trim();
    if (amount.length === 0) return null;
    const base = { sessionId: session.id, type: movType, amount };

    if (movType === 'deposit') {
      const note = movNote.trim();
      if (note.length === 0) return null; // ingreso: nota obligatoria
      return { ...base, reason: note };
    }
    if (movType === 'withdraw') {
      return { ...base, reason: movNote.trim() || 'Alivio de caja' };
    }
    // provider_payment (retiro/gasto): concepto + beneficiario + notas
    if (!concept) return null;
    const notes = movNote.trim() || null;
    if (!needsPayee) {
      return { ...base, reason: concept.label, conceptId: concept.id, notes };
    }
    if (movPayeeId === OTRO_PAYEE) {
      const name = movPayeeName.trim();
      if (name.length === 0) return null; // "Otro": nombre obligatorio
      return {
        ...base,
        reason: concept.label,
        conceptId: concept.id,
        payeeId: null,
        payeeType: concept.beneficiarioTipo,
        payeeName: name,
        notes,
      };
    }
    const tercero = payeeList.find((p) => p.id === movPayeeId);
    if (!tercero) return null; // beneficiario no elegido
    return {
      ...base,
      reason: concept.label,
      conceptId: concept.id,
      payeeId: tercero.id,
      payeeType: tercero.type,
      payeeName: tercero.name,
      notes,
    };
  }
  const movValid = buildMovementPayload() !== null;

  function resetMovForm() {
    setMovType(null);
    setMovAmount('');
    setMovNote('');
    setMovConceptId(null);
    setMovPayeeId(null);
    setMovPayeeName('');
    setPayeeSearch('');
  }

  // ── Filtro de movimientos ──────────────────────────────────────
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = amountMin.trim() ? parseFloat(amountMin) : null;
    const max = amountMax.trim() ? parseFloat(amountMax) : null;
    return movimientos.filter((m) => {
      if (q) {
        const name = (m.customerName ?? 'consumidor final').toLowerCase();
        if (!name.includes(q)) return false;
      }
      const total = parseFloat(m.total || '0');
      if (min !== null && Number.isFinite(min) && total < min) return false;
      if (max !== null && Number.isFinite(max) && total > max) return false;
      if (medioSel.size > 0 && !medioSel.has(m.method ?? 'sin')) return false;
      return true;
    });
  }, [movimientos, search, amountMin, amountMax, medioSel]);

  const visiblesTotal = useMemo(
    () => visibles.reduce((acc, m) => acc + Math.round(parseFloat(m.total || '0')), 0),
    [visibles]
  );
  const filtersActive =
    search.trim() !== '' || amountMin.trim() !== '' || amountMax.trim() !== '' || medioSel.size > 0;

  function clearFilters() {
    setSearch('');
    setAmountMin('');
    setAmountMax('');
    setMedioSel(new Set());
  }
  function toggleMedio(key: string) {
    setMedioSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Handlers ───────────────────────────────────────────────────
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

  async function handleOpen() {
    const ok = await run(() => openSessionAction({ initialAmount: openAmount.trim() }), 'Caja abierta.');
    if (ok) setOpenAmount('');
  }

  async function handleMovement() {
    const payload = buildMovementPayload();
    if (!payload) return;
    const ok = await run(() => registerMovementAction(payload), 'Movimiento registrado.');
    if (ok) resetMovForm();
  }

  async function handleClose() {
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
      setClosing(false);
      setCountedAmount('');
      setCloseReason('');
      setFeedback({
        tone: 'ok',
        text: `Caja cerrada. Descuadre: ${money(res.data.descuadre)} · ${res.data.severity_label}.`,
      });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

  async function handleReclassify() {
    if (!reclassSaleId || !reclassMethod) return;
    const ok = await run(
      () =>
        reclassifyPaymentAction({
          saleId: reclassSaleId,
          newMethod: reclassMethod,
          reason: reclassReason.trim(),
        }),
      'Medio corregido.'
    );
    if (ok) {
      setReclassSaleId(null);
      setReclassMethod(null);
      setReclassReason('');
    }
  }

  // Motivos (owner)
  async function handleCreateReason() {
    const label = newReasonLabel.trim();
    if (label.length === 0) return;
    const ok = await run(
      () => createReasonAction({ label, beneficiarioTipo: newReasonTipo }),
      'Motivo agregado.'
    );
    if (ok) {
      setNewReasonLabel('');
      setNewReasonTipo('ninguno');
    }
  }
  async function handleRenameReason() {
    if (!editReasonId) return;
    const label = editReasonLabel.trim();
    if (label.length === 0) return;
    const ok = await run(
      () => updateReasonAction({ id: editReasonId, label, beneficiarioTipo: editReasonTipo }),
      'Motivo actualizado.'
    );
    if (ok) setEditReasonId(null);
  }
  async function handleDeactivateReason(id: string) {
    await run(() => deactivateReasonAction({ id }), 'Motivo dado de baja.');
  }

  // Terceros (owner)
  async function handleCreateTercero() {
    const name = newTerceroName.trim();
    if (name.length === 0) return;
    const ok = await run(
      () => createTerceroAction({ type: terceroTab, name, doc: newTerceroDoc.trim() || null }),
      'Beneficiario agregado.'
    );
    if (ok) {
      setNewTerceroName('');
      setNewTerceroDoc('');
    }
  }
  async function handleRenameTercero() {
    if (!editTerceroId) return;
    const name = editTerceroName.trim();
    if (name.length === 0) return;
    const ok = await run(
      () => updateTerceroAction({ id: editTerceroId, name, doc: editTerceroDoc.trim() || null }),
      'Beneficiario actualizado.'
    );
    if (ok) setEditTerceroId(null);
  }
  async function handleDeactivateTercero(id: string) {
    await run(() => deactivateTerceroAction({ id }), 'Beneficiario dado de baja.');
  }

  const terceroList = terceroTab === 'empleado' ? empleados : proveedores;

  return (
    <div className="caja-root">
      <style>{CAJA_CSS}</style>

      <header className="caja-topbar">
        <div className="caja-brand">
          <span className="caja-logo">◆</span> Pandora <span className="caja-sep">·</span> Caja
        </div>
        <div className="caja-user">{cashierName}</div>
      </header>

      <main className="caja-main">
        {feedback && <div className={'caja-feedback ' + feedback.tone}>{feedback.text}</div>}

        {/* Barra de sesión */}
        {session ? (
          <section className="glass session-bar">
            <div className="sb-head">
              <div>
                <div className="sb-title">{salePointLabel}</div>
                <div className="sb-sub">
                  Abierta {session.openedAtIso ? `desde ${hora(session.openedAtIso)}` : ''} ·{' '}
                  <span className="sb-live">● en curso</span>
                </div>
              </div>
              <div className="sb-stats">
                <Stat k="Fondo inicial" v={money(session.initialAmount)} />
                <Stat k="Ingresos manuales" v={'+ ' + money(session.totalDeposits)} tone="green" />
                <Stat k="Retiros" v={'− ' + money(session.totalWithdraws)} tone="red" />
                <Stat k="Efectivo esperado (mov.)" v={money(session.expectedFromMovements)} strong />
              </div>
            </div>
          </section>
        ) : (
          <section className="glass session-closed">
            <div className="sc-row">
              <div className="sc-ic">🔒</div>
              <div>
                <div className="sc-title">No hay caja abierta</div>
                <div className="sc-sub">
                  Abrí la caja con el fondo inicial para empezar a operar en {salePointLabel}.
                </div>
              </div>
            </div>
            <div className="sc-form">
              <label className="fld">
                <span className="fld-k">Fondo inicial</span>
                <input
                  className="fld-in mono"
                  inputMode="decimal"
                  placeholder="0"
                  value={openAmount}
                  onChange={(e) => setOpenAmount(e.target.value)}
                />
              </label>
              <button className="btn primary" type="button" disabled={busy} onClick={handleOpen}>
                {busy ? 'Abriendo…' : 'Abrir caja'}
              </button>
            </div>
          </section>
        )}

        {/* Operaciones — sólo con sesión abierta */}
        {session && (
          <section className="glass ops">
            <div className="ops-head">
              <h2>Operaciones de caja</h2>
              {!closing && (
                <div className="ops-head-actions">
                  {isOwner && (
                    <>
                      <button
                        className={'btn ghost' + (managePanel === 'motivos' ? ' on' : '')}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setManagePanel((p) => (p === 'motivos' ? 'none' : 'motivos'));
                          setEditReasonId(null);
                          setFeedback(null);
                        }}
                      >
                        Motivos
                      </button>
                      <button
                        className={'btn ghost' + (managePanel === 'terceros' ? ' on' : '')}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setManagePanel((p) => (p === 'terceros' ? 'none' : 'terceros'));
                          setEditTerceroId(null);
                          setFeedback(null);
                        }}
                      >
                        Beneficiarios
                      </button>
                    </>
                  )}
                  <button
                    className="btn ghost danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setClosing(true);
                      resetMovForm();
                      setManagePanel('none');
                      setFeedback(null);
                    }}
                  >
                    Cerrar caja
                  </button>
                </div>
              )}
            </div>

            {/* Panel: administrar MOTIVOS (dueño) */}
            {isOwner && managePanel === 'motivos' && !closing && (
              <div className="op-form">
                <div className="op-form-title">Motivos de retiro / gasto</div>
                <p className="op-form-hint">
                  El cajero elige el concepto de esta lista. El "tipo de beneficiario" define
                  a quién se le pide seleccionar (empleado / proveedor) al registrar el gasto.
                </p>
                <ul className="mgr-list">
                  {reasons.length === 0 && <li className="mgr-empty">No hay motivos todavía.</li>}
                  {reasons.map((r) => (
                    <li key={r.id} className="mgr-item">
                      {editReasonId === r.id ? (
                        <>
                          <input
                            className="fld-in"
                            value={editReasonLabel}
                            onChange={(e) => setEditReasonLabel(e.target.value)}
                          />
                          <select
                            className="fld-in sel"
                            value={editReasonTipo}
                            onChange={(e) => setEditReasonTipo(e.target.value as BeneficiarioTipo)}
                          >
                            {BENEF_TIPOS.map((b) => (
                              <option key={b.key} value={b.key}>{b.label}</option>
                            ))}
                          </select>
                          <button className="btn primary sm" type="button" disabled={busy} onClick={handleRenameReason}>
                            Guardar
                          </button>
                          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setEditReasonId(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="mgr-name">{r.label}</span>
                          <span className="mgr-tag">{benefLabel(r.beneficiarioTipo)}</span>
                          <button
                            className="btn ghost sm"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditReasonId(r.id);
                              setEditReasonLabel(r.label);
                              setEditReasonTipo(r.beneficiarioTipo);
                            }}
                          >
                            Editar
                          </button>
                          <button className="btn ghost sm danger" type="button" disabled={busy} onClick={() => handleDeactivateReason(r.id)}>
                            Baja
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mgr-add">
                  <input
                    className="fld-in"
                    placeholder="Nuevo motivo (ej: Pago de servicios)"
                    value={newReasonLabel}
                    onChange={(e) => setNewReasonLabel(e.target.value)}
                  />
                  <select
                    className="fld-in sel"
                    value={newReasonTipo}
                    onChange={(e) => setNewReasonTipo(e.target.value as BeneficiarioTipo)}
                  >
                    {BENEF_TIPOS.map((b) => (
                      <option key={b.key} value={b.key}>{b.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn primary sm"
                    type="button"
                    disabled={busy || newReasonLabel.trim().length === 0}
                    onClick={handleCreateReason}
                  >
                    Agregar
                  </button>
                </div>
              </div>
            )}

            {/* Panel: administrar BENEFICIARIOS (dueño) */}
            {isOwner && managePanel === 'terceros' && !closing && (
              <div className="op-form">
                <div className="op-form-title">Beneficiarios</div>
                <p className="op-form-hint">
                  Empleados y proveedores a los que se les paga desde la caja. Solo una lista de
                  nombres para atribuir el gasto (no es liquidación de sueldos ni cuenta corriente).
                </p>
                <div className="mgr-tabs">
                  {(['empleado', 'proveedor'] as TerceroType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={'mgr-tab' + (terceroTab === t ? ' on' : '')}
                      onClick={() => {
                        setTerceroTab(t);
                        setEditTerceroId(null);
                      }}
                    >
                      {t === 'empleado' ? 'Empleados' : 'Proveedores'}
                    </button>
                  ))}
                </div>
                <ul className="mgr-list">
                  {terceroList.length === 0 && (
                    <li className="mgr-empty">
                      No hay {terceroTab === 'empleado' ? 'empleados' : 'proveedores'} todavía.
                    </li>
                  )}
                  {terceroList.map((t) => (
                    <li key={t.id} className="mgr-item">
                      {editTerceroId === t.id ? (
                        <>
                          <input
                            className="fld-in"
                            value={editTerceroName}
                            onChange={(e) => setEditTerceroName(e.target.value)}
                          />
                          <input
                            className="fld-in"
                            placeholder="CUIT/doc (opcional)"
                            value={editTerceroDoc}
                            onChange={(e) => setEditTerceroDoc(e.target.value)}
                          />
                          <button className="btn primary sm" type="button" disabled={busy} onClick={handleRenameTercero}>
                            Guardar
                          </button>
                          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setEditTerceroId(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="mgr-name">{t.name}</span>
                          {t.doc && <span className="mgr-tag">{t.doc}</span>}
                          <button
                            className="btn ghost sm"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditTerceroId(t.id);
                              setEditTerceroName(t.name);
                              setEditTerceroDoc(t.doc ?? '');
                            }}
                          >
                            Editar
                          </button>
                          <button className="btn ghost sm danger" type="button" disabled={busy} onClick={() => handleDeactivateTercero(t.id)}>
                            Baja
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mgr-add">
                  <input
                    className="fld-in"
                    placeholder={terceroTab === 'empleado' ? 'Nombre del empleado' : 'Nombre del proveedor'}
                    value={newTerceroName}
                    onChange={(e) => setNewTerceroName(e.target.value)}
                  />
                  <input
                    className="fld-in"
                    placeholder="CUIT/doc (opcional)"
                    value={newTerceroDoc}
                    onChange={(e) => setNewTerceroDoc(e.target.value)}
                  />
                  <button
                    className="btn primary sm"
                    type="button"
                    disabled={busy || newTerceroName.trim().length === 0}
                    onClick={handleCreateTercero}
                  >
                    Agregar
                  </button>
                </div>
              </div>
            )}

            {closing ? (
              <div className="op-form">
                <div className="op-form-title">Cierre de caja</div>
                <p className="op-form-hint">
                  Contá el efectivo físico en el cajón. El sistema calcula lo esperado (fondo +
                  ventas en efectivo + movimientos) y muestra el descuadre.
                </p>
                <label className="fld">
                  <span className="fld-k">Efectivo contado</span>
                  <input
                    className="fld-in mono"
                    inputMode="decimal"
                    placeholder="0"
                    value={countedAmount}
                    onChange={(e) => setCountedAmount(e.target.value)}
                  />
                </label>
                <label className="fld">
                  <span className="fld-k">Motivo del descuadre (obligatorio si no cuadra)</span>
                  <input
                    className="fld-in"
                    placeholder="Ej: faltante por vuelto mal dado"
                    value={closeReason}
                    onChange={(e) => setCloseReason(e.target.value)}
                  />
                </label>
                <div className="op-actions">
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => setClosing(false)}>
                    Cancelar
                  </button>
                  <button className="btn primary danger" type="button" disabled={busy} onClick={handleClose}>
                    {busy ? 'Cerrando…' : 'Confirmar cierre'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="ops-btns">
                  {MOV_TYPES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={'mov-btn' + (movType === t.key ? ' on' : '')}
                      disabled={busy}
                      onClick={() => {
                        if (movType === t.key) resetMovForm();
                        else {
                          resetMovForm();
                          setMovType(t.key);
                        }
                        setManagePanel('none');
                        setFeedback(null);
                      }}
                    >
                      <span className={'mov-dot ' + t.tone} />
                      <span className="mov-l">{t.label}</span>
                      <span className="mov-h">{t.hint}</span>
                    </button>
                  ))}
                </div>

                {movType && (
                  <div className="op-form">
                    <div className="op-form-title">{MOV_TYPES.find((t) => t.key === movType)?.label}</div>
                    <label className="fld">
                      <span className="fld-k">Monto</span>
                      <input
                        className="fld-in mono"
                        inputMode="decimal"
                        placeholder="0"
                        value={movAmount}
                        onChange={(e) => setMovAmount(e.target.value)}
                      />
                    </label>

                    {movType === 'provider_payment' ? (
                      <>
                        {/* Concepto (seleccionar, no tipear) */}
                        <div className="fld">
                          <span className="fld-k">Concepto (obligatorio)</span>
                          <div className="reclass-chips">
                            {reasons.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                className={'reclass-chip' + (movConceptId === r.id ? ' on' : '')}
                                disabled={busy}
                                onClick={() => {
                                  setMovConceptId(r.id);
                                  setMovPayeeId(null);
                                  setMovPayeeName('');
                                  setPayeeSearch('');
                                }}
                              >
                                {r.label}
                              </button>
                            ))}
                            {reasons.length === 0 && (
                              <span className="mgr-empty">
                                No hay conceptos. {isOwner ? 'Agregalos en "Motivos".' : 'Pedile al dueño que los cargue.'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Beneficiario (si el concepto lo pide) */}
                        {needsPayee && (
                          <div className="fld">
                            <span className="fld-k">
                              {concept?.beneficiarioTipo === 'empleado' ? 'Empleado' : 'Proveedor'} (obligatorio)
                            </span>
                            {payeeList.length > 6 && (
                              <input
                                className="fld-in"
                                placeholder="Buscar…"
                                value={payeeSearch}
                                onChange={(e) => setPayeeSearch(e.target.value)}
                              />
                            )}
                            <div className="reclass-chips">
                              {payeeVisible.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className={'reclass-chip' + (movPayeeId === p.id ? ' on' : '')}
                                  disabled={busy}
                                  onClick={() => setMovPayeeId(p.id)}
                                >
                                  {p.name}
                                </button>
                              ))}
                              <button
                                type="button"
                                className={'reclass-chip' + (movPayeeId === OTRO_PAYEE ? ' on' : '')}
                                disabled={busy}
                                onClick={() => setMovPayeeId(OTRO_PAYEE)}
                              >
                                Otro
                              </button>
                            </div>
                            {movPayeeId === OTRO_PAYEE && (
                              <input
                                className="fld-in"
                                placeholder={
                                  concept?.beneficiarioTipo === 'empleado'
                                    ? 'Nombre del empleado (obligatorio)'
                                    : 'Nombre del proveedor (obligatorio)'
                                }
                                value={movPayeeName}
                                onChange={(e) => setMovPayeeName(e.target.value)}
                              />
                            )}
                          </div>
                        )}

                        <label className="fld">
                          <span className="fld-k">Notas (opcional)</span>
                          <input
                            className="fld-in"
                            placeholder="Detalle adicional"
                            value={movNote}
                            onChange={(e) => setMovNote(e.target.value)}
                          />
                        </label>
                      </>
                    ) : (
                      <label className="fld">
                        <span className="fld-k">
                          {movType === 'withdraw' ? 'Nota (opcional)' : 'Motivo (obligatorio)'}
                        </span>
                        <input
                          className="fld-in"
                          placeholder={movType === 'withdraw' ? 'Alivio de caja' : 'Ej: aporte de cambio a la caja'}
                          value={movNote}
                          onChange={(e) => setMovNote(e.target.value)}
                        />
                      </label>
                    )}

                    <div className="op-actions">
                      <button className="btn ghost" type="button" disabled={busy} onClick={resetMovForm}>
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy || !movValid}
                        onClick={handleMovement}
                      >
                        {busy ? 'Registrando…' : 'Registrar movimiento'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Últimos movimientos (ventas del día) — buscable */}
        <section className="glass movimientos">
          <div className="mv-head">
            <h2>Últimos movimientos</h2>
            <span className="mv-total">
              {visibles.length}
              {filtersActive ? ` / ${movimientos.length}` : ''} ventas · {money(visiblesTotal)}
            </span>
          </div>

          <div className="mv-search">
            <input
              className="fld-in"
              placeholder="Buscar por cliente…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              className="fld-in mono amt"
              inputMode="decimal"
              placeholder="Monto mín."
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
            />
            <input
              className="fld-in mono amt"
              inputMode="decimal"
              placeholder="Monto máx."
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
            />
            {filtersActive && (
              <button className="btn ghost sm" type="button" onClick={clearFilters}>
                Limpiar
              </button>
            )}
          </div>

          <div className="mv-filters">
            {MEDIO_FILTERS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={'mv-chip' + (medioSel.has(c.key) ? ' on' : '')}
                onClick={() => toggleMedio(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {visibles.length === 0 ? (
            <div className="mv-empty">
              {movimientos.length === 0
                ? 'Todavía no hay ventas registradas hoy.'
                : 'Ninguna venta coincide con la búsqueda.'}
            </div>
          ) : (
            <div className="mv-scroll">
              <table className="mv-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Cliente</th>
                    <th>Medio de pago</th>
                    <th className="r">Monto</th>
                    {session && <th className="r">Medio</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((m) => {
                    const md = medioOf(m.method);
                    const editing = reclassSaleId === m.id;
                    const colCount = session ? 5 : 4;
                    return (
                      <Fragment key={m.id}>
                        <tr className={editing ? 'mv-row-editing' : undefined}>
                          <td className="mono">{hora(m.finalizedAtIso)}</td>
                          <td>{m.customerName || 'Consumidor final'}</td>
                          <td>
                            <span className="medio">
                              <span className="sw" style={{ background: md.color }} />
                              {md.label}
                            </span>
                          </td>
                          <td className="r mono strong">{money(m.total)}</td>
                          {session && (
                            <td className="r">
                              <button
                                type="button"
                                className="mv-edit"
                                disabled={busy}
                                onClick={() => (editing ? setReclassSaleId(null) : setReclassSaleId(m.id))}
                              >
                                {editing ? 'Cerrar' : 'Cambiar'}
                              </button>
                            </td>
                          )}
                        </tr>
                        {editing && (
                          <tr className="mv-editor-row">
                            <td colSpan={colCount}>
                              <div className="reclass">
                                <div className="reclass-title">Corregir medio de esta venta</div>
                                <div className="reclass-chips">
                                  {RECLASS_OPTIONS.filter((o) => o.key !== m.method).map((o) => (
                                    <button
                                      key={o.key}
                                      type="button"
                                      className={'reclass-chip' + (reclassMethod === o.key ? ' on' : '')}
                                      disabled={busy}
                                      onClick={() => setReclassMethod(o.key)}
                                    >
                                      {o.label}
                                    </button>
                                  ))}
                                </div>
                                <input
                                  className="fld-in"
                                  placeholder="Motivo (obligatorio): ej. abonó en efectivo, marqué débito"
                                  value={reclassReason}
                                  onChange={(e) => setReclassReason(e.target.value)}
                                />
                                <div className="op-actions">
                                  <button className="btn ghost" type="button" disabled={busy} onClick={() => setReclassSaleId(null)}>
                                    Cancelar
                                  </button>
                                  <button className="btn primary" type="button" disabled={busy || !reclassMethod} onClick={handleReclassify}>
                                    {busy ? 'Guardando…' : 'Guardar corrección'}
                                  </button>
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
      </main>
    </div>
  );
}

function Stat({
  k,
  v,
  tone,
  strong,
}: {
  k: string;
  v: string;
  tone?: 'green' | 'red';
  strong?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className={'stat-v' + (strong ? ' strong' : '') + (tone ? ' ' + tone : '')}>{v}</div>
    </div>
  );
}

const CAJA_CSS = `
.caja-root{ min-height:100dvh; color:#0d1424; font-family:'Inter',ui-sans-serif,system-ui,sans-serif;
  background:linear-gradient(175deg,#b8c8e8 0%,#c8d4ea 25%,#e0d4e0 60%,#f0d8d2 100%); background-attachment:fixed; }
.caja-topbar{ display:flex; align-items:center; justify-content:space-between; padding:14px 22px; }
.caja-brand{ font-weight:700; font-size:15px; display:flex; align-items:center; gap:7px; }
.caja-logo{ color:#6b5fff; }
.caja-sep{ color:#a8b0c5; }
.caja-user{ font-size:12.5px; color:#4a5570; background:rgba(255,255,255,0.55); padding:6px 12px; border-radius:999px;
  border:1px solid rgba(255,255,255,0.8); }
.caja-main{ max-width:1000px; margin:0 auto; padding:8px 20px 60px; display:flex; flex-direction:column; gap:16px; }
.glass{ background:rgba(255,255,255,0.6); backdrop-filter:blur(24px) saturate(140%); -webkit-backdrop-filter:blur(24px) saturate(140%);
  border:1px solid rgba(255,255,255,0.85); border-radius:20px; box-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 32px rgba(54,70,120,0.1); }
.caja-feedback{ padding:11px 16px; border-radius:14px; font-size:12.5px; font-weight:600; }
.caja-feedback.ok{ background:rgba(52,199,125,0.14); color:#127a4b; border:1px solid rgba(52,199,125,0.3); }
.caja-feedback.err{ background:rgba(201,53,69,0.12); color:#a8283a; border:1px solid rgba(201,53,69,0.3); }
.session-bar{ padding:20px 24px; }
.sb-head{ display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; }
.sb-title{ font-size:19px; font-weight:800; }
.sb-sub{ font-size:12px; color:#4a5570; margin-top:3px; }
.sb-live{ color:#1a8e5a; font-weight:600; }
.sb-stats{ display:flex; gap:26px; flex-wrap:wrap; }
.stat-k{ font-size:9.5px; text-transform:uppercase; letter-spacing:0.07em; color:#7681a0; font-weight:600; }
.stat-v{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:15px; font-weight:600; margin-top:2px; }
.stat-v.strong{ font-size:18px; font-weight:700; }
.stat-v.green{ color:#1a8e5a; } .stat-v.red{ color:#c93545; }
.session-closed{ padding:22px 24px; display:flex; flex-direction:column; gap:18px; }
.sc-row{ display:flex; align-items:center; gap:16px; }
.sc-ic{ font-size:26px; } .sc-title{ font-size:16px; font-weight:700; } .sc-sub{ font-size:12.5px; color:#4a5570; margin-top:3px; }
.sc-form{ display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; }
.ops{ padding:20px 24px; }
.ops-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; gap:12px; flex-wrap:wrap; }
.ops-head h2{ margin:0; font-size:16px; font-weight:700; }
.ops-head-actions{ display:flex; gap:10px; flex-wrap:wrap; }
.ops-btns{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
.mov-btn{ display:flex; flex-direction:column; align-items:flex-start; gap:3px; text-align:left; padding:13px 15px; cursor:pointer;
  background:rgba(255,255,255,0.45); border:1px solid rgba(13,20,36,0.08); border-radius:14px; transition:all 150ms; }
.mov-btn:hover{ border-color:rgba(107,95,255,0.4); background:rgba(255,255,255,0.65); }
.mov-btn.on{ border-color:#6b5fff; background:rgba(255,255,255,0.85); box-shadow:0 2px 10px rgba(54,70,120,0.12); }
.mov-btn:disabled{ opacity:0.5; cursor:default; }
.mov-dot{ width:8px; height:8px; border-radius:3px; }
.mov-dot.green{ background:#34c77d; } .mov-dot.red{ background:#c93545; }
.mov-l{ font-size:14px; font-weight:700; color:#1f2a44; }
.mov-h{ font-size:11px; color:#7681a0; }
.op-form{ margin-top:14px; padding:16px; background:rgba(255,255,255,0.4); border:1px solid rgba(13,20,36,0.07);
  border-radius:14px; display:flex; flex-direction:column; gap:12px; }
.op-form-title{ font-size:13.5px; font-weight:700; color:#1f2a44; }
.op-form-hint{ margin:0; font-size:11.5px; color:#7681a0; line-height:1.5; }
.fld{ display:flex; flex-direction:column; gap:5px; flex:1; min-width:160px; }
.fld-k{ font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:#7681a0; font-weight:600; }
.fld-in{ font-size:14px; padding:10px 13px; border-radius:11px; border:1px solid rgba(13,20,36,0.14);
  background:rgba(255,255,255,0.9); color:#0d1424; outline:none; transition:border-color 150ms; width:100%; }
.fld-in:focus{ border-color:#6b5fff; }
.fld-in.sel{ cursor:pointer; }
.op-actions{ display:flex; justify-content:flex-end; gap:10px; }
.btn{ font-size:13px; font-weight:600; padding:10px 18px; border-radius:11px; cursor:pointer; border:1px solid transparent; transition:all 150ms; }
.btn:disabled{ opacity:0.55; cursor:default; }
.btn.primary{ background:#6b5fff; color:#fff; box-shadow:0 4px 14px rgba(107,95,255,0.32); }
.btn.primary:hover:not(:disabled){ background:#5b50f0; }
.btn.primary.danger{ background:#c93545; box-shadow:0 4px 14px rgba(201,53,69,0.3); }
.btn.primary.danger:hover:not(:disabled){ background:#b52c3c; }
.btn.ghost{ background:rgba(255,255,255,0.6); border-color:rgba(13,20,36,0.12); color:#4a5570; }
.btn.ghost:hover:not(:disabled){ border-color:rgba(107,95,255,0.35); }
.btn.ghost.danger{ color:#c93545; border-color:rgba(201,53,69,0.3); }
.btn.ghost.on{ background:rgba(107,95,255,0.12); border-color:#6b5fff; color:#5b50f0; }
.btn.sm{ font-size:11.5px; padding:6px 12px; border-radius:9px; }
.mgr-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.mgr-empty{ font-size:12px; color:#7681a0; padding:4px 0; }
.mgr-item{ display:flex; align-items:center; gap:8px; padding:8px 10px; background:rgba(255,255,255,0.55);
  border:1px solid rgba(13,20,36,0.07); border-radius:11px; flex-wrap:wrap; }
.mgr-item .fld-in{ flex:1; min-width:120px; }
.mgr-name{ flex:1; font-size:13px; font-weight:600; color:#1f2a44; min-width:120px; }
.mgr-tag{ font-size:10.5px; font-weight:600; color:#5b50f0; background:rgba(107,95,255,0.1);
  padding:3px 9px; border-radius:999px; }
.mgr-add{ display:flex; gap:8px; margin-top:4px; flex-wrap:wrap; }
.mgr-add .fld-in{ flex:1; min-width:120px; }
.mgr-tabs{ display:flex; gap:8px; }
.mgr-tab{ font-size:12px; font-weight:600; padding:7px 14px; border-radius:999px; cursor:pointer; color:#4a5570;
  background:rgba(255,255,255,0.5); border:1px solid rgba(13,20,36,0.1); }
.mgr-tab.on{ background:#6b5fff; color:#fff; border-color:#6b5fff; }
.movimientos{ padding:20px 24px; }
.mv-head{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:14px; gap:12px; flex-wrap:wrap; }
.mv-head h2{ margin:0; font-size:16px; font-weight:700; }
.mv-total{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12.5px; color:#4a5570; font-weight:600; }
.mv-search{ display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
.mv-search .fld-in{ flex:1; min-width:150px; }
.mv-search .fld-in.amt{ flex:0 0 120px; min-width:100px; }
.mv-filters{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.mv-chip{ font-size:11.5px; font-weight:600; padding:6px 12px; border-radius:999px; cursor:pointer; color:#4a5570;
  background:rgba(255,255,255,0.4); border:1px solid rgba(13,20,36,0.08); transition:all 150ms; }
.mv-chip:hover{ border-color:rgba(107,95,255,0.35); }
.mv-chip.on{ background:rgba(255,255,255,0.85); border-color:#6b5fff; color:#1f2a44; box-shadow:0 2px 8px rgba(54,70,120,0.1); }
.mv-empty{ text-align:center; padding:30px 10px; color:#7681a0; font-size:12.5px; }
.mv-scroll{ max-height:440px; overflow-y:auto; }
.mv-table{ width:100%; border-collapse:collapse; }
.mv-table th{ text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#7681a0;
  font-family:'JetBrains Mono',ui-monospace,monospace; font-weight:500; padding:0 0 11px; }
.mv-table th.r, .mv-table td.r{ text-align:right; }
.mv-table td{ padding:12px 0; border-top:1px solid rgba(13,20,36,0.05); font-size:13px; color:#1f2a44; }
.mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }
.strong{ font-weight:600; }
.medio{ display:inline-flex; align-items:center; gap:7px; color:#4a5570; }
.medio .sw{ width:8px; height:8px; border-radius:2.5px; }
.mv-edit{ font-size:11px; font-weight:600; padding:4px 11px; border-radius:999px; cursor:pointer; color:#6b5fff;
  background:rgba(107,95,255,0.08); border:1px solid rgba(107,95,255,0.25); transition:all 150ms; }
.mv-edit:hover:not(:disabled){ background:rgba(107,95,255,0.16); }
.mv-edit:disabled{ opacity:0.5; cursor:default; }
.mv-row-editing td{ border-bottom:none; }
.mv-editor-row td{ padding:0 0 12px; border-top:none; }
.reclass{ padding:14px 16px; background:rgba(255,255,255,0.5); border:1px solid rgba(107,95,255,0.2);
  border-radius:14px; display:flex; flex-direction:column; gap:11px; }
.reclass-title{ font-size:12.5px; font-weight:700; color:#1f2a44; }
.reclass-chips{ display:flex; flex-wrap:wrap; gap:8px; }
.reclass-chip{ font-size:12px; font-weight:600; padding:7px 14px; border-radius:999px; cursor:pointer; color:#4a5570;
  background:rgba(255,255,255,0.6); border:1px solid rgba(13,20,36,0.1); transition:all 150ms; }
.reclass-chip:hover:not(:disabled){ border-color:rgba(107,95,255,0.4); }
.reclass-chip.on{ background:#6b5fff; color:#fff; border-color:#6b5fff; }
.reclass-chip:disabled{ opacity:0.5; cursor:default; }
`;

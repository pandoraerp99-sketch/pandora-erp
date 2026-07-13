'use client';

/**
 * CajaClient — UI de la caja (port del mockup public/caja.html a React).
 *
 * Slice 1: barra de sesión (real) + "Últimos movimientos" (ventas reales del día).
 * Slice 3 (este): interacción real — abrir caja, alivios (ingreso/retiro/pago a
 * proveedor) y cierre con descuadre, todo wireado a las server actions (actions.ts)
 * que llaman al dominio de caja ya testeado (src/lib/cash).
 *
 * Los medios se muestran con la taxonomía REAL del backend
 * (efectivo/débito/crédito/tarjeta/mp_qr/mixto); la separación débito/crédito del
 * arqueo (A-26, caja/reporting no fiscal) ya está en el enum.
 *
 * Estilo Dawn Sky (glass sobre gradiente amanecer), coherente con el mockup.
 */
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CashMovementType, SalePaymentMethod } from '@/lib/db/schema/_common';
import {
  openSessionAction,
  registerMovementAction,
  closeSessionAction,
  reclassifyPaymentAction,
  createReasonAction,
  updateReasonAction,
  deactivateReasonAction,
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
}

interface CajaClientProps {
  cashierName: string;
  salePointLabel: string;
  session: CajaSessionDTO | null;
  movimientos: CajaMovimientoDTO[];
  reasons: CajaReasonDTO[];
  isOwner: boolean;
}

/** Valor sentinela para el motivo "Otros" (aclaración libre obligatoria). */
const OTROS_REASON = '__otros__';

const MEDIOS: Record<string, { label: string; color: string }> = {
  efectivo: { label: 'Efectivo', color: '#34c77d' },
  debito: { label: 'Débito', color: '#5b8cff' },
  credito: { label: 'Crédito', color: '#f7984a' },
  tarjeta: { label: 'Tarjeta', color: '#7681a0' },
  mp_qr: { label: 'QR / MercadoPago', color: '#6b5fff' },
  mixto: { label: 'Mixto', color: '#9088ff' },
};

/** Medios elegibles al reclasificar una venta mal cargada (ADR-0026). */
const RECLASS_OPTIONS: Array<{ key: SalePaymentMethod; label: string }> = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'debito', label: 'Débito' },
  { key: 'credito', label: 'Crédito' },
  { key: 'mp_qr', label: 'QR / MP' },
];

// Alivio (withdraw) = extracción a caja fuerte/banco, va APARTE. Retiro/Gasto
// (provider_payment) = egreso de caja con MOTIVO del catálogo. Ingreso = deposit.
const MOV_TYPES: Array<{ key: CashMovementType; label: string; hint: string; tone: 'green' | 'red' }> = [
  { key: 'deposit', label: 'Ingreso', hint: 'Aporte de efectivo a la caja', tone: 'green' },
  { key: 'withdraw', label: 'Alivio', hint: 'Extracción a caja fuerte / banco', tone: 'red' },
  { key: 'provider_payment', label: 'Retiro / Gasto', hint: 'Pago desde caja (con motivo)', tone: 'red' },
];

function money(raw: string): string {
  const n = Math.round(parseFloat(raw || '0'));
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

export function CajaClient({
  cashierName,
  salePointLabel,
  session,
  movimientos,
  reasons,
  isOwner,
}: CajaClientProps) {
  const router = useRouter();
  const [medioFilter, setMedioFilter] = useState<string>('todos');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Formulario abrir caja
  const [openAmount, setOpenAmount] = useState('');

  // Formulario movimiento manual. movType null = ningún form abierto.
  const [movType, setMovType] = useState<CashMovementType | null>(null);
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  // Motivo elegido para Retiro/Gasto (provider_payment): id del catálogo u OTROS.
  const [movReasonId, setMovReasonId] = useState<string | null>(null);

  // Panel de administración de motivos (solo dueño).
  const [managing, setManaging] = useState(false);
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [editReasonId, setEditReasonId] = useState<string | null>(null);
  const [editReasonLabel, setEditReasonLabel] = useState('');

  // Formulario cierre
  const [closing, setClosing] = useState(false);
  const [countedAmount, setCountedAmount] = useState('');
  const [closeReason, setCloseReason] = useState('');

  // Reclasificar medio de una venta (ADR-0026). reclassSaleId = fila abierta.
  const [reclassSaleId, setReclassSaleId] = useState<string | null>(null);
  const [reclassMethod, setReclassMethod] = useState<SalePaymentMethod | null>(null);
  const [reclassReason, setReclassReason] = useState('');

  const totalDia = useMemo(
    () => movimientos.reduce((acc, m) => acc + Math.round(parseFloat(m.total || '0')), 0),
    [movimientos]
  );

  const visibles = useMemo(
    () =>
      medioFilter === 'todos'
        ? movimientos
        : movimientos.filter((m) => (m.method ?? 'sin') === medioFilter),
    [movimientos, medioFilter]
  );

  const filterChips: Array<{ key: string; label: string }> = [
    { key: 'todos', label: 'Todos los medios' },
    { key: 'efectivo', label: 'Efectivo' },
    { key: 'debito', label: 'Débito' },
    { key: 'credito', label: 'Crédito' },
    { key: 'mp_qr', label: 'QR / MP' },
    { key: 'mixto', label: 'Mixto' },
  ];

  async function handleOpen() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const res = await openSessionAction({ initialAmount: openAmount.trim() });
    setBusy(false);
    if (res.ok) {
      setOpenAmount('');
      setFeedback({ tone: 'ok', text: 'Caja abierta.' });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

  /** Reason efectivo según el tipo de movimiento (null = form incompleto). */
  function resolveMovReason(): string | null {
    if (movType === 'provider_payment') {
      // Retiro/Gasto: motivo del catálogo, u "Otros" con aclaración obligatoria.
      if (movReasonId === OTROS_REASON) {
        const t = movReason.trim();
        return t.length > 0 ? t : null;
      }
      const picked = reasons.find((r) => r.id === movReasonId);
      return picked ? picked.label : null;
    }
    if (movType === 'withdraw') {
      // Alivio: nota opcional, default "Alivio de caja".
      return movReason.trim() || 'Alivio de caja';
    }
    // Ingreso: nota obligatoria.
    const t = movReason.trim();
    return t.length > 0 ? t : null;
  }

  async function handleMovement() {
    if (busy || !session || !movType) return;
    const reason = resolveMovReason();
    if (reason === null) return; // form incompleto (motivo/aclaración faltante)
    setBusy(true);
    setFeedback(null);
    const res = await registerMovementAction({
      sessionId: session.id,
      type: movType,
      amount: movAmount.trim(),
      reason,
    });
    setBusy(false);
    if (res.ok) {
      setMovType(null);
      setMovAmount('');
      setMovReason('');
      setMovReasonId(null);
      setFeedback({ tone: 'ok', text: 'Movimiento registrado.' });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

  async function handleCreateReason() {
    if (busy) return;
    const label = newReasonLabel.trim();
    if (label.length === 0) return;
    setBusy(true);
    setFeedback(null);
    const res = await createReasonAction({ label });
    setBusy(false);
    if (res.ok) {
      setNewReasonLabel('');
      setFeedback({ tone: 'ok', text: 'Motivo agregado.' });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

  async function handleRenameReason() {
    if (busy || !editReasonId) return;
    const label = editReasonLabel.trim();
    if (label.length === 0) return;
    setBusy(true);
    setFeedback(null);
    const res = await updateReasonAction({ id: editReasonId, label });
    setBusy(false);
    if (res.ok) {
      setEditReasonId(null);
      setEditReasonLabel('');
      setFeedback({ tone: 'ok', text: 'Motivo renombrado.' });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

  async function handleDeactivateReason(id: string) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const res = await deactivateReasonAction({ id });
    setBusy(false);
    if (res.ok) {
      setFeedback({ tone: 'ok', text: 'Motivo dado de baja.' });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
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
      const d = res.data;
      setClosing(false);
      setCountedAmount('');
      setCloseReason('');
      setFeedback({
        tone: 'ok',
        text: `Caja cerrada. Descuadre: ${money(d.descuadre)} · ${d.severity_label}.`,
      });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

  function openReclass(saleId: string) {
    setReclassSaleId(saleId);
    setReclassMethod(null);
    setReclassReason('');
    setFeedback(null);
  }

  async function handleReclassify() {
    if (busy || !reclassSaleId || !reclassMethod) return;
    setBusy(true);
    setFeedback(null);
    const res = await reclassifyPaymentAction({
      saleId: reclassSaleId,
      newMethod: reclassMethod,
      reason: reclassReason.trim(),
    });
    setBusy(false);
    if (res.ok) {
      const d = res.data;
      setReclassSaleId(null);
      setReclassMethod(null);
      setReclassReason('');
      setFeedback({
        tone: 'ok',
        text: `Medio corregido: ${medioOf(d.from_method).label} → ${medioOf(d.to_method).label}.`,
      });
      router.refresh();
    } else {
      setFeedback({ tone: 'err', text: res.error });
    }
  }

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
        {feedback && (
          <div className={'caja-feedback ' + feedback.tone}>{feedback.text}</div>
        )}

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

        {/* Operaciones de caja (alivios + cierre) — sólo con sesión abierta */}
        {session && (
          <section className="glass ops">
            <div className="ops-head">
              <h2>Operaciones de caja</h2>
              {!closing && (
                <div className="ops-head-actions">
                  {isOwner && (
                    <button
                      className={'btn ghost' + (managing ? ' on' : '')}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setManaging((v) => !v);
                        setEditReasonId(null);
                        setFeedback(null);
                      }}
                    >
                      {managing ? 'Cerrar motivos' : 'Administrar motivos'}
                    </button>
                  )}
                  <button
                    className="btn ghost danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setClosing(true);
                      setMovType(null);
                      setManaging(false);
                      setFeedback(null);
                    }}
                  >
                    Cerrar caja
                  </button>
                </div>
              )}
            </div>

            {/* Panel de administración de motivos (solo dueño) */}
            {isOwner && managing && !closing && (
              <div className="op-form reasons-mgr">
                <div className="op-form-title">Motivos de retiro / gasto</div>
                <p className="op-form-hint">
                  Estos motivos aparecen al registrar un Retiro / Gasto. Solo vos (dueño)
                  podés agregarlos, renombrarlos o darlos de baja.
                </p>
                <ul className="reasons-list">
                  {reasons.length === 0 && (
                    <li className="reasons-empty">No hay motivos. Agregá el primero abajo.</li>
                  )}
                  {reasons.map((r) => (
                    <li key={r.id} className="reason-item">
                      {editReasonId === r.id ? (
                        <>
                          <input
                            className="fld-in"
                            value={editReasonLabel}
                            onChange={(e) => setEditReasonLabel(e.target.value)}
                          />
                          <button className="btn primary sm" type="button" disabled={busy} onClick={handleRenameReason}>
                            Guardar
                          </button>
                          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setEditReasonId(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="reason-label">{r.label}</span>
                          <button
                            className="btn ghost sm"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditReasonId(r.id);
                              setEditReasonLabel(r.label);
                            }}
                          >
                            Renombrar
                          </button>
                          <button
                            className="btn ghost sm danger"
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeactivateReason(r.id)}
                          >
                            Dar de baja
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="reason-add">
                  <input
                    className="fld-in"
                    placeholder="Nuevo motivo (ej: Pago de servicios)"
                    value={newReasonLabel}
                    onChange={(e) => setNewReasonLabel(e.target.value)}
                  />
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

            {closing ? (
              <div className="op-form">
                <div className="op-form-title">Cierre de caja</div>
                <p className="op-form-hint">
                  Contá el efectivo físico en el cajón. El sistema calcula lo esperado
                  (fondo + ventas en efectivo + movimientos) y muestra el descuadre.
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
                        setMovType(movType === t.key ? null : t.key);
                        setMovAmount('');
                        setMovReason('');
                        setMovReasonId(null);
                        setManaging(false);
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
                    <div className="op-form-title">
                      {MOV_TYPES.find((t) => t.key === movType)?.label}
                    </div>
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
                      <div className="fld">
                        <span className="fld-k">Motivo (obligatorio)</span>
                        <div className="reclass-chips">
                          {reasons.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              className={'reclass-chip' + (movReasonId === r.id ? ' on' : '')}
                              disabled={busy}
                              onClick={() => setMovReasonId(r.id)}
                            >
                              {r.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={'reclass-chip' + (movReasonId === OTROS_REASON ? ' on' : '')}
                            disabled={busy}
                            onClick={() => setMovReasonId(OTROS_REASON)}
                          >
                            Otros
                          </button>
                        </div>
                        {movReasonId === OTROS_REASON && (
                          <input
                            className="fld-in reclass-reason"
                            placeholder="Aclará el motivo (obligatorio)"
                            value={movReason}
                            onChange={(e) => setMovReason(e.target.value)}
                          />
                        )}
                      </div>
                    ) : (
                      <label className="fld">
                        <span className="fld-k">
                          {movType === 'withdraw' ? 'Nota (opcional)' : 'Motivo (obligatorio)'}
                        </span>
                        <input
                          className="fld-in"
                          placeholder={
                            movType === 'withdraw'
                              ? 'Alivio de caja'
                              : 'Ej: aporte de cambio a la caja'
                          }
                          value={movReason}
                          onChange={(e) => setMovReason(e.target.value)}
                        />
                      </label>
                    )}

                    <div className="op-actions">
                      <button className="btn ghost" type="button" disabled={busy} onClick={() => setMovType(null)}>
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy || movAmount.trim().length === 0 || resolveMovReason() === null}
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

        {/* Últimos movimientos (ventas del día) */}
        <section className="glass movimientos">
          <div className="mv-head">
            <h2>Últimos movimientos</h2>
            <span className="mv-total">
              {movimientos.length} ventas · {money(String(totalDia))}
            </span>
          </div>

          <div className="mv-filters">
            {filterChips.map((c) => (
              <button
                key={c.key}
                type="button"
                className={'mv-chip' + (medioFilter === c.key ? ' on' : '')}
                onClick={() => setMedioFilter(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {visibles.length === 0 ? (
            <div className="mv-empty">
              {movimientos.length === 0
                ? 'Todavía no hay ventas registradas hoy.'
                : 'Ninguna venta con el medio seleccionado.'}
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
                                onClick={() => (editing ? setReclassSaleId(null) : openReclass(m.id))}
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
                                <div className="reclass-title">
                                  Corregir medio de esta venta
                                </div>
                                <div className="reclass-chips">
                                  {RECLASS_OPTIONS.filter((o) => o.key !== m.method).map(
                                    (o) => (
                                      <button
                                        key={o.key}
                                        type="button"
                                        className={
                                          'reclass-chip' +
                                          (reclassMethod === o.key ? ' on' : '')
                                        }
                                        disabled={busy}
                                        onClick={() => setReclassMethod(o.key)}
                                      >
                                        {o.label}
                                      </button>
                                    )
                                  )}
                                </div>
                                <input
                                  className="fld-in reclass-reason"
                                  placeholder="Motivo (obligatorio): ej. abonó en efectivo, marqué débito"
                                  value={reclassReason}
                                  onChange={(e) => setReclassReason(e.target.value)}
                                />
                                <div className="op-actions">
                                  <button
                                    className="btn ghost"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setReclassSaleId(null)}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    className="btn primary"
                                    type="button"
                                    disabled={busy || !reclassMethod}
                                    onClick={handleReclassify}
                                  >
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
.ops-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.ops-head h2{ margin:0; font-size:16px; font-weight:700; }
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
.ops-head-actions{ display:flex; gap:10px; flex-wrap:wrap; }
.reasons-mgr{ margin-top:0; margin-bottom:14px; }
.reasons-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.reasons-empty{ font-size:12px; color:#7681a0; padding:4px 0; }
.reason-item{ display:flex; align-items:center; gap:8px; padding:8px 10px; background:rgba(255,255,255,0.55);
  border:1px solid rgba(13,20,36,0.07); border-radius:11px; }
.reason-item .fld-in{ flex:1; }
.reason-label{ flex:1; font-size:13px; font-weight:600; color:#1f2a44; }
.reason-add{ display:flex; gap:8px; margin-top:4px; }
.reason-add .fld-in{ flex:1; }
.movimientos{ padding:20px 24px; }
.mv-head{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:14px; }
.mv-head h2{ margin:0; font-size:16px; font-weight:700; }
.mv-total{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12.5px; color:#4a5570; font-weight:600; }
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
.reclass-reason{ max-width:100%; }
`;

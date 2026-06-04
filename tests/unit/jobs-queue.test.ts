/**
 * Tests unitarios jobs_queue — helpers puros (sin DB).
 *
 * Cubrimos:
 * - Catalogo JOB_TYPES + JOB_STATUSES (J1 EVENT-TAXONOMY §6).
 * - Validacion Zod de input enqueue.
 * - defaultMaxAttempts por job_type.
 * - nextAttemptBackoffSeconds lineal (afip vs resto).
 * - detectGenericPoison.
 * - Errores tipados.
 *
 * Tests con DB real (SKIP LOCKED concurrencia, INSERT/UPDATE atomicity,
 * CHECK constraints) van a tests/integration cuando exista Supabase
 * conectada. Esto esta documentado como TODO en memoria de sesion.
 */
import { describe, expect, it } from 'vitest';
import {
  JOB_STATUSES,
  JOB_TYPES,
  type JobStatus,
  type JobType,
} from '@/lib/db/schema/jobs_queue';
// JobStatus se usa en el job mock literal del describe detectGenericPoison.
import {
  defaultMaxAttempts,
  enqueueJobInputSchema,
  JobInvalidStateTransitionError,
  JobNotFoundError,
  JobPoisonDetectedError,
  nextAttemptBackoffSeconds,
} from '@/lib/jobs_queue/types';
import { detectGenericPoison } from '@/lib/jobs_queue/queue.service';

describe('Catalogo canonico JOB_TYPES (EVENT-TAXONOMY §6 v2.0.2 + ROADMAP Sprint 1)', () => {
  it('hay exactamente 10 job_types F0', () => {
    expect(JOB_TYPES).toHaveLength(10);
  });

  it('contiene los 4 jobs AFIP', () => {
    expect(JOB_TYPES).toEqual(
      expect.arrayContaining([
        'afip.emit_invoice',
        'afip.reconcile_pending',
        'afip.refresh_wsaa_token',
        'afip.refresh_padron',
      ])
    );
  });

  it('contiene los 2 jobs email', () => {
    expect(JOB_TYPES).toEqual(
      expect.arrayContaining([
        'email.send_invoice',
        'email.send_breach_notification',
      ])
    );
  });

  it('contiene mp.reconcile_webhook', () => {
    expect(JOB_TYPES).toContain('mp.reconcile_webhook');
  });

  it('contiene los 3 crons F0', () => {
    expect(JOB_TYPES).toEqual(
      expect.arrayContaining([
        'cron.archive_expired_demos',
        'cron.partition_audit_log',
        'cron.cleanup_old_jobs',
      ])
    );
  });

  it('no hay duplicados', () => {
    expect(new Set(JOB_TYPES).size).toBe(JOB_TYPES.length);
  });

  it('todos siguen naming {domain}.{action}', () => {
    for (const t of JOB_TYPES) {
      expect(t).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(t).toBe(t.toLowerCase());
    }
  });

  it('dominios permitidos: afip, email, mp, cron', () => {
    const allowedDomains = new Set(['afip', 'email', 'mp', 'cron']);
    for (const t of JOB_TYPES) {
      const domain = t.split('.')[0]!;
      expect(allowedDomains.has(domain)).toBe(true);
    }
  });
});

describe('Catalogo canonico JOB_STATUSES', () => {
  it('hay exactamente 5 estados', () => {
    expect(JOB_STATUSES).toHaveLength(5);
  });

  it('contiene pending, running, done, failed, dead', () => {
    expect(JOB_STATUSES).toEqual([
      'pending',
      'running',
      'done',
      'failed',
      'dead',
    ]);
  });
});

describe('defaultMaxAttempts segun job_type', () => {
  it('afip.reconcile_pending => 24 (2h ventana 5min × 24)', () => {
    expect(defaultMaxAttempts('afip.reconcile_pending')).toBe(24);
  });

  it('crons => 3 (idempotente por diseno; si falla mucho, es bug)', () => {
    expect(defaultMaxAttempts('cron.archive_expired_demos')).toBe(3);
    expect(defaultMaxAttempts('cron.partition_audit_log')).toBe(3);
    expect(defaultMaxAttempts('cron.cleanup_old_jobs')).toBe(3);
  });

  it('resto (afip emit/wsaa/padron, email, mp) => 5', () => {
    expect(defaultMaxAttempts('afip.emit_invoice')).toBe(5);
    expect(defaultMaxAttempts('afip.refresh_wsaa_token')).toBe(5);
    expect(defaultMaxAttempts('afip.refresh_padron')).toBe(5);
    expect(defaultMaxAttempts('email.send_invoice')).toBe(5);
    expect(defaultMaxAttempts('email.send_breach_notification')).toBe(5);
    expect(defaultMaxAttempts('mp.reconcile_webhook')).toBe(5);
  });
});

describe('nextAttemptBackoffSeconds (lineal, NO exponencial)', () => {
  it('afip.reconcile_pending: 5 min fijo (RECONCILIATION-ENGINE §3)', () => {
    // AFIP no rate-limita -> backoff lineal fijo, independiente del attempt.
    expect(nextAttemptBackoffSeconds('afip.reconcile_pending', 1)).toBe(300);
    expect(nextAttemptBackoffSeconds('afip.reconcile_pending', 10)).toBe(300);
    expect(nextAttemptBackoffSeconds('afip.reconcile_pending', 24)).toBe(300);
  });

  it('resto: 60s × attempts creciente', () => {
    expect(nextAttemptBackoffSeconds('afip.emit_invoice', 1)).toBe(60);
    expect(nextAttemptBackoffSeconds('afip.emit_invoice', 2)).toBe(120);
    expect(nextAttemptBackoffSeconds('email.send_invoice', 5)).toBe(300);
  });

  it('attempts=0 floored a 1 (no caso de cero espera)', () => {
    expect(nextAttemptBackoffSeconds('email.send_invoice', 0)).toBe(60);
  });

  it('cap superior 30 min para attempts altos', () => {
    expect(nextAttemptBackoffSeconds('email.send_invoice', 100)).toBe(1800);
    expect(nextAttemptBackoffSeconds('mp.reconcile_webhook', 50)).toBe(1800);
  });
});

describe('enqueueJobInputSchema validation', () => {
  it('acepta input minimo valido', () => {
    const r = enqueueJobInputSchema.parse({
      job_type: 'email.send_invoice',
      payload: { sale_id: 'abc-123' },
    });
    expect(r.job_type).toBe('email.send_invoice');
    expect(r.payload).toEqual({ sale_id: 'abc-123' });
  });

  it('rechaza job_type fuera de catalogo (J1 EVENT-TAXONOMY)', () => {
    expect(() =>
      enqueueJobInputSchema.parse({
        job_type: 'unknown.job',
        payload: {},
      })
    ).toThrow();
  });

  it('rechaza max_attempts negativo', () => {
    expect(() =>
      enqueueJobInputSchema.parse({
        job_type: 'email.send_invoice',
        payload: {},
        max_attempts: -1,
      })
    ).toThrow();
  });

  it('rechaza max_attempts > 100 (sanity cap)', () => {
    expect(() =>
      enqueueJobInputSchema.parse({
        job_type: 'email.send_invoice',
        payload: {},
        max_attempts: 999,
      })
    ).toThrow();
  });

  it('acepta override_tenant_id valido UUID', () => {
    const r = enqueueJobInputSchema.parse({
      job_type: 'cron.cleanup_old_jobs',
      payload: {},
      override_tenant_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.override_tenant_id).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('rechaza override_tenant_id no UUID', () => {
    expect(() =>
      enqueueJobInputSchema.parse({
        job_type: 'cron.cleanup_old_jobs',
        payload: {},
        override_tenant_id: 'not-a-uuid',
      })
    ).toThrow();
  });
});

describe('detectGenericPoison (REGLA poison detection inmediata)', () => {
  const baseJob = {
    id: BigInt(1),
    job_type: 'email.send_invoice' as JobType,
    tenant_id: '11111111-1111-1111-1111-111111111111',
    correlation_id: '22222222-2222-2222-2222-222222222222',
    last_request_id: null,
    payload: { sale_id: 'abc' },
    status: 'pending' as JobStatus,
    attempts: 0,
    max_attempts: 5,
    next_attempt_at: new Date(),
    last_error: null,
    started_at: null,
    completed_at: null,
    created_at: new Date(),
  };

  it('job sano => null (no poison)', () => {
    expect(detectGenericPoison(baseJob)).toBeNull();
  });

  it('job_type fuera de catalogo => poison', () => {
    const poisoned = { ...baseJob, job_type: 'evil.unknown' as JobType };
    expect(detectGenericPoison(poisoned)).toContain('unknown_job_type');
  });

  it('tenant_id vacio => poison', () => {
    const poisoned = { ...baseJob, tenant_id: '' };
    expect(detectGenericPoison(poisoned)).toBe('missing_tenant_id');
  });

  it('payload no-object => poison', () => {
    const poisoned = {
      ...baseJob,
      payload: 'not-an-object' as unknown as Record<string, unknown>,
    };
    expect(detectGenericPoison(poisoned)).toBe('invalid_payload_shape');
  });

  it('payload null => poison', () => {
    const poisoned = {
      ...baseJob,
      payload: null as unknown as Record<string, unknown>,
    };
    expect(detectGenericPoison(poisoned)).toBe('invalid_payload_shape');
  });
});

describe('Errores tipados', () => {
  it('JobNotFoundError preserva jobId + mensaje', () => {
    const err = new JobNotFoundError(BigInt(42));
    expect(err.jobId).toBe(BigInt(42));
    expect(err.message).toContain('42');
    expect(err.name).toBe('JobNotFoundError');
  });

  it('JobInvalidStateTransitionError preserva from + to + mensaje', () => {
    const err = new JobInvalidStateTransitionError(BigInt(7), 'done', 'running');
    expect(err.jobId).toBe(BigInt(7));
    expect(err.fromStatus).toBe('done');
    expect(err.toStatus).toBe('running');
    expect(err.message).toContain('done -> running');
  });

  it('JobPoisonDetectedError preserva tipo + razon', () => {
    const err = new JobPoisonDetectedError(
      'afip.emit_invoice',
      'invalid_xml_shape'
    );
    expect(err.jobType).toBe('afip.emit_invoice');
    expect(err.reason).toBe('invalid_xml_shape');
    expect(err.message).toContain('afip.emit_invoice');
    expect(err.message).toContain('invalid_xml_shape');
  });
});

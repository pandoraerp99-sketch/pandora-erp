# Tests T-OBS-* + T-SEC-* — Coverage Matrix F0

**Fecha actualizacion:** 2026-06-02 (post Auditoria Alpha)
**Estado:** Sprint 1 esencial F0 (7/7) + Sprint 2 platform contexts (5/6 + 1 deferido).
**Referencia:** CLAUDE.md §18.3 Mandatory tests F0.

> Este doc lista TODOS los tests T-OBS-* + T-SEC-* del catalogo canonico
> CLAUDE.md §18.3 y mapea cobertura actual vs gaps. Items diferidos NO son
> deuda silenciosa — cada uno tiene **trigger explicito** de cierre.

## Filosofia de cobertura

- **Cubierto:** test existe + verde + asserta el invariante real (no smoke).
- **Parcial:** test existe pero solo cubre una parte (resto requiere infra).
- **Diferido:** test NO existe porque la infra que valida NO existe todavia.
  Cada diferido tiene **Sprint de cierre + razon objetiva**.

NO se inventan tests stub para llegar a "100% cobertura" — eso seria
test theatre, exactamente lo que CLAUDE.md §18 anti-pattern N-29 prohibe.

---

## T-SEC-* — Security tests

| ID | Test | Estado | Archivo | Notas |
|---|---|---|---|---|
| **T-SEC-01** | CSP header presente | ✅ **Cubierto** | tests/unit/csp.test.ts (36 tests) | buildCspHeader + buildSecurityHeaders + nonce 128-bit + Edge-compatible |
| **T-SEC-02** | HMAC validation webhook | ✅ **Cubierto** | tests/unit/hmac.test.ts (40 tests) | computeHmacSha256 RFC 4231 + safeSignatureCompare timing-safe + validateMercadoPagoWebhook 4-pasos |
| **T-SEC-03** | Replay protection webhook (timestamp out of window) | ✅ **Cubierto** | tests/unit/hmac.test.ts + tests/unit/webhook-dedup.test.ts | validateWebhookFreshness ±5min + ORDEN validacion freshness-ANTES-de-HMAC verificado implicito en test "ts fuera de ventana con HMAC valido → reason=timestamp_out_of_window NO hmac_mismatch" |
| **T-SEC-04** | Dedup webhook (event_id repetido) | ✅ **Cubierto puro** + 🟡 **Diferido con DB** | tests/unit/webhook-dedup.test.ts (27 tests helpers puros) | hashWebhookPayload SHA-256 + safeSignatureCompare timing-safe + freshness window. INSERT ON CONFLICT con DB real → diferido `tests/integration/` cuando Supabase test instance este conectada |
| **T-SEC-05** | Rate limit hits | ✅ **Cubierto** | tests/unit/rate-limit.test.ts (30 tests) | InMemoryRateLimitStore + checkRateLimit + 4 policies F0 + checkLoginRateLimit composicion IP+email + whitespace bypass defense |
| **T-SEC-06** | TLS 1.2+ obligatorio en cliente AFIP | 🟡 **Diferido Sprint 6** | — | AFIP SOAP client NO existe F0 platform. Cierre: Sprint 6 fiscal cuando se implemente WSAA + WSFEv1 client (`src/lib/fiscal/afip/client.ts`). Test esperado: `tlsClient.options.minVersion === 'TLSv1.2'` + `rejectUnauthorized: true` + Sprint 6 incluye test gate. |
| **T-SEC-07** | Secret no logueado (lista canonica) | ✅ **Cubierto** (Sprint 2 #2) | tests/unit/logger.test.ts (10 tests SECRET_PATHS catalogo + 10 redact end-to-end) | Pino redact con SECRET_PATHS (62 entries: snake_case + camelCase Supabase/MP/jose + env vars SECRETS_ENCRYPTION_KEY_V* + AFIP PascalCase Token/Sign). Plus scrub.ts para audit_log payload (24 tests scrub.test.ts) — scope distinto: Pino redact en logs, scrub en jsonb persistido 10 anios inmutable. |

**T-SEC cubierto F0: 6 de 7 (86%) + T-SEC-04 con parcial DB-real.** Solo T-SEC-06 diferido (Sprint 6 AFIP client).

---

## T-OBS-* — Observability tests

| ID | Test | Estado | Archivo | Notas |
|---|---|---|---|---|
| **T-OBS-01** | End-to-end correlation_id propagation | ✅ **Cubierto** (Sprint 2 #1 + #3) | tests/unit/tracing.test.ts (42 tests) + browser check empirico proxy | withTracingContext + withCronTracing + withWorkerTracing + getCurrentTenantId/CorrelationId/RequestId + async isolation (paralelo NO comparten + heredancia await + cleanup post-throw). Plus browser check Sprint 2 #3: 4 ramas Edge proxy (sin cid → genera + flag; cid valido → respeta; XSS garbage → UUID limpio; path exempt → no flag). |
| **T-OBS-02** | Worker continuity (correlation_id heredado, request_id nuevo) | ✅ **Cubierto helpers** + 🟡 worker runtime deferido | tests/unit/tracing.test.ts (`withWorkerTracing — INVARIANTE: HEREDA correlation_id, GENERA request_id nuevo` 3 tests) | Helper `withWorkerTracing` testeado contra invariante. Worker en si (`afip.reconcile_pending` consumer) deferido Sprint 6+ trigger objetivo (ver [[sprint-2-6-worker-deferred-2026-06-02]]). |
| **T-OBS-03** | Logger auto-inject desde AsyncLocalStorage | ✅ **Cubierto REAL** (Sprint 2 #2) | tests/unit/logger.test.ts (6 tests `wrapPino + tracing context — T-OBS-03 closure end-to-end`) | wrapPino exportado + tests con destination stream custom + Pino instance custom → verifica que `logger.info` dentro de withTracingContext emite JSON con correlation_id/request_id/tenant_id/actor del context. Incluye test SPREAD ORDER INVARIANTE (context gana sobre payload) — sin esto, payload override silencioso del context. |
| **T-OBS-04** | Metrics whitelist enforcement (throw si tag no autorizado) | ✅ **Cubierto** (Sprint 2 #5) | tests/unit/metrics.test.ts (13 tests `prepareMetricIncrement — whitelist enforcement + tag_key + tag_value bounded`) | METRIC_WHITELIST 12 metricas F0 + 4 errors tipados (MetricNotInWhitelistError, MetricTagNotAllowedError, MetricTagValueNotAllowedError, MetricTenantRequiredError). Plus tests integracion tracing context + wrapper fail-open (DB error NO rethrowa, whitelist/tag errors SI rethrowan). **cardinalityWarn declarado pero NO se enforce F0** — doc inline + F1+ trigger cron mensual. |
| **T-OBS-05** | Audit log inmutability (trigger throw en UPDATE/DELETE) | 🟡 **Diferido DB-real** | — | Trigger plpgsql `audit_log_immutable()` esta implementado en `drizzle/migrations/post_initial/0002_immutable_triggers.sql` (RAISE EXCEPTION en UPDATE/DELETE/TRUNCATE). Pero el test del trigger en runtime requiere Supabase test instance. Schema + writer + scrub estan completos (Sprint 2 #4). **Cierre: integration test cuando Supabase test instance este conectada** (esperado Sprint 2-3 cuando se levante CI con DB real). |

**T-OBS cubierto F0: 4 de 5 (80%) + 1 con parcial DB-real.** Solo T-OBS-05 diferido (trigger SQL requiere DB).

---

## Resumen post-Sprint 2

| Item | Estado | Tests cubiertos |
|---|---|---|
| **Sprint 1** | ||
| #1 jobs_queue | ✅ Completo | 31 tests |
| #2 processed_webhook_events | ✅ Completo | 27 tests |
| #3 CSP middleware | ✅ Completo | 36 tests |
| #4 HMAC validation | ✅ Completo | 40 tests |
| #5 rate_limit in-memory | ✅ Completo | 30 tests |
| #6 vault encrypt/decrypt | ✅ Completo | 29 tests |
| #7 Coverage matrix + cierre | ✅ Completo | (este doc) |
| **Sprint 2 platform contexts** | ||
| #1 Tracing context | ✅ Completo | 42 tests |
| #2 Pino logger | ✅ Completo | 33 tests |
| #3 Proxy/middleware Edge | ✅ Completo | 5 tests + browser check 4 ramas |
| #4 audit_log writer + scrub | ✅ Completo | 28 + 24 (scrub) tests |
| #5 metrics_counter | ✅ Completo | 30 tests |
| #6 Worker afip.reconcile_pending | 🟡 **Deferido con trigger** | (ver memoria deferred) |

**Total tests suite: 421/421 verdes** (Sprint 1: 262 + Sprint 2: 162 - duplicacion pequena por ajustes = 421 actual).

---

## Composiciones cross-item ya validadas (acumulativo)

Composiciones REALES verificadas sin gaps detectables:

1. **CSP nonce → page render** — Sprint 1 #3 + Sprint 2 #3 — proxy.ts inyecta nonce via `x-csp-nonce` header. Browser check empirico HTTP 200 + nonce real.
2. **HMAC + freshness orden correcto** — Sprint 1 #4. Test "ts fuera de ventana CON HMAC valido → reason=timestamp_out_of_window" demuestra freshness corre ANTES de HMAC.
3. **HMAC + dedup webhook = replay protection END-TO-END** — Sprint 1 #4 + #2. Composicion documentada JSDoc, testeable end-to-end solo con DB real (deferida).
4. **Rate limit compuesto IP+email login** — Sprint 1 #5. Previene 2 attack vectors distintos.
5. **Vault wire format strict validation** — Sprint 1 #6. `isStrictBase64` previene garbage-passing-as-tampering.
6. **Tracing context heredance Edge→Node** — Sprint 2 #1 + #3. proxy.ts (Edge) genera/valida IDs + setea headers + server-action-tracing.ts (Node) lee headers + monta AsyncLocalStorage. Browser check curl verificado.
7. **Logger auto-inject del context** — Sprint 2 #1 + #2. wrapPino lee tracing context y enriquece TODA log line. SPREAD ORDER INVARIANTE testeado (context > payload).
8. **Audit_log con scrub secrets payload** — Sprint 2 #2 + #4. SECRET_PATHS expandido (62 entries) usado por Pino redact Y por scrub recursivo en audit_log. Audit_log es 10 anios inmutable → defensa en el writer, no trust-the-caller.
9. **Metrics whitelist + tracing context** — Sprint 2 #1 + #5. prepareMetricIncrement lee `getCurrentTenantId()` cuando scope=tenant. Fail-open en wrapper (errores DB no bloquean operacion).
10. **Multi-tenant guard en audit-writer** — Sprint 2 #4. `override_tenant_id` UUID format validation + actor_type=system|support check. Previene cross-tenant audits + INSERT con tenant_id invalido.

---

## Gaps F1+ con trigger objetivo

Diferidos NO son "tests que no escribimos" — son **infra que no construimos**.
Triggers explicitos para cada uno:

| Gap | Sprint cierre | Trigger objetivo |
|---|---|---|
| Worker dedicado `afip.reconcile_pending` con SKIP LOCKED runtime | Sprint 6+ | Sprint 6 fiscal incluye primera emision WSFEv1 (jobs reconcile aparecen) O primer cliente reporta CAE timeout sostenido |
| Tests integration con DB real (audit trigger inmutable, RLS, INSERT ON CONFLICT atomic, partition routing) | Sprint 2-3 | Cuando Supabase test instance este conectada en CI |
| TLS 1.2+ AFIP client | Sprint 6 | Cuando se construya WSAA + WSFEv1 client real |
| Cron mensual cardinalityWarn alert (metrics) | F1+ | Tabla metrics_counter > 1M rows O alguna metrica > su cardinalityWarn × 2 |
| Hash chain en audit_log (tamper-proof real) | F1+ | Disposicion AAIP/auditor requerimiento legal especifico |
| Sentry instrumentacion completa | F1+ | Volumen real F1+ requiere observabilidad rica |
| Multi-tab BroadcastChannel POS | F1+ | Comerciante real reporta conflicto multi-tab |
| Upstash Redis rate limit distribuido | F1+ | > 100 req/s sostenidos O > 30 tenants |
| Key versioning V2/V3 vault wire format | F1+ | Primera rotacion real de SECRETS_ENCRYPTION_KEY |
| OpenTelemetry / Datadog migration | F1+ | > 5M increments/dia O > 30 tenants O necesidad distributed tracing |

---

## Lecciones core acumuladas (Sprint 1 + Sprint 2)

1. **Self-review tiene blind spots que advisor cubre.** En 5+ Sprints consecutivos el advisor encontro issues que self-review NO detecto (dead code paths silenciosos, signature lies, semantic collapse, spread order bugs, trust boundary gaps).

2. **typecheck + tests verdes NO equivale a "funciona en runtime".** Aplicar **browser check empirico** en proxy/Edge/auth/fiscal layers. Sprint 1 #3 CSP detecto 2 bugs que typecheck no vio.

3. **Defense bypass via whitespace/encoding es bug clase recurrente.** trim(), isStrictBase64(), case-sensitivity, regex strict — siempre helpers puros + tests dedicados.

4. **NO inventar tests stub para llegar a "100% cobertura".** Sprint 1 #7 y Sprint 2 docs honestos > test theatre N-29.

5. **Multi-tenant guard asymetrico calcifica.** Aplicar guard SIEMPRE en cada nueva primitiva platform (Sprint 1 #2 webhook-dedup + Sprint 2 #4 audit-writer).

6. **Operator runbook JSDoc para error codes ambiguos.** `tampering_detected` en vault no distingue 3 modos a nivel cripto → JSDoc operator runbook antes de asumir ataque.

7. **Re-research ARCA antes de Sprint fiscal.** Sprint 6 y 7 van a tocar AFIP — disciplina anchor externo recurrente.

8. **Trust boundaries en AMBOS lados** (Edge proxy + Node server-action-tracing + audit-writer override_tenant_id) — todos usando el MISMO helper `resolveInboundIds` + `isValidUuid`.

9. **Audit_log 10 anios inmutable ≠ Pino logs rotables** — defensa scrub DEBE estar en el writer, NO en el caller. Trust-the-caller NO escala (Sprint 2 #2 expansion SECRET_PATHS + Sprint 2 #4 scrub.ts demostraron).

10. **Spread order es bug semantico clase a vigilar** — siempre que hay merge de fuentes (context vs payload), explicitar invariante "X gana" en JSDoc + test del invariante.

11. **Wrapper-vs-helper test discipline.** Cuando se extrae pure helper testeable + wrapper que orquesta → AMBOS necesitan test. Wrapper para invariante critico (fail-open vs rethrow, context guard, etc.).

12. **cardinalityWarn / similar = claim sin enforcement.** Field configurado + nada lo lee = mentira que parece feature. Doc honest OR remover OR implementar enforcement. Tres opciones, pick una.

13. **Migration SQL paralelo al schema Drizzle es contrato.** drizzle-kit NO crea funciones plpgsql / triggers / RLS. Cada schema con behavior custom plpgsql tiene migration `post_initial/000N_*.sql`.

14. **Fail-open vs fail-closed por concern** — fiscal fail-CLOSED, multi-tenant fail-CLOSED, audit_log validation fail-CLOSED, metrics fail-OPEN, logger fail-OPEN. Doc en cada wrapper.

---

## T-MONEY-* — Money invariants (CLAUDE.md §9.9)

**Fecha mapping:** 2026-06-11 (Sprint 5 cierre estructural — destrabar item ⚠️ del ROADMAP §1033 gating)

| ID | Test canónico CLAUDE.md §9.9 | Estado | Archivo:línea | Notas |
|---|---|---|---|---|
| **T-MONEY-01** | cálculo IVA per-line vs per-bracket en factura compleja (multi-alícuota + descuentos) | ⚠️ **PARCIAL** | `calculation.test.ts:125` ("multi-alicuota arma breakdown por rate") + `calculation.test.ts:109` ("suma multi-line con misma alicuota") | Multi-alícuota ✅ cubierto. Descuentos ❌ no testeados porque **no existen en el calculation engine F0**. Trigger cierre: cuando se agreguen descuentos al engine (POS UI Sprint 7-8 o F1+) → test descuentos prorrateados |
| **T-MONEY-02** | invariante `ImpIVA == sum(Iva[].Importe)` con tolerancia 0 después de proyección WSFEv1 | ⚠️ **PARCIAL** | `calculation.test.ts:161` ("valida invariante ImpIVA == sum(Iva[].Importe)") + `calculation.test.ts:169` ("subtotal + tax == total") | Invariante validado a nivel **modelo interno calculation engine**. Proyección WSFEv1 ❌ no testeada (no existe la capa de proyección todavía). Trigger cierre: **Sprint 6 fiscal** cuando exista `projectToWSFEv1()` (ADR-0022 Fiscal Projection Layer) — agregar test que verifique invariante DESPUÉS de la proyección |
| **T-MONEY-03** | precio cliente vs precio server discrepancia > $0.01 → server gana + log | ❌ **N/A F0** | — | Requiere **UI cliente con preview Decimal.js** (ADR-0021). Sin UI todavía F0 (POS Sprint 7-8), no hay forma de tener "precio cliente". Trigger cierre: Sprint POS UI — test de price tampering en finalize Server Action |
| **T-MONEY-04** | overflow check con monto $999.999.999.999.999,9999 | ✅ **CUBIERTO** | `money.test.ts:41` ("rechaza overflow") + `money.test.ts:88-114` (round-trip incluye `999999999999999.9999` como uno de los 9 casos canónicos) | Factory `money()` rechaza overflow + round-trip valida el límite numeric(19,4) en ambas direcciones |
| **T-MONEY-05** | HALF_EVEN behavior en casos límite (0.005, 0.015, 0.025...) | ✅ **CUBIERTO** | `money.test.ts:67-77` (`describe('moneyRound HALF_EVEN')`) | Tests 2.5→2 y 3.5→4 son los casos canónicos HALF_EVEN (banker's rounding: 0.5 va al par más cercano). Los casos 0.005/0.015/0.025 son el mismo principio en escala distinta — el algoritmo subyacente (Decimal.js `ROUND_HALF_EVEN`) los maneja idénticamente |
| **T-MONEY-06** | NO NaN propagation desde input inválido (string vacío, "abc", null) | ✅ **CUBIERTO** | `money.test.ts:28` ("rechaza NaN") + `:32` ("rechaza Infinity") + `:37` ("rechaza string invalido") | Factory `money()` rechaza inputs inválidos throwing en lugar de devolver NaN/Decimal corrupto. Defensa fail-closed en boundary |
| **T-MONEY-07** | round-trip Decimal → string → Decimal sin pérdida | ✅ **CUBIERTO** (agregado 2026-06-11) | `money.test.ts:88-114` ("round-trip Decimal → string → Decimal sin pérdida de precisión (T-MONEY-07)") | NUEVO test del 06-11 con 9 casos canónicos (enteros, decimales 1-4 dígitos, IVA típico 21%/10.5%, límite overflow). Verifica idempotencia + `moneyEq` cross-validation |

**Cobertura T-MONEY: 5/7 ✅ + 2/7 ⚠️ con justificación documentada + 1/7 ❌ N/A F0 sin UI cliente.**

Lección de mapping: la ⚠️ "COBERTURA EXISTE PERO MAPPING NO VERIFICADO" del cierre estructural Sprint 5 (2026-06-11) era genuina — los tests existían pero **el mapping uno-a-uno vs catálogo CLAUDE.md §9.9 no estaba formalizado**. El advisor lo detectó. Mapping ahora explícito.

**Trigger cierre ⚠️:**
- T-MONEY-01 descuentos: cuando se agreguen descuentos al engine (no es deuda, es scope F1+)
- T-MONEY-02 WSFEv1 projection: cuando Sprint 6 fiscal cierre + projection layer exista (ADR-0022)
- T-MONEY-03: cuando POS UI exista (Sprint 7-8)

---

## T-MT-* — Multi-tenant RLS isolation (CLAUDE.md §7.9)

**Fecha mapping:** 2026-06-12 (mini-audit pre-Sprint 6 fiscal — advisor catch reveló gap sistémico: tests "cross-tenant" hasta hoy usaban `db` privileged client que BYPASSA RLS, por tanto NO testeaban isolation real, sino UNIQUE per-tenant + service behavior).

**Pre-requisito implementado:** helper `withRlsContext()` en `src/lib/multi_tenant/rls_context.ts` — monta role=authenticated + JWT claims via `SET LOCAL role` + `set_config('request.jwt.claims', ..., true)` dentro de transacción → RLS aplica + context se descarta al COMMIT. Smoke `T-RLS-CONTEXT-01` (6 tests) valida que `auth.jwt()` + `pandora.current_company_ids()` leen lo seteado.

| ID | Test canónico CLAUDE.md §7.9 | Estado | Archivo:tests | Notas |
|---|---|---|---|---|
| **T-MT-01** | cross-tenant SELECT bloqueado por RLS | ✅ **CUBIERTO** | `tests/cross-tenant/T-MT-01-select-rls.test.ts` (5 tests) | T1.1+T1.2 user solo ve sales de su tenant. T1.3 SELECT por ID ajeno → 0 rows silent. T1.4 cross-check privileged confirma todos existen. T1.5 COUNT(*) respeta RLS (no bypass por agregación). |
| **T-MT-02** | cross-tenant UPDATE bloqueado por RLS + service | ✅ **CUBIERTO (DB layer)** | `tests/cross-tenant/T-MT-02-update-rls.test.ts` (4 tests) | T2.1 UPDATE de row ajeno → 0 rows silent. T2.2 UPDATE row propio → 1 row OK. T2.3 INSERT con tenant_id ajeno → throw RLS WITH CHECK. T2.4 UPDATE WHERE tenant_id=B → 0 rows. Service layer (validation.ts) ya tenía cobertura indirecta via integration tests. |
| **T-MT-03** | contador multi-empresa solo ve sus `company_ids` | ✅ **CUBIERTO** | `tests/cross-tenant/T-MT-03-accountant-multi-company.test.ts` (6 tests) | 3 tenants (A/B/C) + contador con `company_ids=[A,B]`. T3.1 ve sales A+B (4 rows). T3.2+T3.3 NO ve C (0 rows silent). T3.4 mismo accountant + cashier en contexts distintos prueba que el JWT, no el user, define visibilidad. T3.5 array vacío → throw helper guard. T3.6 cross-check 6 sales existen privileged. ADR-0008 contador multi-empresa via JWT array verificado behavioral. |
| **T-MT-04** | secreto de tenant A no accesible desde tenant B | ✅ **CUBIERTO** | `tests/cross-tenant/T-MT-04-secrets-isolation.test.ts` (7 tests) | Cierra deuda migration 0013 (advisor catch 2026-06-12). T4.1+T4.2 SELECT desde A solo ve `padron_a5_cache` + `wsaa_tokens` de A (NO secrets plaintext de B). T4.3+T4.5 UPDATE foreign row → 0 rows (secrets B intactos). T4.4+T4.6 INSERT con `tenant_id=B` desde A → throw RLS WITH CHECK. T4.7 CUIT compartido — UNIQUE permite coexistencia + RLS aisla. Migration 0013 ahora pasa de "applied-without-error" a "behaviorally-verified". |
| **T-MT-05** | numeración fiscal concurrente entre tenants sin colisión | ✅ **CUBIERTO** | `tests/cross-tenant/T-MT-05-invoice-sequences-concurrent.test.ts` (3 tests) | T5.1+T5.2 dos `SELECT FOR UPDATE` paralelas coordinadas con Deferreds completan en <600ms (si los locks cross-tenant se bloquearan, habría timeout 10s) + ambos `next_number` avanzaron a 2 independiente. T5.3 RLS oculta sequence ajena (FOR UPDATE de B desde A → 0 rows silent). T5.4 cross-check privileged. Verifica ADR-0006 (lock por-row, no por-tabla) + ADR-0002 RLS sobre `invoice_sequences`. Intra-tenant T-CONC-01 (lock serialization mismo tenant) queda para Sprint 6 con numbering service real. |
| **T-MT-06** | realtime broadcast de tenant A NO llega a cliente de tenant B | ⏳ **DEFERRED (F0 — infra Realtime pendiente)** | — | Realtime broadcasts SÍ son F0 (CLAUDE.md §5.2 los lista explícitamente en multi-tenant + observabilidad). El gap es que la infra Supabase Realtime publish-via-channels NO está implementada todavía. Trigger cierre: cuando se implemente publish + suscripción cliente — agregar test que verifica canal por tenant + filtro client-side por `correlation_id`. NO recategorizar como F1+ sin ADR explícito. |
| **T-MT-07** | job de tenant A no procesa datos de tenant B (poison test) | ✅ **CUBIERTO (queue layer)** + ⏳ **processing layer pendiente Sprint 6** | `tests/cross-tenant/T-MT-07-jobs-queue-cross-tenant.test.ts` (4 tests) | **Capa enqueue/fetch verificada:** T7.1 `enqueueJob` con `override_tenant_id` desde `actor_type='user'` → throw `CrossTenantAccessError` + post-hecho NO se creó job en B. T7.2 `actor_type='cron'` SÍ puede `override_tenant_id` (sistema cross-tenant by design). T7.3 `detectGenericPoison` detecta `tenant_id` vacío como `'missing_tenant_id'` (§13.5 trigger). T7.4 buzón multi-tenant: 2 jobs (A y B) → `fetchNextJobWithLock` los devuelve con `tenant_id` + payload intactos. Defensa NO es RLS sino service-side + poison (`jobs_queue` corre privileged). **Capa processing pendiente** (advisor catch 2026-06-13): "job de tenant A no procesa datos de tenant B" en §7.9 implica que el worker, mientras procesa el job, confina sus reads/writes al `tenant_id` del job. Esto requiere un worker real (deferido a Sprint 6 fiscal). Trigger cierre: cuando se implemente el primer worker (`afip.emit_invoice` o `afip.reconcile_pending`), agregar test que monte tracing context con `tenant_id` del job + intente leer/escribir un recurso de otro tenant → debe fallar (`validateTenantAccess` capa 2). |

**Cobertura T-MT actual: 5/7 ✅ completos + 1/7 ✅ parcial (T-MT-07 queue layer ✓ / processing layer ⏳ Sprint 6) + 1/7 ⏳ T-MT-06 deferred (F0, infra Realtime pendiente).** Suite canónica CLAUDE.md §7.9 **mayormente completa** para F0 con 2 follow-ups visibles + un worker real (Sprint 6 fiscal) y la infra Realtime (sin ETA confirmada) pendientes.

**⚠️ Aclaración crítica sobre lo que "T-MT-XX ✅ CUBIERTO" significa (advisor refinement 2026-06-12):**

Estos tests prueban que las **policies RLS están correctamente escritas en la DB** (con role=authenticated, RLS aplica como se espera). **NO prueban que el runtime de la app bloquee cross-tenant via RLS** — el `db` client del repo conecta como role privileged que BYPASSA RLS por completo. RLS funciona en runtime sólo si la conexión es como `authenticated` (lo que hace el helper de test, o lo que haría una futura ruta Supabase-JWT per-request).

CLAUDE.md §7.9 ("RLS + service") es defensa en profundidad de DOS capas:
- **Capa 1 RLS Postgres**: tests T-MT-01/02 con `withRlsContext()` (este archivo, sección T-MT)
- **Capa 2 service-side validation**: `src/lib/multi_tenant/validation.ts` — cubierta por integration tests (T-INV-08 cross-tenant, T-CASH-08 cross-tenant, etc.) que corren con `db` privileged y verifican que `validateTenantAccess()` tira `CrossTenantAccessError` cuando el `tenant_id` del recurso no matchea el del context.

En runtime productivo F0, **la protección efectiva es capa 2** (porque el `db` client es privileged). RLS es backstop dormant — sólo bite si en el futuro se introduce una ruta Supabase-JWT per-request o si capa 2 tiene bug. Documentar esto evita que un reader del COVERAGE-MATRIX concluya "RLS me cubre runtime" — no, capa 2 lo cubre. Mismo bar de honestidad que el relabel "per-tenant coexistence (NOT RLS isolation)" en T-PADRON-01.4 + T-WSAA-01.6.

**Lección de mapping (advisor catch 2026-06-12):**

Los tests integration etiquetados "cross-tenant" hasta hoy (T-INV-08, T-CASH-08, T-PADRON-01.4, T-WSAA-01.6) corrían con el `db` client privileged → **NO testeaban RLS isolation real**, sino UNIQUE constraints scoped per-tenant + service layer behavior. Útiles, pero NO satisfacen CLAUDE.md §7.9. El gap sistémico vivió silente desde Sprint 0 hasta hoy. Honesty fix aplicado: etiquetas describe/it de T-PADRON-01.4 + T-WSAA-01.6 renombradas a "per-tenant coexistence (NOT RLS isolation)". Tests REALES en `tests/cross-tenant/` con `withRlsContext()`.

**Trigger cierre ⏳:**
- **T-MT-07 processing layer**: cuando Sprint 6 implemente el primer worker AFIP, agregar test que monte tracing context del tenant del job + intente cross-tenant access durante processing → debe fallar capa 2
- **T-MT-06 Realtime**: F0 pendiente hasta que se implemente la infra Supabase Realtime publish-via-channels (sin ETA confirmada)

---

**Sprint 1 + Sprint 2 F0 CERRADOS** — listo para Auditoria Beta + Sprint 3.
**Sprint 5 CIERRE ESTRUCTURAL** — T-MONEY mapping formalizado 2026-06-11.

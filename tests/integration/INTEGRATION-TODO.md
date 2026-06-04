# Integration tests pendientes — DB real requerida

> **Estado:** sin Supabase test instance F0. Tests con DB real (concurrencia,
> RLS, triggers SQL, CHECK constraints, partial unique indexes) se difieren
> a `tests/integration/` cuando se monte la instancia.
>
> **Bloqueante:** spike Postgres local o Supabase project dedicado test.
> Decisión arquitectónica abierta (ver master audit P2 — setup técnico).

---

## Sprint 3 ROADMAP Inventory — diferidos

### T-INV-04 — SELECT FOR UPDATE oversell concurrente
**Por qué crítico:** es el motivo de existir de `recordStockMovement`. Sin
verificación con DB real, "oversell prevention" es un claim no probado.

```
1. Crear producto con stock_current=1.0000, stock_tracking_enabled=true
2. Abrir transacción T1 + transacción T2 (mismo product_id)
3. T1: recordStockMovement(type='sale', qty=1, related_sale_id=A, skip_audit)
4. T2: recordStockMovement(type='sale', qty=1, related_sale_id=B, skip_audit)
5. Esperar resolución
6. Assert: exactamente 1 succeeds, 1 throws OversellError
7. Assert: products.stock_current = 0.0000 (no negativo)
8. Assert: stock_movements tiene exactamente 1 row para ese product_id
```

### T-INV-05 — Trigger immutable stock_movements
**Por qué crítico:** valida que migration 0005 funciona. Sin esto, alguien
podría UPDATE o DELETE manualmente y romper auditabilidad.

```
1. INSERT row en stock_movements (vía recordStockMovement adjustment)
2. UPDATE row.reason = 'tampered' → assert throw con ERRCODE check_violation
3. DELETE row → assert throw idem
4. TRUNCATE stock_movements → assert throw idem
5. Assert mensaje incluye 'INSERT-only' + 'movimiento inverso'
```

### T-INV-06 — CHECK constraints SQL
**Por qué crítico:** defense-in-depth. Si service tiene bug, DB rechaza.

```
1. INSERT directo a stock_movements bypassing service:
   - type='cucharada' (fuera del catálogo) → throw type_check
   - qty=0 → throw qty_positive_check
   - qty=-1 → throw qty_positive_check
   - type='adjustment' + reason=NULL → throw adjustment_reason_check
   - type='adjustment' + reason='' → throw adjustment_reason_check
   - type='sale' + related_sale_id=NULL → throw sale_requires_related_check
   - related_sale_id + related_purchase_id ambos seteados → throw related_exclusive_check
```

### T-INV-07 — Multi-tenant RLS cross-tenant
**Por qué crítico:** invariante absoluta CLAUDE.md §7.

```
1. Crear tenant A + tenant B
2. Crear producto P en tenant A
3. Loguear como tenant B
4. recordStockMovement(product_id=P) → throw ProductNotFoundForMovementError
   (RLS o service-side filter — ambos válidos)
5. SELECT directo desde Drizzle con tenant_id=B + product_id=P → 0 rows
```

### T-INV-08 — pg_trgm index efectividad
**Por qué crítico:** gating P95 < 100ms con 10k productos del ROADMAP.

```
1. Seed 10k productos con nombres realistas (Faker AR)
2. Ejecutar 100 queries typeahead variadas (prefijos + fuzzy)
3. Assert P95 < 100ms
4. Assert EXPLAIN ANALYZE muestra "Bitmap Index Scan on idx_products_name_trgm"
   (no Seq Scan)
```

---

## Decisión arquitectónica pendiente

**¿Postgres local docker vs Supabase test project?**
- Local docker: rápido, sin costo, requiere setup .env separado, RLS sin
  Auth real (mock o disable)
- Supabase test project: realista (incluye Auth flow), costo mensual extra,
  más lento por network

**Próximo trigger para resolver:** Sprint 6 fiscal (necesita probar
emisión WSFEv1 contra DB real con numeración SELECT FOR UPDATE + Padrón
A5 cache).

---

## Sprint 4 ROADMAP Cash — DIFERIDOS a próxima sesión con Docker

**Estado código:** Sprint 4 implementado completo (schema + migration + sessions + movements + queries + barrel) con **72 unit tests verdes**. Total proyecto: **627/627 unit verde** (+72 cash respecto baseline 552).

**Bloqueante para correr integration:** Docker Desktop tuvo procesos zombies que requieren reinicio Windows. Diferido a la próxima sesión cuando Docker arranque limpio (Sprint 5 Sales también necesita Docker → aprovechar misma ventana).

### T-CASH-01 — UNIQUE partial concurrent (CRÍTICO — el motivo de existir del schema)

```
1. Setup: 2 tenants distintos + 2 users
2. Tenant A abre session (sale_point=1, initial=1000) → OK
3. Tenant A intenta abrir SEGUNDA session mismo (sale_point=1)
   → throw ActiveSessionAlreadyOpenError (ERRCODE 23505 → tipado en service)
4. Tenant A cierra primera + abre nueva → OK (closed_at != NULL no entra al partial index)
5. Tenant A abre session sale_point=2 → OK (distinct sale_point)
6. Tenant B abre session sale_point=1 → OK (distinct tenant)
```

### T-CONC-02 — Apertura concurrente (validación core de la UNIQUE partial)

```
1. 2 promises paralelas openCashSession({sale_point: 1, ...}) mismo tenant
2. Promise.allSettled
3. Assert: exactamente 1 resolved + 1 rejected con ActiveSessionAlreadyOpenError
4. Assert: solo 1 row en cash_sessions con (tenant, sale_point=1, closed_at IS NULL)
```

### T-CASH-02 — Cierre con descuadre > umbral $5000 → audit warning + métrica

```
1. Setup: session abierta con initial=10000
2. closeCashSession(counted=4000, expected=10000, reason="caja olvidada abierta noche")
3. Assert: cash_sessions.descuadre = '-6000.0000'
4. Assert: cash_sessions.discrepancy_reason = "caja olvidada abierta noche"
5. Assert: audit_log tiene event 'cash_session.closed_with_difference' severity 'warning'
6. Assert: payload incluye severity_label='high' (descuadre abs > $5000)
7. Assert: metrics_counter incrementado con metric='cash_session.diff.amount' tag sign='negative'
```

### T-CASH-03 — Cierre limpio descuadre=0 → audit info + métrica zero

```
1. closeCashSession(counted=expected=10000) sin reason
2. Assert: cash_sessions.descuadre = '0.0000', discrepancy_reason = NULL
3. Assert: audit_log event 'cash_session.closed' severity 'info'
4. Assert: metrics tag sign='zero'
```

### T-CASH-04 — Movimiento manual sin reason → throw + CHECK constraint defense

```
1. Test service-level: registerCashMovement con reason='' → throw MovementValidationError
2. Test DB-level (bypass service): SQL raw INSERT con reason='' → throw check_violation
   verifica defense layered DB capa 1
```

### Bonus tests Cash (no listados en ROADMAP pero valen):

- **T-CASH-05** Trigger immutable cash_sessions post-close:
  - Session abierta + cerrar OK
  - Intento UPDATE descuadre directo → throw check_violation
  - Intento DELETE session cerrada → throw idem
  - UPDATE de session ABIERTA (transición close) → OK

- **T-CASH-06** Trigger immutable cash_movements (mismo patrón T-INV-05):
  - INSERT OK, UPDATE/DELETE/TRUNCATE throw check_violation
  - INSERT inverso (withdraw → deposit) sigue funcionando

- **T-CASH-07** CHECK constraints SQL bypass-service:
  - sale_point=0, initial_amount=-1, closed_consistency, discrepancy_reason_required
  - cash_movements type fuera enum, amount<=0, reason empty

- **T-CASH-08** getCashSessionSummary con movimientos agregados + cross-tenant

- **T-CASH-09** Schema verification smoke test (tables + CHECK constraints + UNIQUE partial + triggers + FKs)

**Estimación implementación:** 5 archivos test, ~3-4 horas total con Docker activo.

**Prioridad:** alta. T-CASH-01 + T-CONC-02 son el motivo de existir del schema cash_sessions. Sin verificación empírica, "1 session abierta por tenant + sale_point" es un claim no probado, mismo patrón Spike A1 reveló.

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

# Migraciones Drizzle

## Estructura

```
drizzle/migrations/
├── 0000_*.sql              ← generadas por `pnpm db:generate` (drizzle-kit)
├── meta/                   ← snapshots Drizzle
└── post_initial/           ← migraciones custom que NO genera drizzle-kit
    ├── 0001_partition_audit_log.sql
    ├── 0002_immutable_triggers.sql
    ├── 0003_rls_policies.sql
    └── 0004_helpers_y_indexes.sql
```

## Proceso

### 1. Generar migracion inicial Drizzle

```bash
pnpm db:generate
```

Drizzle-kit lee `src/lib/db/schema/index.ts` y genera `drizzle/migrations/0000_<slug>.sql`.

### 2. Aplicar migracion inicial

```bash
pnpm db:migrate
```

### 3. Aplicar migraciones custom post_initial/

Estas NO las maneja drizzle-kit. Aplicar manualmente via:

```bash
psql $DATABASE_URL -f drizzle/migrations/post_initial/0001_partition_audit_log.sql
psql $DATABASE_URL -f drizzle/migrations/post_initial/0002_immutable_triggers.sql
psql $DATABASE_URL -f drizzle/migrations/post_initial/0003_rls_policies.sql
psql $DATABASE_URL -f drizzle/migrations/post_initial/0004_helpers_y_indexes.sql
```

O via Supabase Studio > SQL Editor.

## Por que migraciones custom

Drizzle-kit NO soporta nativamente:

- **PARTITION BY** (audit_log debe ser particionada por anio per CLAUDE.md §10.2)
- **RLS policies** complejas con `auth.jwt() ->> 'company_id'`
- **Triggers** plpgsql anti-UPDATE/DELETE (ADR sobre inmutabilidad)
- **Particiones futuras** (cron de diciembre crea proxima)

Por eso las dejamos en `post_initial/` como SQL puro mantenido a mano.

## Reglas

1. **NUNCA** modificar migraciones ya aplicadas en produccion.
2. Si se necesita rollback de schema, crear migracion forward con DROP/ALTER explicito.
3. `audit_log` y `fiscal_snapshots` son **append-only** — NO crear migraciones con UPDATE/DELETE sobre ellas.
4. RLS policies se agregan/modifican via migracion custom + actualizar AUTHORITY-MAP.md si cambia autoridad de recurso.

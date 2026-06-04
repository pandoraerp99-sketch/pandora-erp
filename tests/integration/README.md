# Tests integration — Supabase Local CLI

> **Decisión arquitectónica 2026-06-03:** Owner eligió Supabase Local CLI vs
> cloud dev project para evitar dependencia de internet (importante en TDF) +
> velocidad de tests + costo cero. Producción sigue siendo Supabase managed
> (ADR-0001) — el local es solo para tests/desarrollo.

## Setup primera vez

### Requisitos

- Docker Desktop o Docker Engine corriendo (verificá con `docker info`)
- Node 22 + pnpm 11 (ya en `package.json`)
- Supabase CLI (instalado como devDependency en este proyecto)

### Pasos

```bash
# 1. Levantar stack Supabase local (Postgres + Auth + Storage + Realtime + Studio).
#    Primera vez: ~5-10 min descargando ~1.5GB en imágenes Docker.
#    Siguientes veces: ~30s arranque.
pnpm exec supabase start

# 2. Setup vars de tests.
cp .env.test.example .env.test
# (el archivo ya viene con defaults Supabase Local CLI — no requiere edición)

# 3. Aplicar TODAS las migrations contra la DB local.
export $(grep -v '^#' .env.test | xargs)
./scripts/db-apply-all.sh

# 4. Correr smoke test integration.
pnpm test:integration tests/integration/smoke-integration.test.ts
```

Si el smoke pasa: stack listo. Si no: ver troubleshooting más abajo.

## Uso día a día

```bash
# Levantar stack (necesario una vez por sesión de trabajo).
pnpm exec supabase start

# Correr suite integration completa.
pnpm test:integration

# Solo un archivo o pattern.
pnpm test:integration inventory
pnpm test:integration tests/integration/T-INV-04.test.ts

# Bajar stack al terminar (libera RAM Docker).
pnpm exec supabase stop
```

## URLs del stack local

| Servicio | URL | Credenciales |
|---|---|---|
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | postgres/postgres |
| API REST | `http://127.0.0.1:54321` | anon/service_role keys default (en `.env.test.example`) |
| Studio (UI) | `http://127.0.0.1:54323` | sin auth |
| Inbucket (emails captured) | `http://127.0.0.1:54324` | sin auth |

## Cambio de compu

Si cambias de máquina:

1. `git clone <repo>` + `pnpm install`
2. `pnpm exec supabase start` (descarga imágenes la primera vez)
3. `cp .env.test.example .env.test`
4. `./scripts/db-apply-all.sh`

Total: 10-15 min en conexión TDF normal. **Cero dato perdido** — los datos
productivos viven en Supabase managed cloud (AWS), no en local.

## Reset / cleanup

```bash
# Reset DB local (drop schema + reaplicar migrations).
pnpm exec supabase db reset

# O manual:
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
./scripts/db-apply-all.sh

# Stop + remove containers + volumes.
pnpm exec supabase stop --no-backup
```

## Troubleshooting

### `supabase start` no termina o falla

```bash
# Ver logs detallados.
pnpm exec supabase status
docker ps --filter "label=com.supabase.cli.project"

# Reset completo:
pnpm exec supabase stop --no-backup
docker system prune -a  # CUIDADO: borra TODAS las imágenes Docker
pnpm exec supabase start
```

### Tests fallan con `ECONNREFUSED 127.0.0.1:54322`

Postgres no está corriendo. `pnpm exec supabase start`.

### Tests fallan con `relation "x" does not exist`

Migrations no aplicadas. `./scripts/db-apply-all.sh`.

### Tests fallan con `permission denied for table X` (RLS)

Tu test no está en context de tenant. Use service_role para bypass RLS (solo en
tests con justificación) o setup context con JWT de test user.

### Necesito reset entre tests

Usar BEGIN/ROLLBACK por test (`db.transaction(async tx => { ...; throw ROLLBACK })`)
o particionar por `tenant_id` único por test (UUID generado al inicio del describe).

## Convenciones tests integration

- **Filename:** `tests/integration/T-XXX-NN-{descripcion}.test.ts` (matchea
  INTEGRATION-TODO.md).
- **Tenant isolation:** cada describe genera un UUID tenant único — los datos
  quedan colateralmente sin interferir entre tests.
- **NO `truncate` global** — varios tests corren contra la misma DB; truncate
  rompe otros que coinciden temporalmente.
- **Cleanup explícito** en `afterAll` o uso de transactions con rollback.
- **Sin timeouts mágicos** — si un test es lento, agregar `{ timeout: 30_000 }`
  inline + dejar comment explicando por qué.

## Cross-references

- `INTEGRATION-TODO.md` — lista de tests pendientes (T-INV-04..08, etc).
- `.env.test.example` — vars necesarias.
- `vitest.integration.config.ts` — config dedicada (singleThread, timeout 15s).
- `tests/integration/setup.ts` — bootstrap (.env.test load + guards).
- `scripts/db-apply-all.sh` — apply Drizzle + post_initial migrations.
- `CLAUDE.md §16.12` — backup + restore (Supabase managed prod).
- `CLAUDE.md §18.7` — test isolation guidelines.

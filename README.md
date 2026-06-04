# Pandora ERP

POS + ERP fiscal para comercios pequeños argentinos (sederia, rotiseria, kiosko). AFIP nativo. Multi-tenant. Stack Next.js 16 + Supabase Postgres + Drizzle ORM + shadcn/ui (Radix + Nova preset).

> **Documentación arquitectónica completa** vive en el directorio padre Windows:
> `c:\Users\Pandora\Desktop\SRS\` — CLAUDE.md, DECISION-LEDGER, 22 ADRs, ROADMAP, DESIGN-ADAPTATION-PLAN, EVENT-TAXONOMY, etc.
> Este README cubre sólo el setup técnico de este repo.

---

## Estado actual — Sprint 0 + 1 + migración a WSL (2026-05-30)

**Fundaciones técnicas construidas:**

- `package.json` (Next 16.2.6 + React 19.2.4 + TS 5.9 + Drizzle 0.45 + jose 6.2 + zod 4.4 + decimal.js 10.6 + Pino 10 + @supabase/ssr + postgres-js + shadcn-radix-nova)
- `src/lib/env.ts` — Zod fail-fast validation de env vars críticas
- `src/lib/db/schema/` — 10 tablas tipadas (companies, users, products, sales, sale_items, audit_log, invoice_sequences, fiscal_snapshots + helpers)
- `src/lib/db/client.ts` — postgres-js + Drizzle client
- `src/lib/tracing/` — AsyncLocalStorage para correlation_id + request_id + tenant_id
- `src/lib/multi_tenant/` — CrossTenantAccessError + validateTenantAccess service-side
- `src/lib/money/` — Decimal.js + HALF_EVEN global + formatARS locale es-AR
- `src/lib/observability/logger.ts` — Pino con auto-inject + SECRET LIST redact
- `src/lib/auth/` — @supabase/ssr server + browser + JWT custom claims (jose)
- `src/middleware.ts` — request_id + correlation_id + Supabase session refresh
- `src/lib/audit/` — audit-writer con catálogo canónico de 42 events F0 (EVENT-TAXONOMY v2.0.2)
- `src/lib/domain/` — calculation engine puro + state machines commercial/fiscal
- `src/lib/services/products/` — CRUD + barcode + CSV import + adjustStock
- `src/lib/services/sales/` — createDraft + addItem + finalize con stock atómico + cancel
- `src/components/ui/` — 16 componentes shadcn/ui (Radix-Nova preset)
- `drizzle/migrations/post_initial/` — RLS policies + triggers inmutables + particiones audit_log
- `src/app/page.tsx` + `src/app/api/health/route.ts` — primera ruta visible
- `tests/unit/` — money + multi-tenant + calculation + state-machines + audit-event-names

**Lo que falta** (siguientes sprints): Server Actions reales, integración AFIP (Sprint 6 — bloqueado por contador), POS UI funcional, migración del diseño Claude Design al esqueleto.

---

## Setup local

### Prerequisitos

- **WSL2 Ubuntu** (este repo asume Linux dev env, no Windows nativo)
- **Node 22 LTS** (instalado via nvm)
- **pnpm 9+** o **11+**
- **Cuenta Supabase** (free tier alcanza F0) — para fase posterior

### 1. Verificar que está todo en su lugar

```bash
cd ~/workspace/pandora-erp
node --version    # esperado: v22.x
pnpm --version    # esperado: 9+ o 11+
ls src/lib/       # esperado: env.ts + auth/ + db/ + money/ + multi_tenant/ + services/ + etc.
```

### 2. Instalar dependencias

```bash
pnpm install
```

Si pide aprobar build scripts (sharp, esbuild, etc.), aprobar:

```bash
pnpm approve-builds
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env.local
```

Editar `.env.local` con valores reales:

- `DATABASE_URL` — connection string Postgres de Supabase
- `NEXT_PUBLIC_SUPABASE_URL` — URL del proyecto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key pública
- `SUPABASE_SERVICE_ROLE_KEY` — service role secreta
- `JWT_SECRET` — generar con `openssl rand -hex 64`
- `SECRETS_ENCRYPTION_KEY_V1` — generar con `openssl rand -hex 32`

Si falta alguna variable crítica, `src/lib/env.ts` lanza error en boot y la app NO arranca (fail-fast intencional).

### 4. Aplicar schema

```bash
pnpm db:generate     # genera migración inicial Drizzle
pnpm db:migrate      # aplica migración inicial
```

Después, aplicar migraciones SQL custom manualmente:

```bash
psql $DATABASE_URL -f drizzle/migrations/post_initial/0001_partition_audit_log.sql
psql $DATABASE_URL -f drizzle/migrations/post_initial/0002_immutable_triggers.sql
psql $DATABASE_URL -f drizzle/migrations/post_initial/0003_rls_policies.sql
```

> Ver `drizzle/migrations/README.md` para detalle.

### 5. Arrancar dev server

```bash
pnpm dev
```

Abrir <http://localhost:3000>. Verificar `/api/health` retorna 200.

---

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `pnpm dev` | Next.js dev server con Turbopack (puerto 3000) |
| `pnpm build` | Build de producción |
| `pnpm start` | Servidor producción |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` (agregar al package.json si no está) |
| `pnpm test` | Vitest run once (requiere agregar vitest a devDeps) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm db:generate` | Genera migración desde schema |
| `pnpm db:migrate` | Aplica migraciones |
| `pnpm db:push` | Push directo (sólo dev) |
| `pnpm db:studio` | Drizzle Studio (UI DB) |

---

## Estructura del código

```
pandora-erp/
├── src/
│   ├── app/                          ← Next.js App Router
│   │   ├── layout.tsx                ← Geist fonts + lang es-AR + metadata Pandora
│   │   ├── page.tsx                  ← Home Pandora
│   │   ├── globals.css               ← Tailwind 4 + shadcn-radix-nova OKLCH + reduced-motion
│   │   └── api/health/route.ts
│   ├── components/
│   │   └── ui/                       ← 16 componentes shadcn (Radix-Nova preset)
│   ├── lib/
│   │   ├── utils.ts                  ← shadcn cn() helper
│   │   ├── env.ts                    ← Zod env validation fail-fast
│   │   ├── auth/                     ← Supabase + JWT helpers
│   │   ├── db/
│   │   │   ├── client.ts             ← Drizzle + postgres-js
│   │   │   └── schema/               ← Tablas tipadas
│   │   ├── money/                    ← Decimal.js + formatARS
│   │   ├── multi_tenant/             ← Errors + validateTenantAccess
│   │   ├── observability/            ← Pino logger
│   │   ├── tracing/                  ← AsyncLocalStorage context
│   │   ├── audit/                    ← audit-writer + event-names canon
│   │   ├── domain/                   ← calculation + state-machines (puros)
│   │   └── services/                 ← Application Services
│   │       ├── products/
│   │       └── sales/
│   └── middleware.ts                 ← Edge middleware (auth + tracing)
├── tests/
│   ├── setup.ts                      ← env mock para Vitest
│   └── unit/                         ← money + multi-tenant + calc + states + audit events
├── drizzle/
│   └── migrations/
│       ├── README.md
│       └── post_initial/             ← RLS + triggers inmutables + particiones
├── public/                           ← Assets Next.js
├── components.json                   ← shadcn config (radix-nova)
├── postcss.config.mjs                ← Tailwind 4
├── eslint.config.mjs                 ← ESLint 9 flat config
├── tsconfig.json                     ← TS strict
├── next.config.ts                    ← Next 16 config
├── drizzle.config.ts                 ← Drizzle Kit
├── vitest.config.ts                  ← Vitest config
├── .env.example                      ← Variables documentadas
├── .gitattributes                    ← Force LF
└── .gitignore
```

---

## Convenciones

- **Money:** SIEMPRE `Decimal` de `decimal.js`. NUNCA `Number`. Ver `src/lib/money/decimal.ts`.
- **Currency:** ARS-only F0. Display via `formatARS()` con locale es-AR.
- **Multi-tenant:** SIEMPRE validar via `validateTenantAccess()` + RLS Postgres por encima.
- **Logging:** SIEMPRE `logger.{info,warn,...}` (Pino). NUNCA `console.log`.
- **Audit:** Sólo eventos del catálogo canónico (EVENT-TAXONOMY §5 v2.0.2). 42 eventos F0.
- **Errors:** SIEMPRE clase `DomainError` o subclase. Boundary atrapa y formatea.
- **Naming:** snake_case en DB. camelCase en TS. PascalCase en componentes.
- **Idioma:** español rioplatense en UI + comentarios cara-al-comerciante. Inglés técnico en código.

---

## Próximos pasos

Ver en directorio Windows `c:\Users\Pandora\Desktop\SRS\`:

- `ROADMAP.md` — sprints operativos
- `DESIGN-ADAPTATION-PLAN.md` — migración 6 .jsx Claude Design a TSX modular
- Memoria `master-audit-2026-05-28.md` + `sprint-0-1-build-and-audit-2026-05-30.md`

Inmediato (siguientes sprints):

1. Agregar deps test: `pnpm add -D vitest @vitest/coverage-v8 fast-check`
2. Validar: `pnpm typecheck` + `pnpm test`
3. Migrar 6 .jsx de Claude Design a TSX modular siguiendo DESIGN-ADAPTATION-PLAN
4. Wire data layer real: Server Components leyendo de Drizzle
5. Application Services adicionales: Cash, Customer, Orders
6. Auth flows: login, signup, invite contador
7. Sprint 6 — AFIP integration (BLOQUEADO por reuniones contador + abogado)

---

*README sprint 0 base + migración WSL · 2026-05-30 · Pandora ERP*

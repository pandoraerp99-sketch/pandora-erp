# Pandora ERP

POS + ERP para un comercio chico de Tierra del Fuego: vender, cobrar (efectivo, débito, crédito, cuenta corriente), cerrar la caja, llevar el stock como un libro, cargar gastos con su comprobante, y darle a la contadora lo que el estudio pide. Multi-tenant, AFIP nativo (bloqueado: ver abajo).

Next.js 16 (webpack) · React 19 · TypeScript strict · Supabase (Postgres + Auth + Storage) · Drizzle · Decimal.js · Vitest.

> La documentación de producto y arquitectura (CLAUDE.md, DECISION-LEDGER, ADRs, EVENT-TAXONOMY) vive en `C:\Users\Pandora\Desktop\SRS\`. El estado real auditado está en `AUDITORIA-ESTADO-REAL-2026-11-15.md` de esa carpeta. Este README cubre cómo **arrancar, probar y desplegar** este repo.
>
> Los números de este proyecto no se escriben a mano: `bash scripts/numeros-del-proyecto.sh`.

---

## Qué funciona hoy

| Pantalla | Qué hace |
|---|---|
| `/pos` | Vende de punta a punta: carrito, cliente, cobro por medio de pago, stock y caja en la misma transacción. Idempotente contra doble click. |
| `/caja` | Apertura, ingresos/egresos con motivo, cierre con arqueo y descuadre, corrección de medio de pago sin borrar nada. |
| `/productos` | Catálogo, ajustes y merma con motivo, stock reconstruible desde el libro, import CSV. |
| `/clientes` | Ficha, cuenta corriente (fiado) como libro: cobros totales/parciales, ajustes auditados, deudores. |
| `/gastos` | Gastos por rubro, compras que mueven stock, proveedores con cuenta corriente, comprobantes adjuntos (PDF/foto). |
| `/contador` | Lo que pide el estudio: posición de IVA, ventas, caja/deudores/acreedores al cierre, inventario valorizado, comprobantes; todo en CSV. Multi-empresa. |
| `/panel` | Inicio del dueño: ventas, margen, días de stock, proyección del mes, pendientes, feriados. |

**No funciona todavía** (y la pantalla lo dice, no lo esconde):
- **Factura electrónica (AFIP):** la cadena WSAA → WSFEv1 está escrita y testeada; falta el **certificado** y las definiciones A-2/A-11 de la contadora.
- **Cobro con MercadoPago QR:** webhook, verificación y reconciliación existen; falta crear la orden desde el POS (el medio aparece deshabilitado con su motivo).

**Roles:** `owner`, `admin` y `cashier` operan; `accountant` (la contadora) sólo lee. Lo hace cumplir el servidor en cada escritura (`src/lib/auth/autorizacion.ts`), no la interfaz.

---

## Arrancar en local

Todo corre en **WSL2 Ubuntu** con **Docker Desktop** (integración WSL activada), **Node 22** (nvm) y **pnpm**.

```bash
cd ~/workspace/pandora-erp

# 1. Dependencias
pnpm install

# 2. Supabase local (Postgres + Auth + Storage en Docker, puertos 3432x)
#    Docker Desktop tiene que estar prendido en Windows.
npx supabase start

# 3. Variables de la base local
cp .env.test.example .env.test        # ya trae los valores del Supabase local

# 4. Esquema: todas las migraciones, en orden
set -a; . ./.env.test; set +a
bash scripts/db-apply-all.sh

# 5. Un usuario para entrar
node scripts/seed-dev-operator.mjs    # operador@pandora.dev / pandora-dev-1234 (rol owner)

# 6. Levantar la app
bash scripts/dev-con-supabase-local.sh
```

Abrir <http://localhost:3000> y entrar con el operador.

> ⚠️ **No uses `pnpm dev` a secas.** `.env.local` es un archivo de prueba que apunta a una base que no existe: la app levanta, dice *Ready*, y el login falla en silencio (`ECONNREFUSED` adentro de un Server Action). `dev-con-supabase-local.sh` arranca con las variables del Supabase local sin tocar `.env.local`.
>
> Si la pantalla aparece desarmada o con un *"1 Issue"* abajo a la izquierda: parar el server, `rm -rf .next`, y volver a levantarlo.

Datos de demo (opcionales): `scripts/seed-dev-ventas.sql` y `node scripts/seed-dev-gastos.mjs`.

---

## Verificar

| Comando | Qué prueba |
|---|---|
| `bash scripts/suite-completa.sh` | Unit + integración contra la base real, el catálogo de eventos contra la documentación, que nadie suba archivos con el service role, y una vuelta real contra el Storage. Decide por código de salida. |
| `bash scripts/rojos-de-la-suite.sh` | Qué falló en la última corrida (la suite imprime sólo el resumen). |
| `bash scripts/correr-integracion.sh T-ADJ` | Un grupo de tests de integración por prefijo. |
| `bash scripts/verificar-tipos.sh <archivos>` | `tsc` + que los archivos no tengan CRLF. |
| `bash scripts/smoke-prod.sh` | Compila para **producción** (en `.next-prod`, aparte del dev) y pide las rutas al server de producción, incluida la puerta de los crons. |
| `bash scripts/probar-guardia-adjuntos.sh` | Rompe a propósito 9 garantías (policies, triggers, guardia de rol…) y exige que los tests se pongan rojos. Un test que nunca falló no prueba nada. |

Capturas y contraste: `scripts/shot-pos.mjs` (corre desde **Windows**, con `RUTA`, `TEMA` y una acción) y `scripts/contraste-png.ps1` (mide contraste WCAG sobre los píxeles, no sobre el CSS).

---

## Desplegar (todavía NO está desplegado)

Hoy la app vive sólo en local: no hay Supabase en la nube, ni variables de producción, ni CI, y la mayoría de los commits no está en GitHub. Lo que hace falta, en orden:

1. **Proyecto Supabase en la nube** (plan free alcanza para un comercio). Aplicar las migraciones con `scripts/db-apply-all.sh` apuntando a su `DATABASE_URL`, y configurar el *Custom Access Token Hook* de la migración 0015.
2. **Variables de producción** en Vercel, según `.env.example`. Las que no pueden faltar: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `SECRETS_ENCRYPTION_KEY_V1` (+ `_ACTIVE_VERSION`), y `CRON_SECRET` (sin él los crons quedan apagados: es a propósito). **No** fijar `NODE_ENV`: rompe el build.
3. **Vercel**: conectar el repo; `vercel.json` ya declara el cron de MercadoPago. El build es `pnpm build` (webpack, por los imports `.js`; ver `next.config.ts`).
4. Antes de cada deploy, `bash scripts/smoke-prod.sh` en verde.
5. **AFIP**: `AFIP_ENVIRONMENT=homologacion` hasta tener certificado y homologación. `produccion` sólo con `NODE_ENV=production`.

Crear la cuenta en la nube, cargar secretos y publicar son decisiones del dueño del proyecto: ningún script de este repo lo hace solo.

---

## Convenciones que el código hace cumplir

- **Plata:** `Decimal` (decimal.js), nunca `Number`. Redondeo `HALF_EVEN`.
- **Tablas que no se editan:** `audit_log`, `stock_movements`, `expenses`, `attachments`. Corregir es insertar una fila nueva que apunta a la vieja; un trigger rechaza el `UPDATE`/`DELETE`.
- **Multi-tenant:** toda consulta filtra por `tenant_id` dentro del `WHERE`. El tenant sale del contexto de la sesión, nunca de un parámetro.
- **Autorización:** cada mutación del service layer empieza con `await exigirQueOpereElComercio();`. Una nueva se agrega a `scripts/insertar-guardia-de-rol.py` y a `tests/integration/T-ROL-01`.
- **Fechas:** el día del comercio es `America/Argentina/Ushuaia`. El período de una pantalla se resuelve con la fecha de hoy, nunca con un borde que mande el cliente (hay un test que lo vigila).
- **Auditoría:** sólo eventos del catálogo cerrado (`src/lib/audit/event-names.ts`); agregar uno es decisión del dueño.
- **Logs:** Pino (`logger`), nunca `console.log`; tokens, certificados y URLs firmadas no se loguean.
- **Idioma:** castellano rioplatense en la interfaz y en los comentarios.

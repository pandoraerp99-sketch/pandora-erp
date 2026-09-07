# Fiscal — WSFEv1 (Sprint 6)

Emisión de comprobantes electrónicos AFIP/ARCA. ADR-0022 (Fiscal Projection Layer) +
tax-policy-versions (SRS) + decisiones provisionales del guion contadora 2026-07-10.

## 🔒 Regla de seguridad (no negociable)

Todo esto corre **solo contra AFIP homologación** (`AFIP_ENVIRONMENT=homologacion`,
ADR-0019 S13). **NO se emite ni un comprobante a cliente real hasta que la contadora
revise la app funcionando.** El env.ts ya bloquea `produccion` fuera de `NODE_ENV=production`.

## ⚠️ Auditoría externa 2026-07-10 — estado

- ✅ **HIGH-1 CORREGIDO** (bug de correctitud): `ImpNeto` debe ser `Σ Iva[].BaseImp`,
  no `round2(Σ base)` — con ≥2 alícuotas y bases de centavos difieren y AFIP rechaza
  (valida `ImpNeto == Σ BaseImp`). Fix en `projection/wsfev1.ts` + assertion nueva +
  test de regresión (`bases con centavos`).
- 🟡 **HIGH-2 PARCIAL — bloqueador de GO-LIVE (no de dev):** la frontera §8.5 (tx abierta
  durante AFIP) requiere conexión **directa/session, NO el pooler transaccional 6543**.
  **(b) HECHO:** `fiscal-db-guard.ts` — `emitInvoice` falla-rápido si `DATABASE_URL` apunta
  al puerto 6543 (`assertFiscalDbConnectionMode`, testeado). **Falta para el slice del cliente
  real (con cert):** **(a)** pool fiscal dedicado directo/session, **(c)** timeout AFIP acotado
  < `idle_in_transaction_session_timeout`. Dev usa 5432 directo → seguro.
- 🟡 **Seeding de numeración (extra):** `emitInvoice` confía en `next_number` local (arranca
  en 1) y NO llama `FECompUltimoAutorizado` en el primer uso. OK para un PV **nuevo** en AFIP
  (LIS homologación arranca en 0). **Riesgo** al onboardear un comercio que YA factura, o si
  se pierde el contador local con AFIP reteniendo estado → reuso de CbteDesde → 10016. Cerrar
  en el slice reconciliación (seed/cross-check con `getLastAuthorized`, que el cliente ya expone).
- ✅ Resto verificado OK: numeración correlativa, códigos AFIP (incl. `51 = A ALEY` vs Manual
  v4.5), fail-closed, cambio `not_required→pending`, snapshot inmutable (0010 = CREATE OR REPLACE
  intencional + TRUNCATE), parseo XML. RLS inerte en la ruta fiscal = patrón codebase-wide (los
  services usan filtros app-level, no `withRlsContext`), no específico de lo fiscal.

## Qué está construido (slice 1 — capa pura, sin red)

| Archivo | Qué hace |
|---|---|
| `afip-codes.ts` | Constantes AFIP de fuente primaria (Manual COMPG v4.5): CbteTipo, IVA Id, Concepto, DocTipo, CondicionIVAReceptor. Fail-closed si falta un código. |
| `invoice-type.ts` | `selectInvoiceType(regimenEmisor, receptor)` → A/B/C. Monotri→C siempre; RI→B a CF, A a sujeto con condición. |
| `projection/wsfev1.ts` | `projectToWSFEv1(...)` → `FECAEDetRequest`. Reusa `domain/calculation.ts`. Invariantes fail-closed (ImpTotal=Σcomponentes, ImpIVA=ΣIva[], Tipo C sin Iva[]). Exención TDF→ImpOpEx. |

Tests: `tests/unit/fiscal-invoice-type.test.ts` + `tests/unit/fiscal-projection-wsfev1.test.ts` (12, TDD).

## Slice 2 — Cliente WSAA (auth) — parcial (partes puras + orquestación hechas)

`src/lib/integrations/afip/`:
| Archivo | Estado |
|---|---|
| `wsaa-endpoints.ts` | ✅ URLs homo/prod WSAA + WSFEv1 + servicio 'wsfe' |
| `wsaa-tra.ts` | ✅ `buildTra()` (TRA XML, offset AR -03:00) + `parseLoginCmsResponse()` (extrae token/sign/exp del SOAP) — puro, TDD |
| `wsaa-client.ts` | ✅ `WsaaClient.getCredentials()` cache get-or-refresh + `buildLoginCmsEnvelope()` — signer/transport/cache **inyectables**, TDD con fakes |

Tests: `tests/unit/wsaa-tra.test.ts` (9) + `wsaa-client.test.ts` (7).

**Falta enchufar (necesita cert / red / DB — todo tras la interfaz):**
- `TraSigner` real: firma CMS/PKCS#7 del TRA con el cert (node built-in no arma CMS → node-forge o similar). **Requiere el cert.**
- `LoginCmsTransport` real: `fetch` POST del envelope a WSAA (thin adapter).
- `WsaaTokenCache` real: mapea a la tabla `wsaa_tokens` vía Drizzle (integration test).

## Slice 3 — Cliente WSFEv1 SOAP — hecho (partes puras + orquestación)

`src/lib/integrations/afip/`:
| Archivo | Estado |
|---|---|
| `xml.ts` | ✅ helpers extractTag/extractAll/unescape (tolerante a namespace/atributos) |
| `wsfev1-request.ts` | ✅ `buildFecaeSolicitarEnvelope()` + `buildFecompUltimoAutorizadoEnvelope()` — orden XSD verificado (ImpTrib→ImpIVA→MonId→CondicionIVAReceptorId→Iva). Puro, TDD |
| `wsfev1-response.ts` | ✅ `parseFecaeSolicitarResponse()` + `classifyCaeResult()` (issued/observed/rejected/error, fail-closed) + `parseFecompUltimoAutorizadoResponse()`. Puro, TDD |
| `wsfev1-client.ts` | ✅ `Wsfev1Client.getLastAuthorized()` (numeración) + `requestCae()` — auth/transport **inyectables**, TDD con fakes |

Tests: `wsfev1-response` (6) + `wsfev1-request` (4) + `wsfev1-client` (5).

**Falta enchufar (necesita cert / DB):**
- `Wsfev1Transport` real: `fetch` POST con SOAPAction (thin adapter).
- `AfipAuthProvider` real: envuelve `WsaaClient.getCredentials()` + el CUIT del tenant.

## Slice 4 — emitInvoice (emisión del CAE) — hecho

`src/lib/fiscal/`:
| Archivo | Estado |
|---|---|
| `receptor.ts` | ✅ deriva DocTipo/DocNro/CondicionIVAReceptor + condición desde el snapshot de cliente. Puro, TDD |
| `emit-invoice.ts` | ✅ `emitInvoice(saleId, {client})` — numeración SELECT FOR UPDATE (ADR-0006) + `requestCae` **inyectado** + snapshot inmutable (solo en éxito) + transiciones + audit. Los 5 outcomes + guards |

Tests: `fiscal-receptor` (5, unit) + `T-FISCAL-EMIT-01` (6, integración con DB real + cliente fake).

**Outcomes (fail-closed):** issued→issued+snapshot+número+1 · observed→issued (CAE válido)+obs · rejected/error→manual_resolution_required, sin snapshot, número NO avanza · timeout/red→requires_reconciliation (worker recupera).

**Frontera transaccional (§8.5, decisión consciente):** el número avanza SOLO cuando AFIP autoriza (correlatividad estricta AFIP, error 10016). La tx se sostiene durante la llamada AFIP → **requiere conexión directa/session en producción, NO el pooler transaccional 6543 de Supabase** (dev usa 5432). Ver comentario en `emit-invoice.ts`.

**Gap latente corregido:** `finalizeSale(require_fiscal_invoice=true)` nunca funcionó — la máquina de estados prohibía `not_required→pending`. Se agregó esa arista (determinación fiscal al finalizar) en `domain/state-machines.ts`. Ningún test previo lo ejercía (todos usaban `false`).

## Slice 5 — Cableado al POS (post-cobro) — hecho

`src/lib/fiscal/` + `src/app/pos/actions.ts`:
| Archivo | Estado |
|---|---|
| `fiscal-client-factory.ts` | ✅ `getCaeRequester(tenant)` → `null` mientras no haya cert/adaptadores (emisión diferida) |
| `emit-after-cobro.ts` | ✅ `emitAfterCobro(saleId, {getClient?})` **best-effort, NUNCA lanza**: not_pending (no-op) / fiscal_client_unavailable (skip→pending) / emit_error (captura) / delega en emitInvoice |
| `actions.ts` | ✅ `finalizeSaleAction` llama a `emitAfterCobro` tras el cobro; devuelve `data.fiscal` (aditivo, no rompe la UI) |

Tests: `T-FISCAL-EMIT-02` (4 integración). **Aditivo:** el POS hoy pasa `require_fiscal_invoice=false` → la venta queda `not_required` y esto es no-op. El cobro NUNCA se rompe por un fallo de emisión.

## Slice 6 — Adaptadores reales — HECHO (2026-09-07)

`getCaeRequester()` ya **no devuelve `null` cuando hay certificado**: arma la cadena
completa cert → firma CMS → WSAA (cache en base) → WSFEv1 sobre TLS 1.2+.

| Archivo | Qué hace |
|---|---|
| `drizzle/.../0025_afip_credentials.sql` | Tabla del cert por (tenant, environment). Contenido CIFRADO con el vault; un CHECK rechaza un PEM en claro. Primer consumidor real del vault (escrito y sin usar desde Sprint 1). |
| `fiscal/afip-credentials.ts` | `getAfipCredentials` / `saveAfipCredentials`. Único lugar que descifra. Falla si el cert está vencido (§8.12) en vez de dejar que AFIP conteste un error que no lo menciona. |
| `afip/tra-signer.ts` | Firma CMS/PKCS#7 del TRA con **node-forge** (Node no arma CMS). Se descartó `openssl` por consola: en Vercel no hay binario garantizado. |
| `afip/soap-transport.ts` | `postSoap` sobre `node:https` con `minVersion:'TLSv1.2'` + `rejectUnauthorized:true` + timeout obligatorio. La opción `ca` AGREGA confianza, nunca la saca. |
| `afip/wsaa-token-cache.ts` | Cache sobre `wsaa_tokens`. En la BASE y no en memoria: WSAA da un token cada 12h y rechaza pedir otro antes de que venza; en serverless un cache en memoria pediría uno por cada arranque en frío. |
| `fiscal-client-factory.ts` | Junta todo. El environment sale del SERVIDOR, no de un parámetro (ADR-0019 S13). El CUIT sale del CERTIFICADO, no de `companies.cuit`. |

**Tests nuevos:** `tra-signer` (10 unit) · `fiscal-timeouts` (5 unit) ·
**T-SEC-06** (4 integración, con servidores TLS reales) · **T-FISCAL-CRED-01**
(10 integración).

**HIGH-2 cerrado:** faltaba (c), el timeout de AFIP acotado y menor que el
`idle_in_transaction_session_timeout`. `assertAfipTimeoutFitsDb` + su test. Se
testea PURO a propósito: en desarrollo el timeout de la base está en 0 y un test
contra la base real pasaría siempre sin probar nada. **(a) el pool fiscal dedicado
sigue pendiente** — sólo importa en producción con pooler.

## Próximos slices (pendientes)

7. **POS UI**: pasar `require_fiscal_invoice=true` (o según cliente) + mostrar `data.fiscal`
   (CAE / "en proceso"). **Ojo:** hoy el POS manda `false`, así que aunque haya certificado
   la emisión sigue sin dispararse. Es el interruptor, y va aparte a propósito.
8. **Homologación live**: primera factura de prueba de punta a punta. Recién con el cert.
9. **Seeding de numeración**: cross-check con `FECompUltimoAutorizado` antes del primer
   comprobante de un PV que ya facturó (ver arriba).

## Cómo obtener y cargar el certificado

    ./scripts/afip-generar-csr.sh <cuit> "<razón social>" [alias]

Genera la clave privada (que **nunca** sale de la máquina; `.gitignore` la bloquea)
y el CSR, que es lo único que se sube a AFIP. El script imprime los pasos del portal:
WSASS para homologación, autorizar el servicio `wsfe`, descargar el `.crt`.

    pnpm tsx scripts/afip-cargar-certificado.ts --tenant <uuid> --cuit <11>       --cert <archivo.crt> --key <archivo.key> [--env homologacion|produccion]

Lo guarda cifrado y lee el vencimiento del propio certificado.


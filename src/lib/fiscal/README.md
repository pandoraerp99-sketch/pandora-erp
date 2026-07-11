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
- 🔴 **HIGH-2 ABIERTO — bloqueador de GO-LIVE (no de dev):** la frontera §8.5 (tx abierta
  durante AFIP) requiere conexión **directa/session, NO el pooler transaccional 6543**.
  Hoy `db/client.ts` es un cliente global con `prepare:false` (típico del pooler). Antes
  de emitir en producción hace falta: **(a)** pool fiscal dedicado directo/session, **(b)**
  assertion de arranque que rechace 6543 en la ruta fiscal, **(c)** timeout AFIP acotado
  < `idle_in_transaction_session_timeout`. Se implementa en el slice del cliente real
  (con el cert). Dev usa 5432 directo → seguro.
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

## Próximos slices (pendientes) — todo gated por el CERTIFICADO

6. **Adaptadores reales del cliente** (en `getCaeRequester`): TraSigner CMS (node-forge, firma con el cert),
   transports fetch (WSAA `LoginCms` + WSFEv1), `AfipAuthProvider` (WsaaClient + cuit de la company),
   `WsaaTokenCache` sobre la tabla `wsaa_tokens`. Con esto `getCaeRequester` deja de devolver `null`.
7. **POS UI**: pasar `require_fiscal_invoice=true` (o según cliente) + mostrar `data.fiscal` (CAE / "en proceso").
8. **Homologación live**: primera factura de prueba de punta a punta. Recién con el cert.

## ⚠️ Dependencia externa que desbloquea el LIVE homologación: el certificado

Para que WSAA autentique hace falta un **certificado X.509 de homologación** de AFIP.
Es lo único que falta para probar de punta a punta. Cómo obtenerlo (owner, una vez):

1. Generar clave privada + CSR:
   `openssl req -new -newkey rsa:2048 -nodes -keyout pandora-homo.key -out pandora-homo.csr -subj "/C=AR/O=<razon social>/CN=pandora-homo/serialNumber=CUIT <cuit>"`
2. En el portal AFIP (homologación / WSASS con clave fiscal): subir el CSR → descargar el certificado.
3. Autorizar el servicio **wsfe** (WSFEv1) para ese certificado/CUIT en WSASS.
4. Guardar cert + key. F0 piloto: env vars / vault cifrado (§11.8, nunca en git, nunca loguear).

Env vars que se agregarán en el slice WSAA (aún no en `env.ts`):
`AFIP_CUIT`, `AFIP_CERT` (o path/handle en storage cifrado), `AFIP_PRIVATE_KEY`.

Endpoints homologación (constantes por environment):
- WSAA: `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`
- WSFEv1: `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`

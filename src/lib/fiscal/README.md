# Fiscal — WSFEv1 (Sprint 6)

Emisión de comprobantes electrónicos AFIP/ARCA. ADR-0022 (Fiscal Projection Layer) +
tax-policy-versions (SRS) + decisiones provisionales del guion contadora 2026-07-10.

## 🔒 Regla de seguridad (no negociable)

Todo esto corre **solo contra AFIP homologación** (`AFIP_ENVIRONMENT=homologacion`,
ADR-0019 S13). **NO se emite ni un comprobante a cliente real hasta que la contadora
revise la app funcionando.** El env.ts ya bloquea `produccion` fuera de `NODE_ENV=production`.

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

## Próximos slices (pendientes)

4. **Fiscal Snapshot + wiring**: persistir `fiscal_snapshots` (inmutable) con payload+response+CAE;
   numeración `invoice_sequences` SELECT FOR UPDATE (ADR-0006) + `getLastAuthorized` para recovery;
   cablear al `finalizeSale` que ya funciona. Fail-closed §8.12 en timeout (F0 = sin CAEA, → F0.5).
5. **Adaptadores reales** (con el cert): TraSigner CMS, transports fetch (WSAA+WSFEv1),
   caches DB. Recién ahí se prueba live contra homologación.

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

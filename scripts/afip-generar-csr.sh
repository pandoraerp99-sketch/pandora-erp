#!/usr/bin/env bash
#
# Genera la clave privada + el CSR para pedirle el certificado a AFIP.
#
# La clave privada NUNCA sale de acá: se genera local, se queda local, y lo que
# se sube al portal de AFIP es SOLO el .csr (que no contiene la clave). Si la
# clave se filtra, un tercero puede facturar con la identidad fiscal del
# comercio: tratarla como una contraseña maestra.
#
# Uso:
#   ./scripts/afip-generar-csr.sh <cuit-11-digitos> "<razon social>" [alias]
#
# Ejemplo:
#   ./scripts/afip-generar-csr.sh 20123456789 "Kiosco El Faro SRL" pandora-homo
set -euo pipefail

CUIT="${1:-}"
RAZON="${2:-}"
ALIAS="${3:-pandora-homo}"

if [[ ! "$CUIT" =~ ^[0-9]{11}$ ]]; then
  echo "ERROR: el CUIT tiene que ser 11 dígitos sin guiones. Recibí: '${CUIT}'" >&2
  echo "Uso: $0 <cuit> \"<razon social>\" [alias]" >&2
  exit 1
fi
if [[ -z "$RAZON" ]]; then
  echo "ERROR: falta la razón social." >&2
  exit 1
fi

DESTINO="secretos-afip"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

KEY="${DESTINO}/${ALIAS}.key"
CSR="${DESTINO}/${ALIAS}.csr"

if [[ -f "$KEY" ]]; then
  echo "ERROR: ya existe ${KEY}." >&2
  echo "NO se pisa: si esa clave corresponde a un certificado que AFIP ya emitió," >&2
  echo "perderla deja el certificado inservible. Movela a mano si querés rehacerla." >&2
  exit 1
fi

# RSA 2048 es lo que pide AFIP. -nodes = sin passphrase: el server tiene que
# poder firmar solo, sin que nadie tipee nada al arrancar.
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$KEY" \
  -out "$CSR" \
  -subj "/C=AR/O=${RAZON}/CN=${ALIAS}/serialNumber=CUIT ${CUIT}"

chmod 600 "$KEY"

cat <<FIN

  Listo.

    clave privada : ${KEY}     <- NO se sube a ningún lado. No va a git.
    pedido (CSR)  : ${CSR}     <- esto es lo que se sube a AFIP.

  Seguir así (una sola vez, lo hace el dueño con su clave fiscal):

    1. Entrar a AFIP con clave fiscal (nivel 3 o más).
    2. HOMOLOGACIÓN — buscar el servicio "WSASS" (Autogestión de Certificados
       de Homologación). Ahí se sube el CSR y se descarga el certificado.
       PRODUCCIÓN — es otro camino: "Administración de Certificados Digitales".
    3. Subir ${CSR} y descargar el certificado (.crt / .pem).
    4. En el MISMO portal, autorizar el servicio "wsfe" (Facturación
       Electrónica WSFEv1) para ese certificado y ese CUIT.
       Sin este paso el certificado autentica pero no puede facturar, y el
       error que devuelve AFIP no dice que falta la autorización.
    5. Cargarlo en la app:

         pnpm tsx scripts/afip-cargar-certificado.ts \\
           --tenant <uuid-de-la-empresa> \\
           --cuit ${CUIT} \\
           --cert ${DESTINO}/${ALIAS}.crt \\
           --key ${KEY}

  El certificado de HOMOLOGACIÓN sólo sirve contra el AFIP de prueba. Para
  facturar de verdad hay que repetir todo en producción, con otro certificado.

FIN

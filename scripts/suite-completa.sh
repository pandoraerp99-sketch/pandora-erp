#!/usr/bin/env bash
# Suite completa: unit + integración (secuencial). Decide por CÓDIGO DE SALIDA.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

# Los nombres tienen que salir LITERALES del código, no armados con variables:
# un `event_name: \`\${dominio}.settled\`` pasa el typecheck y deja el catálogo
# sin poder auditarse con un grep.
#
# ⚠️ La lista de archivos es a mano y por eso se queda vieja: el 2026-09-18 este
# check decía "6" y no miraba supplier-account.service.ts, así que los dos
# eventos de proveedores estaban emitidos y NO aparecían acá. Si agregás un
# service que emite, agregalo también en esta lista y en el dominio de la regex.
#
# ⚠️⚠️ Hasta el 2026-09-19 esto IMPRIMÍA los nombres y decía "tienen que ser 8"
# sin contar nada: el número vivía en un `echo` y ninguna salida cambiaba si
# dejaban de ser 8. Misma forma que el "Total: 49" escrito arriba de 51 eventos
# que se corrigió esta misma semana — un número declarado que no verifica nadie.
# Ahora se cuenta y se falla.
EVENTOS_ESPERADOS=10
echo "== eventos cableados (tienen que ser $EVENTOS_ESPERADOS nombres propios, no mutados) =="
EVENTOS_CABLEADOS=$(grep -hoE "event_name: '(expense|customer\.account|supplier\.account|auth\.accountant)\.[a-z_]+'" \
  src/lib/services/expenses/expense.service.ts \
  src/lib/services/expenses/supplier-account.service.ts \
  src/lib/services/expenses/attachment.service.ts \
  src/lib/services/customers/account.service.ts \
  src/lib/services/identity/accountant.service.ts | sort -u)
# `sort -u`: se cuentan NOMBRES distintos, que es lo que el titulo dice y lo
# que importa del catalogo. Con `sort` a secas contaba apariciones, y emitir un
# evento ya cableado desde un segundo lugar —el contrato del proveedor reusa
# `expense.attachment_added`— rompia el chequeo sin que el catalogo cambiara.
echo "$EVENTOS_CABLEADOS"

FALLA=0

EVENTOS_CONTADOS=$(printf '%s' "$EVENTOS_CABLEADOS" | grep -c . || true)
if [ "$EVENTOS_CONTADOS" -ne "$EVENTOS_ESPERADOS" ]; then
  echo "🔴 eventos cableados: $EVENTOS_CONTADOS, se esperaban $EVENTOS_ESPERADOS"
  echo "   Si sumaste un service que emite, agregalo a la lista de archivos de"
  echo "   acá arriba y subí EVENTOS_ESPERADOS. Si uno dejó de emitir, hay un"
  echo "   evento en el catálogo que no lo usa nadie."
  FALLA=1
fi

# Los adjuntos se suben con el cliente del USUARIO, no con el service role.
# No es una preferencia: el service role IGNORA el RLS, así que si alguien lo
# usara acá, la policy del bucket —que es la segunda capa que protege el path—
# dejaría de correr sin un solo error visible, y todos los tests seguirían en
# verde porque prueban el service con un almacén falso. El comentario de
# `attachment.storage.ts` afirma que esto pasa; acá se verifica.
echo "== adjuntos: nadie sube con el service role =="
if grep -rln 'createSupabaseServiceRoleClient' \
     src/lib/services/expenses/attachment.service.ts \
     src/lib/services/expenses/attachment.storage.ts \
     src/app/gastos/ 2>/dev/null; then
  echo "🔴 un archivo de adjuntos importa el service role — se pierde el RLS del bucket"
  FALLA=1
else
  echo "ok"
fi

# La vuelta REAL contra el Storage. Los tests no la cubren y no pueden:
# T-ADJ-01 escribe las filas de `storage.objects` a mano y T-ADJ-02 usa un
# almacén falso, así que `almacenSupabase()` —el único camino que corre en
# producción— nunca se ejecutaba. Así se pasó que `remove()` devolvía
# `data: [], error: null` sin borrar nada, con la compensación muda.
echo "== adjuntos: la vuelta real contra el Storage =="
if bash scripts/probar-storage-real.sh; then :; else FALLA=1; fi

# El catálogo del CÓDIGO contra el DOC. Los tests no pueden hacerlo: corren en
# WSL y EVENT-TAXONOMY.md vive en el filesystem de Windows, así que el "coincide
# exacto" que afirmaban CLAUDE.md, el DECISION-LEDGER y el propio doc no lo
# verificaba nadie — y derivó dos versiones enteras (49 declarados con 51 en el
# código). Si el doc no está montado lo DICE y no falla: un chequeo que no corrió
# no es un chequeo que pasó.
echo "== catálogo de eventos: código vs EVENT-TAXONOMY.md =="
if bash scripts/verificar-catalogo-eventos.sh; then :; else FALLA=1; fi

if pnpm test >/tmp/suite-unit.log 2>&1; then echo "UNIT OK"; else echo "UNIT FAIL"; FALLA=1; fi
grep -E 'Test Files|Tests ' /tmp/suite-unit.log | tail -2

if pnpm test:integration --no-file-parallelism >/tmp/suite-int.log 2>&1; then
  echo "INTEGRACION OK"
else
  echo "INTEGRACION FAIL"; FALLA=1
  grep -E '^\s*(FAIL|×)' /tmp/suite-int.log | head -30
fi
grep -E 'Test Files|Tests ' /tmp/suite-int.log | tail -2
exit "$FALLA"

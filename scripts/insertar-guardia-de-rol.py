#!/usr/bin/env python3
"""
Inserta `await exigirQueOpereElComercio();` como PRIMERA línea de cada
mutación exportada del service layer (H-01), y el import que hace falta.

Es un script y no una edición a mano por dos motivos: son ~33 funciones en
15 archivos (a mano se saltea una y nadie lo nota), y es idempotente — si la
guardia ya está en la función, no la duplica — así que puede volver a correr
después de agregar una mutación nueva.

La lista de abajo ES la decisión de qué funciones escriben. Lo que no está:
- attachment.service.ts: ya tiene su guardia (de ahí salió la regla).
- identity/accountant.service.ts: el que ACEPTA la invitación es el contador,
  que por definición no opera el comercio; tiene su lógica propia de owner.
- registerChargeFromSale / registerChargeFromExpense: internas, las llama una
  mutación que ya pasó por la guardia.
"""
import io
import os
import re
import sys

ROOT = os.path.expanduser("~/workspace/pandora-erp")
LLAMADA = "  await exigirQueOpereElComercio();"

MUTACIONES = {
    "src/lib/cash/movements.ts": ["registerCashMovement"],
    "src/lib/cash/reasons.ts": ["createWithdrawalReason", "updateWithdrawalReason", "deactivateWithdrawalReason"],
    "src/lib/cash/reclassify.ts": ["reclassifySalePaymentMethod"],
    "src/lib/cash/sessions.ts": ["openCashSession", "closeCashSession"],
    "src/lib/cash/terceros.ts": ["createTercero", "updateTercero", "deactivateTercero"],
    "src/lib/inventory/products.ts": ["createProduct"],
    "src/lib/inventory/stock.ts": ["recordStockMovement", "recordOpeningStock"],
    "src/lib/services/customers/account.service.ts": ["settleAccount", "adjustAccount"],
    "src/lib/services/customers/customer.service.ts": ["createCustomer", "updateCustomer", "deactivateCustomer"],
    "src/lib/services/expenses/expense.service.ts": ["registerExpense", "annulExpense"],
    "src/lib/services/expenses/supplier-account.service.ts": ["settleSupplier", "adjustSupplier"],
    "src/lib/services/products/csv-import.ts": ["importProductsFromCsv"],
    "src/lib/services/products/product.service.ts": ["createProduct", "updateProduct", "adjustStock", "softDeleteProduct"],
    "src/lib/services/sales/sale.service.ts": [
        "createDraftSale", "addItemToSale", "updateItemQuantity", "removeItemFromSale",
        "setSaleCustomer", "finalizeSale", "cancelSale",
    ],
    "src/lib/services/tasks/task.service.ts": ["createTask", "completeTask", "uncompleteTask", "updateTask", "deleteTask"],
}


def ruta_import(rel):
    # src/lib/cash/x.ts -> ../auth/autorizacion.js ; src/lib/services/a/x.ts -> ../../auth/...
    profundidad = rel.count("/") - 2  # carpetas debajo de src/lib
    return "../" * profundidad + "auth/autorizacion.js"


def agregar_import(lineas, rel):
    objetivo = f"import {{ exigirQueOpereElComercio }} from '{ruta_import(rel)}';"
    if any(objetivo in l for l in lineas):
        return lineas, False
    ultimo = max(i for i, l in enumerate(lineas) if l.startswith("import ") or l.startswith("} from "))
    return lineas[: ultimo + 1] + [objetivo] + lineas[ultimo + 1:], True


def insertar(lineas, nombre):
    patron = re.compile(rf"^export async function {re.escape(nombre)}\(")
    for i, l in enumerate(lineas):
        if not patron.match(l):
            continue
        # Fin de la firma: la primera línea que termina en '{' con los
        # paréntesis BALANCEADOS. La primera versión tomaba la primera línea
        # que terminaba en '{' y en `adjustSupplier(input: {` eso es el tipo
        # literal del parámetro, no el cuerpo: la guardia quedó adentro del
        # tipo y tsc explotó (vitest no, porque esbuild no valida tipos).
        profundidad = 0
        j = i
        while True:
            profundidad += lineas[j].count("(") - lineas[j].count(")")
            if profundidad == 0 and lineas[j].rstrip().endswith("{"):
                break
            j += 1
        if lineas[j + 1].strip() == LLAMADA.strip():
            return lineas, "ya estaba"
        return lineas[: j + 1] + [LLAMADA] + lineas[j + 1:], "insertada"
    return lineas, "NO ENCONTRADA"


def quitar_todas(lineas):
    # Idempotencia de verdad: se sacan TODAS las guardias que puso este script
    # y se vuelven a poner con la heurística vigente. Así una mal ubicada por
    # una versión anterior no sobrevive.
    return [l for l in lineas if l.strip() != LLAMADA.strip()]


fallos = 0
for rel, nombres in MUTACIONES.items():
    ruta = os.path.join(ROOT, rel)
    texto = io.open(ruta, encoding="utf-8").read()
    nl = "\r\n" if "\r\n" in texto else "\n"
    lineas = quitar_todas(texto.split("\n"))
    tocado = True
    for n in nombres:
        lineas, estado = insertar(lineas, n)
        print(f"{rel:58s} {n:28s} {estado}")
        if estado == "NO ENCONTRADA":
            fallos += 1
        tocado = tocado or estado == "insertada"
    if tocado:
        lineas, _ = agregar_import(lineas, rel)
        io.open(ruta, "w", encoding="utf-8", newline="").write("\n".join(lineas))

print()
print("FALLOS:", fallos)
sys.exit(1 if fallos else 0)

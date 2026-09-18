#!/usr/bin/env bash
# Datos de mentira en la base de DEV para poder MIRAR la tarjeta de acreedores
# y el modal de pago con números: la base de dev no tiene ninguna compra a
# cuenta corriente, así que la pantalla sale en su estado vacío y una captura
# verde ahí no prueba nada (ver la memoria "la captura no prueba corrección").
#
# Lo real lo prueba tests/integration/T-PROV-01. Esto es sólo para ver.
#
# Se borra por MARCA, nunca por fecha: un DELETE por fecha en la base de dev ya
# se llevó una vez pagos legítimos y dejó sus cargos huérfanos, inventando dos
# deudores que no existían.
#
# Uso: bash scripts/semilla-acreedores-dev.sh sembrar | limpiar
set -u
TENANT=11111111-1111-4111-8111-111111111111
USUARIO=dec7075a-1ae5-4290-80d6-1ad9ab356d8e
# Distribuidora Austral SRL (con CUIT) y Kiosco El Faro.
AUSTRAL=fb339bc1-83fb-4046-a78e-818f200802ce
FARO=ba6897a8-3efb-4539-a6b6-374f22b22b94
MARCA='SEMILLA-ACREEDORES-DEV'

# `-v ON_ERROR_STOP=1` + el `|| exit` de abajo: sin eso psql imprime el ERROR,
# devuelve 0, y el script sigue hasta decir "sembrado". Pasó en el primer
# intento de este mismo script — un cast faltante, el INSERT no entró, y la
# única señal era una tabla vacía tres líneas más arriba del "sembrado".
psql() {
  docker exec supabase_db_pandora-erp psql -U postgres -P pager=off \
    -v ON_ERROR_STOP=1 "$@"
}

case "${1:-}" in
  sembrar)
    # La base de dev no tiene NINGÚN tercero cargado, así que el desplegable de
    # proveedores del formulario también sale vacío. Se crean acá: sin esto no
    # se puede cargar una deuda ni desde la pantalla ni desde la semilla.
    psql -c "
      INSERT INTO terceros (id, tenant_id, type, name, doc, is_active)
      VALUES ('$AUSTRAL', '$TENANT', 'proveedor', 'Distribuidora Austral SRL',
              '30712345678', true),
             ('$FARO', '$TENANT', 'proveedor', 'Kiosco El Faro', NULL, true)
      ON CONFLICT (id) DO NOTHING;" \
      || { echo "🔴 no se pudieron crear los proveedores"; exit 1; }

    # Dos compras a cuenta corriente del mes en curso. La de Austral lleva un
    # pago parcial, así que la tarjeta muestra el saldo y no el total comprado
    # — que es justo lo que se rompería si el saldo se leyera del gasto en vez
    # de calcularse del libro.
    psql -c "
      WITH g1 AS (
        INSERT INTO expenses (id, tenant_id, fecha, categoria, total, neto, iva,
                              medio_pago, tercero_id, payee_name, payee_doc,
                              descripcion, comprobante_tipo, comprobante_numero,
                              en_iva_compras, created_by)
        VALUES (gen_random_uuid(), '$TENANT', current_date - 12, 'mercaderia',
                '184500.0000', '152479.3400', '32020.6600', 'cuenta_corriente',
                '$AUSTRAL', 'Distribuidora Austral SRL', '30712345678',
                '$MARCA — reposicion quincenal', 'Factura', 'A-0003-00018842',
                true, '$USUARIO')
        RETURNING id, tercero_id, total, fecha
      ), g2 AS (
        INSERT INTO expenses (id, tenant_id, fecha, categoria, total, neto, iva,
                              medio_pago, tercero_id, payee_name,
                              descripcion, comprobante_tipo, comprobante_numero,
                              en_iva_compras, created_by)
        VALUES (gen_random_uuid(), '$TENANT', current_date - 5, 'mercaderia',
                '47300.0000', '39090.9100', '8209.0900', 'cuenta_corriente',
                '$FARO', 'Kiosco El Faro',
                '$MARCA — pedido chico', 'Factura', 'B-0001-00000771',
                true, '$USUARIO')
        RETURNING id, tercero_id, total, fecha
      ), c AS (
        INSERT INTO supplier_account_movements
          (id, tenant_id, tercero_id, type, amount, fecha, expense_id, created_by)
        SELECT gen_random_uuid(), '$TENANT'::uuid, tercero_id, 'charge', total,
               fecha, id, '$USUARIO'::uuid FROM g1
        UNION ALL
        SELECT gen_random_uuid(), '$TENANT'::uuid, tercero_id, 'charge', total,
               fecha, id, '$USUARIO'::uuid FROM g2
        RETURNING 1
      )
      -- Pago parcial a Austral: quedan debiendo 104.500.
      INSERT INTO supplier_account_movements
        (id, tenant_id, tercero_id, type, amount, fecha, payment_method, reason,
         created_by)
      VALUES (gen_random_uuid(), '$TENANT', '$AUSTRAL', 'payment', '80000.0000',
              current_date - 3, 'transferencia', '$MARCA', '$USUARIO');" \
      || { echo "🔴 la semilla NO entró"; exit 1; }

    psql -c "
      SELECT t.name, SUM(CASE WHEN m.type='payment' THEN -m.amount ELSE m.amount END)::text AS saldo
        FROM supplier_account_movements m JOIN terceros t ON t.id = m.tercero_id
       WHERE m.tenant_id = '$TENANT' GROUP BY t.name ORDER BY 2 DESC;"
    echo "sembrado"
    ;;

  limpiar)
    # El libro es append-only (triggers): para borrar hay que desactivarlos en
    # la transacción, igual que en los tests.
    #
    # Se borra por PROVEEDOR, no por la marca: al verificar la pantalla se
    # cargan compras y pagos DESDE LA UI, que no llevan marca ninguna. Estos dos
    # proveedores existen sólo porque los crea esta semilla, así que todo lo que
    # cuelga de ellos es de la prueba. Por eso tampoco se borra por fecha.
    psql -c "
      BEGIN;
      SET LOCAL session_replication_role = 'replica';
      DELETE FROM supplier_account_movements
       WHERE tenant_id = '$TENANT' AND tercero_id IN ('$AUSTRAL','$FARO');
      DELETE FROM cash_movements WHERE id IN (
        SELECT cash_movement_id FROM supplier_account_movements
         WHERE tenant_id='$TENANT' AND tercero_id IN ('$AUSTRAL','$FARO')
           AND cash_movement_id IS NOT NULL);
      DELETE FROM stock_movements WHERE tenant_id='$TENANT' AND related_expense_id IN (
        SELECT id FROM expenses WHERE tenant_id='$TENANT'
           AND tercero_id IN ('$AUSTRAL','$FARO'));
      DELETE FROM expense_items WHERE tenant_id='$TENANT' AND expense_id IN (
        SELECT id FROM expenses WHERE tenant_id='$TENANT'
           AND tercero_id IN ('$AUSTRAL','$FARO'));
      DELETE FROM expenses
       WHERE tenant_id = '$TENANT' AND tercero_id IN ('$AUSTRAL','$FARO');
      DELETE FROM terceros WHERE id IN ('$AUSTRAL','$FARO');
      COMMIT;" || { echo "🔴 la limpieza NO corrió"; exit 1; }
    echo "limpiado"
    ;;

  *) echo "uso: $0 sembrar | limpiar"; exit 1 ;;
esac

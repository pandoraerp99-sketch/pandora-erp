#!/usr/bin/env bash
# Datos de mentira en la base de DEV para poder MIRAR la tarjeta "al cierre"
# con números: la base de dev no tiene cierres de caja ni deudores, así que la
# pantalla sale en su estado vacío y una captura verde no probaría nada.
#
# Lo real lo prueba tests/integration/T-CIERRE-01. Esto es sólo para ver.
#
# Uso: bash scripts/semilla-cierre-dev.sh sembrar | limpiar
set -u
TENANT=11111111-1111-4111-8111-111111111111
USUARIO=dec7075a-1ae5-4290-80d6-1ad9ab356d8e
# Distribuidora Austral SRL (CUIT) y Kiosco El Faro (CUIT).
AUSTRAL=fb339bc1-83fb-4046-a78e-818f200802ce
FARO=ba6897a8-3efb-4539-a6b6-374f22b22b94
# Marca para poder borrar exactamente esto y nada más.
MARCA='SEMILLA-CIERRE-DEV'

psql() { docker exec supabase_db_pandora-erp psql -U postgres -P pager=off "$@"; }

case "${1:-}" in
  sembrar)
    # Dos cajas arqueadas HOY (hora del comercio: 21:00 Ushuaia = 00:00 UTC del
    # día siguiente, justo el borde que el reporte tiene que resolver bien).
    psql -c "
      INSERT INTO cash_sessions
        (id, tenant_id, sale_point, opened_by, opened_at, initial_amount,
         closed_by, closed_at, final_amount, expected_amount, descuadre,
         discrepancy_reason)
      VALUES
        (gen_random_uuid(), '$TENANT', 2, '$USUARIO',
         (current_date + time '12:00') AT TIME ZONE 'America/Argentina/Ushuaia',
         '5000.0000', '$USUARIO',
         (current_date + time '21:00') AT TIME ZONE 'America/Argentina/Ushuaia',
         '349000.0000', '349000.0000', '0.0000', '$MARCA'),
        (gen_random_uuid(), '$TENANT', 3, '$USUARIO',
         (current_date + time '12:00') AT TIME ZONE 'America/Argentina/Ushuaia',
         '5000.0000', '$USUARIO',
         (current_date + time '21:00') AT TIME ZONE 'America/Argentina/Ushuaia',
         '51250.5000', '51000.0000', '250.5000', '$MARCA sobrante');"

    # Dos deudores: uno con saldo parcial (fía y paga), otro entero.
    psql -c "
      WITH v AS (
        INSERT INTO sales (id, tenant_id, correlation_id, cashier_user_id,
                           customer_id, commercial_status, total, subtotal,
                           created_at)
        VALUES (gen_random_uuid(), '$TENANT', gen_random_uuid(), '$USUARIO',
                '$AUSTRAL', 'terminada', '88000.0000', '88000.0000',
                now() - interval '9 days'),
               (gen_random_uuid(), '$TENANT', gen_random_uuid(), '$USUARIO',
                '$FARO', 'terminada', '23400.0000', '23400.0000',
                now() - interval '4 days')
        RETURNING id, customer_id, total, created_at
      )
      INSERT INTO customer_account_movements
        (tenant_id, customer_id, type, amount, sale_id, reason, created_by,
         created_at)
      SELECT '$TENANT', v.customer_id, 'charge', v.total, v.id, '$MARCA',
             '$USUARIO', v.created_at
        FROM v;"
    psql -c "
      INSERT INTO customer_account_movements
        (tenant_id, customer_id, type, amount, payment_method, reason,
         created_by, created_at)
      VALUES ('$TENANT', '$AUSTRAL', 'payment', '30000.0000', 'transferencia',
              '$MARCA', '$USUARIO', now() - interval '2 days');"
    ;;

  limpiar)
    # SÓLO lo que lleva la marca. Un filtro por fecha ("lo de los últimos 10
    # días") se llevaba puestos pagos REALES de la base de dev y dejaba sus
    # cargos huérfanos: dos deudores inventados que nadie habría relacionado
    # con este script.
    #
    # `session_replication_role = replica` apaga los triggers: el libro de
    # cuenta corriente es append-only (ADR-0027) y no deja borrar de otra forma.
    # Es la misma llave que usan los tests para limpiar sus fixtures.
    psql -v ON_ERROR_STOP=1 -c "
      BEGIN;
      SET LOCAL session_replication_role = 'replica';
      CREATE TEMP TABLE ventas_sembradas ON COMMIT DROP AS
        SELECT DISTINCT sale_id FROM customer_account_movements
         WHERE tenant_id = '$TENANT' AND reason = '$MARCA'
           AND sale_id IS NOT NULL;
      DELETE FROM customer_account_movements
       WHERE tenant_id = '$TENANT' AND reason = '$MARCA';
      DELETE FROM sales
       WHERE tenant_id = '$TENANT'
         AND id IN (SELECT sale_id FROM ventas_sembradas);
      DELETE FROM cash_sessions
       WHERE tenant_id = '$TENANT'
         AND discrepancy_reason LIKE '$MARCA%';
      COMMIT;"
    ;;

  *)
    echo "uso: bash scripts/semilla-cierre-dev.sh sembrar|limpiar" >&2
    exit 2
    ;;
esac

echo "== estado =="
psql -c "
  SELECT sale_point, closed_at, final_amount
    FROM cash_sessions WHERE tenant_id = '$TENANT' ORDER BY sale_point;"
psql -c "
  SELECT c.name, c.doc_type, c.doc_number,
         sum(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END) AS saldo
    FROM customer_account_movements m
    JOIN customers c ON c.id = m.customer_id
   WHERE m.tenant_id = '$TENANT'
   GROUP BY c.id, c.name, c.doc_type, c.doc_number
  HAVING sum(CASE WHEN m.type = 'payment' THEN -m.amount ELSE m.amount END) > 0;"

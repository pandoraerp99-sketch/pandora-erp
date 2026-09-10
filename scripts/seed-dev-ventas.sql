-- seed-dev-ventas.sql — historial de ventas para DESARROLLO.
--
-- ── POR QUE EXISTE ────────────────────────────────────────────────────────
-- El Panel se disena CONTRA los datos. Lo que habia era detritus de tests: 57
-- "ventas" de las cuales 48 no tenian ni un item ni un pago, una por dia
-- suelto, y varias con fecha FUTURA (2026-09-16). Disenar un dashboard sobre
-- eso es no poder distinguir un bug de layout de un artefacto de los datos —
-- exactamente lo que paso con /gastos cuando estaba en cero.
--
-- Genera 12 meses de ventas COHERENTES: con items, con pagos, con hora del dia
-- realista (pico 18-20h), con medios mezclados y con clientes asignados a una
-- parte. El mes corriente va mas denso, que es lo que el Panel muestra.
--
-- NO es data productiva. Idempotente: borra lo suyo antes de generar.
-- Correr:  docker exec -i supabase_db_pandora-erp psql -U postgres < este.sql

\set ON_ERROR_STOP on

DO $seed$
DECLARE
  co        uuid := '11111111-1111-4111-8111-111111111111';
  cajero    uuid;
  prods     record;
  d         date;
  -- El "hoy" del COMERCIO, no el de la base. La base corre en UTC, y a las 21
  -- de Ushuaia ya es el dia siguiente en UTC: usar current_date generaba ventas
  -- con fecha de manana. Es el mismo error que el Panel tiene que evitar al
  -- decir "ventas de hoy".
  hoy       date := (now() AT TIME ZONE 'America/Argentina/Ushuaia')::date;
  n_ventas  int;
  i         int;
  v_id      uuid;
  v_ts      timestamptz;
  v_hora    int;
  n_items   int;
  j         int;
  p         record;
  cant      numeric(19,4);
  sub       numeric(19,4);
  iva       numeric(19,4);
  tot       numeric(19,4);
  v_sub     numeric(19,4);
  v_iva     numeric(19,4);
  v_tot     numeric(19,4);
  medio     text;
  -- Escalares y no un record: en plpgsql un record no se puede poner en NULL
  -- ("record is not assigned yet"), y la mayoria de las ventas no lleva cliente.
  cli_id    uuid;
  cli_nom   text;
  cli_doc   text;
  cli_cond  text;
  total_gen int := 0;
BEGIN
  SELECT user_id INTO cajero FROM company_users WHERE company_id = co LIMIT 1;
  IF cajero IS NULL THEN
    RAISE EXCEPTION 'No hay usuario para %; corre antes seed-dev-operator.mjs', co;
  END IF;

  -- Append-only: sale_items y sale_payments tienen trigger. Es data de
  -- desarrollo, mismo mecanismo que usan los tests para limpiar.
  SET LOCAL session_replication_role = 'replica';
  DELETE FROM sale_payments WHERE tenant_id = co;
  DELETE FROM sale_items    WHERE tenant_id = co;
  DELETE FROM sales         WHERE tenant_id = co;

  -- Un dia por vez, desde hace 12 meses.
  d := hoy - interval '365 days';
  WHILE d <= hoy LOOP
    -- Volumen: el mes corriente mas denso; domingos cerrado; sabados flojos.
    n_ventas := CASE
      WHEN extract(dow FROM d) = 0 THEN 0
      WHEN d > hoy - interval '35 days' THEN 12 + floor(random() * 14)::int
      ELSE 3 + floor(random() * 5)::int
    END;
    IF extract(dow FROM d) = 6 THEN n_ventas := greatest(1, n_ventas / 2); END IF;

    FOR i IN 1..n_ventas LOOP
      -- Hora con pico a la tarde: la maqueta muestra "mejor hora 18-19h" y el
      -- Panel lo va a calcular de verdad, asi que la curva tiene que existir.
      v_hora := (ARRAY[9,10,10,11,11,12,12,13,14,15,16,17,17,18,18,18,19,19,19,20,20,21])
                [1 + floor(random() * 22)::int];
      -- AT TIME ZONE convierte el timestamp NAIVE a timestamptz interpretandolo
      -- en Ushuaia. Sin esto, la hora seria UTC y la curva quedaria corrida 3
      -- horas: el "pico de las 19" apareceria a las 16 del comercio. La base
      -- corre en UTC (verificado: son las 00:01 UTC = 21:01 en Ushuaia).
      v_ts := (d + (v_hora || ' hours')::interval + (floor(random()*60) || ' minutes')::interval)
              AT TIME ZONE 'America/Argentina/Ushuaia';

      v_id := gen_random_uuid();
      v_sub := 0; v_iva := 0; v_tot := 0;
      n_items := 1 + floor(random() * 4)::int;

      INSERT INTO sales (id, tenant_id, correlation_id, cashier_user_id, sale_point,
                         commercial_status, fiscal_status, subtotal, tax_amount,
                         exempt_amount, total, created_at, finalized_at)
      VALUES (v_id, co, gen_random_uuid(), cajero, 1,
              'cobrada', 'not_required', 0, 0, 0, 0, v_ts, v_ts);

      FOR j IN 1..n_items LOOP
        SELECT id, name, sku, price, tax_rate, tdf_exempt, unit_type
          INTO p
          FROM products
         WHERE tenant_id = co AND is_active
         ORDER BY random() LIMIT 1;
        EXIT WHEN p.id IS NULL;

        cant := CASE WHEN p.unit_type = 'kg' THEN round((0.25 + random()*2)::numeric, 3)
                     ELSE (1 + floor(random()*3))::numeric END;
        sub := round(p.price * cant, 2);
        iva := CASE WHEN p.tdf_exempt THEN 0 ELSE round(sub * p.tax_rate / 100, 2) END;
        tot := sub + iva;

        INSERT INTO sale_items (tenant_id, sale_id, product_id, product_name_snapshot,
                                product_sku_snapshot, product_unit_type_snapshot,
                                unit_price, quantity, tax_rate, tdf_exempt,
                                line_subtotal, line_tax, line_total)
        VALUES (co, v_id, p.id, p.name, p.sku, p.unit_type,
                p.price, cant, p.tax_rate, p.tdf_exempt, sub, iva, tot);

        v_sub := v_sub + sub; v_iva := v_iva + iva; v_tot := v_tot + tot;
      END LOOP;

      -- Medio de pago con una mezcla creible de kiosco fueguino.
      medio := (ARRAY['efectivo','efectivo','efectivo','efectivo','efectivo',
                      'debito','debito','debito','credito','credito',
                      'mp_qr','mp_qr','cuenta_corriente'])[1 + floor(random()*13)::int];

      -- Una parte de las ventas lleva cliente. TODAS las de cuenta corriente,
      -- porque fiarle a un anonimo no tiene sentido.
      cli_id := NULL; cli_nom := NULL; cli_doc := NULL; cli_cond := NULL;
      IF medio = 'cuenta_corriente' OR random() < 0.25 THEN
        SELECT id, name, doc_number, tax_condition
          INTO cli_id, cli_nom, cli_doc, cli_cond
          FROM customers WHERE tenant_id = co AND is_active ORDER BY random() LIMIT 1;
      END IF;

      UPDATE sales SET subtotal = v_sub, tax_amount = v_iva, total = v_tot,
                       payment_method = medio,
                       customer_id = cli_id,
                       customer_name_snapshot = cli_nom,
                       customer_doc_number = cli_doc,
                       customer_tax_condition_snapshot = cli_cond
       WHERE id = v_id;

      -- cuenta_corriente NO genera sale_payment: no entro plata todavia. Es el
      -- mismo criterio de ADR-0027 (el fiado se cobra despues).
      IF medio <> 'cuenta_corriente' THEN
        INSERT INTO sale_payments (tenant_id, sale_id, method, amount, created_at)
        VALUES (co, v_id, medio, v_tot, v_ts);
      END IF;

      total_gen := total_gen + 1;
    END LOOP;

    d := d + interval '1 day';
  END LOOP;

  RAISE NOTICE 'OK · % ventas generadas en 12 meses', total_gen;
END
$seed$;

-- Resumen para verificar de un vistazo.
SELECT 'ventas'          AS que, count(*)::text AS valor FROM sales WHERE tenant_id='11111111-1111-4111-8111-111111111111'
UNION ALL SELECT 'con items',  count(*)::text FROM sales s WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id=s.id)
UNION ALL SELECT 'con pago',   count(*)::text FROM sales s WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id=s.id)
UNION ALL SELECT 'a futuro',   count(*)::text FROM sales WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND (created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date > (now() AT TIME ZONE 'America/Argentina/Ushuaia')::date
UNION ALL SELECT 'de hoy',     count(*)::text FROM sales WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND (created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date = (now() AT TIME ZONE 'America/Argentina/Ushuaia')::date
UNION ALL SELECT 'total hoy',  coalesce(sum(total),0)::numeric(12,2)::text FROM sales WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND (created_at AT TIME ZONE 'America/Argentina/Ushuaia')::date = (now() AT TIME ZONE 'America/Argentina/Ushuaia')::date
UNION ALL SELECT 'medios',     string_agg(DISTINCT payment_method, ', ') FROM sales WHERE tenant_id='11111111-1111-4111-8111-111111111111';

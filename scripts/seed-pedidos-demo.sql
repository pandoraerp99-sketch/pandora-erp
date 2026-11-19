-- Pedidos de DEMO para la base de DESARROLLO: los encargos que dibuja
-- pos-preview/pedidos.html, con fechas relativas a hoy, para poder comparar la
-- pantalla real con la maqueta en el mismo estado.
--
-- ⚠️ Sólo el comercio de prueba (11111111-…, el de operador@pandora.dev). Los
-- cobros van a la caja que esté ABIERTA en ese comercio. No se repite: si ya
-- hay pedidos con la marca de demo, no hace nada.
--
-- Se inserta por SQL y no por el service a propósito: los pedidos viejos
-- necesitan fechas pasadas, que el service (con `now()`) no puede poner. Por
-- eso NO dejan eventos en audit_log: son datos de prueba, no operaciones.
DO $$
DECLARE
  t uuid := '11111111-1111-4111-8111-111111111111';
  u uuid;
  caja uuid;
  n int;
  o uuid;
  hoy date := (now() AT TIME ZONE 'America/Argentina/Ushuaia')::date;
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM orders WHERE tenant_id = t AND notes = 'demo · copia de la maqueta') THEN
    RAISE NOTICE 'ya sembrado: no hago nada';
    RETURN;
  END IF;
  SELECT cu.user_id INTO u FROM company_users cu JOIN users x ON x.id = cu.user_id
   WHERE cu.company_id = t AND x.email = 'operador@pandora.dev';
  SELECT id INTO caja FROM cash_sessions WHERE tenant_id = t AND closed_at IS NULL LIMIT 1;
  IF u IS NULL OR caja IS NULL THEN
    RAISE EXCEPTION 'falta el usuario de prueba o una caja abierta en el comercio de prueba';
  END IF;

  FOR r IN SELECT * FROM (VALUES
    -- dias atras, cliente, detalle, cantidad, precio, estado, sena, cobra_saldo, retira (dias desde hoy)
    (0,  'García SRL',             '50 m de tafeta roja — bordó',         50::numeric,  3200::numeric, 'en_preparacion', 20000::numeric, false, 2),
    (0,  'Lucía Fernández',        'Arreglo vestido de fiesta',            1,           12000,         'tomado',         0,              false, 2),
    (1,  'Kiosco Norte',           '2 cajas de botones forrados (x100)',   2,            1900,         'listo',          1900,           false, 0),
    (1,  'Mercería Belén',         '3 cierres invisibles 60 cm + hilos',   1,            8500,         'listo',          3000,           false, -13),
    (3,  'Laura Méndez',           'Cortinado a medida — living 3,20 m',   3.2,          7500,         'listo',          24000,          false, 4),
    (3,  'Doña Rosa Giménez',      '1 blackout ventana + colocación',      1,            6200,         'entregado',      0,              true,  -1),
    (5,  'Ferretería del Sur',     '20 m elástico + broches a presión',    20,            475,         'entregado',      0,              true,  -3),
    (5,  'Martín Ledesma',         'Cambio de cierre campera',             1,            2800,         'entregado',      0,              true,  -4),
    (10, 'Distribuidora Austral',  '100 m cinta bies + 12 conos hilo',     1,           32000,         'entregado',      8000,           true,  -8),
    (10, 'Norma (vecina)',         'Ruedo de 3 pantalones',                3,            1200,         'entregado',      0,              true,  -8),
    (18, 'Almacén El Sol',         '5 rollos hilo overlock',               5,             900,         'cancelado',      0,              false, -16)
  ) AS v(atras, cliente, detalle, cant, precio, estado, sena, cobra_saldo, retira)
  LOOP
    SELECT COALESCE(MAX(number), 0) + 1 INTO n FROM orders WHERE tenant_id = t;
    INSERT INTO orders (tenant_id, number, customer_name, pickup_date, notes, status,
                        price_freezes, total, created_by, created_at, updated_at,
                        delivered_at, cancelled_at)
    VALUES (t, n, r.cliente, hoy + r.retira, 'demo · copia de la maqueta', r.estado,
            false, round(r.cant * r.precio, 2), u,
            (hoy - r.atras) + time '11:30' AT TIME ZONE 'America/Argentina/Ushuaia', now(),
            CASE WHEN r.estado = 'entregado' THEN (hoy + r.retira) + time '17:00' AT TIME ZONE 'America/Argentina/Ushuaia' END,
            CASE WHEN r.estado = 'cancelado' THEN (hoy - r.atras + 2) + time '10:00' AT TIME ZONE 'America/Argentina/Ushuaia' END)
    RETURNING id INTO o;
    INSERT INTO order_items (tenant_id, order_id, position, description, quantity, unit_price, line_total)
    VALUES (t, o, 1, r.detalle, r.cant, r.precio, round(r.cant * r.precio, 2));
    IF r.sena > 0 THEN
      INSERT INTO order_payments (tenant_id, order_id, kind, method, amount, cash_session_id, created_by, created_at)
      VALUES (t, o, CASE WHEN r.sena >= round(r.cant * r.precio, 2) THEN 'saldo' ELSE 'sena' END,
              'efectivo', r.sena, caja, u,
              (hoy - r.atras) + time '11:32' AT TIME ZONE 'America/Argentina/Ushuaia');
    END IF;
    IF r.cobra_saldo AND round(r.cant * r.precio, 2) > r.sena THEN
      INSERT INTO order_payments (tenant_id, order_id, kind, method, amount, cash_session_id, created_by, created_at)
      VALUES (t, o, 'saldo', 'debito', round(r.cant * r.precio, 2) - r.sena, caja, u,
              (hoy + r.retira) + time '17:00' AT TIME ZONE 'America/Argentina/Ushuaia');
    END IF;
  END LOOP;
  RAISE NOTICE 'sembrados 11 pedidos de demo';
END
$$;

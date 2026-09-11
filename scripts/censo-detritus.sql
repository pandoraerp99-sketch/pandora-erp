-- Censo de detritus en la base de DESARROLLO.
--
-- Para que sirve: correrlo ANTES y DESPUES de la suite de integracion. Si los
-- numeros no se mueven, los tests limpian lo suyo y lo que haya quedado es
-- residuo historico de corridas interrumpidas. Si se mueven, hay un teardown
-- roto HOY y este censo dice cual tabla.
--
-- Existe porque medir contra esta base sin separar por tenant hizo leer
-- "9 de 20.009 productos sin costo" como un dato del comercio, cuando eran
-- 20.000 productos sinteticos de un test de performance de junio.

SELECT 'companies que NO son el demo' AS que, count(*)::text AS cuanto
  FROM companies WHERE id <> '11111111-1111-4111-8111-111111111111'
UNION ALL
SELECT 'productos fuera del demo', count(*)::text
  FROM products WHERE tenant_id <> '11111111-1111-4111-8111-111111111111'
UNION ALL
SELECT 'ventas fuera del demo', count(*)::text
  FROM sales WHERE tenant_id <> '11111111-1111-4111-8111-111111111111'
UNION ALL
SELECT 'sale_items fuera del demo', count(*)::text
  FROM sale_items WHERE tenant_id <> '11111111-1111-4111-8111-111111111111'
UNION ALL
SELECT 'usuarios @test.local', count(*)::text
  FROM users WHERE email LIKE '%@test.local'
UNION ALL
-- Huerfanos: filas cuyo tenant ya no existe como company. Son peores que un
-- tenant de test entero, porque no se ven agrupando por nombre.
SELECT 'HUERFANAS: products sin company', count(*)::text
  FROM products p WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = p.tenant_id)
UNION ALL
SELECT 'HUERFANAS: sales sin company', count(*)::text
  FROM sales s WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = s.tenant_id)
UNION ALL
SELECT 'HUERFANAS: sale_items sin venta', count(*)::text
  FROM sale_items si WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = si.sale_id)
UNION ALL
SELECT 'HUERFANAS: audit_log sin company', count(*)::text
  FROM audit_log a
 WHERE a.tenant_id <> '00000000-0000-0000-0000-000000000000'
   AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = a.tenant_id);

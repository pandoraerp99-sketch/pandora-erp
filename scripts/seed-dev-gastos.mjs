/**
 * seed-dev-gastos.mjs — gastos de ejemplo para DESARROLLO.
 *
 * Existe para poder VERIFICAR la pantalla. Una captura de /gastos sin gastos no
 * prueba nada: no muestra la fila, ni las dos marcas (ya-en-ARCA / hay-que-
 * mandar), ni los totales por categoría, ni si la grilla se desalinea. Con todo
 * en $0,00 cualquier bug de layout pasa desapercibido.
 *
 * Los importes llevan CENTAVOS a propósito: con miles redondos, un error de
 * suma en float pasaría inadvertido (CLAUDE.md §9.8).
 *
 * OJO: inserta DIRECTO en la tabla, sin pasar por registerExpense(). O sea que
 * los que dicen 'efectivo' NO generan su movimiento de caja. La pantalla no
 * miente por eso — la leyenda "salio de la caja" sale de cash_movement_id, que
 * en estos es null — pero no tomes esta data como prueba de que el efectivo
 * funciona: eso lo prueban T-GASTO-01 y la carga real desde la pantalla.
 *
 * NO es data productiva. Idempotente: borra los suyos antes de insertar.
 * Correr:  node scripts/seed-dev-gastos.mjs
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.test', 'utf8')
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const sql = postgres(env.DATABASE_URL, { max: 1 });

/**
 * La demo cierra ejercicio en JULIO, como el caso real del pedido
 * (ROMERO & RUIZ SAS: 01/08/2025 → 31/07/2026). Con el default 12 el grano
 * "Ejercicio" sería el año calendario y no se distinguiría de "Año".
 */
const MES_CIERRE = 7;

/** Un día de ESTE mes, para que caiga en el período por defecto. */
const dia = (n) => {
  const h = new Date();
  const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), n));
  return d.toISOString().slice(0, 10);
};

/**
 * Un día DENTRO del último ejercicio cerrado, o sea antes del 01/08 de este
 * año. Sin estos, el grano "Ejercicio" mostraría cero y no verificaría nada:
 * los del mes corriente caen DESPUES del cierre.
 */
const diaDelEjercicio = (mes, n) => {
  const h = new Date();
  // Si ya pasamos el mes de cierre, el ejercicio cerrado termina este año.
  const anioFin = h.getUTCMonth() + 1 > MES_CIERRE
    ? h.getUTCFullYear()
    : h.getUTCFullYear() - 1;
  // Meses posteriores al de cierre pertenecen al año ANTERIOR del rango.
  const anio = mes > MES_CIERRE ? anioFin - 1 : anioFin;
  return new Date(Date.UTC(anio, mes - 1, n)).toISOString().slice(0, 10);
};

const GASTOS = [
  // Con factura → el estudio los baja de ARCA. Netos + IVA cierran contra el total.
  {
    fecha: dia(3), categoria: 'alquiler', payee_name: 'Inmobiliaria Del Sur',
    payee_doc: '30-71234567-4', neto: '330578.51', iva: '69421.49', total: '400000.00',
    comprobante_tipo: 'Factura', comprobante_numero: '0003-00004521',
    en_iva_compras: true, medio_pago: 'transferencia', descripcion: 'Alquiler del local',
  },
  {
    fecha: dia(5), categoria: 'servicios', payee_name: 'Camuzzi Gas del Sur',
    payee_doc: '30-65786411-2', neto: '38264.46', iva: '8035.54', total: '46300.00',
    comprobante_tipo: 'Factura', comprobante_numero: '0001-00982211',
    en_iva_compras: true, medio_pago: 'debito', descripcion: 'Gas',
  },
  {
    fecha: dia(8), categoria: 'mercaderia', payee_name: 'Distribuidora Fueguina',
    payee_doc: '30-70991234-8', neto: '212396.69', iva: '44603.31', total: '257000.00',
    comprobante_tipo: 'Factura', comprobante_numero: '0007-00031188',
    en_iva_compras: true, medio_pago: 'transferencia', descripcion: 'Reposición',
  },
  {
    fecha: dia(11), categoria: 'seguros', payee_name: 'Sancor Seguros',
    payee_doc: '30-50001427-5', neto: '52892.56', iva: '11107.44', total: '64000.00',
    comprobante_tipo: 'Factura', comprobante_numero: '0002-00776543',
    en_iva_compras: true, medio_pago: 'credito', descripcion: 'Póliza del local',
  },
  // SIN comprobante fiscal → son los que hay que mandarle a la contadora.
  {
    fecha: dia(6), categoria: 'otros', payee_name: 'Ferretería del barrio',
    payee_doc: null, neto: '0', iva: '0', total: '18450.75',
    comprobante_tipo: 'Ticket', comprobante_numero: null,
    en_iva_compras: false, medio_pago: 'efectivo', descripcion: 'Cerradura y bisagras',
  },
  {
    fecha: dia(9), categoria: 'impuestos_y_tasas', payee_name: 'Municipalidad de Río Grande',
    payee_doc: null, neto: '0', iva: '0', total: '27300.40',
    comprobante_tipo: 'Recibo', comprobante_numero: null,
    en_iva_compras: false, medio_pago: 'transferencia', descripcion: 'Tasa de comercio',
  },
  {
    fecha: dia(12), categoria: 'honorarios', payee_name: 'Estudio contable',
    payee_doc: null, neto: '0', iva: '0', total: '95000.00',
    comprobante_tipo: null, comprobante_numero: null,
    en_iva_compras: false, medio_pago: 'transferencia', descripcion: 'Honorarios del mes',
  },
  {
    fecha: dia(14), categoria: 'servicios', payee_name: 'Fletes Ushuaia',
    payee_doc: null, neto: '0', iva: '0', total: '12800.85',
    comprobante_tipo: null, comprobante_numero: null,
    en_iva_compras: false, medio_pago: 'efectivo', descripcion: 'Flete de la reposición',
  },

  // ── Dentro del ULTIMO EJERCICIO CERRADO (01/08 al 31/07) ────────────────
  // Estos NO aparecen en "Mes": estan para que el grano "Ejercicio" tenga algo
  // que mostrar y se vea que es un recorte distinto del ano calendario.
  {
    fecha: diaDelEjercicio(11, 5), categoria: 'alquiler', payee_name: 'Inmobiliaria Del Sur',
    payee_doc: '30-71234567-4', neto: '289256.20', iva: '60743.80', total: '350000.00',
    comprobante_tipo: 'Factura', comprobante_numero: '0003-00003980',
    en_iva_compras: true, medio_pago: 'transferencia', descripcion: 'Alquiler de noviembre',
  },
  {
    fecha: diaDelEjercicio(3, 18), categoria: 'impuestos_y_tasas',
    payee_name: 'Municipalidad de Río Grande',
    payee_doc: null, neto: '0', iva: '0', total: '24800.60',
    comprobante_tipo: 'Recibo', comprobante_numero: null,
    en_iva_compras: false, medio_pago: 'transferencia', descripcion: 'Tasa de comercio',
  },
  {
    fecha: diaDelEjercicio(6, 27), categoria: 'seguros', payee_name: 'Sancor Seguros',
    payee_doc: '30-50001427-5', neto: '46280.99', iva: '9719.01', total: '56000.00',
    comprobante_tipo: 'Factura', comprobante_numero: '0002-00701122',
    en_iva_compras: true, medio_pago: 'credito', descripcion: 'Póliza anual',
  },
  {
    fecha: diaDelEjercicio(7, 30), categoria: 'honorarios', payee_name: 'Estudio contable',
    payee_doc: null, neto: '0', iva: '0', total: '88500.25',
    comprobante_tipo: null, comprobante_numero: null,
    en_iva_compras: false, medio_pago: 'transferencia',
    descripcion: 'Honorarios del cierre — último día del ejercicio',
  },
];

// Los gastos son append-only: el trigger bloquea UPDATE y DELETE. Para poder
// re-sembrar hay que desactivar los triggers de la sesión, igual que hacen los
// tests en su limpieza. Es data de DESARROLLO — en producción esto no corre.
await sql.begin(async (tx) => {
  await tx`SET LOCAL session_replication_role = 'replica'`;
  await tx`DELETE FROM expenses WHERE tenant_id = ${COMPANY_ID}`;
});

// La demo cierra en julio, como el caso real. Si quedara en el default 12, el
// grano "Ejercicio" daría el año calendario y no se distinguiría de "Año".
await sql`UPDATE companies SET fiscal_year_end_month = ${MES_CIERRE} WHERE id = ${COMPANY_ID}`;

for (const g of GASTOS) {
  await sql`
    INSERT INTO expenses (
      tenant_id, fecha, categoria, payee_name, payee_doc,
      neto, iva, total, descripcion, comprobante_tipo, comprobante_numero,
      en_iva_compras, medio_pago
    ) VALUES (
      ${COMPANY_ID}, ${g.fecha}::date, ${g.categoria}, ${g.payee_name}, ${g.payee_doc},
      ${g.neto}, ${g.iva}, ${g.total}, ${g.descripcion}, ${g.comprobante_tipo},
      ${g.comprobante_numero}, ${g.en_iva_compras}, ${g.medio_pago}
    )`;
}

const [r] = await sql`
  SELECT count(*)::int                                              AS n,
         sum(total)::text                                           AS total,
         coalesce(sum(iva) FILTER (WHERE en_iva_compras), 0)::text  AS credito,
         count(*) FILTER (WHERE NOT en_iva_compras)::int            AS fuera
  FROM expenses WHERE tenant_id = ${COMPANY_ID}`;

// El mes corriente y el ejercicio cerrado, por separado: son los dos recortes
// que la pantalla ofrece y no se pisan.
const mesDesde = dia(1);
const [m] = await sql`
  SELECT count(*)::int AS n, coalesce(sum(total),0)::text AS total
  FROM expenses WHERE tenant_id = ${COMPANY_ID} AND fecha >= ${mesDesde}::date`;
const [e] = await sql`
  SELECT count(*)::int AS n, coalesce(sum(total),0)::text AS total
  FROM expenses WHERE tenant_id = ${COMPANY_ID} AND fecha < ${mesDesde}::date`;

console.log(
  `OK · ${r.n} gastos · total ${r.total} · IVA crédito ${r.credito} · ${r.fuera} para mandar`
);
console.log(
  `     mes corriente: ${m.n} ($${m.total}) · ejercicio cerrado: ${e.n} ($${e.total}) · cierre mes ${MES_CIERRE}`
);
await sql.end();

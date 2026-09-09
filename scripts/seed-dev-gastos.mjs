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

/** Un día de ESTE mes, para que caiga en el período por defecto. */
const dia = (n) => {
  const h = new Date();
  const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), n));
  return d.toISOString().slice(0, 10);
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
];

// Los gastos son append-only: el trigger bloquea UPDATE y DELETE. Para poder
// re-sembrar hay que desactivar los triggers de la sesión, igual que hacen los
// tests en su limpieza. Es data de DESARROLLO — en producción esto no corre.
await sql.begin(async (tx) => {
  await tx`SET LOCAL session_replication_role = 'replica'`;
  await tx`DELETE FROM expenses WHERE tenant_id = ${COMPANY_ID}`;
});

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

console.log(
  `OK · ${r.n} gastos · total ${r.total} · IVA crédito ${r.credito} · ${r.fuera} para mandar`
);
await sql.end();

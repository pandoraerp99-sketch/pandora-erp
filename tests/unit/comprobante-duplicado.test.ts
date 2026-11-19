import { describe, expect, it } from 'vitest';
import {
  mismoComprobante,
  mismoProveedor,
  normalizarCuit,
  normalizarNumero,
  normalizarTexto,
  tieneProveedor,
  type DatosComprobante,
} from '../../src/lib/domain/comprobante-duplicado';

const base: DatosComprobante = {
  tercero_id: null,
  payee_doc: null,
  payee_name: null,
  comprobante_tipo: 'Factura',
  comprobante_numero: '0007-00001162',
};
const con = (cambios: Partial<DatosComprobante>): DatosComprobante => ({ ...base, ...cambios });

describe('normalizarNumero', () => {
  it.each([
    ['0007-00001162', '7-1162'],
    ['7-1162', '7-1162'],
    ['00007 00001162', '7-1162'],
    ['FC A 0007-00001162', '7-1162'],
    ['N° 00007-00001162', '7-1162'],
    ['1234', '1234'],
    ['00001234', '1234'],
    ['0001-00000000', '1-0'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarNumero(entrada)).toBe(esperado);
  });

  it('sin dígitos no es un número', () => {
    expect(normalizarNumero('')).toBeNull();
    expect(normalizarNumero('s/n')).toBeNull();
    expect(normalizarNumero(null)).toBeNull();
  });
});

describe('normalizarTexto y normalizarCuit', () => {
  it('ignora mayúsculas, acentos, puntos y espacios de más', () => {
    expect(normalizarTexto('  Makor  S.A. ')).toBe('makor sa');
    expect(normalizarTexto('Distribuidora Caseros')).toBe(
      normalizarTexto('DISTRIBUIDORA   CASEROS')
    );
    expect(normalizarTexto('Texturas del Sur')).toBe(normalizarTexto('Texturas del Súr'));
    expect(normalizarTexto('   ')).toBeNull();
  });

  it('el CUIT se compara por sus dígitos', () => {
    expect(normalizarCuit('30-71469403-7')).toBe('30714694037');
    expect(normalizarCuit('30714694037')).toBe('30714694037');
    expect(normalizarCuit('123')).toBeNull();
  });
});

describe('mismoProveedor', () => {
  it('por la ficha, por el CUIT o por el nombre escrito igual', () => {
    expect(mismoProveedor(con({ tercero_id: 't1' }), con({ tercero_id: 't1' }))).toBe(true);
    expect(
      mismoProveedor(con({ payee_doc: '30-71469403-7' }), con({ payee_doc: '30714694037' }))
    ).toBe(true);
    expect(mismoProveedor(con({ payee_name: 'Makor SA' }), con({ payee_name: 'MAKOR S.A.' }))).toBe(
      true
    );
  });

  it('una ficha con CUIT reconoce al mismo proveedor cargado a mano con ese CUIT', () => {
    expect(
      mismoProveedor(
        con({ tercero_id: 't1', payee_doc: '30-71469403-7', payee_name: 'Makor SA' }),
        con({ payee_doc: '30714694037' })
      )
    ).toBe(true);
  });

  it('sin ninguna llave en común, no', () => {
    expect(mismoProveedor(con({ tercero_id: 't1' }), con({ tercero_id: 't2' }))).toBe(false);
    expect(mismoProveedor(con({ payee_name: 'Makor' }), con({ payee_name: 'Traberso' }))).toBe(
      false
    );
    expect(mismoProveedor(con({}), con({}))).toBe(false);
  });
});

describe('mismoComprobante', () => {
  const makor = { tercero_id: 'makor', payee_name: 'Makor SA' };

  it('mismo número con otro formato, mismo tipo y proveedor: es el mismo', () => {
    expect(
      mismoComprobante(
        con({ ...makor, comprobante_numero: '7-1162' }),
        con({ ...makor, comprobante_numero: '0007-00001162' })
      )
    ).toBe(true);
  });

  it('el mismo número de OTRO proveedor no es el mismo', () => {
    expect(
      mismoComprobante(con(makor), con({ tercero_id: 'traberso', payee_name: 'Traberso SRL' }))
    ).toBe(false);
  });

  it('una nota de débito con el mismo número no es la factura', () => {
    expect(
      mismoComprobante(con(makor), con({ ...makor, comprobante_tipo: 'Nota de débito' }))
    ).toBe(false);
  });

  it('un gasto viejo sin tipo, con el mismo número y proveedor, sí lo es', () => {
    expect(mismoComprobante(con(makor), con({ ...makor, comprobante_tipo: null }))).toBe(true);
  });

  it('otro número, o sin número, no', () => {
    expect(
      mismoComprobante(con(makor), con({ ...makor, comprobante_numero: '0007-00001163' }))
    ).toBe(false);
    expect(mismoComprobante(con({ ...makor, comprobante_numero: null }), con(makor))).toBe(false);
  });
});

describe('tieneProveedor', () => {
  it('alcanza con una llave; sin ninguna, no', () => {
    expect(tieneProveedor(con({ payee_name: 'Panadería' }))).toBe(true);
    expect(tieneProveedor(con({ payee_doc: '20-22740416-8' }))).toBe(true);
    expect(tieneProveedor(con({}))).toBe(false);
  });
});

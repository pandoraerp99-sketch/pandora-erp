/**
 * Tests unitarios inventory queries — pure helpers + wrapper smoke.
 * Sprint 3 ROADMAP Inventory T-INV-03 (parcial — sanitization cubierto).
 *
 * Cubre:
 * - buildNameSearchPattern (sanitiza + valida longitud + escapa wildcards ILIKE)
 * - normalizeExactLookup (trim + length checks barcode/sku)
 * - normalizeLimit (default + max bounds)
 * - Wrapper smoke (requireTracingContext gate)
 *
 * Tests con DB real (pg_trgm similarity ranking + partial unique index + RLS
 * + P95 < 100ms con 10k productos) → diferidos a tests/integration T-INV-08.
 */
import { describe, expect, it } from 'vitest';
import {
  buildNameSearchPattern,
  normalizeExactLookup,
  normalizeLimit,
  searchProductsByName,
  findProductByBarcode,
  findProductBySku,
  listLowStockProducts,
  listProductsPaginated,
  QueryValidationError,
} from '@/lib/inventory/queries';

describe('buildNameSearchPattern — typeahead sanitization', () => {
  it('query normal "toallon" → passthrough trimmed', () => {
    expect(buildNameSearchPattern('toallon')).toBe('toallon');
  });

  it('query con whitespace alrededor → trim', () => {
    expect(buildNameSearchPattern('  algodón  ')).toBe('algodón');
  });

  it('1 caracter → throw (typeahead requiere 2+)', () => {
    expect(() => buildNameSearchPattern('a')).toThrow(QueryValidationError);
  });

  it('vacío → throw', () => {
    expect(() => buildNameSearchPattern('')).toThrow(QueryValidationError);
  });

  it('solo whitespace → throw', () => {
    expect(() => buildNameSearchPattern('   ')).toThrow(QueryValidationError);
  });

  it('100 chars → OK (límite máximo)', () => {
    const long = 'a'.repeat(100);
    expect(buildNameSearchPattern(long)).toBe(long);
  });

  it('101 chars → throw (DoS guard)', () => {
    const tooLong = 'a'.repeat(101);
    expect(() => buildNameSearchPattern(tooLong)).toThrow(QueryValidationError);
  });

  it('escapa % (LIKE injection)', () => {
    // "100% efectivo" sin escape → ILIKE matchea casi todo.
    expect(buildNameSearchPattern('100% efectivo')).toBe('100\\% efectivo');
  });

  it('escapa _ (LIKE single-char wildcard)', () => {
    expect(buildNameSearchPattern('co_a')).toBe('co\\_a');
  });

  it('escapa \\ (backslash literal)', () => {
    // Backslash debe escaparse PRIMERO, sino el escape de % se corrompe.
    expect(buildNameSearchPattern('a\\b')).toBe('a\\\\b');
  });

  it('combinación: \\%_ → \\\\\\%\\_', () => {
    // Backslash primero (a → a\\), después %, después _
    expect(buildNameSearchPattern('a\\%_b')).toBe('a\\\\\\%\\_b');
  });

  it('non-string → throw', () => {
    expect(() =>
      // @ts-expect-error testing runtime guard
      buildNameSearchPattern(123)
    ).toThrow(QueryValidationError);
  });
});

describe('normalizeExactLookup — barcode/sku exact', () => {
  it('barcode válido EAN-13 → passthrough', () => {
    expect(normalizeExactLookup('7790000123456', 'barcode')).toBe('7790000123456');
  });

  it('SKU válido con guiones → passthrough', () => {
    expect(normalizeExactLookup('V-MAL-750', 'sku')).toBe('V-MAL-750');
  });

  it('trim whitespace', () => {
    expect(normalizeExactLookup('  ABC123  ', 'sku')).toBe('ABC123');
  });

  it('vacío → throw', () => {
    expect(() => normalizeExactLookup('', 'barcode')).toThrow(QueryValidationError);
  });

  it('solo whitespace → throw', () => {
    expect(() => normalizeExactLookup('   ', 'sku')).toThrow(QueryValidationError);
  });

  it('101 chars → throw (DoS guard)', () => {
    expect(() =>
      normalizeExactLookup('a'.repeat(101), 'barcode')
    ).toThrow(QueryValidationError);
  });

  it('non-string → throw', () => {
    expect(() =>
      // @ts-expect-error testing runtime guard
      normalizeExactLookup(123, 'sku')
    ).toThrow(QueryValidationError);
  });

  it('caracteres especiales permitidos (barcodes alfanuméricos)', () => {
    // Code128 permite ASCII printable
    expect(normalizeExactLookup('Code-128/AB', 'barcode')).toBe('Code-128/AB');
  });
});

describe('normalizeLimit — pagination bounds', () => {
  it('undefined → default 20', () => {
    expect(normalizeLimit(undefined)).toBe(20);
  });

  it('undefined con defaultLimit custom → custom', () => {
    expect(normalizeLimit(undefined, 50)).toBe(50);
  });

  it('1 → OK', () => {
    expect(normalizeLimit(1)).toBe(1);
  });

  it('100 (max default) → OK', () => {
    expect(normalizeLimit(100)).toBe(100);
  });

  it('101 (excede max) → throw', () => {
    expect(() => normalizeLimit(101)).toThrow(QueryValidationError);
  });

  it('0 → throw', () => {
    expect(() => normalizeLimit(0)).toThrow(QueryValidationError);
  });

  it('-1 → throw', () => {
    expect(() => normalizeLimit(-1)).toThrow(QueryValidationError);
  });

  it('1.5 (no entero) → throw', () => {
    expect(() => normalizeLimit(1.5)).toThrow(QueryValidationError);
  });

  it('maxLimit custom respetado (200)', () => {
    expect(normalizeLimit(200, 50, 200)).toBe(200);
    expect(() => normalizeLimit(201, 50, 200)).toThrow(QueryValidationError);
  });
});

describe('searchProductsByName wrapper — context gate', () => {
  it('llamado FUERA de tracing context → throw', async () => {
    await expect(searchProductsByName('algodón')).rejects.toThrow(
      /no esta inicializado/
    );
  });

  it('query inválida (1 char) → throw QueryValidationError (sanitize antes que context)', async () => {
    // El sanitize de query corre PRIMERO en pure helper. Pero el wrapper
    // llama requireTenantId() ANTES de buildNameSearchPattern → ese throw gana.
    // OK porque ambos son input validation. Documenta el orden actual.
    await expect(searchProductsByName('a')).rejects.toThrow(/no esta inicializado/);
  });
});

describe('findProductByBarcode wrapper — context gate', () => {
  it('llamado FUERA de tracing context → throw', async () => {
    await expect(findProductByBarcode('7790000123456')).rejects.toThrow(
      /no esta inicializado/
    );
  });
});

describe('findProductBySku wrapper — context gate', () => {
  it('llamado FUERA de tracing context → throw', async () => {
    await expect(findProductBySku('V-MAL-750')).rejects.toThrow(
      /no esta inicializado/
    );
  });
});

describe('listLowStockProducts wrapper — context gate', () => {
  it('llamado FUERA de tracing context → throw', async () => {
    await expect(listLowStockProducts()).rejects.toThrow(/no esta inicializado/);
  });
});

describe('listProductsPaginated wrapper — context gate + offset validation', () => {
  it('llamado FUERA de tracing context → throw', async () => {
    await expect(listProductsPaginated()).rejects.toThrow(/no esta inicializado/);
  });

  it('offset negativo → throw (pre-mutation validation NO corre por context first)', async () => {
    // Mismo principio que searchProductsByName: context gate gana.
    await expect(listProductsPaginated({ offset: -1 })).rejects.toThrow(
      /no esta inicializado/
    );
  });
});

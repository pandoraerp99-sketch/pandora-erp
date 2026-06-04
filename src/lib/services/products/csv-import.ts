/**
 * CSV bulk import de productos.
 *
 * Resuelve el dolor confirmado del owner: "comerciante TDF tiene Excel con
 * 200-2000 productos, ¿como los entra a Pandora?".
 *
 * Formato CSV esperado (header fila 1):
 *   name,sku,barcode,unit_type,price,cost,tax_rate,tdf_exempt,stock_current,stock_minimum
 *
 * - Lineas en blanco se ignoran
 * - Lineas que empiezan con '#' son comentario
 * - Columnas opcionales (sku, barcode, cost, etc) pueden estar vacias
 * - Decimales con punto (no coma): "1234.56" NO "1234,56"
 *
 * Devuelve resumen con counts (ok / fail) + errores por fila.
 */
import { z } from 'zod';
import { db } from '../../db/client.js';
import { products } from '../../db/schema/products.js';
import { UNIT_TYPES } from '../../db/schema/products.js';
import { writeAuditLog } from '../../audit/audit-writer.js';
import { logger } from '../../observability/logger.js';
import { ValidationError } from '../../multi_tenant/errors.js';
import { requireTenantId } from '../../tracing/context.js';

const REQUIRED_COLUMNS = ['name', 'price'] as const;
const ALLOWED_COLUMNS = [
  'name',
  'sku',
  'barcode',
  'unit_type',
  'price',
  'cost',
  'tax_rate',
  'tdf_exempt',
  'stock_current',
  'stock_minimum',
] as const;

const csvRowSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  sku: z.string().max(64).optional(),
  barcode: z.string().max(64).optional(),
  unit_type: z.enum(UNIT_TYPES).default('unidad'),
  price: z.string().regex(/^\d+(\.\d{1,4})?$/),
  cost: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  tax_rate: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/)
    .default('21.00'),
  tdf_exempt: z
    .union([z.literal('true'), z.literal('false'), z.literal('')])
    .default('false')
    .transform((v) => v === 'true'),
  stock_current: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default('0'),
  stock_minimum: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
});

export interface CsvImportError {
  row: number;
  message: string;
  raw_line: string;
}

export interface CsvImportResult {
  ok_count: number;
  fail_count: number;
  total_rows: number;
  errors: ReadonlyArray<CsvImportError>;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

export async function importProductsFromCsv(
  csvContent: string
): Promise<CsvImportResult> {
  const tenantId = requireTenantId();

  const rawLines = csvContent.split(/\r?\n/);
  const lines: Array<{ originalRow: number; text: string }> = [];
  rawLines.forEach((text, idx) => {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    lines.push({ originalRow: idx + 1, text });
  });

  if (lines.length === 0) {
    throw new ValidationError('CSV vacio o solo contiene comentarios', {
      csv: 'No hay filas para importar',
    });
  }

  const firstLine = lines[0]!;
  const headers = parseCsvLine(firstLine.text).map((h) => h.toLowerCase());

  for (const required of REQUIRED_COLUMNS) {
    if (!headers.includes(required)) {
      throw new ValidationError(`Columna obligatoria ausente: ${required}`, {
        csv: `Header debe incluir al menos: ${REQUIRED_COLUMNS.join(', ')}`,
      });
    }
  }

  const unknownColumns = headers.filter(
    (h) => !ALLOWED_COLUMNS.includes(h as (typeof ALLOWED_COLUMNS)[number])
  );
  if (unknownColumns.length > 0) {
    throw new ValidationError(`Columnas desconocidas: ${unknownColumns.join(', ')}`, {
      csv: `Columnas permitidas: ${ALLOWED_COLUMNS.join(', ')}`,
    });
  }

  const dataLines = lines.slice(1);
  const errors: CsvImportError[] = [];
  let okCount = 0;

  const rowsToInsert: Array<typeof products.$inferInsert> = [];

  for (const line of dataLines) {
    const cells = parseCsvLine(line.text);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });

    const parsed = csvRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({
        row: line.originalRow,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        raw_line: line.text,
      });
      continue;
    }

    rowsToInsert.push({
      tenant_id: tenantId,
      name: parsed.data.name,
      sku: parsed.data.sku,
      barcode: parsed.data.barcode,
      unit_type: parsed.data.unit_type,
      price: parsed.data.price,
      cost: parsed.data.cost,
      tax_rate: parsed.data.tax_rate,
      tdf_exempt: parsed.data.tdf_exempt,
      stock_current: parsed.data.stock_current,
      stock_minimum: parsed.data.stock_minimum,
    });
  }

  if (rowsToInsert.length > 0) {
    await db.transaction(async (tx) => {
      await tx.insert(products).values(rowsToInsert);
      okCount = rowsToInsert.length;

      await writeAuditLog(
        {
          event_name: 'product.bulk_imported',
          payload: {
            ok_count: okCount,
            fail_count: errors.length,
            total_rows: dataLines.length,
          },
          pii_level: 'internal',
          severity: errors.length > 0 ? 'warning' : 'info',
        },
        tx
      );
    });
  }

  logger.info(
    {
      ok_count: okCount,
      fail_count: errors.length,
      total: dataLines.length,
    },
    'product.bulk_imported'
  );

  return {
    ok_count: okCount,
    fail_count: errors.length,
    total_rows: dataLines.length,
    errors,
  };
}

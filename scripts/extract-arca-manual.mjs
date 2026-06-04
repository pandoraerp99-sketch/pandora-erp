/**
 * Extrae texto del manual oficial WSFEv1 (PDF) y persiste a .txt.
 * Uso: node extract-arca-manual.mjs <input.pdf> <output.txt>
 *
 * Sprint Auditoría Beta 2026-06-03: verificar manual v4.2 oficial canonical
 * vs research v3.4.2 que cerró ADR-0023 + tax-policy-versions/ar-2026-06-v1.md.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node extract-arca-manual.mjs <input.pdf> <output.txt>');
  process.exit(1);
}

const buffer = await readFile(inputPath);
const parser = new PDFParse({ data: new Uint8Array(buffer) });

const info = await parser.getInfo();
console.log('=== PDF METADATA ===');
console.log(JSON.stringify(info, null, 2));

const textResult = await parser.getText();
const text =
  typeof textResult === 'string' ? textResult : (textResult.text ?? JSON.stringify(textResult));

await writeFile(outputPath, text, 'utf8');
console.log(`\n=== Wrote ${text.length} chars to ${outputPath} ===`);
console.log(`Total pages: ${textResult.numpages ?? 'unknown'}`);

await parser.destroy();

// Converte data/bling/sku-map.csv → src/lib/sku-map-data.ts
// Rodar quando o CSV mudar: node scripts/gen-sku-map.mjs

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.join(__dirname, '..');

const csvPath = path.join(root, 'data', 'bling', 'sku-map.csv');
const outPath = path.join(root, 'src', 'lib', 'sku-map-data.ts');

const raw     = fs.readFileSync(csvPath, 'utf-8');
const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
const lines   = content.split(/\r?\n/);

// Usa Map para deduplicar (chave = SKU FILHO — mantém última ocorrência)
const map = new Map();

// linha 0 = cabeçalho
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols     = line.split(';');
  const skuFilho = cols[2]?.trim().toUpperCase();
  const skuPai   = cols[5]?.trim().toUpperCase();
  const qtyKit   = parseInt(cols[6]?.trim() ?? '1', 10);

  if (!skuFilho || !skuPai) continue;

  map.set(skuFilho, { skuPai, qtyKit: isNaN(qtyKit) || qtyKit < 1 ? 1 : qtyKit });
}

const entries = [...map.entries()];

const lines_out = [
  '// ─── Gerado automaticamente por scripts/gen-sku-map.mjs ───────────────────────',
  `// Origem: data/bling/sku-map.csv — ${entries.length} entradas únicas`,
  '// NÃO EDITE MANUALMENTE. Rode: node scripts/gen-sku-map.mjs',
  '',
  'export interface SkuEntry { skuPai: string; qtyKit: number }',
  '',
  'const data: Record<string, SkuEntry> = {',
  ...entries.map(([sku, e]) => `  '${sku}': { skuPai: '${e.skuPai}', qtyKit: ${e.qtyKit} },`),
  '};',
  '',
  'export default data;',
];

fs.writeFileSync(outPath, lines_out.join('\n'), 'utf-8');
console.log(`✓ ${entries.length} entradas únicas escritas em src/lib/sku-map-data.ts`);

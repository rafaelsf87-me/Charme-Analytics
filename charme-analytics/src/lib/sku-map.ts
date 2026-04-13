// ─── Mapeamento estático SKU FILHO → SKU PAI ──────────────────────────────────
// Fonte: data/bling/sku-map.csv (exportado do Bling)
// Colunas (separador ;): ID_filho ; Desc_filho ; SKU_filho ;
//                        ID_pai   ; Desc_pai   ; SKU_pai   ; Qtde_kit
//
// qtyKit = quantas unidades do PAI compõem 1 unidade do FILHO.
// Ex.: CD1343-6 (Kit 6) → skuPai=CD1343, qtyKit=6
//      A quantidade real de un. do PAI = quantidade_pedido × qtyKit

import * as fs   from 'fs';
import * as path from 'path';

export interface SkuInfo {
  skuPai:  string;
  qtyKit:  number;
}

type SkuMap = Map<string, SkuInfo>;

let _cache: SkuMap | null = null;

function loadMap(): SkuMap {
  if (_cache) return _cache;

  const csvPath = path.join(process.cwd(), 'data', 'bling', 'sku-map.csv');
  const raw      = fs.readFileSync(csvPath, 'utf-8');

  // Remove BOM (UTF-8 with BOM → starts with \uFEFF)
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;

  const map: SkuMap = new Map();
  const lines = content.split(/\r?\n/);

  // Linha 0 = cabeçalho — pular
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(';');
    // col[2] = SKU FILHO, col[5] = SKU PAI, col[6] = Qtde
    const skuFilho = cols[2]?.trim();
    const skuPai   = cols[5]?.trim();
    const qtyKit   = parseInt(cols[6]?.trim() ?? '1', 10);

    if (!skuFilho || !skuPai) continue;

    map.set(skuFilho.toUpperCase(), {
      skuPai:  skuPai.toUpperCase(),
      qtyKit:  isNaN(qtyKit) || qtyKit < 1 ? 1 : qtyKit,
    });
  }

  _cache = map;
  return map;
}

/**
 * Retorna o SKU PAI e a quantidade de unidades do PAI por unidade do FILHO.
 * Se o SKU não estiver no mapa (já é um PAI ou desconhecido), retorna null.
 */
export function getSkuInfo(sku: string): SkuInfo | null {
  return loadMap().get(sku.toUpperCase()) ?? null;
}

/**
 * Resolve o SKU canônico (PAI) para exibição e agrupamento.
 * Se não encontrar mapeamento, retorna o próprio SKU recebido.
 */
export function getParentSku(sku: string): string {
  return loadMap().get(sku.toUpperCase())?.skuPai ?? sku.toUpperCase();
}

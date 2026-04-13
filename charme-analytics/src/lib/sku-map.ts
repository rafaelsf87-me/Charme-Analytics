// ─── Mapeamento SKU FILHO → PAI ───────────────────────────────────────────────
// Dados pré-compilados em sku-map-data.ts (gerado por scripts/gen-sku-map.mjs).
// Zero I/O em runtime — bundled junto com o código na build.
//
// Para atualizar quando o CSV mudar:
//   node scripts/gen-sku-map.mjs && git add src/lib/sku-map-data.ts

import data, { type SkuEntry } from './sku-map-data';

export type { SkuEntry };

/**
 * Retorna { skuPai, qtyKit } para um SKU FILHO.
 * qtyKit = unidades do PAI por unidade do FILHO (ex: kit-6 → 6).
 * Retorna null se o SKU não estiver no mapa (já é PAI ou desconhecido).
 */
export function getSkuInfo(sku: string): SkuEntry | null {
  return data[sku.toUpperCase()] ?? null;
}

/**
 * Resolve o SKU canônico (PAI) para agrupamento.
 * Se não encontrar mapeamento, retorna o próprio SKU.
 */
export function getParentSku(sku: string): string {
  return data[sku.toUpperCase()]?.skuPai ?? sku.toUpperCase();
}

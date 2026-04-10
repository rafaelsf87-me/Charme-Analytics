// ─── Fase 2: Buscar Itens de um Batch de Pedidos ─────────────────────────────
// Batch size: 50 pedidos por request. Rate limit: 340ms entre calls (3 req/s).
// Cada item inclui pedidoId para permitir filtro por loja no frontend.

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

export interface PedidoItem {
  codigo: string;
  descricao: string;
  quantidade: number;
  pedidoId: number;
}

export interface ItensResponse {
  items: PedidoItem[];
  erros: number;
}

const DELAY_MS = 340;

async function fetchPedidoItens(id: number): Promise<PedidoItem[]> {
  try {
    const data = await blingFetch(`/pedidos/vendas/${id}`) as {
      data?: {
        itens?: Array<{
          codigo?: string;
          descricao?: string;
          quantidade?: number;
          produto?: { codigo?: string };
        }>;
      };
    };

    return (data?.data?.itens ?? [])
      .filter(i => Number(i.quantidade) > 0)
      .map(i => ({
        codigo:     (i.codigo ?? i.produto?.codigo ?? '').toString().trim(),
        descricao:  (i.descricao ?? '').toString().trim(),
        quantidade: Number(i.quantidade ?? 0),
        pedidoId:   id,
      }))
      .filter(i => i.codigo.length > 0);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { orderIds } = await req.json() as { orderIds?: number[] };

    if (!orderIds || !Array.isArray(orderIds)) {
      return NextResponse.json({ error: 'orderIds deve ser um array de números' }, { status: 400 });
    }
    if (orderIds.length > 50) {
      return NextResponse.json({ error: 'Máximo de 50 pedidos por request' }, { status: 400 });
    }

    const allItems: PedidoItem[] = [];
    let erros = 0;

    for (let i = 0; i < orderIds.length; i++) {
      const itens = await fetchPedidoItens(orderIds[i]);
      if (itens.length === 0) erros++;
      else allItems.push(...itens);
      if (i < orderIds.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
    }

    return NextResponse.json({ items: allItems, erros } satisfies ItensResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

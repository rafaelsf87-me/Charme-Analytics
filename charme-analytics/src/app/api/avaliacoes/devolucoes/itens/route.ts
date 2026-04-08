// ─── Fase 2: Buscar Itens de um Batch de Pedidos ─────────────────────────────
// Recebe um array de IDs, busca cada pedido individualmente e retorna os itens.
// Batch size: 50 pedidos por request (~17s, dentro do limite de 60s da Vercel).
// Rate limit: 340ms entre calls (3 req/s).

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

export interface PedidoItem {
  codigo: string;
  descricao: string;
  quantidade: number;
}

export interface ItensResponse {
  items: PedidoItem[];
  erros: number;
}

const DELAY_MS = 340; // 3 req/s com margem

async function fetchPedidoItens(id: number): Promise<PedidoItem[]> {
  try {
    const data = await blingFetch(`/pedidos/vendas/${id}`) as {
      data?: {
        itens?: Array<{
          codigo?: string;
          descricao?: string;
          quantidade?: number;
          produto?: { codigo?: string; descricaoUnidadeMedida?: string };
        }>;
      };
    };

    const itens = data?.data?.itens ?? [];

    return itens
      .filter(i => i.quantidade && i.quantidade > 0)
      .map(i => ({
        codigo:    (i.codigo ?? i.produto?.codigo ?? '').toString().trim(),
        descricao: (i.descricao ?? '').toString().trim(),
        quantidade: Number(i.quantidade ?? 0),
      }))
      .filter(i => i.codigo.length > 0);
  } catch {
    // Pedido individual falhou (404, timeout, etc.) — pular
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { orderIds?: number[] };
    const { orderIds } = body;

    if (!orderIds || !Array.isArray(orderIds)) {
      return NextResponse.json(
        { error: 'orderIds deve ser um array de números' },
        { status: 400 }
      );
    }

    if (orderIds.length > 50) {
      return NextResponse.json(
        { error: 'Máximo de 50 pedidos por request' },
        { status: 400 }
      );
    }

    const allItems: PedidoItem[] = [];
    let erros = 0;

    for (let i = 0; i < orderIds.length; i++) {
      const id = orderIds[i];
      const itens = await fetchPedidoItens(id);

      if (itens.length === 0) {
        erros++;
      } else {
        allItems.push(...itens);
      }

      // Rate limit entre requests (exceto no último)
      if (i < orderIds.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    return NextResponse.json({ items: allItems, erros } satisfies ItensResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

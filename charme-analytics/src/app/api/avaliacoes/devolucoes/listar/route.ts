// ─── Fase 1: Listar todos os IDs do período ───────────────────────────────────
// Classificação movida para Fase 2 (detalhe do pedido tem situacao.nome com texto).

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

async function listAllIds(dateFrom: string, dateTo: string, idLoja?: number): Promise<number[]> {
  const allIds: number[] = [];
  let pagina = 1;
  const limite = 100;

  while (true) {
    const params = new URLSearchParams({
      pagina: String(pagina), limite: String(limite),
      dataInicial: dateFrom, dataFinal: dateTo,
    });
    if (idLoja) params.set('idLoja', String(idLoja));

    const data = await blingFetch(`/pedidos/vendas?${params}`) as {
      data?: Array<{ id: number }>;
    };

    const items = data?.data ?? [];
    if (items.length === 0) break;
    for (const p of items) allIds.push(Number(p.id));
    if (items.length < limite) break;
    pagina++;
    await new Promise(r => setTimeout(r, 350));
  }

  return allIds;
}

export async function POST(req: Request) {
  try {
    const { dateFrom, dateTo, idLoja, idLojas } = await req.json() as {
      dateFrom?: string;
      dateTo?: string;
      idLoja?: number;
      idLojas?: number[];
    };
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom e dateTo obrigatórios' }, { status: 400 });
    }

    const ids = idLojas && idLojas.length > 0 ? idLojas : (idLoja ? [idLoja] : [undefined]);

    // Busca para cada canal e combina (sem duplicatas)
    const seen = new Set<number>();
    const allIds: number[] = [];
    for (const id of ids) {
      const partial = await listAllIds(dateFrom, dateTo, id);
      for (const pid of partial) {
        if (!seen.has(pid)) { seen.add(pid); allIds.push(pid); }
      }
    }

    return NextResponse.json({ allIds, totalIds: allIds.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── Debug: retorna primeiros 3 pedidos brutos do Bling para diagnóstico ─────

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { dateFrom, dateTo } = await req.json() as { dateFrom?: string; dateTo?: string };

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom e dateTo obrigatórios' }, { status: 400 });
    }

    const params = new URLSearchParams({ pagina: '1', limite: '3', dataInicial: dateFrom, dataFinal: dateTo });
    const data = await blingFetch(`/pedidos/vendas?${params}`);

    return NextResponse.json({ raw: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

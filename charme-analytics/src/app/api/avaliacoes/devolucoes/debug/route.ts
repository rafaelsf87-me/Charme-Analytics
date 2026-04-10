// ─── Debug: retorna estrutura bruta do Bling para diagnóstico ─────────────────

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { dateFrom, dateTo } = await req.json() as { dateFrom?: string; dateTo?: string };

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom e dateTo obrigatórios' }, { status: 400 });
    }

    // 1) Listagem bruta (3 pedidos)
    const params = new URLSearchParams({ pagina: '1', limite: '3', dataInicial: dateFrom, dataFinal: dateTo });
    const listaRaw = await blingFetch(`/pedidos/vendas?${params}`) as { data?: Array<{ id: number; loja?: { id?: number } }> };

    const primeiroId   = listaRaw?.data?.[0]?.id;
    const primeiraLoja = listaRaw?.data?.[0]?.loja?.id;

    // 2) Detalhe do primeiro pedido
    let detalhe: unknown = null;
    if (primeiroId) {
      try { detalhe = await blingFetch(`/pedidos/vendas/${primeiroId}`); } catch { detalhe = 'ERRO'; }
      await new Promise(r => setTimeout(r, 350));
    }

    // 3) /lojas/{id} do canal encontrado
    let lojaEndpoint: unknown = null;
    if (primeiraLoja) {
      try { lojaEndpoint = await blingFetch(`/lojas/${primeiraLoja}`); } catch (e) { lojaEndpoint = `ERRO: ${String(e)}`; }
      await new Promise(r => setTimeout(r, 350));
    }

    // 4) /canais-venda/{id}
    let canalVendaEndpoint: unknown = null;
    if (primeiraLoja) {
      try { canalVendaEndpoint = await blingFetch(`/canais-venda/${primeiraLoja}`); } catch (e) { canalVendaEndpoint = `ERRO: ${String(e)}`; }
    }

    return NextResponse.json({
      lista_raw: listaRaw,
      primeiro_pedido_id: primeiroId,
      primeira_loja_id: primeiraLoja,
      detalhe_pedido: detalhe,
      lojas_endpoint: lojaEndpoint,
      canais_venda_endpoint: canalVendaEndpoint,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

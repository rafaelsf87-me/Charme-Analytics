// ─── Debug: retorna estrutura bruta do Bling para diagnóstico ─────────────────

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { dateFrom, dateTo, lojaId, orderId, skuTest } = await req.json() as {
      dateFrom?: string;
      dateTo?: string;
      lojaId?: number;
      orderId?: number;
      skuTest?: string;
    };

    // Modo produto: inspeciona um SKU específico (lista + detalhe)
    if (skuTest) {
      const lista = await blingFetch(`/produtos?codigo=${encodeURIComponent(skuTest)}&limite=5`) as { data?: Array<{ id: number; codigo?: string; nome?: string; formato?: unknown; estrutura?: unknown }> };
      const prod = lista?.data?.[0];
      if (!prod) return NextResponse.json({ error: `SKU ${skuTest} não encontrado`, lista_raw: lista });
      await new Promise(r => setTimeout(r, 350));
      const detalhe = await blingFetch(`/produtos/${prod.id}`) as { data?: Record<string, unknown> };
      return NextResponse.json({
        sku: skuTest,
        id_interno: prod.id,
        lista_campos: Object.keys(prod),
        lista_formato: prod.formato,
        lista_estrutura: prod.estrutura ?? '(não veio na listagem)',
        detalhe_campos: Object.keys(detalhe?.data ?? {}),
        detalhe_formato: (detalhe?.data as Record<string, unknown> | undefined)?.formato ?? null,
        detalhe_estrutura: (detalhe?.data as Record<string, unknown> | undefined)?.estrutura ?? null,
        detalhe_full: detalhe,
      });
    }

    // Modo direto por número do pedido (número visível no Bling, não o ID interno)
    if (orderId) {
      const lista = await blingFetch(`/pedidos/vendas?numero=${orderId}&limite=5`) as { data?: Array<{ id: number }> };
      const internalId = lista?.data?.[0]?.id;
      if (!internalId) {
        return NextResponse.json({ error: `Pedido número ${orderId} não encontrado`, lista_raw: lista });
      }
      await new Promise(r => setTimeout(r, 350));
      const detalhe = await blingFetch(`/pedidos/vendas/${internalId}`) as { data?: Record<string, unknown> };
      const raw = detalhe?.data ?? {};
      return NextResponse.json({
        numero_pedido: orderId,
        id_interno: internalId,
        situacao: raw.situacao ?? null,
        loja: raw.loja ?? null,
        intermediador: raw.intermediador ?? null,
        data_pedido: raw.data ?? null,
        full_raw: detalhe,
      });
    }

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom e dateTo obrigatórios' }, { status: 400 });
    }

    const hoje = new Date();
    const inicio = new Date();
    inicio.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    // Se lojaId fornecido: busca intermediador desse canal específico
    if (lojaId) {
      // Varre páginas até achar um pedido desse canal
      for (let pagina = 1; pagina <= 10; pagina++) {
        const params = new URLSearchParams({
          pagina: String(pagina), limite: '100',
          dataInicial: fmt(inicio), dataFinal: fmt(hoje),
        });
        const lista = await blingFetch(`/pedidos/vendas?${params}`) as {
          data?: Array<{ id: number; loja?: { id?: number } }>
        };
        const items = lista?.data ?? [];
        if (items.length === 0) break;

        const match = items.find(p => p.loja?.id === lojaId);
        if (match) {
          await new Promise(r => setTimeout(r, 350));
          const detail = await blingFetch(`/pedidos/vendas/${match.id}`) as { data?: Record<string, unknown> };
          return NextResponse.json({
            canal_id: lojaId,
            pedido_id: match.id,
            intermediador: (detail?.data as Record<string, unknown> | undefined)?.intermediador ?? null,
            loja: (detail?.data as Record<string, unknown> | undefined)?.loja ?? null,
          });
        }
        if (items.length < 100) break;
        await new Promise(r => setTimeout(r, 350));
      }
      return NextResponse.json({ error: `Nenhum pedido encontrado para loja ${lojaId}` });
    }

    // Sem lojaId: retorna primeiros 3 pedidos brutos + detalhe + endpoints de loja
    const params = new URLSearchParams({ pagina: '1', limite: '3', dataInicial: dateFrom, dataFinal: dateTo });
    const listaRaw = await blingFetch(`/pedidos/vendas?${params}`) as { data?: Array<{ id: number; loja?: { id?: number } }> };

    const primeiroId   = listaRaw?.data?.[0]?.id;
    const primeiraLoja = listaRaw?.data?.[0]?.loja?.id;

    let detalhe: unknown = null;
    if (primeiroId) {
      try { detalhe = await blingFetch(`/pedidos/vendas/${primeiroId}`); } catch { detalhe = 'ERRO'; }
      await new Promise(r => setTimeout(r, 350));
    }

    let lojaEndpoint: unknown = null;
    if (primeiraLoja) {
      try { lojaEndpoint = await blingFetch(`/lojas/${primeiraLoja}`); } catch (e) { lojaEndpoint = `ERRO: ${String(e)}`; }
      await new Promise(r => setTimeout(r, 350));
    }

    let canalVendaEndpoint: unknown = null;
    if (primeiraLoja) {
      try { canalVendaEndpoint = await blingFetch(`/canais-venda/${primeiraLoja}`); } catch (e) { canalVendaEndpoint = `ERRO: ${String(e)}`; }
    }

    // 5) Situação do primeiro pedido
    const primeiraSituacaoId = (listaRaw?.data?.[0] as Record<string, unknown> & { situacao?: { id?: number } } | undefined)?.situacao?.id;
    let situacaoEndpoint: unknown = null;
    if (primeiraSituacaoId) {
      try { situacaoEndpoint = await blingFetch(`/situacoes/${primeiraSituacaoId}`); } catch (e) { situacaoEndpoint = `ERRO: ${String(e)}`; }
    }

    // 6) Lista todas as situações disponíveis
    let todasSituacoes: unknown = null;
    try { todasSituacoes = await blingFetch(`/situacoes?pagina=1&limite=100`); } catch (e) { todasSituacoes = `ERRO: ${String(e)}`; }

    return NextResponse.json({
      lista_raw: listaRaw,
      primeiro_pedido_id: primeiroId,
      primeira_loja_id: primeiraLoja,
      primeira_situacao_id: primeiraSituacaoId,
      detalhe_pedido: detalhe,
      lojas_endpoint: lojaEndpoint,
      canais_venda_endpoint: canalVendaEndpoint,
      situacao_endpoint: situacaoEndpoint,
      todas_situacoes: todasSituacoes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

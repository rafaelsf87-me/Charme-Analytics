// ─── Lista canais de venda extraídos da listagem de pedidos ──────────────────
// /canais-venda requer scope extra (403). Alternativa: amostrar pedidos recentes
// e extrair lojas únicas — usa o mesmo endpoint já autorizado.

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

interface BlingPedidoLista {
  id: number;
  loja?: { id?: number; descricao?: string; nome?: string };
  canal?: { id?: number; descricao?: string; nome?: string };
}

export async function GET() {
  try {
    const hoje = new Date();
    const inicio = new Date();
    inicio.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    // Busca 3 páginas recentes para cobrir canais usados
    const lojasMap = new Map<number, string>();
    for (let pagina = 1; pagina <= 3; pagina++) {
      const params = new URLSearchParams({
        pagina: String(pagina), limite: '100',
        dataInicial: fmt(inicio), dataFinal: fmt(hoje),
      });
      const data = await blingFetch(`/pedidos/vendas?${params}`) as { data?: BlingPedidoLista[] };
      const items = data?.data ?? [];
      if (items.length === 0) break;

      for (const p of items) {
        const src = p.loja ?? p.canal;
        if (src?.id) {
          const nome = src.descricao ?? src.nome ?? `Canal ${src.id}`;
          if (!lojasMap.has(src.id)) lojasMap.set(src.id, nome);
        }
      }

      if (items.length < 100) break;
      await new Promise(r => setTimeout(r, 350));
    }

    const lojas = [...lojasMap.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    return NextResponse.json({ lojas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

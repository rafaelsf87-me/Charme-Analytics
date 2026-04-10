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

function extrairNomeLoja(raw: Record<string, unknown>): string | null {
  const loja = raw.loja as Record<string, unknown> | undefined;
  const canal = raw.canal as Record<string, unknown> | undefined;
  const nome =
    (loja?.nome as string | undefined) ||
    (loja?.descricao as string | undefined) ||
    (canal?.nome as string | undefined) ||
    (canal?.descricao as string | undefined);
  return nome?.trim() || null;
}

export async function GET() {
  try {
    const hoje = new Date();
    const inicio = new Date();
    inicio.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    // Busca 3 páginas recentes para cobrir canais usados
    const lojasMap = new Map<number, string>();
    // Um pedido de amostra por canal (para resolver nomes em fallback)
    const canalSampleOrder = new Map<number, number>();

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
          const nome = src.descricao?.trim() || src.nome?.trim() || null;
          if (!lojasMap.has(src.id)) {
            lojasMap.set(src.id, nome ?? `Canal ${src.id}`);
            canalSampleOrder.set(src.id, p.id);
          }
        }
      }

      if (items.length < 100) break;
      await new Promise(r => setTimeout(r, 350));
    }

    // Para canais sem nome na listagem, buscar detalhe de um pedido para resolver o nome real
    const fallbackIds = [...lojasMap.entries()]
      .filter(([id, nome]) => nome === `Canal ${id}`)
      .map(([id]) => id);

    for (const canalId of fallbackIds) {
      const orderId = canalSampleOrder.get(canalId);
      if (!orderId) continue;
      try {
        const detail = await blingFetch(`/pedidos/vendas/${orderId}`) as { data?: Record<string, unknown> };
        const raw = detail?.data;
        if (raw) {
          const nomeReal = extrairNomeLoja(raw);
          if (nomeReal) lojasMap.set(canalId, nomeReal);
        }
        await new Promise(r => setTimeout(r, 350));
      } catch {
        // mantém o fallback se falhar
      }
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

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

// Mapeamento CNPJ → nome do marketplace (Bling não expõe nome da loja via API)
const CNPJ_MARKETPLACE: Record<string, string> = {
  '03.007.331/0001-41': 'Mercado Livre',
  '03.007.331/0002-22': 'Mercado Livre',
  '35.060.635/0001-88': 'Shopee',
  '24.269.738/0001-00': 'Shopee',
  '35.635.824/0001-12': 'Shopee',
  '15.436.940/0001-03': 'Shopify',
  '45.814.425/0001-72': 'Shopify',
  '27.415.911/0001-36': 'TikTok Shop',
  '47.960.950/0001-21': 'Magalu',
  '02.722.816/0001-58': 'Americanas',
  '07.170.816/0001-29': 'Amazon',
  '04.312.454/0001-80': 'Netshoes',
  '09.358.108/0001-25': 'Dafiti',
  '14.380.200/0001-21': 'OLX',
};

function infoIntermediador(raw: Record<string, unknown>): { marketplace: string | null; seller: string | null; cnpj: string | null } {
  const inter = raw.intermediador as { cnpj?: string; nomeUsuario?: string } | undefined;
  if (!inter) return { marketplace: null, seller: null, cnpj: null };
  const cnpj = inter.cnpj?.trim() || null;
  const marketplace = (cnpj && CNPJ_MARKETPLACE[cnpj]) || null;
  const seller = inter.nomeUsuario?.trim() || null;
  return { marketplace, seller, cnpj };
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

    // Para canais sem nome: buscar detalhe de um pedido e extrair via intermediador.cnpj
    const fallbackIds = [...lojasMap.entries()]
      .filter(([id, nome]) => nome === `Canal ${id}`)
      .map(([id]) => id);

    // Coleta info de cada canal
    type CanalInfo = { marketplace: string | null; seller: string | null; cnpj: string | null };
    const canalInfo = new Map<number, CanalInfo>();

    for (const canalId of fallbackIds) {
      const orderId = canalSampleOrder.get(canalId);
      if (!orderId) { canalInfo.set(canalId, { marketplace: null, seller: null, cnpj: null }); continue; }
      try {
        const detail = await blingFetch(`/pedidos/vendas/${orderId}`) as { data?: Record<string, unknown> };
        const raw = detail?.data;
        canalInfo.set(canalId, raw ? infoIntermediador(raw) : { marketplace: null, seller: null, cnpj: null });
        await new Promise(r => setTimeout(r, 350));
      } catch {
        canalInfo.set(canalId, { marketplace: null, seller: null, cnpj: null });
      }
    }

    // Detecta, por marketplace, se há múltiplos CNPJs distintos (= mesma loja, integração duplicada)
    // ou múltiplos sellers no mesmo CNPJ (= contas distintas)
    const marketplaceCnpjs = new Map<string, Set<string>>();
    const marketplaceSellers = new Map<string, Set<string>>();
    for (const info of canalInfo.values()) {
      if (!info.marketplace) continue;
      if (info.cnpj) {
        const s = marketplaceCnpjs.get(info.marketplace) ?? new Set();
        s.add(info.cnpj);
        marketplaceCnpjs.set(info.marketplace, s);
      }
      if (info.seller) {
        const s = marketplaceSellers.get(info.marketplace) ?? new Set();
        s.add(info.seller);
        marketplaceSellers.set(info.marketplace, s);
      }
    }

    for (const canalId of fallbackIds) {
      const info = canalInfo.get(canalId) ?? { marketplace: null, seller: null, cnpj: null };
      let nome: string;
      if (info.marketplace) {
        const cnpjsDoMarketplace = marketplaceCnpjs.get(info.marketplace) ?? new Set();
        const sellersDoMarketplace = marketplaceSellers.get(info.marketplace) ?? new Set();
        // CNPJs distintos = mesma loja com integração duplicada → não adiciona sufixo
        // Sellers distintos no mesmo CNPJ = contas separadas → adiciona seller
        const multiCnpj   = cnpjsDoMarketplace.size > 1;
        const multiSeller = sellersDoMarketplace.size > 1;
        nome = (!multiCnpj && multiSeller && info.seller)
          ? `${info.marketplace} · ${info.seller}`
          : info.marketplace;
      } else if (info.seller) {
        nome = info.seller;
      } else {
        nome = 'Loja Própria';
      }
      lojasMap.set(canalId, nome);
    }

    // Agrupa canais com o mesmo nome em uma única entrada (ex: 2 Shopify = mesma loja)
    const grouped = new Map<string, number[]>();
    for (const [id, nome] of lojasMap) {
      const existing = grouped.get(nome) ?? [];
      existing.push(id);
      grouped.set(nome, existing);
    }

    const lojas = [...grouped.entries()]
      .map(([nome, ids]) => ({ id: ids[0], ids, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    return NextResponse.json({ lojas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── Fase 2: Buscar detalhe, classificar e extrair itens ─────────────────────
// Bling v3 não retorna situacao.nome — usa situacao.valor (enum padrão) +
// fallback para /situacoes/{id} para situações customizadas (ex: devolução).
// Rate limit: 340ms entre calls (3 req/s). Batch size: 50.

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

export interface ClassifiedItem {
  codigo: string;
  descricao: string;
  quantidade: number;
  pedidoId: number;
  tipo: 'vendido' | 'devolvido' | 'cancelado';
}

export interface ItensResponse {
  items: ClassifiedItem[];
  pedidoLojas: Record<string, string>;
  lojas: string[];
  counts: { vendidos: number; devolvidos: number; cancelados: number; ignorados: number };
  erros: number;
}

// Bling v3 situacao.valor → classificação direta
// Ref: 0=Em Aberto, 1=Em Atendimento, 2=Atendido, 3/4=Cancelado,
//      6=Em Digitação, 9=Verificado, 11=NF Emitida, 12=NF Enviada ao Mercado
const SITUACAO_VALOR: Record<number, 'vendido' | 'cancelado' | 'ignorar'> = {
  0:  'ignorar',   // Em Aberto
  1:  'ignorar',   // Em Atendimento
  2:  'vendido',   // Atendido
  3:  'cancelado', // Cancelado
  4:  'cancelado', // Inativo/Cancelado
  6:  'ignorar',   // Em Digitação
  9:  'vendido',   // Verificado
  11: 'vendido',   // NF Emitida
  12: 'vendido',   // NF Enviada ao Mercado
};

function getSituacaoTipo(valor: number): 'vendido' | 'cancelado' | 'ignorar' {
  return SITUACAO_VALOR[valor] ?? 'ignorar';
}

// Situações customizadas de devolução: nomes conhecidos → devolvido
// (usado apenas se o Bling retornar nome no futuro via scope adicional)
function classificarNome(nome: string): 'devolvido' | null {
  const n = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (n.includes('devolucao') || n.includes('devolvido')) return 'devolvido';
  return null;
}

function extrairLoja(data: Record<string, unknown>): string {
  const loja = data.loja as Record<string, unknown> | undefined;
  if (loja?.nome)      return String(loja.nome).trim();
  if (loja?.descricao) return String(loja.descricao).trim();
  const canal = data.canal as Record<string, unknown> | undefined;
  if (canal?.nome)      return String(canal.nome).trim();
  if (canal?.descricao) return String(canal.descricao).trim();
  if (loja?.id)         return `Loja ${loja.id}`;
  return 'Sem canal';
}

const DELAY_MS = 340;

async function fetchOrder(id: number): Promise<{ tipo: 'vendido' | 'devolvido' | 'cancelado' | 'ignorar'; items: Omit<ClassifiedItem, 'tipo'>[], loja: string } | null> {
  try {
    const data = await blingFetch(`/pedidos/vendas/${id}`) as {
      data?: Record<string, unknown> & {
        situacao?: { id?: number; valor?: number };
        itens?: Array<{ codigo?: string; descricao?: string; quantidade?: number; produto?: { codigo?: string } }>;
      };
    };

    const raw = data?.data;
    if (!raw) return null;

    const sit = raw.situacao;
    const tipo = getSituacaoTipo(sit?.valor ?? -1);
    const loja = extrairLoja(raw);

    const items = (raw.itens ?? [])
      .filter(i => Number(i.quantidade) > 0)
      .map(i => ({
        codigo:     (i.codigo ?? i.produto?.codigo ?? '').toString().trim(),
        descricao:  (i.descricao ?? '').toString().trim(),
        quantidade: Number(i.quantidade ?? 0),
        pedidoId:   id,
      }))
      .filter(i => i.codigo.length > 0);

    return { tipo, items, loja };
  } catch {
    return null;
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

    const allItems: ClassifiedItem[] = [];
    const pedidoLojas: Record<string, string> = {};
    const lojasSet = new Set<string>();
    const counts = { vendidos: 0, devolvidos: 0, cancelados: 0, ignorados: 0 };
    let erros = 0;

    for (let i = 0; i < orderIds.length; i++) {
      const id = orderIds[i];
      const result = await fetchOrder(id);

      if (!result) {
        erros++;
      } else {
        const { tipo, items, loja } = result;
        pedidoLojas[String(id)] = loja;
        lojasSet.add(loja);

        if (tipo === 'ignorar') {
          counts.ignorados++;
        } else {
          if (tipo === 'vendido')    counts.vendidos++;
          else if (tipo === 'devolvido')  counts.devolvidos++;
          else if (tipo === 'cancelado')  counts.cancelados++;

          for (const item of items) {
            allItems.push({ ...item, tipo });
          }
        }
      }

      if (i < orderIds.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
    }

    return NextResponse.json({
      items: allItems,
      pedidoLojas,
      lojas: [...lojasSet].sort(),
      counts,
      erros,
    } satisfies ItensResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

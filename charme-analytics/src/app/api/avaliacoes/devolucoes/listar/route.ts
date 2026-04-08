// ─── Fase 1: Listar e Classificar Pedidos ────────────────────────────────────
// Busca TODOS os pedidos do período (sem filtro de status), classifica pelo
// idSituacao no backend, retorna IDs agrupados por desfecho.

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

// Cache em memória para IDs de situações (evita re-fetch a cada análise)
interface SituacaoIds {
  verificado: number;
  devolucao: number;
  cancelado: number;
  emTroca: number;
}
let situacaoCache: SituacaoIds | null = null;

// Módulo de pedidos de venda no Bling
const MODULO_PEDIDOS_VENDA = 6;

async function getSituacaoIds(): Promise<SituacaoIds> {
  if (situacaoCache) return situacaoCache;

  const data = await blingFetch(`/situacoes/modulos/${MODULO_PEDIDOS_VENDA}`) as {
    data?: Array<{ id: number; nome: string }>;
  };

  const situacoes: Array<{ id: number; nome: string }> = data?.data ?? [];

  function findId(nomes: string[]): number {
    const lower = nomes.map(n => n.toLowerCase());
    const found = situacoes.find(s =>
      lower.some(n => s.nome.toLowerCase().includes(n))
    );
    return found?.id ?? -1;
  }

  situacaoCache = {
    verificado: findId(['verificado']),
    devolucao:  findId(['devolução', 'devolucao']),
    cancelado:  findId(['cancelado']),
    emTroca:    findId(['em troca', 'troca']),
  };

  return situacaoCache;
}

interface PedidoResumo {
  id: number;
  idSituacao: number;
}

async function listarTodosPedidos(
  dateFrom: string,
  dateTo: string
): Promise<PedidoResumo[]> {
  const todos: PedidoResumo[] = [];
  let pagina = 1;
  const limite = 100;

  while (true) {
    const params = new URLSearchParams({
      pagina: String(pagina),
      limite: String(limite),
      dataInicial: dateFrom,
      dataFinal: dateTo,
    });

    const data = await blingFetch(`/pedidos/vendas?${params}`) as {
      data?: Array<{ id: number; situacao?: { id: number } }>;
    };

    const items = data?.data ?? [];
    if (items.length === 0) break;

    for (const p of items) {
      todos.push({ id: p.id, idSituacao: p.situacao?.id ?? -1 });
    }

    if (items.length < limite) break;
    pagina++;

    // Rate limit: 3 req/s → aguardar ~350ms entre páginas
    await new Promise(r => setTimeout(r, 350));
  }

  return todos;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { dateFrom?: string; dateTo?: string };
    const { dateFrom, dateTo } = body;

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom e dateTo são obrigatórios (formato YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const [ids, pedidos] = await Promise.all([
      getSituacaoIds(),
      listarTodosPedidos(dateFrom, dateTo),
    ]);

    const vendidos: number[]   = [];
    const devolvidos: number[] = [];
    const cancelados: number[] = [];
    let descartados = 0;

    for (const p of pedidos) {
      if (p.idSituacao === ids.verificado) {
        vendidos.push(p.id);
      } else if (p.idSituacao === ids.devolucao) {
        devolvidos.push(p.id);
      } else if (p.idSituacao === ids.cancelado) {
        cancelados.push(p.id);
      } else if (p.idSituacao === ids.emTroca) {
        descartados++;
      }
      // Demais status desconhecidos: ignorar silenciosamente
    }

    return NextResponse.json({
      vendidos,
      devolvidos,
      cancelados,
      descartados,
      totalVendidos:   vendidos.length,
      totalDevolvidos: devolvidos.length,
      totalCancelados: cancelados.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

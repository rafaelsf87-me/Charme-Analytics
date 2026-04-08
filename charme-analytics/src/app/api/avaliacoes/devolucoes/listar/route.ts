// ─── Fase 1: Listar e Classificar Pedidos ────────────────────────────────────
// Busca TODOS os pedidos do período (sem filtro de status), classifica pelo
// nome da situação (campo situacao.value) — não requer escopo extra no Bling.

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

function classificar(nome: string): 'vendido' | 'devolvido' | 'cancelado' | 'emTroca' | 'ignorar' {
  const n = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (n.includes('verificado'))          return 'vendido';
  if (n.includes('devolucao') || n.includes('devolvido')) return 'devolvido';
  if (n.includes('cancelado'))           return 'cancelado';
  if (n.includes('troca'))               return 'emTroca';
  return 'ignorar';
}

async function listarTodosPedidos(dateFrom: string, dateTo: string) {
  const vendidos:   number[] = [];
  const devolvidos: number[] = [];
  const cancelados: number[] = [];
  let descartados = 0;

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
      data?: Array<{ id: number; situacao?: { valor?: string; nome?: string } }>;
    };

    const items = data?.data ?? [];
    if (items.length === 0) break;

    for (const p of items) {
      // Bling v3 retorna situacao.valor ou situacao.nome — aceitar ambos
      const nomeSit = (p.situacao?.valor ?? p.situacao?.nome ?? '').toString();
      const tipo = classificar(nomeSit);

      if (tipo === 'vendido')    vendidos.push(p.id);
      else if (tipo === 'devolvido')  devolvidos.push(p.id);
      else if (tipo === 'cancelado')  cancelados.push(p.id);
      else if (tipo === 'emTroca')    descartados++;
      // 'ignorar' → status desconhecido, pular silenciosamente
    }

    if (items.length < limite) break;
    pagina++;

    // Rate limit: 3 req/s
    await new Promise(r => setTimeout(r, 350));
  }

  return { vendidos, devolvidos, cancelados, descartados };
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

    const { vendidos, devolvidos, cancelados, descartados } =
      await listarTodosPedidos(dateFrom, dateTo);

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

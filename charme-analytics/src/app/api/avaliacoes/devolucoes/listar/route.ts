// ─── Fase 1: Listar e Classificar Pedidos ────────────────────────────────────
// Classifica pelo campo situacao.valor/nome — não requer escopo extra no Bling.
// Também captura o canal/loja de cada pedido para filtro no frontend.

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function classificar(nome: string): 'vendido' | 'devolvido' | 'cancelado' | 'emTroca' | 'ignorar' {
  const n = norm(nome);
  if (n.includes('verificado'))                          return 'vendido';
  if (n.includes('devolucao') || n.includes('devolvido')) return 'devolvido';
  if (n.includes('cancelado'))                           return 'cancelado';
  if (n.includes('troca'))                               return 'emTroca';
  return 'ignorar';
}

function extrairLoja(p: Record<string, unknown>): string {
  // Bling v3 — tentar campos conhecidos em ordem de preferência
  const loja = p.loja as Record<string, unknown> | undefined;
  if (loja?.descricao) return String(loja.descricao).trim();
  if (loja?.nome)      return String(loja.nome).trim();
  const canal = p.canal as Record<string, unknown> | undefined;
  if (canal?.descricao) return String(canal.descricao).trim();
  if (canal?.nome)      return String(canal.nome).trim();
  return 'Sem canal';
}

async function listarTodosPedidos(dateFrom: string, dateTo: string) {
  const vendidos:   number[] = [];
  const devolvidos: number[] = [];
  const cancelados: number[] = [];
  const pedidoLojas: Record<string, string> = {};
  const lojasSet = new Set<string>();
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
      data?: Array<Record<string, unknown>>;
    };

    const items = data?.data ?? [];
    if (items.length === 0) break;

    for (const p of items) {
      const id = Number(p.id);
      const situacao = p.situacao as Record<string, unknown> | undefined;
      const nomeSit = String(situacao?.valor ?? situacao?.nome ?? '');
      const tipo = classificar(nomeSit);

      const loja = extrairLoja(p);
      pedidoLojas[String(id)] = loja;
      lojasSet.add(loja);

      if (tipo === 'vendido')   vendidos.push(id);
      else if (tipo === 'devolvido') devolvidos.push(id);
      else if (tipo === 'cancelado') cancelados.push(id);
      else if (tipo === 'emTroca')   descartados++;
    }

    if (items.length < limite) break;
    pagina++;
    await new Promise(r => setTimeout(r, 350));
  }

  return {
    vendidos, devolvidos, cancelados, descartados,
    pedidoLojas,
    lojas: [...lojasSet].sort(),
  };
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

    const result = await listarTodosPedidos(dateFrom, dateTo);

    return NextResponse.json({
      vendidos:        result.vendidos,
      devolvidos:      result.devolvidos,
      cancelados:      result.cancelados,
      descartados:     result.descartados,
      pedidoLojas:     result.pedidoLojas,
      lojas:           result.lojas,
      totalVendidos:   result.vendidos.length,
      totalDevolvidos: result.devolvidos.length,
      totalCancelados: result.cancelados.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

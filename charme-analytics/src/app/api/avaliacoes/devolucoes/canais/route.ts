// ─── Lista canais de venda (lojas) disponíveis no Bling ─────────────────────

import { blingFetch } from '@/lib/bling-auth';
import { NextResponse } from 'next/server';

interface BlingLoja {
  id: number;
  descricao?: string;
  nome?: string;
  tipo?: { id?: number; descricao?: string };
}

export async function GET() {
  try {
    const data = await blingFetch('/canais-venda') as { data?: BlingLoja[] };
    const lojas: { id: number; nome: string }[] = (data?.data ?? []).map(l => ({
      id: l.id,
      nome: l.descricao ?? l.nome ?? `Canal ${l.id}`,
    }));
    return NextResponse.json({ lojas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

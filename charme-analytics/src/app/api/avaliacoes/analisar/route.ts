import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewInput {
  product_handle: string;
  title: string;
  body: string;
  rating: number;
}

export interface ProblemaResultado {
  categoria: string;
  quantidade: number;
  percentual: number;
}

export interface ProdutoResultado {
  product_handle: string;
  total_reviews: number;
  total_negativas: number;
  nota_media: number;
  problemas: ProblemaResultado[];
  omitidas: number;
}

export interface AnalisarResponse {
  produtos: ProdutoResultado[];
  batches_com_erro: number;
  total_processadas: number;
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 300;
const BATCH_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `Você é um analista de qualidade de e-commerce. Recebeu avaliações negativas de clientes.

Para cada avaliação, classifique o MOTIVO PRINCIPAL da insatisfação em UMA categoria curta (2-4 palavras).

Categorias devem ser padronizadas e reutilizáveis. Exemplos:
- "Tamanho inadequado"
- "Material frágil"
- "Diferente da foto"
- "Não serviu no móvel"
- "Defeito de fabricação"
- "Entrega atrasada"
- "Embalagem danificada"
- "Cor diferente"
- "Não é impermeável"
- "Difícil de colocar"

Regras:
- Use SEMPRE a mesma categoria para problemas similares (não criar variações)
- Se a avaliação menciona múltiplos problemas, classifique pelo PRINCIPAL
- Se o texto é vago ou não identifica um problema claro, use "Insatisfação geral"
- Responda APENAS em JSON, sem markdown, sem preamble

Formato de resposta (JSON array):
[
  {"index": 0, "categoria": "Tamanho inadequado"},
  {"index": 1, "categoria": "Material frágil"}
]`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildUserMessage(batch: ReviewInput[], offset: number): string {
  const lines = batch.map((r, i) => {
    const text = [r.title, r.body].filter(Boolean).join(' | ');
    return `[${offset + i}] Rating: ${r.rating} | Produto: ${r.product_handle} | "${text}"`;
  });
  return `Classifique estas avaliações:\n\n${lines.join('\n')}`;
}

interface ClassificacaoItem {
  index: number;
  categoria: string;
}

async function classificarBatch(
  client: Anthropic,
  batch: ReviewInput[],
  offset: number
): Promise<ClassificacaoItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(batch, offset) }],
    });

    clearTimeout(timer);

    const text = msg.content.find(b => b.type === 'text')?.text ?? '[]';
    const parsed: ClassificacaoItem[] = JSON.parse(text);
    return parsed;
  } catch {
    clearTimeout(timer);
    throw new Error('Batch timeout ou erro Claude');
  }
}

function agruparPorProduto(reviews: ReviewInput[]): Map<string, ReviewInput[]> {
  const map = new Map<string, ReviewInput[]>();
  for (const r of reviews) {
    const arr = map.get(r.product_handle) ?? [];
    arr.push(r);
    map.set(r.product_handle, arr);
  }
  return map;
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: { reviews: ReviewInput[]; total_reviews_por_produto: Record<string, { total: number; nota_media: number }> };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { reviews, total_reviews_por_produto } = body;

  if (!Array.isArray(reviews) || reviews.length === 0) {
    return NextResponse.json({ error: 'Nenhuma review enviada' }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Dividir em batches
  const batches: ReviewInput[][] = [];
  for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
    batches.push(reviews.slice(i, i + BATCH_SIZE));
  }

  // Mapa global: índice global → categoria
  const categoriasMap = new Map<number, string>();
  let batches_com_erro = 0;

  for (let b = 0; b < batches.length; b++) {
    const offset = b * BATCH_SIZE;
    const batch = batches[b];

    let resultado: ClassificacaoItem[] = [];

    try {
      resultado = await classificarBatch(client, batch, offset);
    } catch {
      // Retry 1x
      try {
        resultado = await classificarBatch(client, batch, offset);
      } catch {
        batches_com_erro++;
        // Pular batch com erro — não bloqueia
        continue;
      }
    }

    for (const item of resultado) {
      categoriasMap.set(item.index, item.categoria);
    }
  }

  // Agregar por produto
  const reviewsByProduct = agruparPorProduto(reviews);
  const produtos: ProdutoResultado[] = [];

  for (const [handle, revs] of reviewsByProduct.entries()) {
    const totais = total_reviews_por_produto[handle] ?? { total: revs.length, nota_media: 0 };

    // Contar categorias
    const contagem = new Map<string, number>();
    let indexGlobal = reviews.findIndex(r => r.product_handle === handle);

    for (let i = 0; i < revs.length; i++) {
      const idx = reviews.indexOf(revs[i]);
      const cat = categoriasMap.get(idx) ?? 'Insatisfação geral';
      contagem.set(cat, (contagem.get(cat) ?? 0) + 1);
    }

    const totalNeg = revs.length;
    const MIN_PCT = 5;

    const problemasFiltrados: ProblemaResultado[] = [];
    let omitidas = 0;

    for (const [cat, qtd] of contagem.entries()) {
      const pct = (qtd / totalNeg) * 100;
      if (pct < MIN_PCT) {
        omitidas += qtd;
      } else {
        problemasFiltrados.push({ categoria: cat, quantidade: qtd, percentual: pct });
      }
    }

    problemasFiltrados.sort((a, b) => b.quantidade - a.quantidade);

    produtos.push({
      product_handle: handle,
      total_reviews: totais.total,
      total_negativas: totalNeg,
      nota_media: totais.nota_media,
      problemas: problemasFiltrados,
      omitidas,
    });
  }

  // Ordenar por mais negativas
  produtos.sort((a, b) => b.total_negativas - a.total_negativas);

  const response: AnalisarResponse = {
    produtos,
    batches_com_erro,
    total_processadas: reviews.length - batches_com_erro * BATCH_SIZE,
  };

  return NextResponse.json(response);
}

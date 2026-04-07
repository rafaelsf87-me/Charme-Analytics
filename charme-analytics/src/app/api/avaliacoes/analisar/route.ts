import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300; // 5 min — necessário para volumes maiores

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewInput {
  product_handle: string;
  title: string;
  body: string;
  rating: number;
}

export type TipoProblema = 'produto' | 'logistica' | 'outro';

export interface ProblemaResultado {
  categoria: string;
  quantidade: number;
  percentual: number;
  tipo: TipoProblema;
}

export interface ProdutoResultado {
  product_handle: string;
  total_reviews: number;
  total_negativas: number;
  nota_media: number;
  problemas: ProblemaResultado[];
  outros: number; // reviews de categoria única (< 2 ocorrências) ou genéricas
}

export interface AnalisarResponse {
  produtos: ProdutoResultado[];
  batches_com_erro: number;
  total_processadas: number;
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 80;
const BATCH_TIMEOUT_MS = 90_000;

// Categorias de logística — aparecem em cinza no card
const CATEGORIAS_LOGISTICA = new Set([
  'Produto não chegou',
  'Entrega atrasada',
  'Produto errado enviado',
  'Embalagem danificada',
  'Pedido extraviado',
]);

const SYSTEM_PROMPT = `Você é um analista de qualidade especialista em e-commerce de capas para móveis (cadeiras, sofás, poltronas).
Recebeu avaliações negativas de clientes. Classifique cada avaliação em UMA categoria padronizada.

## Categorias de PRODUTO (problemas de qualidade/adequação):
- "Qualidade do tecido" — material fino, fraco, não durável, se desfaz
- "Ficou grande" — capa folgada, grande demais, não ajusta no móvel, fica sobrando
- "Ficou pequeno" — capa justa demais, não cobriu o móvel, não estica, não encaixou
- "Gato rasgou a capa" — arranhado por pets, material não resistiu a gatos
- "Cor diferente da foto" — cor veio diferente do anunciado, cor errada
- "Não é impermeável" — líquido atravessou o tecido, manchou, prometia impermeabilidade
- "Difícil de colocar" — processo de encaixe difícil, não fica bem posicionada
- "Defeito de fabricação" — costura abriu, rasgou no primeiro uso, defeito físico na peça
- "Produto diferente da foto" — produto veio diferente do anunciado (não apenas a cor)
- "Material ruim" — tecido grosseiro, acabamento fraco, qualidade abaixo do esperado

## Categorias de LOGÍSTICA (problemas de entrega — não relacionados à qualidade do produto):
- "Produto não chegou" — não foi entregue, extraviado, não recebeu
- "Entrega atrasada" — demorou muito mais que o prazo
- "Produto errado enviado" — enviaram SKU/modelo diferente do pedido
- "Embalagem danificada" — chegou amassado, rasgado, mal embalado

## Categoria GENÉRICA:
- "Insatisfação geral" — reclamação vaga, cliente insatisfeito sem motivo claro identificável

## Regras críticas:
1. Use SEMPRE a categoria exata da lista acima — nunca crie variações ou sinônimos
2. Classifique pelo problema PRINCIPAL se houver múltiplos
3. "Ficou grande" e "Ficou pequeno" são DISTINTOS — leia o contexto para diferenciar
4. Se mencionar gato/pet destruindo, use "Gato rasgou a capa"
5. Reclamações sobre cor → "Cor diferente da foto" (não "Produto diferente da foto")
6. Responda APENAS JSON, sem markdown, sem preamble

## Formato de resposta:
[
  {"index": 0, "categoria": "Ficou grande", "tipo": "produto"},
  {"index": 1, "categoria": "Produto não chegou", "tipo": "logistica"},
  {"index": 2, "categoria": "Insatisfação geral", "tipo": "outro"}
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
  tipo: TipoProblema;
}

function parseClassificacoes(raw: string, batchSize: number, offset: number): ClassificacaoItem[] {
  // Limpar markdown code fences que o modelo pode retornar
  let text = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Tentar extrair apenas o array JSON (ignora texto extra antes/depois)
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) text = arrayMatch[0];

  try {
    const parsed = JSON.parse(text) as ClassificacaoItem[];
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fallback: tentar extrair objetos individuais
    const items: ClassificacaoItem[] = [];
    const objRegex = /\{\s*"index"\s*:\s*(\d+)\s*,\s*"categoria"\s*:\s*"([^"]+)"\s*,\s*"tipo"\s*:\s*"([^"]+)"\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRegex.exec(text)) !== null) {
      items.push({
        index: parseInt(m[1]),
        categoria: m[2],
        tipo: m[3] as TipoProblema,
      });
    }
    if (items.length > 0) return items;
  }

  // Fallback final: classificar tudo como Insatisfação geral para não perder o batch
  return Array.from({ length: batchSize }, (_, i) => ({
    index: offset + i,
    categoria: 'Insatisfação geral',
    tipo: 'outro' as TipoProblema,
  }));
}

async function classificarBatch(
  client: Anthropic,
  batch: ReviewInput[],
  offset: number
): Promise<ClassificacaoItem[]> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), BATCH_TIMEOUT_MS)
  );

  const apiPromise = client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(batch, offset) }],
  });

  const msg = await Promise.race([apiPromise, timeoutPromise]);
  const raw = msg.content.find(b => b.type === 'text')?.text ?? '[]';
  return parseClassificacoes(raw, batch.length, offset);
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

function inferirTipo(categoria: string): TipoProblema {
  if (CATEGORIAS_LOGISTICA.has(categoria)) return 'logistica';
  if (categoria === 'Insatisfação geral') return 'outro';
  return 'produto';
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: {
    reviews: ReviewInput[];
    total_reviews_por_produto: Record<string, { total: number; nota_media: number }>;
  };

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

  // Mapa global: índice global → classificação
  const classificacoes = new Map<number, ClassificacaoItem>();
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
        continue;
      }
    }

    for (const item of resultado) {
      // Garantir tipo correto mesmo que Claude devolva errado
      const tipo = inferirTipo(item.categoria);
      classificacoes.set(item.index, { ...item, tipo });
    }
  }

  // Agregar por produto
  const reviewsByProduct = agruparPorProduto(reviews);
  const produtos: ProdutoResultado[] = [];

  for (const [handle, revs] of reviewsByProduct.entries()) {
    const totais = total_reviews_por_produto[handle] ?? {
      total: revs.length,
      nota_media: 0,
    };

    // Contar categorias
    const contagem = new Map<string, { quantidade: number; tipo: TipoProblema }>();

    for (const rev of revs) {
      const idx = reviews.indexOf(rev);
      const cl = classificacoes.get(idx);
      const categoria = cl?.categoria ?? 'Insatisfação geral';
      const tipo = cl ? inferirTipo(cl.categoria) : 'outro';

      const entry = contagem.get(categoria);
      if (entry) {
        entry.quantidade++;
      } else {
        contagem.set(categoria, { quantidade: 1, tipo });
      }
    }

    const totalNeg = revs.length;
    const MIN_OCORRENCIAS = 2;

    const problemas: ProblemaResultado[] = [];
    let outros = 0;

    for (const [cat, { quantidade, tipo }] of contagem.entries()) {
      if (quantidade >= MIN_OCORRENCIAS) {
        problemas.push({
          categoria: cat,
          quantidade,
          percentual: (quantidade / totalNeg) * 100,
          tipo,
        });
      } else {
        // Ocorrência única → vai para "Outros não identificados"
        outros += quantidade;
      }
    }

    // Ordenar: produto > logistica > outro, dentro de cada grupo por quantidade desc
    const ordemTipo: Record<TipoProblema, number> = { produto: 0, logistica: 1, outro: 2 };
    problemas.sort((a, b) => {
      const dt = ordemTipo[a.tipo] - ordemTipo[b.tipo];
      return dt !== 0 ? dt : b.quantidade - a.quantidade;
    });

    produtos.push({
      product_handle: handle,
      total_reviews: totais.total,
      total_negativas: totalNeg,
      nota_media: totais.nota_media,
      problemas,
      outros,
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

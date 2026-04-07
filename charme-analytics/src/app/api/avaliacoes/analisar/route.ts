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
  textos: string[]; // textos completos das reviews nesta categoria
}

export interface ProdutoResultado {
  product_handle: string;
  total_reviews: number;
  total_negativas: number;
  nota_media: number;
  problemas: ProblemaResultado[];
  outros: number;
  textos_outros: string[]; // textos de reviews que não atingiram mínimo de ocorrências
}

export interface AnalisarResponse {
  produtos: ProdutoResultado[];
  batches_com_erro: number;
  total_processadas: number;
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 80;
const BATCH_TIMEOUT_MS = 90_000;
const MIN_OCORRENCIAS = 2;

// Categorias de logística — aparecem em cinza no card
const CATEGORIAS_LOGISTICA = new Set([
  'Produto não chegou',
  'Produto errado enviado',
  'Pedido incompleto',
  'Embalagem danificada',
]);

const SYSTEM_PROMPT = `Você é um analista de qualidade especialista em e-commerce de capas para móveis (cadeiras, sofás, poltronas).
Recebeu avaliações negativas de clientes. Classifique cada avaliação em UMA categoria padronizada.

## Categorias de PRODUTO (problemas relacionados ao produto em si):

Tamanho/Encaixe:
- "Ficou grande" — capa folgada, enrugada, sobrando, não ajusta no móvel, "ficou largo"
- "Ficou pequeno" — capa não cobriu o móvel, não esticou, ficou justo, "não coube", "menor que o esperado"

Qualidade do Material:
- "Tecido fino / fraco" — material fino, ralo, leve, parece papel, baixa qualidade de tecido
- "Defeito de costura" — descosturou, costura aberta, veio rasgada, arrebentou na instalação
- "Rasgou facilmente" — furou, rasgou com uso, gato destruiu em pouco tempo, desfibrou
- "Não é impermeável" — líquido atravessou, prometia impermeabilidade mas vaza, xixi do pet atravessou
- "Não fixa / escorrega" — fica saindo, escorrega do sofá/cadeira, não prende, não fica no lugar
- "Veio manchado" — manchas de mofo, sujeira, produto veio com manchas

Aparência:
- "Cor diferente da foto" — cor veio diferente do anunciado, tonalidade errada, paleta diferente
- "Qualidade ruim" — produto abaixo do esperado de forma geral, diferente da propaganda (quando não se enquadra em categoria específica)

Funcionalidade:
- "Difícil de colocar" — processo de encaixe muito difícil, não conseguiu instalar

## Categorias de LOGÍSTICA (problema na entrega, não no produto):
- "Produto não chegou" — não recebeu, não entregue, extraviado, rastreamento sem atualizações
- "Produto errado enviado" — enviaram modelo/tamanho/cor diferente do pedido
- "Pedido incompleto" — faltou peça, veio quantidade menor que a comprada

## Categoria GENÉRICA (quando não é possível identificar um motivo claro):
- "Insatisfação geral" — reclamação vaga, sem detalhar o problema específico

## Regras críticas:
1. Use SEMPRE a categoria EXATA da lista — nunca crie variações ou novas categorias
2. Classifique pelo problema PRINCIPAL se houver múltiplos
3. "Ficou grande" vs "Ficou pequeno" — leia com atenção: "folgada/sobrando/enrugada" = grande; "não coube/não esticou/justo" = pequeno
4. Reclamação sobre entrega demorada sem mencionar problema no produto → "Produto não chegou"
5. Gato/pet rasgou/furou a capa → "Rasgou facilmente"
6. Cor errada → "Cor diferente da foto" (não "Qualidade ruim")
7. Tecido escorrega no móvel → "Não fixa / escorrega" (não "Ficou grande")
8. Responda APENAS JSON, sem markdown, sem preamble

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

function formatTexto(rev: ReviewInput): string {
  const body = rev.body?.trim();
  const title = rev.title?.trim();
  if (body && title && body.toLowerCase() !== title.toLowerCase()) {
    return `${title}: ${body}`;
  }
  return body || title || '(sem texto)';
}

interface ClassificacaoItem {
  index: number;
  categoria: string;
  tipo: TipoProblema;
}

function parseClassificacoes(raw: string, batchSize: number, offset: number): ClassificacaoItem[] {
  let text = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) text = arrayMatch[0];

  try {
    const parsed = JSON.parse(text) as ClassificacaoItem[];
    if (Array.isArray(parsed)) return parsed;
  } catch {
    const items: ClassificacaoItem[] = [];
    const objRegex = /\{\s*"index"\s*:\s*(\d+)\s*,\s*"categoria"\s*:\s*"([^"]+)"\s*,\s*"tipo"\s*:\s*"([^"]+)"\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRegex.exec(text)) !== null) {
      items.push({ index: parseInt(m[1]), categoria: m[2], tipo: m[3] as TipoProblema });
    }
    if (items.length > 0) return items;
  }

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

  const classificacoes = new Map<number, ClassificacaoItem>();
  let batches_com_erro = 0;

  for (let b = 0; b < batches.length; b++) {
    const offset = b * BATCH_SIZE;
    const batch = batches[b];

    let resultado: ClassificacaoItem[] = [];
    try {
      resultado = await classificarBatch(client, batch, offset);
    } catch {
      try {
        resultado = await classificarBatch(client, batch, offset);
      } catch {
        batches_com_erro++;
        continue;
      }
    }

    for (const item of resultado) {
      const tipo = inferirTipo(item.categoria);
      classificacoes.set(item.index, { ...item, tipo });
    }
  }

  // Agregar por produto
  const reviewsByProduct = agruparPorProduto(reviews);
  const produtos: ProdutoResultado[] = [];

  for (const [handle, revs] of reviewsByProduct.entries()) {
    const totais = total_reviews_por_produto[handle] ?? { total: revs.length, nota_media: 0 };

    // Contar categorias e coletar textos
    const conteudo = new Map<string, { quantidade: number; tipo: TipoProblema; textos: string[] }>();

    for (const rev of revs) {
      const idx = reviews.indexOf(rev);
      const cl = classificacoes.get(idx);
      const categoria = cl?.categoria ?? 'Insatisfação geral';
      const tipo = cl ? inferirTipo(cl.categoria) : 'outro';
      const texto = formatTexto(rev);

      const entry = conteudo.get(categoria);
      if (entry) {
        entry.quantidade++;
        entry.textos.push(texto);
      } else {
        conteudo.set(categoria, { quantidade: 1, tipo, textos: [texto] });
      }
    }

    const totalNeg = revs.length;
    const problemas: ProblemaResultado[] = [];
    const textos_outros: string[] = [];
    let outros = 0;

    for (const [cat, { quantidade, tipo, textos }] of conteudo.entries()) {
      if (quantidade >= MIN_OCORRENCIAS) {
        problemas.push({
          categoria: cat,
          quantidade,
          percentual: (quantidade / totalNeg) * 100,
          tipo,
          textos,
        });
      } else {
        outros += quantidade;
        textos_outros.push(...textos);
      }
    }

    // Ordenar: produto (por qtd desc) → logistica → outro
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
      textos_outros,
    });
  }

  produtos.sort((a, b) => b.total_negativas - a.total_negativas);

  return NextResponse.json({
    produtos,
    batches_com_erro,
    total_processadas: reviews.length - batches_com_erro * BATCH_SIZE,
  } satisfies AnalisarResponse);
}

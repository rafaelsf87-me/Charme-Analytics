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

// Rollup: subcategorias sobem para o pai quando abaixo do mínimo
const ROLLUP_PARENT: Record<string, string> = {
  'Qualidade Ruim - Tecido':   'Qualidade Ruim',
  'Qualidade Ruim - Costura':  'Qualidade Ruim',
  'Qualidade Ruim - Rasgou':   'Qualidade Ruim',
  'Qualidade Ruim - Escorrega':'Qualidade Ruim',
  'Qualidade - Manchado':      'Qualidade Ruim',
  'Não Serviu - Grande':       'Não Serviu',
  'Não Serviu - Pequeno':      'Não Serviu',
};

// Categorias de logística — aparecem em cinza no card
const CATEGORIAS_LOGISTICA = new Set([
  'Não Recebi (atraso)',
  'Produto Errado',
  'Pedido Faltando Peça',
]);

// Categorias genéricas — aparecem em cinza claro
const CATEGORIAS_OUTRO = new Set([
  'Comprou Errado (problema unidades)',
  'Outros / Genérico',
]);

const SYSTEM_PROMPT = `Você é um analista de qualidade especialista em e-commerce de capas para móveis (cadeiras, sofás, poltronas).
Classifique cada avaliação negativa em UMA das categorias abaixo. Use EXATAMENTE o nome da categoria listado.

As categorias têm hierarquia: algumas são genéricas (ex: "Qualidade Ruim") e outras são específicas (ex: "Qualidade Ruim - Costura"). Sempre prefira a categoria ESPECÍFICA quando o texto permitir identificar o subproblema.

## CATEGORIAS

### Não Recebi (atraso)
Cliente não recebeu o produto ou houve atraso significativo na entrega.
Palavras-chave: não recebi, não chegou, nunca entregue, atraso, não foi entregue, até agora nada, código de rastreio, não entregaram
Exemplos: "Não recebi meu produto." / "Até agora eu não recebi." / "Nunca foi entregue" / "Até agora eu não recebi. Eu pedi dia 27 e até agora nada."

### Qualidade Ruim
Insatisfação genérica com qualidade quando NÃO é possível identificar o subtipo específico. Use esta SÓ quando o texto não permite classificar nas subcategorias abaixo.
Palavras-chave: qualidade ruim, material fraco, péssima qualidade, decepcionei, esperava melhor, propaganda enganosa, não vale o preço
Exemplos: "Material muito fraco, achei que era melhor" / "Me decepcionei, esperava um tecido mais encorpado."

### Qualidade Ruim - Tecido
Reclamação específica sobre o tecido ser fino, fraco, brilhante, plástico ou de má qualidade.
Palavras-chave: tecido fino, tecido fraco, tecido brilhante, tecido plástico, material fino, parece plástico
Exemplos: "Tecido muito fino. Não protegerá em nada minhas cadeiras." / "Péssimo acabamento! Tecido brilhante!!!!"

### Qualidade Ruim - Costura
Problemas com costura, acabamento, fita de ajuste, peças descosturadas.
Palavras-chave: costura, descosturada, mal acabada, fita arrebentou, costurada torto, acabamento ruim, falha na costura
Exemplos: "Duas capas vieram com falha na costura" / "Uma delas veio descosturada na lateral e costurada tudo torto" / "A fita de ajuste arrebentou."

### Qualidade Ruim - Rasgou
Produto rasgou, furou, desfiou ou soltou fios em pouco tempo de uso.
Palavras-chave: rasgou, furou, desfiando, fios soltos, fios puxados, soltando fio, unha do gato, primeira semana
Exemplos: "Furou na primeira semana" / "Já está toda desfiando, não tem proteção contra arranhões!" / "Em uma semana já está cheia de fios soltando"

### Qualidade Ruim - Escorrega
Capa não fica fixa, escorrega, sai do lugar.
Palavras-chave: escorrega, escorregando, não fixa, fica saindo, sai do lugar, não prendeu, solta, não fica presa, saindo
Exemplos: "Fica escorregando o tempo todo, enruga tudo no sofá" / "Ela fica saindo do sofá" / "Não fixou, já devolvi" / "Não fica presa no sofá: Fica saindo, escorrega."

### Não Serviu
Genérico — capa não serviu no móvel, sem especificar se é grande ou pequena. Use SÓ quando o texto não permite classificar se ficou grande ou pequena.
Palavras-chave: não serviu, não encaixou, não coube (sem dizer se é grande/pequena), não vestiu, não se encaixa, padronagem diferente e não encaixa
Exemplos: "Não encaixou na minha cadeira." / "A capa não deu certo" / "A capa de 2 lugares e a de 3 vieram com padronagem diferente e não se encaixam em qualquer modelo de sofá" — mesmo com menção a devolução/reembolso, o problema principal é encaixe → "Não Serviu"

### Não Serviu - Pequeno
Capa ficou pequena, apertada, curta, não coube.
Palavras-chave: pequena, apertada, curta, não coube, menor que, muito justa, não cobriu
Exemplos: "Ficaram pequenas e minhas cadeiras são padrão" / "Veio pequena, fiz a devolução"

### Não Serviu - Grande
Capa ficou grande, solta, sobrando, folgada.
Palavras-chave: grande, solta, folgada, imensa, sobrando, enorme, larga demais, muito solta
Exemplos: "A capa ficou muito solta no sofá" / "Ficou imensa, sobrando" / "Grande, não é ajustável." / "A capa ficou muito solta no sofá"

### Cor Errada
Cor recebida diferente da comprada ou variação de cor entre unidades do mesmo pedido.
Palavras-chave: cor errada, cor diferente, não é a cor, veio outra cor, cores diferentes, não veio a cor que escolhi
Exemplos: "A cor recebida foi marrom, não veio verde oliva." / "Pedi 6 capas iguais. Recebi 4 de uma cor e 2 de outra."

### Produto Errado
Recebeu produto/tamanho/modelo diferente do comprado — não é cor, é o item em si.
Palavras-chave: capa errada, veio errada, errado, 2 lugares ao invés de 3, produto trocado, mandaram outro
Exemplos: "Recebi uma capa de 2 lugares ao invés de 3" / "Veio a capa errada" / "A capa veio errada. Estou aguardando meu reembolso, pois já devolvi." — menção a devolução/reembolso não muda a categoria, classifique pelo problema do produto

### Não é Impermeável
Prometido como impermeável mas não protege contra líquidos.
Palavras-chave: impermeável, não é impermeável, vazou, molhou, xixi, líquido, água passou
Exemplos: "Até a cachorra subir no sofá e fazer xixi." / "Comprei impermeável e recebi normal"

### Pedido Faltando Peça
Pedido incompleto — faltou parte do produto ou do pedido.
Palavras-chave: faltando, incompleto, segunda metade, não veio tudo, peça faltando
Exemplos: "Não entregou a segunda metade do meu pedido"

### Dificuldade Utilização
Dificuldade em colocar, instalar ou usar o produto (diferente de "não serviu" — aqui o produto até serve, mas é trabalhoso).
Palavras-chave: difícil de colocar, chato de usar, complicado, não fica arrumado, trabalhoso
Exemplos: "É lindo, mas muito chato de usar, o sofá não fica arrumado"

### Comprou Errado (problema unidades)
Cliente se confundiu com o site — não é erro da loja, é confusão do cliente.
Palavras-chave: 1 unidade, achei que era par, pensei que vinham mais, site confuso, não ficou claro
Exemplos: "Deveriam deixar mais explícito no site que é apenas 1 unidade"

### Outros / Genérico
Usar APENAS quando o texto não se encaixa em nenhuma categoria acima. Inclui: pós-venda ruim sem outro problema, avaliação sem informação útil, devolveu sem explicar motivo.
Palavras-chave: devolvido, pós-venda, não respondem, atendimento (quando o foco é APENAS atendimento)
Exemplos: "Não posso avaliar pois o material foi devolvido" / "Loja não responde o cliente."

---

## REGRAS DE DECISÃO

1. Use SEMPRE o nome EXATO da categoria — nunca crie variações
2. Quando houver múltiplos problemas, classifique pelo PRIMEIRO problema mencionado no texto. Exemplo: "não serviu nas minhas cadeiras... essas fininhas não deu" → o primeiro problema é tamanho/encaixe ("não serviu"), ignore a menção ao tecido como justificativa → "Não Serviu"
3. Específica > Genérica: se o texto permite o subtipo, use o subtipo
4. "Cor Errada" cobre qualquer situação de cor incorreta — NÃO use "Produto Errado" para cor. Inclui: "pedido veio errado, cores diferentes", "mandaram 5 de uma cor e 3 de outra", "recebi cores misturadas" → SEMPRE "Cor Errada"
5. "Produto Errado" = modelo/tamanho/tipo errado (ex: pediu 3 lugares, veio de 2). NUNCA para cor. Textos curtos como "veio a capa errada", "capa errada", "veio errado" sem menção a cor → sempre "Produto Errado"
6. "Qualidade Ruim - Escorrega" = capa escorrega/sai do lugar durante uso; "Não Serviu - Grande" = capa ficou fisicamente grande/solta/folgada para o móvel. "Ficou muito solta no sofá" = tamanho → "Não Serviu - Grande"
7. Entrega atrasada ou rastreamento inexistente → "Não Recebi (atraso)"
8. Gato/pet rasgou/furou → "Qualidade Ruim - Rasgou"
9. Atendimento ruim como problema secundário → classificar pelo problema de produto
10. Menção a devolução, reembolso ou troca NÃO muda a categoria — classifique sempre pelo problema do produto que motivou a devolução
11. Nunca deixar sem categoria — se nada se encaixa, usar "Outros / Genérico"
12. Responda APENAS JSON, sem markdown, sem preamble

## Formato de resposta:
[
  {"index": 0, "categoria": "Não Serviu - Grande", "tipo": "produto"},
  {"index": 1, "categoria": "Não Recebi (atraso)", "tipo": "logistica"},
  {"index": 2, "categoria": "Outros / Genérico", "tipo": "outro"}
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
    categoria: 'Outros / Genérico',
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
  if (CATEGORIAS_OUTRO.has(categoria)) return 'outro';
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

    // Rollup: subcategorias abaixo do mínimo sobem para o pai
    const consolidated = new Map<string, { quantidade: number; tipo: TipoProblema; textos: string[] }>();
    for (const [cat, data] of conteudo.entries()) {
      const parent = data.quantidade < MIN_OCORRENCIAS ? (ROLLUP_PARENT[cat] ?? cat) : cat;
      const existing = consolidated.get(parent);
      if (existing) {
        existing.quantidade += data.quantidade;
        existing.textos.push(...data.textos);
      } else {
        consolidated.set(parent, { quantidade: data.quantidade, tipo: inferirTipo(parent), textos: [...data.textos] });
      }
    }

    for (const [cat, { quantidade, tipo, textos }] of consolidated.entries()) {
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

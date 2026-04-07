# MODULO-AVALIACOES.md — Spec de Implementação
> Para o Claude Code executar. Leia INTEIRO antes de começar.
> Data: 07/04/2026

---

## Contexto

Novo módulo **isolado** no Charme Analytics: "Análise de Avaliações de Produtos".
Aparece como 3º card na tela Home, ao lado de "Dados e Insights" e "Relatório ADS".

**Objetivo:** O usuário faz upload de um CSV exportado do Judge.me (avaliações de produtos). O sistema classifica automaticamente os motivos de reclamação, consolida por produto e exibe os principais problemas ordenados por volume.

**Uso:** ~1x por mês. Volume: 500 a 8.000+ reviews por upload.

**Princípio de isolamento:** Este módulo NÃO compartilha código com o chat nem com o módulo de criativos. Tem sua própria rota, seus próprios componentes, seu próprio endpoint de API. NÃO usa as tools do chat (ga4.ts, shopify.ts, etc.). A única exceção é uma query direta ao Shopify para buscar imagens de produtos (usando as env vars SHOPIFY_STORE_DOMAIN e SHOPIFY_ACCESS_TOKEN já existentes).

---

## Stack (mesma do projeto)

- Next.js 16 (App Router), TypeScript
- Tailwind CSS + shadcn/ui + fonte Geist
- Cores Charme: primária `#553679`, background `#F8F5FC`
- Claude API: `claude-sonnet-4-20250514` via `@anthropic-ai/sdk`
- Papa Parse para parsing CSV no frontend (instalar: `papaparse` + `@types/papaparse`)

---

## Estrutura de Arquivos (CRIAR)

```
src/
├── app/
│   ├── avaliacoes/
│   │   └── page.tsx                    # Página do módulo
│   └── api/
│       └── avaliacoes/
│           ├── analisar/route.ts       # POST — processa reviews via Claude
│           └── imagens/route.ts        # POST — busca imagens no Shopify por handles
├── components/
│   └── avaliacoes/
│       ├── upload-form.tsx             # Área de upload + drag & drop
│       ├── processing-status.tsx       # Barra de progresso durante processamento
│       ├── resultados-view.tsx         # Container dos resultados
│       └── produto-card.tsx            # Card individual de produto com problemas
```

---

## Arquivos a EDITAR (mínimo)

| Arquivo | O que mudar |
|---|---|
| `src/app/home/page.tsx` | Adicionar 3º card: "Análise de Avaliações" com link para `/avaliacoes` |
| `src/proxy.ts` | Adicionar `/avaliacoes` às rotas protegidas (se não coberto por pattern existente) |

**NÃO editar nenhum outro arquivo existente.**

---

## Formato do CSV (Judge.me export)

```csv
"title","body","rating","review_date","source","curated","reviewer_name","reviewer_email","product_id","product_handle","reply","reply_date","picture_urls","ip_address","location","metaobject_handle"
```

Campos usados:
- `body` — texto da avaliação (campo principal para análise)
- `rating` — nota 1-5 (filtrar ≤ 3)
- `product_handle` — slug do produto (agrupar + buscar imagem)
- `product_id` — ID Shopify (backup para imagem)
- `review_date` — data da avaliação (exibir no card)
- `title` — título da avaliação (contexto adicional para classificação)

---

## Fluxo Completo

### 1. Upload (Frontend)

**Tela:** área de upload centralizada com drag & drop + botão "Selecionar arquivo".
- Aceita apenas `.csv`
- Validação: verificar se tem as colunas obrigatórias (`body`, `rating`, `product_handle`)
- Parsing com Papa Parse no frontend
- Após parse, mostrar resumo antes de processar:

```
📊 Resumo do arquivo:
• Total de avaliações: 5.234
• Avaliações negativas (≤ 3 estrelas): 1.847 (35,3%)
• Produtos únicos com avaliações negativas: 42
• Período: 15/jan'26 a 07/abr'26

[Analisar Avaliações]   [Cancelar]
```

- Se 0 avaliações negativas: mostrar mensagem "Nenhuma avaliação negativa encontrada" e não habilitar botão.

### 2. Processamento (Backend — POST /api/avaliacoes/analisar)

**Input:** array de reviews negativas (só `body`, `title`, `rating`, `product_handle`). NÃO enviar email, IP ou dados pessoais ao backend.

**Pipeline:**

#### Passo 1: Agrupar por produto
```typescript
// Agrupar reviews por product_handle
const reviewsByProduct = groupBy(negativeReviews, 'product_handle');
```

#### Passo 2: Dividir em batches
```typescript
const BATCH_SIZE = 300; // reviews por chamada Claude
// Flatten todas as reviews negativas e dividir em batches de 300
// Cada review no batch inclui: product_handle, title, body, rating
```

#### Passo 3: Classificar via Claude API (1 chamada por batch)

System prompt para classificação:
```
Você é um analista de qualidade de e-commerce. Recebeu avaliações negativas de clientes.

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
  {"index": 1, "categoria": "Material frágil"},
  ...
]
```

User message:
```
Classifique estas avaliações:

[0] Rating: 1 | Produto: capa-cadeira-boho | "Não serviu na cadeira, ficou folgada"
[1] Rating: 2 | Produto: capa-sofa-elastex | "Material muito fino, rasgou no primeiro uso"
...
```

#### Passo 4: Agregar resultados (programático, sem IA)

```typescript
// Para cada produto:
//   Contar ocorrências de cada categoria
//   Calcular % = ocorrências da categoria / total de negativas do produto × 100
//   Filtrar categorias com < 5% das avaliações negativas do produto
//   Ordenar por quantidade (desc)

interface ProdutoResultado {
  product_handle: string;
  total_reviews: number;        // total geral (positivas + negativas)
  total_negativas: number;      // rating ≤ 3
  nota_media: number;           // média de todas as reviews
  problemas: {
    categoria: string;
    quantidade: number;
    percentual: number;         // % das negativas deste produto
  }[];
}
```

#### Passo 5: Buscar imagens dos produtos (POST /api/avaliacoes/imagens)

Após agregar, pegar os `product_handle` únicos e buscar imagens no Shopify:

```typescript
// Query GraphQL ao Shopify
const query = `{
  products(first: 50, query: "${handles.map(h => `handle:${h}`).join(' OR ')}") {
    edges {
      node {
        handle
        title
        featuredImage {
          url
          altText
        }
      }
    }
  }
}`;
```

- Fazer em batches de 50 handles (limite do Shopify)
- Se produto não encontrado: mostrar placeholder
- Usar as env vars `SHOPIFY_STORE_DOMAIN` e `SHOPIFY_ACCESS_TOKEN` já existentes
- NÃO importar funções de `src/lib/tools/shopify.ts` — fazer query direta para isolamento

### 3. Exibição dos Resultados

**Layout:** grid de cards, 1 coluna em mobile, 2 colunas em desktop.
**Ordenação dos cards:** por `total_negativas` (desc) — produto com mais reclamações primeiro.

#### Card do produto:

```
┌─────────────────────────────────────────────────┐
│ [IMG]  Capa para Cadeira de Jantar Florata       │
│        ⭐ 3.2 média | 234 avaliações | 87 negativas │
│─────────────────────────────────────────────────│
│  Principais Problemas:                           │
│                                                  │
│  ██████████████████░░  Tamanho inadequado    34  (39,1%)  │
│  ████████████░░░░░░░░  Diferente da foto     21  (24,1%)  │
│  ██████░░░░░░░░░░░░░░  Material frágil       12  (13,8%)  │
│  ████░░░░░░░░░░░░░░░░  Difícil de colocar    8  ( 9,2%)  │
│  ███░░░░░░░░░░░░░░░░░  Cor diferente          5  ( 5,7%)  │
│                                                  │
│  Problemas menores (<5%) omitidos: 7 avaliações  │
└─────────────────────────────────────────────────┘
```

**Detalhes do card:**
- **Imagem:** thumbnail do produto (featuredImage do Shopify), 80×80px, rounded
- **Título:** derivado do `product_handle` (humanizado) ou `title` do Shopify se disponível
- **Métricas:** nota média, total avaliações, total negativas
- **Barras de progresso:** proporcionais à maior categoria (a maior = 100% da barra)
- **Cor das barras:** `#553679` (primária Charme)
- **Nota de rodapé:** quantas avaliações foram omitidas por estar abaixo de 5%

#### Filtros (topo da tela de resultados):
- **Ordenar por:** Mais reclamações | Pior nota média | Mais avaliações
- **Buscar produto:** campo de texto para filtrar cards por nome

#### Botão de export:
- **Exportar XLSX** — mesmo padrão do módulo de criativos (`xlsx` / SheetJS)
- Colunas: Produto | Nota Média | Total Avaliações | Total Negativas | Problema | Qtd | %

---

## Progresso Durante Processamento

O processamento pode levar 1-3 minutos para volumes grandes. Mostrar progresso:

```
Analisando avaliações...

████████████░░░░░░░░░░░░  Batch 4 de 10

Classificando reviews 901-1.200 de 2.800 negativas...
```

**Implementação:** o frontend envia o array completo ao backend. O backend processa batch a batch e retorna o resultado completo ao final. Usar um approach simples:
- Frontend mostra loading/spinner com estimativa ("Processando ~2.800 avaliações, isso pode levar 1-2 minutos...")
- Backend retorna tudo de uma vez quando pronto
- Se quiser mais sofisticação futura (streaming de progresso), pode evoluir depois

---

## Tratamento de Erros

- CSV inválido (colunas faltando): mostrar erro claro indicando quais colunas estão ausentes
- Nenhuma review negativa: mensagem amigável, sem botão de processar
- Erro na API Claude: retry 1x por batch. Se falhar de novo, pular o batch e avisar
- Timeout: cada batch tem timeout de 60s. Se exceder, pular e avisar
- Erro Shopify (imagens): usar placeholder, não bloquear resultado

---

## Card na Home

Adicionar em `src/app/home/page.tsx` como 3º card:

```
📝 Análise de Avaliações
Faça upload das avaliações (Judge.me) e identifique
os principais problemas reportados por produto.
```

- Mesmo estilo visual dos 2 cards existentes
- Link para `/avaliacoes`
- Se o layout atual é 2 cards lado a lado, ajustar para 3 cards (pode ser 3 colunas em desktop ou 2+1)

---

## Regras para o Claude Code

1. **CRIAR** apenas os arquivos listados na seção "Estrutura de Arquivos"
2. **EDITAR** apenas `home/page.tsx` (adicionar card) e `proxy.ts` (adicionar rota) — verificar se proxy.ts já cobre `/avaliacoes` pelo pattern existente antes de editar
3. **NÃO alterar** nenhum outro arquivo existente
4. **NÃO importar** de `src/lib/tools/*` — as queries Shopify para imagens são diretas neste módulo
5. **Instalar** `papaparse` e `@types/papaparse` se não existirem
6. **Usar** `@anthropic-ai/sdk` para chamadas Claude (já instalado no projeto)
7. **Usar** `xlsx` para export (já instalado no projeto)
8. **Manter** cores Charme, fonte Geist, responsividade
9. **NÃO** usar localStorage/sessionStorage
10. O processamento acontece todo no **server-side** (route handler). O frontend só envia os dados parseados e recebe os resultados.
11. **NÃO enviar dados pessoais** (email, IP, nome do reviewer) ao endpoint de análise — só body, title, rating, product_handle.

---

## Estimativa de Custo por Uso

| Volume | Reviews negativas (~35%) | Batches | Custo estimado | Tempo |
|---|---|---|---|---|
| 500 | ~175 | 1 | ~R$0,50 | ~15s |
| 2.000 | ~700 | 3 | ~R$1,50 | ~45s |
| 5.000 | ~1.750 | 6 | ~R$3,00 | ~1,5min |
| 8.000 | ~2.800 | 10 | ~R$5,00 | ~2,5min |

---

## Comando para Claude Code

```
Leia o MODULO-AVALIACOES.md na raiz do projeto. Implemente o módulo completo conforme especificado.

Ordem de implementação:
1. Criar a estrutura de arquivos (páginas, API routes, componentes)
2. Implementar upload-form.tsx com Papa Parse (parse CSV no frontend)
3. Implementar POST /api/avaliacoes/analisar (batching + Claude API + agregação)
4. Implementar POST /api/avaliacoes/imagens (query Shopify por handles)
5. Implementar produto-card.tsx (card com barras de progresso)
6. Implementar resultados-view.tsx (grid de cards + filtros + export)
7. Montar avaliacoes/page.tsx integrando tudo
8. Adicionar 3º card na home/page.tsx
9. Verificar se proxy.ts cobre /avaliacoes (adicionar se necessário)

Regras críticas:
- NÃO altere nenhum arquivo existente além de home/page.tsx e proxy.ts
- NÃO importe de src/lib/tools/* — queries Shopify são diretas neste módulo
- NÃO envie dados pessoais (email, IP, nome) ao endpoint de análise
- Instale papaparse e @types/papaparse
- Mantenha cores Charme (#553679, #F8F5FC), fonte Geist, responsividade
- Após implementar, me mostre o resultado visual da tela de upload e de um card de exemplo
```

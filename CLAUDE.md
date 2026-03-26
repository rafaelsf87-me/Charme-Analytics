# Charme Analytics — Instruções de Build

## O Que É Este Projeto

Web app de analytics para o e-commerce "Charme do Detalhe" (têxteis para casa). Interface de chat onde o usuário faz perguntas em linguagem natural e recebe análises cruzando dados de Shopify, GA4, Google Ads e Meta Ads.

## Antes de Codar, Leia Tudo

Leia TODOS os arquivos em `docs/` antes de começar qualquer módulo:

- `docs/ARCHITECTURE.md` — Stack, estrutura, fluxo de dados
- `docs/SYSTEM-PROMPT.md` — System prompt do agente (usado na Claude API)
- `docs/BUILD-PLAN.md` — Ordem de construção módulo por módulo
- `docs/API-SPECS.md` — Specs de cada API externa (endpoints, auth, queries, campos)
- `docs/ADDENDUM.md` — Regras de performance (chamadas paralelas), economia de tokens, identificação de produtos no GA4

## Stack

- **Next.js 14+** (App Router, TypeScript)
- **Tailwind CSS + shadcn/ui**
- **Claude API** (claude-sonnet-4-20250514, tool use)
- **Deploy:** Vercel
- **Sem banco de dados** — stateless, dados sempre frescos das APIs

## Princípios Inegociáveis

### Somente leitura
Nenhuma integração deve ter capacidade de escrita. Todas as chamadas são GET/query. Se um SDK exigir scope de write, NÃO inclua.

### Otimização de tokens (custo)
Requisito de primeira classe. Cada token custa dinheiro. Aplique em TUDO:

1. **System prompt:** denso, sem repetição, zero floreio. Cada frase carrega informação.
2. **Tool descriptions:** máximo 2 frases por tool. Só o que Claude precisa pra decidir quando usar.
3. **Tool responses:** backend DEVE pré-processar dados antes de devolver ao Claude. Nunca retorne JSON cru da API. Retorne texto tabular resumido com só os campos necessários.
   - ❌ ERRADO: retornar o objeto completo do pedido Shopify (200+ campos)
   - ✅ CERTO: retornar `"cliente: Maria S. | pedidos: 8 | receita: R$4.200 | ticket_medio: R$525"`
4. **Histórico de conversa:** enviar no máximo as últimas 10 mensagens à Claude API. Truncar anteriores.
5. **Paginação:** se query retorna 500+ resultados, agregar NO BACKEND. Enviar só o top N ao Claude.
6. **Campos das APIs:** requisitar APENAS os campos necessários em cada query GraphQL/REST. Nunca usar SELECT * ou equivalente.

### Anti-falha
1. **Validação de entrada:** toda tool valida parâmetros antes de chamar a API. Datas inválidas, campos faltando → erro claro, sem chamar API.
2. **Dados pré-formatados:** tools retornam labels legíveis (nomes, não IDs). Monetários em R$. Percentuais já calculados.
3. **Erros estruturados:** se API falhar → `"ERRO [Plataforma]: [mensagem legível]. Sugestão: [ação]"`. Nunca stack trace.
4. **Campos nulos:** substituir null/undefined por "N/D". Nunca deixar Claude interpretar null.
5. **Rate limiting:** retry com backoff exponencial (max 3x) em 429. Se falhar, erro claro.
6. **Timeout:** 30s por chamada de API.

### Segurança
- Secrets em `.env.local` (nunca commitados)
- Auth: `AUTH_PASSWORD` no env → cookie httpOnly, secure, SameSite=strict, 7 dias

## Padrões de Código

- TypeScript strict mode
- Um arquivo por connector em `src/lib/tools/`
- Comentários em português nos pontos de lógica de negócio
- Sem dependências desnecessárias — cada npm install deve ser justificado
- Priorize simplicidade: 10 linhas > 50 linhas

## Como Trabalhar

1. Leia `docs/BUILD-PLAN.md`
2. Construa módulo por módulo, na ordem indicada
3. Após cada módulo, mostre o que foi feito e peça confirmação
4. Dúvida sobre regra de negócio → PERGUNTE antes de assumir

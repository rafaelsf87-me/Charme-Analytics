# Plano de Construção — Módulo por Módulo

> Siga esta ordem. Cada módulo é independente e testável.
> Após cada módulo, mostre o resultado ao usuário e peça confirmação antes de avançar.

---

## Módulo 0: Scaffold

**Objetivo:** Projeto Next.js rodando com todas as dependências.

**Ações:**
1. `npx create-next-app@latest charme-analytics --typescript --tailwind --app --src-dir`
2. Instalar dependências:
   - `@anthropic-ai/sdk` — Claude API
   - `react-markdown` + `remark-gfm` — renderizar Markdown com tabelas
   - Inicializar shadcn/ui (`npx shadcn@latest init`)
   - Adicionar componentes shadcn: button, input, card, scroll-area
3. Criar estrutura de pastas conforme `docs/ARCHITECTURE.md`
4. Criar `.env.example` com todas as variáveis de `docs/ARCHITECTURE.md`
5. Criar `.gitignore` (incluir: .env.local, node_modules, .next)

**Pronto quando:** `npm run dev` roda, página em branco carrega.

---

## Módulo 1: Autenticação

**Objetivo:** Login com senha compartilhada protegendo /chat.

**Ações:**

1. **`src/components/login-form.tsx`**
   - Input de senha + botão "Entrar"
   - Visual limpo, centralizado
   - Título: "Charme Analytics"
   - Subtítulo: "Central de Dados"
   - Estado de erro se senha incorreta

2. **`src/app/page.tsx`**
   - Renderiza login-form
   - Se já autenticado (cookie existe), redireciona pra /chat

3. **`src/app/api/auth/route.ts`**
   - POST `{ password: string }`
   - Compara com `process.env.AUTH_PASSWORD`
   - Correto → seta cookie `charme_auth` (httpOnly, secure, SameSite=strict, maxAge=7dias, valor = hash simples)
   - Incorreto → 401

4. **`src/middleware.ts`**
   - Matcher: `/chat/:path*`
   - Checa cookie `charme_auth`
   - Ausente/inválido → redirect pra `/`

**Pronto quando:** Login funciona, /chat protegido, redirect correto.

---

## Módulo 2: Interface de Chat

**Objetivo:** Tela de chat funcional com renderização de Markdown e tabelas.

**Ações:**

1. **`src/app/chat/page.tsx`**
   - Header fixo: "Charme Analytics" + botão logout
   - Área de mensagens (scroll automático)
   - Input fixo no bottom + botão enviar (Enter também envia)
   - Estado inicial: mostrar sugestões de relatórios clicáveis

2. **`src/components/chat-interface.tsx`**
   - State: `messages: { role: 'user' | 'assistant', content: string }[]`
   - Ao enviar: adiciona msg do user, mostra loading, chama POST /api/chat
   - Suportar streaming (ler resposta chunk por chunk)

3. **`src/components/message-bubble.tsx`**
   - User: alinhado à direita, bg destaque
   - Assistant: alinhado à esquerda, renderiza Markdown completo
   - Usar react-markdown com remark-gfm pra tabelas

4. **`src/components/data-table.tsx`**
   - Override do componente `table` do react-markdown
   - Zebra striping, bordas sutis, responsivo (scroll-x em mobile)
   - Header com bg diferenciado
   - Texto numérico alinhado à direita

5. **`src/components/loading-indicator.tsx`**
   - Texto progressivo: "Analisando pergunta..." → "Consultando [Plataforma]..." → "Processando dados..."
   - Animação sutil (dots ou pulse)

6. **Sugestões iniciais (no chat vazio):**
   ```
   📊 "Relatório: Top 10 campanhas Meta Ads por ROAS no último mês"
   👥 "Relatório: Top 20 clientes por receita nos últimos 3 meses"
   📈 "Compare: taxa de conversão Google Ads vs Meta Ads este mês"
   🛒 "Relatório: produtos com mais views e menor conversão em vendas"
   ```

**Pronto quando:** Chat renderiza mensagens mockadas. Tabelas Markdown viram tabelas HTML estilizadas.

---

## Módulo 3: Integração Claude API (sem tools)

**Objetivo:** Chat conectado ao Claude. Agente responde com perguntas de clarificação.

**Ações:**

1. **`src/lib/system-prompt.ts`**
   - Exporta o conteúdo de `docs/SYSTEM-PROMPT.md` como string constante
   - ATENÇÃO: o conteúdo deve ser a string literal, não ler o arquivo em runtime

2. **`src/lib/claude.ts`**
   - Função principal: `streamChat(messages, tools?)`
   - Usa `@anthropic-ai/sdk` com streaming
   - Modelo: `claude-sonnet-4-20250514`
   - max_tokens: 4096
   - Envia: system prompt + últimas 10 mensagens do histórico + tools
   - Implementar tool use loop:
     ```
     while resposta contém tool_use:
       executar tool → obter resultado
       adicionar tool_result às messages
       chamar Claude novamente
     retornar texto final
     ```

3. **`src/app/api/chat/route.ts`**
   - POST `{ messages: [{role, content}] }`
   - Trunca histórico pra últimas 10 mensagens
   - Chama streamChat
   - Retorna StreamingTextResponse

4. **Conectar frontend ao endpoint**
   - chat-interface.tsx faz fetch com stream reader
   - Atualiza mensagem do assistant em tempo real

**Pronto quando:** Usuário pergunta algo, Claude responde com perguntas de clarificação (sem dados reais ainda).

---

## Módulo 4: Connector Shopify

**Objetivo:** Claude consulta dados reais da loja.

**Ações:**

1. **`src/lib/tools/shopify.ts`**
   - Auth: header `X-Shopify-Access-Token`
   - URL: `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json`
   - Funções (cada uma vira uma tool):

   **`shopify_get_orders`**
   - Params: date_from, date_to, status (default: any), limit (default: 50)
   - Query GraphQL: APENAS campos: id, name, createdAt, totalPriceSet, customer{firstName,lastName,email}, lineItems(first:5){title,quantity,originalTotalSet}
   - Pré-processamento: agrupa por cliente se solicitado, calcula totais
   - Retorna texto tabular compacto

   **`shopify_get_top_customers`**
   - Params: date_from, date_to, limit (default: 10), sort_by (revenue|orders)
   - Busca pedidos no período, agrupa por cliente NO BACKEND
   - Calcula: total gasto, nº pedidos, ticket médio, primeiro/último pedido
   - Retorna já ordenado e formatado

   **`shopify_get_products`**
   - Params: limit, search_query (opcional)
   - Campos: id, title, productType, vendor, totalInventory, variants(first:3){price,inventoryQuantity}
   - Retorna lista compacta

2. **`src/lib/tools/index.ts`**
   - Registry com definições de tools (name, description, input_schema)
   - Descriptions CURTAS (max 2 frases):
     ```
     shopify_get_orders: "Busca pedidos da Shopify com filtros de data e status. Retorna dados de pedidos incluindo cliente, produtos e valores."
     shopify_get_top_customers: "Ranking de clientes por receita ou nº de pedidos em um período. Retorna nome, total gasto, pedidos, ticket médio."
     shopify_get_products: "Lista ou busca produtos da loja. Retorna título, tipo, estoque e preços."
     ```

3. **`src/lib/formatters.ts`**
   - `formatBRL(centavos)` → "R$1.234,56"
   - `formatPercent(decimal)` → "12,3%"
   - `formatDate(iso)` → "25/03/2026"
   - `compactTable(headers, rows)` → texto tabular pipe-separated

4. **Atualizar claude.ts** pra executar tool use loop com tools reais

**Pronto quando:** "Top 10 clientes dos últimos 3 meses" retorna dados reais do Shopify em tabela.

---

## Módulo 5: Connector GA4

**Objetivo:** Claude consulta dados de analytics.

**Ações:**

1. **`src/lib/tools/ga4.ts`**
   - Auth: Service Account via google-auth-library
   - Endpoint: GA4 Data API v1beta `runReport`
   - Funções:

   **`ga4_run_report`**
   - Params: date_from, date_to, metrics (array), dimensions (array), filters (opcional), limit (default: 10)
   - Métricas disponíveis: sessions, totalUsers, screenPageViews, conversions, ecommercePurchases, purchaseRevenue, addToCarts, checkouts, itemRevenue, averageSessionDuration
   - Dimensões disponíveis: sessionSource, sessionMedium, sessionCampaignName, pagePath, pageTitle, deviceCategory, country, city, eventName, itemName
   - Pré-processamento: converte response da API em texto tabular. Valores numéricos formatados.
   - Retorna texto compacto com headers + rows

   **`ga4_get_top_pages`**
   - Params: date_from, date_to, limit, sort_by (views|conversions|revenue)
   - Atalho pré-configurado pra relatório de páginas mais acessadas
   - Já retorna formatado

2. **Registrar tools no index com descriptions curtas:**
   ```
   ga4_run_report: "Relatório customizado do GA4 com métricas, dimensões e filtros. Use para dados de tráfego, sessões, conversões e comportamento."
   ga4_get_top_pages: "Ranking de páginas do site por views, conversões ou receita em um período."
   ```

**Pronto quando:** "Sessões por fonte de tráfego no último mês" retorna dados reais do GA4.

---

## Módulo 6: Connector Google Ads

**Objetivo:** Claude consulta dados de campanhas Google Ads.

**Ações:**

1. **`src/lib/tools/google-ads.ts`**
   - Auth: OAuth2 com refresh token via google-auth-library
   - Endpoint: Google Ads API v17 (REST, usando googleads.googleapis.com)
   - Funções:

   **`google_ads_campaign_report`**
   - Params: date_from, date_to, limit (default: 20)
   - Query GAQL:
     ```sql
     SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM campaign
     WHERE segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
       AND campaign.status = 'ENABLED'
     ORDER BY metrics.cost_micros DESC
     ```
   - Pré-processamento: cost_micros ÷ 1.000.000 → R$, calcula CTR, CPA, ROAS
   - Retorna tabular compacto

   **`google_ads_search_query`**
   - Params: gaql_query (string GAQL livre)
   - Para queries avançadas que o Claude monta
   - Pré-processamento: converte cost_micros, formata valores
   - ⚠️ Validar que a query é SELECT (não UPDATE/DELETE)

2. **Registrar tools:**
   ```
   google_ads_campaign_report: "Performance de campanhas Google Ads com impressões, cliques, custo, conversões e ROAS."
   google_ads_search_query: "Executa query GAQL customizada no Google Ads. Apenas SELECT permitido."
   ```

**Pronto quando:** "ROAS por campanha Google Ads este mês" retorna dados reais.

---

## Módulo 7: Connector Meta Ads

**Objetivo:** Claude consulta dados de campanhas Meta (Facebook + Instagram).

**Ações:**

1. **`src/lib/tools/meta-ads.ts`**
   - Auth: access token no header Authorization: Bearer
   - Base URL: `https://graph.facebook.com/v21.0`
   - Funções:

   **`meta_ads_campaign_insights`**
   - Params: date_from, date_to, level (campaign|adset|ad), limit, breakdowns (opcional: age, gender, device_platform, publisher_platform)
   - Endpoint: `GET /{ad_account_id}/insights`
   - Fields: campaign_name, impressions, clicks, spend, actions, action_values, ctr, cpm
   - Pré-processamento:
     - Extrair purchase e add_to_cart de actions[] (array complexo do Meta)
     - Extrair purchase_value de action_values[]
     - Calcular ROAS = purchase_value / spend
     - Calcular CPA = spend / purchases
     - Formatar tudo em R$
   - Retorna tabular compacto

   **`meta_ads_creative_insights`**
   - Params: date_from, date_to, limit
   - Level: ad (pra pegar nome do criativo)
   - Mesmos campos + ad_name, adset_name
   - Para análises no nível de anúncio individual

2. **Registrar tools:**
   ```
   meta_ads_campaign_insights: "Performance Meta Ads por campanha, adset ou anúncio. Inclui spend, conversões, ROAS, CPA. Suporta breakdowns por idade, gênero, device."
   meta_ads_creative_insights: "Performance no nível de anúncio individual do Meta Ads com nome do criativo e adset."
   ```

**Pronto quando:** "Top 5 campanhas Meta Ads por ROAS esta semana" retorna dados reais.

---

## Módulo 8: Polish e Error Handling

**Objetivo:** Experiência robusta e à prova de falhas.

**Ações:**

1. **Error handling em todos os connectors:**
   - Try/catch em toda chamada de API
   - Timeout de 30s (AbortController)
   - Retry com backoff em 429 (max 3x, delays: 1s, 3s, 9s)
   - Retornar erros como: `"ERRO [Shopify]: Timeout ao buscar pedidos. Sugestão: tente um período menor ou tente novamente."`

2. **Validação de parâmetros em todas as tools:**
   - Datas: validar formato, não permitir futuro, date_from < date_to
   - Limit: min 1, max 100
   - Campos obrigatórios: retornar erro claro se faltando

3. **Loading progressivo no frontend:**
   - Interceptar tool_use events do stream
   - Mostrar: "Consultando Shopify..." → "Consultando Meta Ads..." → "Montando relatório..."

4. **Responsividade:**
   - Tabelas com overflow-x auto em mobile
   - Chat usável em telas 375px+

5. **Sugestões de relatórios no chat vazio:**
   - 6 cards clicáveis com relatórios frequentes
   - Ao clicar, envia como mensagem do usuário

6. **Botão "Copiar" em cada resposta do assistant:**
   - Copia o Markdown cru pra clipboard (pra colar em docs/planilhas)

**Pronto quando:** App completo, robusto, responsivo, tratando erros graciosamente.

---

## Módulo 9: Deploy

**Objetivo:** App no ar na Vercel.

**Ações:**
1. Push do projeto pro GitHub
2. Conectar repo à Vercel
3. Configurar todas as env vars na Vercel
4. Testar todas as integrações no ambiente de produção
5. Compartilhar URL + senha com o time

**Pronto quando:** URL acessível, login funcionando, relatórios retornando dados reais.

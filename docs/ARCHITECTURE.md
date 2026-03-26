# Arquitetura — Charme Analytics

## Diagrama

```
┌──────────────────────────────────────────────────────┐
│                    FRONTEND                           │
│           Next.js (App Router + Tailwind)             │
│                                                       │
│  ┌──────────┐  ┌──────────────────────────────────┐  │
│  │  Login    │  │  Chat Interface                  │  │
│  │  (senha)  │  │  - Input de pergunta/relatório   │  │
│  │           │  │  - Mensagens com Markdown         │  │
│  │           │  │  - Tabelas formatadas             │  │
│  │           │  │  - Loading: "Consultando X..."    │  │
│  │           │  │  - Sugestões de perguntas         │  │
│  └──────────┘  └──────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────┘
                         │ POST /api/chat (streaming)
                         ▼
┌──────────────────────────────────────────────────────┐
│                 BACKEND (API Routes)                  │
│                                                       │
│  /api/chat                                            │
│  ├── Recebe { messages } (max 10 mensagens)           │
│  ├── Chama Claude API:                                │
│  │   - system prompt compacto                         │
│  │   - tools definitions (descriptions curtas)        │
│  │   - messages do usuário                            │
│  ├── Tool Use Loop:                                   │
│  │   ├── Claude pede tool_use → backend executa       │
│  │   ├── Connector chama API externa                  │
│  │   ├── Backend PRÉ-PROCESSA: filtra campos,         │
│  │   │   agrega dados, formata valores, compacta      │
│  │   ├── Retorna texto tabular resumido ao Claude     │
│  │   └── Loop até Claude emitir resposta final        │
│  └── Stream resposta pro frontend                     │
│                                                       │
│  Connectors (src/lib/tools/):                         │
│  ├── shopify.ts    → Shopify Admin API (GraphQL)      │
│  ├── ga4.ts        → GA4 Data API (REST)              │
│  ├── google-ads.ts → Google Ads API (GAQL)            │
│  └── meta-ads.ts   → Meta Marketing API (REST)        │
└──────────────────────────────────────────────────────┘
```

## Estrutura de Pastas

```
charme-analytics/
├── CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SYSTEM-PROMPT.md
│   ├── BUILD-PLAN.md
│   └── API-SPECS.md
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Login
│   │   ├── chat/
│   │   │   └── page.tsx                # Interface de chat
│   │   └── api/
│   │       ├── auth/route.ts           # Verifica senha → seta cookie
│   │       └── chat/route.ts           # Orquestra Claude + tools
│   ├── lib/
│   │   ├── claude.ts                   # Client Claude API + tool use loop
│   │   ├── system-prompt.ts            # Exporta system prompt como string
│   │   ├── tools/
│   │   │   ├── index.ts               # Registry de tools (definições)
│   │   │   ├── shopify.ts
│   │   │   ├── ga4.ts
│   │   │   ├── google-ads.ts
│   │   │   └── meta-ads.ts
│   │   ├── formatters.ts              # Funções de formatação (R$, %, datas)
│   │   └── types.ts
│   ├── components/
│   │   ├── chat-interface.tsx
│   │   ├── message-bubble.tsx
│   │   ├── data-table.tsx             # Renderiza tabelas Markdown → HTML
│   │   ├── loading-indicator.tsx
│   │   └── login-form.tsx
│   └── middleware.ts                   # Auth check em /chat
├── .env.example
├── .gitignore
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Variáveis de Ambiente

```env
# Auth
AUTH_PASSWORD=

# Claude API
ANTHROPIC_API_KEY=

# Shopify (Custom App — somente scopes read_*)
SHOPIFY_STORE_DOMAIN=charmedodetalhe.myshopify.com
SHOPIFY_ACCESS_TOKEN=

# Google Analytics 4 (Service Account com role Viewer)
GA4_PROPERTY_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=

# Google Ads (OAuth2 read-only)
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=

# Meta Ads (token com permissão ads_read apenas)
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
```

## Decisões Técnicas

### Pré-processamento de dados no backend (economia de tokens)
O maior custo de tokens vem dos tool_results. Se um connector retornar o JSON cru da Shopify (200+ campos por pedido, 50 pedidos = 10K+ tokens), o custo explode. Por isso:

- Connectors NUNCA retornam JSON cru
- Cada connector tem uma camada de formatação que:
  1. Seleciona só os campos relevantes
  2. Agrega/agrupa quando necessário (ex: agrupar pedidos por cliente)
  3. Formata valores (R$, %, datas)
  4. Retorna texto tabular compacto
- Resultado: cada tool_result usa ~200-500 tokens ao invés de 5.000+

### Streaming
A resposta do Claude é streamed pro frontend. Como relatórios podem ser longos (múltiplas tabelas), o streaming evita que o usuário fique esperando 15-30s sem feedback.

### Sem banco de dados
- Dados sempre frescos das APIs
- Sem custo de manutenção de DB
- Stateless = deploy simples na Vercel
- Se futuramente precisar de cache, adicionar Redis como módulo separado

## Limites e Considerações

- **Rate limits por API:** ver docs/API-SPECS.md
- **Custo por pergunta:** ~R$0,02-0,08 (Sonnet, com pré-processamento)
- **Timeout:** 30s por chamada de API. Frontend mostra loading progressivo.
- **UTMs inconsistentes:** agente sempre pergunta como identificar origem quando análise depende de atribuição
- **Divergência entre plataformas:** agente mostra números de ambas as fontes e explica diferença

## Pendências (confirmar durante construção)

- [ ] Meta Ads: quantas contas de ads?
- [ ] Tracking de ATC: GA4 ou Meta Pixel como fonte primária?

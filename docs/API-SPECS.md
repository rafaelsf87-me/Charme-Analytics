# API Specs — Integrações Externas

> Referência técnica para cada connector. Detalhes de auth, endpoints, campos e rate limits.

---

## 1. Shopify Admin API (GraphQL)

### Auth
- Header: `X-Shopify-Access-Token: {SHOPIFY_ACCESS_TOKEN}`
- Token tipo: Custom App access token (`shpat_...`)
- Scopes necessários (SOMENTE READ):
  - `read_orders`
  - `read_customers`
  - `read_products`
  - `read_inventory`

### Endpoint
```
POST https://{SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json
Content-Type: application/json
```

### Queries principais

**Pedidos com filtros:**
```graphql
{
  orders(first: $limit, query: "created_at:>=$date_from created_at:<=$date_to financial_status:paid", sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { firstName lastName email }
        lineItems(first: 5) {
          edges {
            node { title quantity originalTotalSet { shopMoney { amount } } }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Clientes com pedidos:**
```graphql
{
  customers(first: $limit, sortKey: TOTAL_SPENT, reverse: true) {
    edges {
      node {
        id
        firstName
        lastName
        email
        ordersCount
        totalSpent
        createdAt
        lastOrder { id createdAt totalPriceSet { shopMoney { amount } } }
      }
    }
  }
}
```

**Produtos:**
```graphql
{
  products(first: $limit, query: $search) {
    edges {
      node {
        id
        title
        productType
        vendor
        totalInventory
        variants(first: 3) {
          edges {
            node { price inventoryQuantity }
          }
        }
      }
    }
  }
}
```

### Rate Limits
- 50 pontos por segundo (leak bucket)
- Query cost: ~5-10 pontos por query simples
- Se `429` ou `THROTTLED`: retry com backoff

### Pré-processamento obrigatório
- totalPriceSet.shopMoney.amount vem como string → converter pra número, formatar R$
- Paginação: se precisar de mais que `first:50`, iterar com cursor NO BACKEND e agregar
- Para top clientes: buscar pedidos e agrupar por customer.email no backend

---

## 2. Google Analytics 4 Data API

### Auth
- Service Account (JSON key)
- Scope: `https://www.googleapis.com/auth/analytics.readonly`
- A Service Account precisa ter acesso Viewer na propriedade GA4

### Biblioteca
- `@google-analytics/data` (Node.js client) ou REST direto
- REST endpoint: `https://analyticsdata.googleapis.com/v1beta/properties/{GA4_PROPERTY_ID}:runReport`

### Request body (runReport)
```json
{
  "dateRanges": [{ "startDate": "2026-01-01", "endDate": "2026-03-25" }],
  "dimensions": [{ "name": "sessionSource" }, { "name": "sessionMedium" }],
  "metrics": [{ "name": "sessions" }, { "name": "totalUsers" }, { "name": "ecommercePurchases" }, { "name": "purchaseRevenue" }],
  "limit": 10,
  "orderBys": [{ "metric": { "metricName": "purchaseRevenue" }, "desc": true }]
}
```

### Dimensões mais usadas
| Dimensão | Descrição |
|---|---|
| sessionSource | google, facebook, direct, etc |
| sessionMedium | cpc, organic, social, referral, email |
| sessionCampaignName | Nome da campanha (UTM) |
| pagePath | URL da página |
| pageTitle | Título da página |
| deviceCategory | desktop, mobile, tablet |
| eventName | add_to_cart, purchase, page_view, etc |
| itemName | Nome do produto (em eventos de ecommerce) |

### Métricas mais usadas
| Métrica | Descrição |
|---|---|
| sessions | Total de sessões |
| totalUsers | Usuários únicos |
| screenPageViews | Pageviews |
| ecommercePurchases | Nº de compras |
| purchaseRevenue | Receita total |
| addToCarts | Eventos de ATC |
| checkouts | Checkouts iniciados |
| averageSessionDuration | Duração média da sessão |
| conversions | Conversões (eventos marcados) |

### Rate Limits
- 10 requests simultâneos por propriedade
- 10.000 requests por dia por projeto
- Se `429`: retry com backoff

### Pré-processamento
- Valores vêm como strings no response → converter pra número
- purchaseRevenue vem em unidade da moeda (R$) → formatar
- Rows com dimensionValues + metricValues → mapear pra tabela legível

---

## 3. Google Ads API (GAQL)

### Auth
- OAuth2 com refresh token
- Headers necessários:
  - `Authorization: Bearer {access_token}`
  - `developer-token: {GOOGLE_ADS_DEVELOPER_TOKEN}`
  - `login-customer-id: {GOOGLE_ADS_CUSTOMER_ID}` (sem hífens)

### Endpoint
```
POST https://googleads.googleapis.com/v17/customers/{customer_id}/googleAds:searchStream
Content-Type: application/json
```

### Request body
```json
{
  "query": "SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '2026-01-01' AND '2026-03-25' AND campaign.status = 'ENABLED' ORDER BY metrics.cost_micros DESC LIMIT 20"
}
```

### Campos GAQL principais
| Campo | Tipo | Nota |
|---|---|---|
| campaign.name | string | Nome da campanha |
| campaign.status | enum | ENABLED, PAUSED, REMOVED |
| ad_group.name | string | Nome do grupo de anúncios |
| metrics.impressions | int | |
| metrics.clicks | int | |
| metrics.cost_micros | long | ⚠️ Dividir por 1.000.000 pra ter R$ |
| metrics.conversions | double | |
| metrics.conversions_value | double | Receita atribuída |
| metrics.ctr | double | Click-through rate |
| metrics.average_cpc | long | Em micros |
| segments.date | string | YYYY-MM-DD |
| segments.device | enum | MOBILE, DESKTOP, TABLET |

### Métricas calculadas no backend
- **ROAS** = conversions_value / (cost_micros / 1.000.000)
- **CPA** = (cost_micros / 1.000.000) / conversions
- **CTR** = já vem calculado, mas como decimal (0.05 = 5%)

### Rate Limits
- 15.000 requests por dia (Developer Token nível básico)
- Se `RESOURCE_EXHAUSTED`: retry com backoff

### Pré-processamento
- cost_micros → R$ (÷ 1.000.000, formatar)
- average_cpc → R$ (÷ 1.000.000)
- CTR decimal → percentual (× 100, 1 casa)
- ⚠️ Validar que toda query começa com SELECT (rejeitar qualquer outra operação)

### Obtenção do refresh token (setup inicial)
1. Criar projeto no Google Cloud Console
2. Habilitar Google Ads API
3. Criar credenciais OAuth2 (tipo Desktop app)
4. Gerar refresh token via oauth2l ou Google OAuth Playground:
   - Scope: `https://www.googleapis.com/auth/adwords`
   - Fazer authorization flow e copiar o refresh_token
5. Developer token: solicitar no Google Ads → Ferramentas → API Center

---

## 4. Meta Marketing API

### Auth
- Header: `Authorization: Bearer {META_ACCESS_TOKEN}`
- Token tipo: User Access Token com permissão `ads_read`
- ⚠️ Tokens expiram. Usar System User Token (não expira) ou Long-Lived Token (60 dias)

### Recomendação: usar System User Token
1. No Business Manager → Business Settings → System Users
2. Criar System User com role Admin
3. Gerar token com permissão `ads_read`
4. Associar ao Ad Account
5. Este token NÃO expira

### Endpoint
```
GET https://graph.facebook.com/v21.0/{META_AD_ACCOUNT_ID}/insights
```

### Query params
```
?fields=campaign_name,impressions,clicks,spend,ctr,cpm,actions,action_values,cost_per_action_type
&time_range={"since":"2026-01-01","until":"2026-03-25"}
&level=campaign  (ou adset, ad)
&limit=50
&breakdowns=device_platform  (opcional)
&filtering=[{"field":"campaign.delivery_status","operator":"IN","value":["active","completed"]}]
```

### Campos principais
| Campo | Tipo | Nota |
|---|---|---|
| campaign_name | string | |
| adset_name | string | Só disponível em level=adset ou ad |
| ad_name | string | Só em level=ad |
| impressions | string | ⚠️ Vem como string, converter |
| clicks | string | |
| spend | string | Em moeda da conta (R$) |
| ctr | string | Percentual como string |
| cpm | string | |
| actions | array | ⚠️ Array complexo, ver abaixo |
| action_values | array | ⚠️ Array complexo |

### Extraindo métricas de actions[]
O campo `actions` é um array de objetos `{action_type, value}`. Extrair no backend:

```typescript
function extractAction(actions: any[], type: string): number {
  const found = actions?.find(a => a.action_type === type);
  return found ? parseFloat(found.value) : 0;
}

// Uso:
const purchases = extractAction(actions, 'purchase');       // ou 'offsite_conversion.fb_pixel_purchase'
const addToCarts = extractAction(actions, 'add_to_cart');    // ou 'offsite_conversion.fb_pixel_add_to_cart'
const leads = extractAction(actions, 'lead');

// Mesmo padrão para action_values (receita):
const purchaseValue = extractAction(action_values, 'purchase');
```

### Métricas calculadas no backend
- **ROAS** = purchaseValue / spend
- **CPA** = spend / purchases
- **ATC Rate** = addToCarts / clicks

### Breakdowns disponíveis
| Breakdown | Valores |
|---|---|
| age | 18-24, 25-34, 35-44, 45-54, 55-64, 65+ |
| gender | male, female, unknown |
| device_platform | mobile, desktop |
| publisher_platform | facebook, instagram, audience_network, messenger |
| platform_position | feed, story, reels, right_column, etc |

### Rate Limits
- 200 chamadas por hora por ad account (nível Standard)
- Headers de resposta incluem: `x-app-usage` (JSON com call_count, total_cputime, total_time)
- Se `x-app-usage` → algum campo > 75%: desacelerar
- Se `429` ou error code 17 (rate limit): retry com backoff

### Pré-processamento
- Todos os campos numéricos vêm como string → parseFloat
- spend → R$ formatado
- actions[] → extrair purchases, add_to_cart, leads como números separados
- action_values[] → extrair purchase value
- Calcular ROAS, CPA, ATC Rate no backend
- ⚠️ Se actions[] for undefined (campanha sem conversões), retornar 0, não null

---

## Padrão de retorno de TODAS as tools

Cada tool deve retornar uma string compacta (não JSON). Formato:

```
[SHOPIFY] Top 10 Clientes por Receita (01/01/2026 a 25/03/2026)
# | Cliente | Pedidos | Receita | Ticket Médio | Último Pedido
1 | Maria Silva | 12 | R$8.450,00 | R$704,17 | 20/03/2026
2 | João Santos | 8 | R$5.200,00 | R$650,00 | 18/03/2026
...
Total: 10 clientes | Receita agregada: R$32.100,00
```

Isso garante que o Claude receba dados legíveis e compactos, sem desperdício de tokens com JSON verboso.

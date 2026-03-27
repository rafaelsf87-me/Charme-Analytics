# Mudanças V3 — Dados Legados Yampi + Correções Shopify + Regras de Negócio

> Claude Code: leia este arquivo e implemente TODAS as mudanças abaixo.
> Leia também `docs/KNOWN-TRAPS.md` e `docs/ADDENDUM.md` se ainda não leu.

---

## Mudança 1: Corrigir Bug na Query Shopify

### Problema
O connector Shopify está retornando que o pedido mais antigo é de 26/Jan/2026, mas existem pedidos de 2025. Provável causa: a query GraphQL está filtrando `financial_status: paid` de forma muito restritiva, ou a paginação está limitada.

### Correções obrigatórias em `src/lib/tools/shopify.ts`:

1. **Remover filtro fixo de `financial_status: paid` na query de busca geral.** Usar `financial_status: any` como padrão e filtrar no backend após receber os dados. Motivo: pedidos migrados da Yampi podem ter status diferente.

2. **Paginação completa:** se a query precisa de TODOS os pedidos (ex: top clientes), implementar paginação com cursor (`after: endCursor`) até `hasNextPage: false`. NÃO parar no primeiro batch de 50/250.

3. **Para consultas de receita:** filtrar no backend os status que significam "pago":
   ```typescript
   const PAID_STATUSES = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']; // refunded still was paid
   // Filtrar no backend, não na query GraphQL
   const paidOrders = orders.filter(o => PAID_STATUSES.includes(o.displayFinancialStatus));
   ```

4. **Testar:** após corrigir, a query "qual o pedido mais antigo do Shopify?" deve retornar pedidos de 2025 (provavelmente de teste/migração).

---

## Mudança 2: Módulo de Dados Legados (Yampi)

### Contexto
Antes do Shopify, a loja usava a plataforma Yampi. Os pedidos históricos estão em 3 planilhas Excel estáticas. O sistema deve consultá-las automaticamente quando a análise envolver períodos anteriores ao Shopify.

### Cobertura dos dados

```
TIMELINE DE DADOS:

Dez/2022 ─── Mar/2023 │ SEM DADOS │ Dez/2023 ─── Dez/2024 ─── Abr/2025 │ SEM DADOS │ Shopify
     Yampi 2023         Abr-Nov/23      Yampi 2024       Yampi 2025        Gap         (data variável)
     15.099 pedidos                      47.189 pedidos   9.999 pedidos
```

**Gaps conhecidos (SEM DADOS):**
- Abr/2023 a Nov/2023 — planilha não cobre esse período
- Entre último pedido Yampi (~Abr/2025) e primeiros pedidos reais no Shopify — período de transição

**O sistema DEVE:**
- Detectar automaticamente quando um relatório cai parcial ou totalmente num gap
- Avisar o usuário: "⚠️ Período solicitado inclui [Abr-Nov/2023] onde não há dados disponíveis. Os resultados cobrem apenas os períodos com dados."
- Nunca tratar gap como "zero vendas" — é ausência de dados, não ausência de vendas

### Arquivos e localização

Criar pasta `data/yampi/` na raiz do projeto. As 3 planilhas ficam ali:
```
data/
└── yampi/
    ├── Base_Pedidos_Yampi_2023.xlsx
    ├── Base_Pedidos_Yampi_2024.xlsx
    └── Base_Pedidos_Yampi_2025-parcial.xlsx
```

### Variável de ambiente para data de corte

Adicionar ao `.env.local` e `.env.example`:
```
# Data a partir da qual o Shopify é a fonte de pedidos.
# Tudo ANTES dessa data → consultar planilhas Yampi.
# Tudo A PARTIR dessa data → consultar Shopify API.
# Formato: YYYY-MM-DD
SHOPIFY_START_DATE=2025-10-01
```

O usuário vai ajustar essa data quando confirmar exatamente quando o Shopify começou a operar de verdade (excluindo pedidos de teste).

### Estrutura das planilhas Yampi

**Colunas relevantes (mapeamento Yampi → formato unificado):**

| Campo Yampi | Usar como | Tipo | Nota |
|---|---|---|---|
| `data_pagamento` | Data do pedido | datetime | Data do pagamento confirmado |
| `cliente` | Nome do cliente | string | Nome completo |
| `cliente_email` | ID do cliente | string | Usar como chave pra cruzar com Shopify |
| `numero_pedido` | Nº pedido | int | Sequencial |
| `produto` | Nome do produto | string | Texto livre, pode diferir do título no Shopify |
| `sku` | SKU | string | Mais confiável que nome pra cruzar produtos |
| `quantidade` | Unidades | int | |
| `total_pago` | Receita total | float | Inclui frete e desconto aplicado |
| `total_produtos` | Receita de produtos | float | Sem frete |
| `total_desconto` | Desconto | float | |
| `total_frete` | Frete | float | |
| `status` | Status pagamento | string | Ver mapeamento abaixo |
| `cupom` | Cupom usado | string | |

**Mapeamento de status Yampi → paid/cancelled:**
```typescript
function mapYampiStatus(status: string): 'paid' | 'cancelled' {
  const PAID_STATUSES = ['Em transporte', 'Faturado', 'Pagamento aprovado', 'Entregue'];
  if (PAID_STATUSES.includes(status)) return 'paid';
  return 'cancelled'; // "Cancelado" e qualquer outro
}
```

**Planilha 2024 tem colunas extras** (`Concatenar`, `Ano`, `Mês`) que são auxiliares — ignorar.

**Planilha 2024 tem `cliente_telefone` e `cliente_email` em posições diferentes da 2023** — usar nome da coluna, não posição.

### Implementação

1. **Criar `src/lib/tools/yampi-legacy.ts`**

   - Carregar as 3 planilhas ao iniciar o servidor (ou no primeiro request, com cache)
   - Usar uma lib como `xlsx` (sheetjs) para ler os .xlsx no Node.js
   - Normalizar todas as linhas das 3 planilhas num array unificado:
     ```typescript
     interface LegacyOrder {
       date: Date            // data_pagamento
       orderNumber: number   // numero_pedido
       customerName: string  // cliente
       customerEmail: string // cliente_email
       product: string       // produto
       sku: string           // sku
       quantity: number      // quantidade
       totalPaid: number     // total_pago
       totalProducts: number // total_produtos
       totalDiscount: number // total_desconto
       totalShipping: number // total_frete
       status: 'paid' | 'cancelled'
       coupon: string | null // cupom
       source: 'yampi-2023' | 'yampi-2024' | 'yampi-2025'
     }
     ```
   - Excluir `status === 'cancelled'` por padrão
   - Cachear em memória após primeiro carregamento (dados são estáticos)

2. **Tools pra registrar no Claude:**

   **`yampi_get_orders`**
   - Params: date_from, date_to, limit (default: 50)
   - Filtra por data_pagamento no range
   - Retorna tabela compacta igual ao formato do Shopify connector

   **`yampi_get_top_customers`**
   - Params: date_from, date_to, limit (default: 10), sort_by (revenue|orders)
   - Agrupa por cliente_email, calcula total gasto, nº pedidos, ticket médio
   - Aplica regra de pedidos consecutivos (ver Mudança 3)
   - Retorna formatado

   **`yampi_search_products`**
   - Params: search_term, date_from, date_to
   - Busca por nome de produto (contains, case-insensitive) ou SKU
   - Retorna resumo: produto, total vendido, quantidade, nº pedidos

3. **Descriptions das tools (curtas):**
   ```
   yampi_get_orders: "Pedidos históricos (antes do Shopify) com filtro de data. Dados de Dez/2022 a ~Abr/2025 com gaps conhecidos."
   yampi_get_top_customers: "Ranking de clientes históricos por receita ou pedidos. Dados pré-Shopify."
   yampi_search_products: "Busca vendas de um produto específico nos dados históricos por nome ou SKU."
   ```

4. **Lógica de roteamento automático no tool use:**

   Atualizar o system prompt para incluir:
   ```
   ## Roteamento Shopify vs Yampi (dados de pedidos)

   Quando a análise envolver pedidos/clientes/receita, decidir a fonte baseado na data:

   - Período 100% APÓS a data de corte (env SHOPIFY_START_DATE) → usar tools Shopify
   - Período 100% ANTES da data de corte → usar tools Yampi
   - Período que CRUZA a data de corte → usar AMBAS as tools, somar resultados, e avisar:
     "📊 Este relatório combina dados de 2 fontes: Yampi (até [data]) e Shopify (a partir de [data])."

   ⚠️ Gaps conhecidos sem dados:
   - Abr/2023 a Nov/2023 — não há registros
   - Período de transição entre último pedido Yampi e primeiro pedido real no Shopify
   Se o relatório cair nestes períodos, avisar:
   "⚠️ O período [X] a [Y] não possui dados de pedidos. Resultados parciais."
   NUNCA tratar gap como zero vendas.

   Para CRM/Top Clientes com período longo (ex: "todos os tempos"):
   - Consultar Yampi + Shopify
   - Cruzar por email do cliente (cliente_email)
   - Se mesmo email aparece em ambas fontes, SOMAR totais
   ```

---

## Mudança 3: Regra de Pedidos Consecutivos (Mesclagem)

### Regra de negócio
Quando um mesmo cliente faz 2 ou mais pedidos em dias consecutivos (intervalo ≤ 2 dias), eles devem ser tratados como **1 única compra** para efeitos de:
- Contagem de pedidos do cliente
- Cálculo de frequência de recompra
- Análise de recência
- Ticket médio (somar os pedidos mesclados)

### Exemplo
```
Maria Silva:
  Pedido #1001 — 10/Mar — R$200
  Pedido #1002 — 11/Mar — R$80    ← ≤2 dias do anterior
  Pedido #1003 — 15/Abr — R$300

Sem mesclagem: 3 pedidos, ticket médio R$193
Com mesclagem: 2 compras (R$280 + R$300), ticket médio R$290
```

### Implementação

1. **Criar função utilitária em `src/lib/tools/order-utils.ts`:**

   ```typescript
   interface OrderForMerge {
     date: Date;
     customerEmail: string;
     totalPaid: number;
     orderNumbers: number[];
     // outros campos conforme necessário
   }

   /**
    * Mescla pedidos do mesmo cliente feitos em ≤2 dias consecutivos.
    * Retorna array de "compras" (cada uma pode conter 1+ pedidos mesclados).
    */
   function mergeConsecutiveOrders(orders: OrderForMerge[]): MergedPurchase[] {
     // 1. Ordenar por customerEmail + date
     // 2. Para cada cliente, iterar pedidos em ordem cronológica
     // 3. Se diferença entre pedido atual e anterior ≤ 2 dias → mesclar:
     //    - Somar totalPaid
     //    - Manter a data do PRIMEIRO pedido do grupo
     //    - Concatenar orderNumbers
     // 4. Se diferença > 2 dias → nova compra
   }
   ```

2. **Usar em:** `shopify_get_top_customers`, `yampi_get_top_customers`, e qualquer tool que retorne dados por cliente.

3. **Adicionar no system prompt:**
   ```
   ## Regra de Pedidos Consecutivos
   Pedidos do mesmo cliente com ≤2 dias de diferença são tratados como 1 compra.
   Isso afeta: contagem de pedidos, ticket médio, frequência de recompra.
   O sistema aplica essa mesclagem automaticamente.
   Quando aplicado, informar: "ℹ️ Pedidos consecutivos (≤2 dias) do mesmo cliente foram mesclados como compra única."
   ```

---

## Mudança 4: Atualizar .env.example

Adicionar:
```env
# --- Dados Legados ---
# Data a partir da qual o Shopify é a fonte de pedidos.
# Tudo ANTES → planilhas Yampi em data/yampi/
# Tudo A PARTIR → Shopify API
# Ajuste quando confirmar a data exata da migração.
SHOPIFY_START_DATE=2025-10-01
```

---

## Mudança 5: Atualizar System Prompt

Adicionar ao `src/lib/system-prompt.ts` as seguintes seções (integrar nos locais adequados):

### Seção: Roteamento de dados de pedidos
(conteúdo descrito na Mudança 2, item 4)

### Seção: Regra de pedidos consecutivos
(conteúdo descrito na Mudança 3, item 3)

### Seção: Gaps de dados conhecidos
```
## Gaps de Dados Conhecidos

Períodos SEM dados de pedidos:
- Abr/2023 a Nov/2023 (planilha Yampi 2023 cobre só Dez/2022 a Mar/2023)
- Período de transição Yampi → Shopify (entre ~Abr/2025 e início real do Shopify)

Se um relatório cair nesses períodos:
1. Avisar o usuário ANTES de gerar: "⚠️ O período solicitado inclui [meses] sem dados disponíveis."
2. Perguntar: "Quer que eu gere com os dados disponíveis ou prefere ajustar o período?"
3. Nos resultados, indicar claramente quais meses têm dados e quais não
4. NUNCA interpretar ausência de dados como zero vendas
```

---

## Ordem de implementação

1. Corrigir query Shopify (Mudança 1) — testar que pedidos de 2025 aparecem
2. Criar pasta `data/yampi/` e módulo yampi-legacy.ts (Mudança 2)
3. Criar order-utils.ts com merge de pedidos consecutivos (Mudança 3)
4. Atualizar .env.example (Mudança 4)
5. Atualizar system prompt com todas as novas regras (Mudança 5)
6. Testar: "Top 10 clientes de todos os tempos" deve combinar Yampi + Shopify

Após implementar, me mostre:
- O system prompt final atualizado
- A lógica de merge de pedidos
- O roteamento Yampi vs Shopify funcionando

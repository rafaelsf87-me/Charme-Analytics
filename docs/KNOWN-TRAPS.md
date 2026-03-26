# Armadilhas Conhecidas — Métricas e Interpretação

> Claude Code: este arquivo contém erros de interpretação já identificados pelo usuário.
> O system prompt do agente DEVE referenciar estas armadilhas.
> Quando o agente encontrar uma dessas métricas, DEVE alertar o usuário antes de gerar o relatório.

---

## GA4 — Eventos de E-commerce

### ⚠️ "add_to_cart" ≠ "sessões com ATC"

| Métrica GA4 | O que realmente mede | Armadilha |
|---|---|---|
| `addToCarts` (evento count) | Quantas VEZES o botão "adicionar" foi clicado | Se o cliente adiciona 4 cadeiras, conta 4 eventos |
| `sessions` com filtro `eventName = add_to_cart` | Quantas SESSÕES tiveram pelo menos 1 ATC | Esse sim é "quantas pessoas adicionaram ao carrinho" |

**Impacto real:** para produtos comprados em múltiplas unidades (cadeiras, fronhas, toalhas), o `addToCarts` infla drasticamente. Para produtos unitários (sofá, edredom), o número é mais próximo da realidade.

**Regra pro agente:**
- Quando o relatório envolver ATC, SEMPRE perguntar: "Quer ver quantidade de eventos de ATC (inclui múltiplas unidades do mesmo produto) ou quantidade de sessões que tiveram ATC (pessoas únicas que adicionaram)?"
- Se o usuário pedir "taxa de ATC", usar sessões com ATC / total de sessões (NÃO eventos / sessões)
- Alertar: "Para produtos como cadeiras e fronhas, o nº de eventos de ATC é tipicamente 3-6x maior que o nº de sessões com ATC"

### ⚠️ "ecommercePurchases" vs "transactions" vs "conversions"

| Métrica | Mede |
|---|---|
| `ecommercePurchases` | Nº de transações de compra concluídas |
| `conversions` (genérico) | Qualquer evento marcado como conversão (pode incluir leads, signups, etc) |
| `purchaseRevenue` | Receita das compras (não inclui frete/impostos por padrão) |

**Regra:** para relatórios de venda, usar SEMPRE `ecommercePurchases` e `purchaseRevenue`. Nunca usar `conversions` genérico sem especificar o evento.

### ⚠️ "itemRevenue" vs "purchaseRevenue"

| Métrica | Escopo |
|---|---|
| `purchaseRevenue` | Receita total da transação |
| `itemRevenue` | Receita atribuída a um item específico (quando cruzado com dimensão `itemName`) |

**Regra:** para relatórios de produto específico, usar `itemRevenue`. Para relatório geral de receita, usar `purchaseRevenue`.

---

## GA4 — Dimensões e Filtros

### ⚠️ pagePath é case-sensitive e URL-encoded

Já tratado no ADDENDUM.md com `sanitizeForGA4()`. Reforço:
- "Sofá" na URL vira "sofa" ou "sof%C3%A1"
- Filtro `contains` deve usar fragmento sem acento e lowercase
- Sempre confirmar o termo com o usuário

### ⚠️ sessionSource/sessionMedium vs source/medium

| Dimensão | Escopo |
|---|---|
| `sessionSource` / `sessionMedium` | Atribuição da SESSÃO (de onde veio naquela visita) |
| `firstUserSource` / `firstUserMedium` | Atribuição do PRIMEIRO acesso do usuário |

**Regra:** para análise de performance de campanha, usar `session*`. Para análise de aquisição de novos clientes, usar `firstUser*`.

---

## Meta Ads — Métricas

### ⚠️ actions[] — nem todo "purchase" é igual

| action_type no Meta | Significado |
|---|---|
| `purchase` | Compra rastreada pelo pixel (pode incluir duplicatas) |
| `offsite_conversion.fb_pixel_purchase` | Compra específica do pixel (mais preciso) |
| `omni_purchase` | Compra cross-device (modelo do Meta, tende a inflar) |

**Regra:** usar `offsite_conversion.fb_pixel_purchase` quando disponível. Se não estiver no response, usar `purchase`. Alertar que números do Meta tendem a ser ~20-40% maiores que o Shopify por diferença de atribuição.

### ⚠️ "results" vs métricas específicas

O Meta reporta "results" baseado no objetivo da campanha. Se a campanha é de conversão, result = purchase. Se é de tráfego, result = link_click. NÃO usar "results" em relatórios — sempre extrair a ação específica de actions[].

---

## Google Ads — Métricas

### ⚠️ conversions vs all_conversions

| Métrica | Mede |
|---|---|
| `metrics.conversions` | Só as ações de conversão marcadas como "primárias" na conta |
| `metrics.all_conversions` | Todas as conversões (primárias + secundárias) |

**Regra:** usar `metrics.conversions` por padrão (só primárias). Alertar o usuário se parecer haver discrepância grande.

### ⚠️ cost_micros e decimais

Já tratado no API-SPECS.md. Reforço: SEMPRE dividir por 1.000.000 antes de exibir.

---

## Shopify — Dados de Pedidos

### ⚠️ financial_status importa

| Status | Inclui |
|---|---|
| `paid` | Pedidos pagos (receita confirmada) |
| `pending` | Pedidos aguardando pagamento (boleto, pix pendente) |
| `refunded` | Pedidos estornados |
| `any` | Todos (incluindo cancelados e estornados) |

**Regra:** para relatórios de receita, SEMPRE filtrar `financial_status: paid` por padrão. Se o usuário quiser incluir pendentes, deve pedir explicitamente.

### ⚠️ Receita no Shopify inclui frete e descontos

- `totalPrice` inclui frete e desconto aplicado
- `subtotalPrice` é só os produtos (sem frete, sem desconto)

**Regra:** perguntar: "Quer receita total (com frete e descontos) ou receita líquida de produtos?"

---

## Regra Geral de Cross-check

Para TODA análise, o agente deve considerar: "Existe outro caminho nos dados pra validar esse resultado?"

Exemplos:
- Se o Meta diz ROAS de 8x → checar receita real no Shopify no mesmo período
- Se GA4 mostra 100 ATC para um produto → checar no Shopify quantos pedidos desse produto houve
- Se um produto aparece com 0 views no GA4 → pode ser problema de filtro/termo, não que ninguém acessou

O agente deve incluir uma seção "Validação Cruzada" nos relatórios quando detectar divergência > 20% entre fontes.

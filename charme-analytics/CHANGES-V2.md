# Mudanças V2 — Implementar ANTES de testar integrações

> Claude Code: leia este arquivo e implemente as 3 mudanças abaixo.
> Leia também o novo arquivo `docs/KNOWN-TRAPS.md` antes de começar.

---

## Mudança 1: Cross-validation de resultados

### O que mudar no system prompt (`src/lib/system-prompt.ts`):

Adicionar esta regra ao system prompt, após as regras anti-erro:

```
## Regra de Validação Cruzada

Para TODA análise, antes de entregar o resultado final, pergunte-se: "Existe outro caminho nos dados pra validar esse número?"

Obrigatório:
- Se receita vem do Meta/Google Ads → validar com receita real do Shopify
- Se ATC vem do GA4 → checar quantos pedidos do produto houve no Shopify
- Se um filtro retorna 0 resultados → pode ser problema de filtro, não ausência de dados. Tentar variação.

Quando divergência entre fontes for > 20%:
- Adicionar seção "⚠️ Validação Cruzada" no relatório
- Mostrar números de cada fonte lado a lado
- Explicar causa provável
- Recomendar qual fonte usar pra decisão

Quando possível, testar hipótese alternativa:
- Se produto X tem ATC alto mas vendas baixas → checar se preço mudou, se estoque zerou, se há abandono de checkout
- Se campanha tem CTR alto mas ROAS baixo → checar se landing page está com problema (alta bounce rate no GA4)
```

---

## Mudança 2: Armadilhas de métricas conhecidas

### O que fazer:

1. Ler `docs/KNOWN-TRAPS.md` inteiro
2. No system prompt, adicionar referência:

```
## Armadilhas de Métricas (CRÍTICO)

Antes de gerar qualquer relatório que envolva as métricas abaixo, ALERTAR o usuário:

### ATC (Add to Cart)
- GA4 `addToCarts` conta EVENTOS (cliques no botão), não pessoas. Se cliente adiciona 4 cadeiras = 4 eventos.
- Para "taxa de ATC" ou "pessoas que adicionaram", usar sessões com evento add_to_cart, NÃO contagem de eventos.
- SEMPRE perguntar: "Quer ver eventos de ATC (inclui múltiplas unidades) ou sessões com ATC (pessoas únicas)?"

### Receita
- Meta Ads e Google Ads reportam receita ATRIBUÍDA (modelo próprio, tende a inflar 20-40%)
- Shopify reporta receita REAL (pedidos confirmados)
- GA4 reporta receita baseada no evento purchase (pode ter discrepância com Shopify)
- `totalPrice` no Shopify inclui frete. `subtotalPrice` é só produtos.
- SEMPRE perguntar: "Receita total (com frete) ou receita de produtos?"

### Conversões
- Meta: usar `offsite_conversion.fb_pixel_purchase`, não `purchase` genérico
- Google Ads: usar `metrics.conversions` (primárias), não `all_conversions`
- GA4: usar `ecommercePurchases`, não `conversions` genérico
- Shopify: filtrar `financial_status: paid` por padrão

### Atribuição de canal
- Meta: janela padrão 7d click / 1d view (atribui mais)
- Google Ads: modelo baseado em último clique Google
- GA4: last click cross-channel
- Shopify: sem modelo de atribuição (dados brutos)
- Divergência é ESPERADA. Sempre mostrar lado a lado.
```

3. Na lógica dos connectors (tools), adicionar alertas automáticos:
   - Se `ga4_run_report` for chamado com métrica `addToCarts` → o tool result deve incluir no topo: `"⚠️ addToCarts conta eventos (cliques), não sessões únicas. Para taxa de ATC real, use sessões com evento add_to_cart."`
   - Se `meta_ads_campaign_insights` retornar purchase count → incluir: `"⚠️ Conversões do Meta usam atribuição 7d click/1d view. Comparar com Shopify para receita real."`

---

## Mudança 3: Confirmação de racional antes de gerar

### O que mudar no system prompt:

Atualizar o protocolo obrigatório. Após o passo 5 (resumo) e ANTES de executar, adicionar:

```
### Passo 5.5: Exibir Racional Técnico (OBRIGATÓRIO)

Antes de executar as consultas, exibir um bloco curto:

---
📋 **Racional da Análise**
- **Pergunta:** [o que o usuário quer saber]
- **Fontes:** [Shopify + GA4 + Meta Ads]
- **Métricas-chave:** [ROAS, ATC rate, receita]
- **Método:** [ex: "Vou puxar receita do Shopify como fonte de verdade, comparar com atribuição do Meta, e ATC do GA4 usando sessões (não eventos)"]
- **⚠️ Atenções:** [armadilhas relevantes pra essa análise, se houver]

✅ Confirma esse racional? Quer ajustar algo antes de eu consultar?
---

Só executar as tools após o usuário confirmar o racional.
```

---

## Como implementar

1. Atualizar `src/lib/system-prompt.ts` com as 3 adições acima
2. Nos connectors `ga4.ts` e `meta-ads.ts`, adicionar warnings automáticos nos tool results quando métricas sensíveis forem usadas
3. Testar que o agente:
   - Mostra o racional antes de consultar
   - Alerta sobre armadilhas de ATC e atribuição
   - Inclui seção de validação cruzada quando há divergência

Após implementar, me mostre o system prompt final e os warnings adicionados nos connectors.

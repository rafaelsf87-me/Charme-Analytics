# Armadilhas Conhecidas — Lições de Análises Anteriores

> Claude Code: este arquivo contém armadilhas REAIS descobertas em análises passadas da Charme do Detalhe.
> O system prompt DEVE referenciar estas regras. Quando o agente encontrar uma dessas situações, DEVE alertar.

---

## 1. GA4 — Filtro Case-Sensitive e Acentos (CRÍTICO)

### Problema real
Filtros de "Nome do item" no GA4 são case-sensitive. A loja tem "Sofá" (maiúsculo, com acento) e o filtro "sofa" (minúsculo, sem acento) retornou **zero ou 118 resultados quando deveria retornar 200k+**.

### Solução confirmada
Usar fragmento sem a primeira letra: **"ofá"** pega tanto "Sofá" quanto "sofá".

### Regra pro agente:
- Filtros seguros por fragmento: `ofá` (sofá), `adeira` (cadeira), `ortina` (cortina), `oalha` (toalha)
- Se resultado vazio → tentar automaticamente: sem acento, fragmento menor, lowercase
- SEMPRE perguntar: "Qual termo funciona pra filtrar esse produto?"
- `sanitizeForGA4()` deve remover acentos E oferecer variação sem primeira letra

---

## 2. GA4 — ATC Eventos vs Sessões (CRÍTICO)

### Problema real
Duas métricas de ATC medem coisas completamente diferentes:

| Métrica | Mede | Exemplo cadeira |
|---|---|---|
| `addToCarts` (eventos) | Cada clique = 1 evento. 4 cadeiras = 4 eventos | **809%** (impossível) |
| Funil GA4 (usuários) | Usuários únicos que fizeram ATC | **16,1%** (correto) |

### Caso real: cadeira = 809% de ATC por eventos (porque clientes compram 4-6 cadeiras). Sofá = ~7% (compra unitária, dado limpo).

### Regra:
- NUNCA usar contagem de eventos como "taxa de ATC" sem avisar
- Para "taxa de ATC real" → sessões/usuários com evento add_to_cart
- Para **cadeira**: alertar que ATC por item é inflado ~5x
- Para **sofá**: ATC por item é confiável

---

## 3. GA4 — Produtos Duplicados por Mudança de Título

### Problema real
Título alterado no Shopify → GA4 registra como 2 produtos. URL se mantém igual.

### Caso: "Anti Arranhão Caramelo" e "Anti Arranhão Protex Max Caramelo" = mesmo produto.

### Regra:
- Se dois produtos parecem variações do mesmo: alertar e sugerir somar dados
- Cruzar por URL/handle do Shopify (não muda) quando possível

---

## 4. GA4 — Atribuição de Canal (Meta Comprometida)

### Problema real
Tráfego do Meta aparece em múltiplos canais no GA4:
- Organic Social (39%) — inclui Meta com UTM errado
- Cross-network (24%) — PMax + Meta misturados
- Paid Social (0.3%) — sub-reportado drasticamente

### Regra:
- NUNCA confiar nos canais do GA4 para análise de Meta Ads
- Para Meta → usar API do Meta Ads diretamente
- Avisar: "⚠️ Atribuição do Meta no GA4 está comprometida nesta loja"

---

## 5. GA4 — item_id ≠ SKU do Shopify

### Problema real
Shopify envia item_id como ID numérico interno, NÃO como SKU (DS01067, MR0021).
Filtrar "item_id contém DS" → retornou **zero**.

### Regra:
- Para filtrar produtos no GA4: usar **Nome do item**, NUNCA ID do item
- SKUs são úteis no Shopify, não no GA4

---

## 6. Segmentação China vs Produção Própria

### Dados confirmados:
- **China/drop:** nome contém "Special". SKU começa com "DS". Coleção: `/collections/capa-sofa-premium`
- **Produção própria:** todo sofá que NÃO contém "Special"
- Coleção geral: `/collections/capa-para-sofa` (inclui ambos)

### Performance confirmada:
- ATC similar: China 6.96% vs Própria 7.54% (diferença pequena)
- Funil completo: China 1.02% vs Própria 1.53% (China 50% pior)
- Maior gap: ATC→Checkout (37.8% China vs 48.4% própria) — prazo/preço/confiança
- **Problema de ATC baixo é de toda a categoria sofá, não só China**

### Regra:
- Quando análise envolve sofá: perguntar "Quer separar produção própria vs China?"
- Filtro China no GA4: Nome contém "Special"
- Filtro Própria: Nome contém "ofá" E NÃO contém "Special"

---

## 7. Meta Ads — Atribuição Inflada 20-40%

### Dados confirmados:
- Meta reporta ~20-40% mais conversões que Shopify
- ROAS auto-reportado Meta: 2.80x | ROAS real estimado: ~2.0-2.2x
- Janela: 7d click / 1d view

### Regra:
- SEMPRE cruzar Meta com Shopify
- Mostrar ambos lado a lado
- Usar `offsite_conversion.fb_pixel_purchase`
- Alertar sobre inflação

---

## 8. Shopify — Receita com ou sem Frete

- `totalPrice` = produtos + frete + impostos - descontos
- `subtotalPrice` = só produtos
- Perguntar: "Receita total (com frete) ou só produtos?"

---

## 9. Landing Pages Genéricas

### Problema real
Campanhas apontam pra `/collections/...` (genérica). Não dá pra filtrar por page_location pra segmentar tráfego por produto.

### Regra:
- Não segmentar por URL de landing page
- Usar `item_name` nos eventos de ecommerce
- Para segmentar por campanha: cruzar com API dos Ads

---

## 10. GA4 — Nomes de Métricas Confusos (PT-BR)

| Nome no GA4 | O que é realmente |
|---|---|
| "Itens vistos" | Eventos de view_item por item (não pageviews) |
| "Itens adicionados ao carrinho" | EVENTOS, não usuários (infla pra cadeira) |
| "Conversões" | Qualquer evento marcado como conversão (não só compras) |

### Regra: sempre especificar qual métrica está usando e o que ela mede.

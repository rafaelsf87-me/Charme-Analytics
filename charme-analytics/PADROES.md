# PADRÕES.md — Templates de Relatório e Lições Aprendidas
> Arquivo injetado automaticamente no system prompt do agente.
> Edite sempre que encontrar um formato bom ou uma lição nova.
> O agente DEVE seguir estes formatos. Não inventar colunas extras.

---

## INSTRUÇÃO PARA O AGENTE

Ao gerar uma resposta com tabela, verifique se existe um padrão aqui para o tipo de consulta.
- Se existir: siga EXATAMENTE as colunas, ordenação e regras indicadas.
- Se não existir: use seu melhor julgamento, mas mantenha consistência com os padrões já definidos.
- NUNCA adicione colunas que não estão no padrão, a menos que o usuário peça explicitamente.

---

## PADRÃO 1 — ATC / VIEWS POR PRODUTO

**Fonte:** GA4 (ga4_get_item_report)
**Quando usar:** perguntas sobre ATC, views, taxa de conversão por produto

| Produto | Views | ATC | Taxa ATC (%) | Checkout | Taxa Checkout (%) | Receita (GA4 — est.) |
|---|---|---|---|---|---|---|

- **Ordenação padrão:** Views (desc)
- Taxa ATC = ATC ÷ Views × 100
- Taxa Checkout = Checkout ÷ ATC × 100
- Cadeira: ATC já vem corrigido (÷5 automático) — mencionar "ATC corrigido" na resposta
- Marcadores 🟢🔴 top/bottom 30%
- Seção "⭐ Produtos Destaque" gerada automaticamente pela tool — manter
- Se usuário especificar threshold de views (ex: "+4.000 views"), filtrar APÓS receber dados
- `ranking_mode: 'both'` para "top N melhores e piores" (1 chamada, não 2)
- Coluna "Receita (GA4 — est.)" sempre presente — marcar como estimativa pois pode divergir do Shopify

**❌ NÃO fazer:**
- Não buscar vendas no Shopify quando a pergunta é sobre ATC/Views
- Não apresentar "quantidade vendida" quando o pedido é sobre comportamento
- Não ignorar threshold solicitado pelo usuário

---

## PADRÃO 2 — FATURAMENTO / VENDAS POR PRODUTO

**Fonte:** Shopify (shopify_get_top_products ou shopify_get_orders)
**Quando usar:** perguntas sobre vendas, faturamento, produtos mais vendidos, receita

| Produto | Qtd Vendida | Receita (R$) | Ticket Médio (R$) | % do Total |
|---|---|---|---|---|

- **Ordenação padrão:** Receita (desc)
- % do Total = receita do produto ÷ receita total do período × 100
- Se pedir "top N": mostrar exatamente N linhas, não mais
- Coluna "Origem" (China vs Produção Própria) só quando o usuário pedir

**❌ NÃO fazer:**
- Não usar GA4 para faturamento real
- Não apresentar amostra parcial como total (se paginação truncou, avisar)

---

## PADRÃO 3 — PERFORMANCE DE CAMPANHAS ADS

**Fonte:** Google Ads e/ou Meta Ads
**Quando usar:** perguntas sobre campanhas, ROAS, CPA, gasto, performance de ads

| Campanha | Status | Gasto (R$) | Impressões | Cliques | CTR (%) | Conversões | Receita (R$) | ROAS | CPA (R$) |
|---|---|---|---|---|---|---|---|---|---|

- **Ordenação padrão:** Gasto (desc)
- Status: 🟢 ativo / ⚪ pausado
- **Regra de canal:**
  - Pergunta genérica ("performance de ads") → tabelas separadas por canal (Google + Meta)
  - Canal específico na pergunta → só aquele canal (economia de token)
- ROAS = Receita ÷ Gasto
- CPA = Gasto ÷ Conversões
- Google Ads: gasto via formatBRLFromMicros (cost_micros ÷ 1.000.000)
- Meta Ads: CTR vem como "2.5" (já %) → formatPercent(ctr / 100); ROAS via purchase_roas[0].value
- Sem linha de "Total" consolidado

**❌ NÃO fazer:**
- Não misturar Google e Meta na mesma tabela
- Não usar GA4 para dados de custo de mídia
- Não usar campo actions[] do Meta (causa HTTP 500)

---

## PADRÃO 4 — FUNIL DE CHECKOUT

**Fonte:** GA4 (ga4_run_report com sessions + eventName)
**Quando usar:** perguntas sobre funil, conversão por etapa, checkout

| Etapa | Sessões | Taxa desde o Topo (%) |
|---|---|---|

Etapas fixas (nesta ordem):
1. View
2. ATC
3. Begin Checkout
4. Add Payment
5. Purchase

- Taxa desde o Topo = sessões da etapa ÷ sessões de View × 100
- **Sem coluna de drop-off** entre etapas
- Funil geral da loja por padrão. Por categoria só se o usuário pedir.
- Usar sessions + dimensão eventName — NÃO eventCount (inflado no Shopify 1-step checkout)

---

## PADRÃO 5 — COMPARAÇÃO DE PERÍODOS

**Fonte:** depende da métrica (qualquer fonte)
**Quando usar:** qualquer pergunta comparativa entre 2 períodos, ou quando [COMPARAR PERÍODOS] estiver ativo

| Métrica | Período A | Período B | Δ% | |
|---|---|---|---|---|

- Δ% = (B - A) ÷ A × 100
- Indicadores visuais obrigatórios:
  - Métrica "boa" (receita, ROAS, conversões): 🟢 se subiu, 🔴 se caiu
  - Métrica "ruim" (CPA, bounce, custo): 🟢 se caiu, 🔴 se subiu
- Última coluna: seta de tendência ↑ ou ↓
- **Sem comentário interpretativo** abaixo da tabela
- Consultar APENAS os dois períodos indicados

---

## PADRÃO 6 — MIX DE CATEGORIAS

**Fonte:** Shopify
**Quando usar:** perguntas sobre mix, distribuição por categoria, participação

| Categoria | Receita (R$) | % do Total | Qtd Pedidos | Ticket Médio (R$) |
|---|---|---|---|---|

- **Regra dos 90%:** focar em Capa Cadeira (~70%) e Capa Sofá (~20%). Agrupar todo o resto como "Outros".
- Ordenação: Receita (desc)
- Análise de mix SKU/pedido (shopify_get_order_mix) só quando o usuário pedir

---

## PADRÃO 7 — FUNIL PDP DIRETO vs VIA CATEGORIA

**Fonte:** GA4
**Quando usar:** comparação de conversão entre acesso direto ao PDP vs navegação via página de categoria

| Caminho | Sessões | ATC | Taxa ATC (%) |
|---|---|---|---|

Caminhos:
- **Direto no PDP** — sessão que aterrissa direto na página do produto
- **Via Página de Categoria** — sessão que passa pela página de categoria antes do PDP

- Produto identificado por **URL** (estável, não muda). Categoria por **título** (mais confiável para categorias).
- O sistema já implementa essa lógica — não alterar código existente.

---

## PADRÃO 8 — TICKET MÉDIO

**Fonte:** Shopify
**Quando usar:** perguntas sobre ticket médio

| Produto | Qtd Pedidos | Ticket Médio (R$) |
|---|---|---|

- **Padrão: por produto individual.** Por categoria só se o usuário especificar.
- Sem ticket mínimo/máximo — só médio.
- Sempre incluir Qtd Pedidos para contextualizar.
- Ordenação: Ticket Médio (desc)

---

## PADRÃO 9 — % PRODUTO CROSS NO CARRINHO

**Fonte:** GA4 + Shopify
**Quando usar:** perguntas sobre cross-sell, produtos cross, taxa de cross

**Resumo no topo:**
| Métrica | Valor |
|---|---|
| % Pedidos com Cross (Shopify) | ... |
| % ATCs que são Cross (GA4) | ... |

**Ranking abaixo:**
| Produto Cross | ATC (GA4) | Qtd Vendida (Shopify) | Receita (R$) |
|---|---|---|---|

- Identificação: título do produto contém "cross" (case insensitive)
- Fontes: GA4 para ATC + Shopify para vendas/receita
- Ordenação do ranking: ATC (desc)

---

## REGRAS GERAIS DE FORMATAÇÃO

- Valores monetários: R$ com separador de milhar (R$ 1.234,56)
- Percentuais: 1 casa decimal (12,3%)
- Quantidades inteiras: sem decimal (1.234)
- Anos: abreviados ('26, '25, '24)
- Tabelas: máximo 10 colunas — se precisar de mais, dividir em 2 tabelas
- Ranking: se pedir "top N", mostrar exatamente N linhas
- Linha de total/média na última linha só se fizer sentido no contexto (ex: faturamento). Campanhas: sem total.

---

## LIÇÕES APRENDIDAS

> Adicione erros recorrentes e correções aqui. Formato livre.

### Lição 1 — ATC ≠ Vendas
**Data:** 06/abr'26
**Contexto:** Pergunta sobre "melhor ATC de sofá", agente foi no Shopify buscar pedidos.
**Correção:** ATC é comportamento → GA4. Vendas → Shopify. Nunca confundir.

### Lição 2 — Amostra parcial como total
**Data:** 06/abr'26
**Contexto:** Agente retornou "100 pedidos mais recentes" como universo completo.
**Correção:** Se o período tem mais dados que o retornado, avisar que é amostra OU paginar até ter tudo.

### Lição 3 — [PRÓXIMA LIÇÃO AQUI]
**Data:**
**Contexto:**
**Correção:**

<!--
Para adicionar lição via Claude Code:
"Abra PADROES.md, seção Lições Aprendidas. Adicione Lição N com: Data: [hoje], Contexto: [descrição], Correção: [o que fazer certo]."
-->

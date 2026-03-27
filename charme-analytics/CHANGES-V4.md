# Mudanças V4 — Modo Especialista + Otimização de Tokens

> Claude Code: leia este arquivo e implemente TODAS as mudanças.

---

## Mudança 1: Otimizar Tool Definitions (economia ~800 tokens/request)

### Problema
As 12 tools (~1.400 tokens) são enviadas em TODA request, mesmo quando irrelevantes. Uma pergunta sobre clientes não precisa das tools de GA4 ou Meta Ads na definição.

### Implementação

Criar um pré-classificador leve em `src/lib/claude.ts` que analisa a mensagem do usuário e seleciona APENAS as tools relevantes:

```typescript
function selectRelevantTools(userMessage: string): Tool[] {
  const msg = userMessage.toLowerCase();
  const selected: Tool[] = [];

  // Sempre incluir (custo mínimo, úteis em quase tudo)
  // Nenhuma tool é "sempre" — selecionar por contexto

  // Shopify: pedidos, clientes, receita, produtos, faturamento
  if (match(msg, ['cliente', 'pedido', 'receita', 'faturamento', 'produto', 'vend', 'ticket', 'top', 'compra', 'recompra', 'ltv', 'shopify'])) {
    selected.push(...SHOPIFY_TOOLS);
  }

  // Yampi: dados históricos, antes de 2025, "todos os tempos"
  if (match(msg, ['históric', 'yampi', '2023', '2024', 'todos os tempos', 'antes', 'migração', 'antigo'])) {
    selected.push(...YAMPI_TOOLS);
  }

  // GA4: tráfego, sessões, conversão, ATC, funil, página, analytics
  if (match(msg, ['sessão', 'sessões', 'tráfego', 'analytics', 'ga4', 'funil', 'atc', 'add to cart', 'carrinho', 'página', 'views', 'orgânico', 'canal', 'fonte'])) {
    selected.push(...GA4_TOOLS);
  }

  // Google Ads: campanha google, keyword, pmax, roas google, cpa google
  if (match(msg, ['google ads', 'google', 'keyword', 'pmax', 'demand gen', 'display', 'shopping', 'gaql'])) {
    selected.push(...GOOGLE_ADS_TOOLS);
  }

  // Meta Ads: meta, facebook, instagram, campanha meta, criativo
  if (match(msg, ['meta', 'facebook', 'instagram', 'criativo', 'adset', 'anúncio'])) {
    selected.push(...META_ADS_TOOLS);
  }

  // Se nenhum match claro, enviar todas (fallback seguro)
  if (selected.length === 0) {
    return ALL_TOOLS;
  }

  // Se pergunta genérica de performance/relatório, incluir todas de ads + shopify
  if (match(msg, ['relatório', 'performance', 'compare', 'roas', 'cpa', 'ctr'])) {
    selected.push(...SHOPIFY_TOOLS, ...GA4_TOOLS, ...GOOGLE_ADS_TOOLS, ...META_ADS_TOOLS);
  }

  // Deduplicar
  return [...new Set(selected)];
}

function match(msg: string, keywords: string[]): boolean {
  return keywords.some(k => msg.includes(k));
}
```

Isso reduz de ~1.400 tokens pra ~400-800 na maioria dos requests.

---

## Mudança 2: Briefing da Empresa no System Prompt

### Adicionar ao system prompt (ANTES das regras, logo após a apresentação):

```
## Briefing — Charme do Detalhe

Empresa: Charme do Detalhe (e-commerce têxteis para casa)
Site: charmedodetalhe.com | IG: @charmedodetalhe
Faturamento total: ~R$20MM/ano
- Site Shopify: ~30% (~R$6MM) — foco estratégico de crescimento
- 11 lojas em marketplaces (ML, Amazon, Shopee, TikTok Shop, Shein, Magalu): ~70% (~R$14MM)
- Marketplaces têm preços mais baixos que o site

Catálogo e mix:
- Especialistas em capas para cadeiras (70% fat. site) e capas para sofás (20%)
- Outros: cortinas, toalhas, etc. (10%)
- Catálogo grande, mas foco real: cadeira + sofá
- Sofá: metade produção própria, metade drop shipping China ("Special" no nome, SKU "DS")
- China: prazo maior, preço mais alto, margem menor

Equipe:
- 2 sócios mão na massa (CEO Rafael: marketing/CRM/automação + sócio: processos/IA)
- 2 analistas
- Orçamento limitado — priorizar ações de alto impacto e baixo custo de execução

Gasto em tráfego: ~R$163k/mês (Google ~R$75k + Meta ~R$88k)

Dores atuais:
- Faturamento estagnado
- CPA subindo
- LTV estagnado
- Muita dependência de tráfego pago
- Margem comprime nos meses fracos (jan/fev) por custo fixo de tráfego

Keywords principais: "capas para cadeiras", "capas para sofás"
Sazonalidade: queda jan/fev, recuperação ao longo do ano, pico nov

Dados confirmados (Set/25-Mar/26):
- Taxa conversão site: 0.70%
- ATC sofá: 7.4% (problema identificado — cadeira: 16.1%)
- Recompra: 10-15%
- Ticket médio: R$254-269
```

**Custo:** ~350 tokens. Com caching ativo: ~35 tokens/request após o primeiro.

---

## Mudança 3: Modo Especialista no System Prompt

### Adicionar após as regras de formato de resposta:

```
## Modo Especialista (opcional por request)

Após gerar qualquer relatório, perguntar:
"📊 Relatório gerado. Quer a **Análise Especialista** com diagnóstico, oportunidades e plano de ação?"

Se o usuário aceitar, adicionar ao final do mesmo relatório:

---
# 🎯 Análise Especialista

## Resumo Executivo
[O que realmente importa em 2-3 frases. Linguagem de negócio, não técnica.]

## Fatos Confirmados
[Só o que os dados sustentam. Sem interpretação.]

## Hipóteses
[Interpretação provável com grau de confiança: alta/média/baixa. Ex: "Hipótese (confiança ALTA): ATC baixo de sofá é barreira de decisão pré-carrinho, não problema de tráfego"]

## O Que Pode Estar Sendo Lido Errado
[Números enganosos, conflitos de fonte, métricas mal definidas. Ex: "ATC de cadeira por eventos (809%) não é comparável com ATC de sofá (7%)"]

## Gargalos (ranking por impacto)
1. [Gargalo] — impacto estimado: [R$ ou %]
2. ...

## Oportunidades
**Quick wins (execução <1 semana):**
- [Ação específica, não genérica]

**Estruturais (1-3 meses):**
- [Ação específica]

## Alertas / Riscos
[Onde NÃO tomar decisão ainda. Onde falta dado.]

## Próximos Relatórios Sugeridos
[Se necessário: quais análises adicionais fechariam a dúvida — PERGUNTAR antes de executar]
---

### Regras do Especialista:
- Ser extremamente analítico e cético com conclusões fáceis
- Orientado por evidência — não puxar conclusão sem base
- Separar FATO de HIPÓTESE sempre
- Não alucinar benchmarks — se não sabe o benchmark real, dizer "sem benchmark disponível"
- Não confundir correlação com causa
- Priorizar por impacto REAL (R$), não por "importância teórica"
- Ser operacional: em vez de "melhorar oferta" → "testar bundle 2+3 lugares com desconto de 15%"
- Considerar a realidade da equipe (2 sócios + 2 analistas, orçamento limitado)
- Nunca sugerir ação que exija equipe ou budget que a empresa não tem
- Se não tem dado suficiente, dizer "não sei ainda, preciso de [X]"
- Nunca usar frases vazias tipo "melhorar experiência do usuário" sem detalhar

### Modos de análise (o agente ativa automaticamente conforme contexto):

| Modo | Quando | Foco |
|---|---|---|
| Marketing/Performance | ROAS, CPA, funil, campanha | Gargalo + ação |
| Produto/Oferta | produto específico, ATC, mix | Buraco negro vs vencedor, bundle, preço |
| Mercado | concorrente, preço, tendência | Benchmark + posicionamento |
| Crescimento | "o que fazer", priorização | Alavancas, impacto x esforço |

O agente escolhe o modo sem perguntar. Se a pergunta cruza modos, combina.
```

**Custo:** ~400 tokens. Com caching: ~40 tokens/request.

---

## Mudança 4: Análise de Mercado com Web Search (Opcional)

### Implementação

Quando o modo Mercado for ativado (concorrentes, preço, tendência), o agente pode usar web search da Claude API pra consultar dados em tempo real.

**Adicionar ao system prompt:**
```
## Análise de Mercado (modo opcional)

Quando a análise envolver concorrentes ou mercado, perguntar:
"🔍 Quer que eu consulte dados de mercado em tempo real? (concorrentes, preços, tendências). Nota: isso usa mais tokens."

Se sim, pode usar web_search para:
- Consultar preços em concorrentes diretos:
  - casadascapas.store
  - okdarling.com.br
- Consultar marketplaces: Amazon, ML, Shopee, Shein (preços e posicionamento)
- Google Trends: tendência de busca das keywords principais
- Qualquer outra fonte pública relevante

Concorrentes conhecidos:
- Diretos: Casa das Capas (casadascapas.store), Ok Darling (okdarling.com.br)
- Indiretos: Amazon, MercadoLivre, Shopee, Shein (vendem capas mas não são especialistas)

Foco da análise de mercado: SEMPRE mercado brasileiro.

Formato de entrega da análise de mercado:
| Concorrente | Produto Equivalente | Preço Deles | Nosso Preço | Diferença |
|---|---|---|---|---|
| Casa das Capas | Capa Sofá 3 Lugares | R$X | R$Y | +Z% |

+ Insights de posicionamento e oportunidades.
```

### Implementação técnica

1. Adicionar `web_search` como tool no Claude API:
```typescript
// Em tools/index.ts, adicionar:
{
  type: "web_search_20250305",
  name: "web_search"
}
```

2. A web search é uma tool nativa da Claude API — não precisa de connector customizado.
3. Só incluir a tool de web_search quando modo Mercado for ativado (pelo seletor de tools da Mudança 1).
4. Adicionar keyword match: `['concorrente', 'mercado', 'benchmark', 'preço relativo', 'tendência', 'google trends', 'casa das capas', 'ok darling']`

---

## Mudança 5: Resposta em Camadas (Economia de Tokens no Output)

### Problema
O output do Especialista pode ficar longo (2.000-3.000 tokens). Nem sempre o usuário quer tudo.

### Implementação

Quando o Especialista gerar a análise, entregar em 2 níveis:

**Nível 1 (sempre):** Resumo Executivo + Gargalos + Quick Wins (~500 tokens)

**Nível 2 (sob demanda):** "Quer ver a análise completa? (hipóteses, riscos, plano detalhado)"

Adicionar ao system prompt:
```
## Camadas de Resposta do Especialista

Nível 1 (padrão): Resumo Executivo + Top 3 Gargalos + Top 3 Quick Wins
→ Compacto, direto, ~500 tokens de output

Nível 2 (sob demanda): Análise completa com todos os blocos
→ Detalhado, ~1.500-2.000 tokens de output

Sempre entregar Nível 1 primeiro. Perguntar: "Quer a análise detalhada completa?"
Se sim, gerar Nível 2 na mensagem seguinte.
```

---

## Resumo de impacto em tokens

| Mudança | Impacto |
|---|---|
| Tool selection | **-600 tokens/request** (12→4-6 tools) |
| Briefing empresa | +350 tokens no prompt (**+35 com cache**) |
| Regras especialista | +400 tokens no prompt (**+40 com cache**) |
| Camadas de resposta | **-500 a -1.500 tokens no output** |
| **Resultado líquido** | **~500 tokens/request MAIS BARATO** que hoje, COM o Especialista |

---

## Ordem de implementação

1. Tool selection em `claude.ts` (Mudança 1)
2. Briefing da empresa no system prompt (Mudança 2)
3. Modo Especialista no system prompt (Mudança 3)
4. Web search como tool opcional (Mudança 4)
5. Camadas de resposta (Mudança 5)
6. Testar: pedir relatório → aceitar análise especialista → verificar formato

Após implementar, me mostre:
- O system prompt final completo
- A função selectRelevantTools
- O fluxo de "Quer análise especialista?" funcionando

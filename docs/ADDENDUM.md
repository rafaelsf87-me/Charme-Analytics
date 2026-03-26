# Adendos Técnicos — Performance e Regras Adicionais

> Claude Code: leia este arquivo JUNTO com os demais docs/.
> Contém regras que afetam a implementação dos connectors e do tool use loop.

---

## 1. Performance: Chamadas Paralelas (OBRIGATÓRIO)

O comportamento padrão do agente é cruzar múltiplas fontes por pergunta. Isso significa 2-4 chamadas de API por solicitação. Se executadas em sequência, o tempo total seria 10-30s. Inaceitável.

### Regra: TODAS as tool calls de uma mesma "rodada" devem ser executadas em paralelo.

No tool use loop do `claude.ts`:

```typescript
// ❌ ERRADO — sequencial, lento
for (const toolCall of toolCalls) {
  const result = await executeTool(toolCall);
  results.push(result);
}

// ✅ CERTO — paralelo
const results = await Promise.all(
  toolCalls.map(toolCall => executeTool(toolCall))
);
```

**Nota:** Claude pode pedir múltiplas tools em uma única resposta (tool_use com array). Quando isso acontecer, executar TODAS em paralelo e retornar TODOS os results de uma vez.

### Timeouts por plataforma

| Plataforma | Timeout esperado | Max aceitável |
|---|---|---|
| Shopify | 1-3s | 15s |
| GA4 | 2-5s | 20s |
| Google Ads | 3-8s | 25s |
| Meta Ads | 3-10s | 30s |

Se qualquer chamada estourar o timeout, retornar erro parcial e continuar com as demais:
```
"TIMEOUT [Meta Ads]: consulta demorou mais de 30s. Dados de Meta Ads indisponíveis nesta análise. Demais fontes consultadas normalmente."
```

### Loading progressivo no frontend

O frontend DEVE mostrar quais plataformas estão sendo consultadas em tempo real. Como as tools rodam em paralelo, mostrar todas simultaneamente:
```
🔄 Consultando: Shopify ✓ | GA4 ✓ | Google Ads ⏳ | Meta Ads ⏳
```

Atualizar cada status conforme retorna (✓ sucesso, ✗ erro, ⏳ aguardando).

---

## 2. Economia de Tokens: Tool Results Compactos

### Budget de tokens por tool result

| Cenário | Max tokens no result |
|---|---|
| Listagem simples (top 10) | ~300 tokens |
| Relatório com múltiplas dimensões | ~500 tokens por dimensão |
| Cruzamento multi-fonte | ~400 tokens por fonte |

Se o resultado bruto exceder o budget, o connector DEVE agregar/truncar no backend ANTES de retornar.

### Estratégia de compactação por connector

**Shopify:**
- Nunca retornar lineItems individuais a menos que explicitamente pedido
- Para top clientes: agregar pedidos por cliente NO BACKEND, retornar só o resumo
- Para pedidos: retornar max 50 linhas, com subtotais

**GA4:**
- Sempre usar `limit` na API request (default: 10, max: 50)
- Se houver mais dimensões do que o necessário, remover as menos relevantes
- Nunca retornar raw rows — sempre texto tabular formatado

**Google Ads / Meta Ads:**
- Filtrar campanhas ENABLED/ACTIVE na query (não trazer PAUSED por default)
- Limitar a 20 campanhas por default
- Métricas calculadas (ROAS, CPA, CTR) já devem vir calculadas — não enviar os componentes separados pro Claude calcular

---

## 3. Identificação de Produtos no GA4

### O problema
GA4 usa `pagePath` e `pageTitle` para identificar páginas. Filtros de dimensão são case-sensitive. Acentos em URLs ficam URL-encoded. Exemplo:
- URL da página: `/products/capa-de-sofa-elastica`
- No GA4: pagePath contém `capa-de-sofa` (sem acento, lowercase)
- Mas título do produto no Shopify pode ser: "Capa de Sofá Elástica Premium"

### Implementação no connector GA4

Quando `ga4_run_report` receber um filtro de produto:

1. Usar `dimensionFilter` com `stringFilter.matchType: "CONTAINS"` (não EXACT)
2. Termo SEMPRE lowercase e sem acentos
3. Se o resultado vier vazio, tentar variações automaticamente:
   - Remover acentos
   - Tentar fragmento menor (ex: "sofa" → "ofa")
   - Retornar mensagem: "Nenhum resultado para '[termo]'. Termos tentados: [lista]. Sugira outro termo ou envie URL de exemplo."

```typescript
// Exemplo de filtro GA4
{
  dimensionFilter: {
    filter: {
      fieldName: "pagePath",
      stringFilter: {
        matchType: "CONTAINS",
        value: sanitizeForGA4(userTerm) // remove acentos, lowercase
      }
    }
  }
}

function sanitizeForGA4(term: string): string {
  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, '-');           // espaços → hífens
}
```

### Cruzamento produto Shopify ↔ GA4

Para relatórios de produto que envolvem ambas as fontes:

1. **Shopify:** buscar por título do produto (campo `title`, busca parcial)
2. **GA4:** buscar por URL (pagePath contains [termo sanitizado])
3. **No resultado:** mostrar ambos lado a lado, identificar pelo nome do produto
4. Se não bater: avisar "Não foi possível cruzar automaticamente produto X entre Shopify e GA4. Confirme o termo de URL."

---

## 4. Ordem de Execução das Tools (Otimização)

Quando Claude pedir tools em sequência (não paralelo), priorizar:

1. **Shopify primeiro** — dados de pedidos/clientes são a "fonte de verdade" de receita
2. **GA4 segundo** — comportamento no site complementa
3. **Ads por último** — dados de mídia contextualizam

Motivo: se Shopify falhar, o agente pode informar logo e ajustar o plano. Se Ads falhar, o relatório ainda tem valor com Shopify + GA4.

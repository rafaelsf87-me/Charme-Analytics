# MELHORIAS-CHAT-V2.md — Plano de Implementação
> Para o Claude Code executar. Leia INTEIRO antes de começar.
> Última atualização: 28/03/2026

---

## Contexto

Este documento detalha melhorias de UX no módulo Chat (Central de Dados) do Charme Analytics.
Todas as mudanças são no chat. NÃO alterar: Dashboard de Criativos, Home, Auth, nem nenhuma API de dados.

**Stack:** Next.js 14+ (App Router), Tailwind CSS, shadcn/ui, fonte Geist.
**Cores Charme:** primária `#553679`, background `#F8F5FC`.
**Arquivos principais afetados:**
- `src/components/chat-interface.tsx` (componente principal do chat)
- `src/lib/system-prompt.ts` (regras do agente)
- `src/app/api/chat/route.ts` (recebe mensagem, chama Claude)

---

## MELHORIA 1 — Caixa de Input Maior + Shift+Enter

### O que mudar
- Aumentar altura mínima da textarea de input para `80px` (aprox. dobro do padrão).
- Max height: `200px` com auto-expand conforme digita (mesma UX do Claude.ai).
- Placeholder: `"Faça uma pergunta ou solicite um relatório…"`
- Implementar `Shift+Enter` para quebra de linha. `Enter` sozinho envia a mensagem.

### Onde mudar
- `src/components/chat-interface.tsx` — componente de input

### Spec técnica
```tsx
// Textarea com auto-resize
<textarea
  ref={textareaRef}
  rows={1}
  className="min-h-[80px] max-h-[200px] resize-none overflow-y-auto ..."
  placeholder="Faça uma pergunta ou solicite um relatório…"
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Shift+Enter = quebra de linha natural (não precisa de handler)
  }}
  onChange={(e) => {
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  }}
/>
```

### Impacto em tokens/performance
Nenhum.

---

## MELHORIA 2 — Abreviação de Ano

### O que mudar
Adicionar regra no system prompt: ao citar anos, abreviar de "2026" para "'26", "2025" para "'25", etc.

### Onde mudar
- `src/lib/system-prompt.ts`

### Texto para adicionar ao system prompt
Inserir no bloco de regras de formatação:
```
## FORMATAÇÃO DE ANOS
Sempre abreviar anos: "2026" → "'26", "2025" → "'25", "2024" → "'24", etc.
Exemplos: "faturamento em '25", "comparando Q4'25 vs Q4'24", "últimos 90 dias (dez'25 a mar'26)".
Nunca escrever o ano completo com 4 dígitos.
```

### Impacto em tokens/performance
Desprezível (~30 tokens no system prompt, cacheado).

---

## MELHORIA 3 — Confirmação com Fonte de Dados (até 7 linhas)

### O que mudar
Na mensagem de confirmação que o agente exibe antes de gerar o relatório, incluir obrigatoriamente a(s) fonte(s) de dados que será(ão) consultada(s). Aumentar limite de 5 para 7 linhas.

### Onde mudar
- `src/lib/system-prompt.ts`

### Texto para substituir/atualizar no system prompt
Localizar a regra existente de confirmação curta (5 linhas) e substituir por:
```
## CONFIRMAÇÃO ANTES DE GERAR RELATÓRIO
Antes de executar qualquer tool, envie uma confirmação curta (máximo 7 linhas) com:
1. O que você entendeu que foi pedido (1-2 linhas)
2. Período de análise (com datas calculadas, último dia = ontem)
3. Filtros aplicados (categoria, produto, campanha, etc.)
4. Fonte(s) de dados: listar quais APIs serão consultadas (ex: "Fonte: GA4" ou "Fontes: Shopify + GA4")
5. Restrições relevantes (se houver, ex: "apenas produtos com +4.000 views")

Formato exemplo:
---
📋 **Confirmação:**
Ranking de ATC de capas para sofá, top 2 melhores e piores.
Período: últimos 90 dias (28/dez'25 a 27/mar'26)
Filtro: produtos contendo "ofá" com +4.000 views
Fonte: GA4 (métricas de comportamento)
Confirma? ✅
---

NÃO adicionar informações que o usuário não pediu. Não sugerir análises extras.
Após confirmação (ou se o usuário não pedir confirmação), execute.
```

### Impacto em tokens/performance
Desprezível (~80 tokens no system prompt, cacheado). Pode ECONOMIZAR tokens ao evitar relatórios errados que precisam ser refeitos.

---

## MELHORIA 4 — Chips de Período Pré-Selecionado

### O que mudar
Abaixo da textarea de input, adicionar uma linha com chips de período:
- Label: `"Pré-selecionar período"` (texto discreto, cinza `#9CA3AF`)
- Chips: `7D`, `30D`, `60D`, `90D`, `180D`, `Total`
- Comportamento: mutuamente exclusivos (radio button), visual de chip/tag
- Nenhum vem selecionado por padrão
- Clicar novamente no chip ativo = desselecionar (volta a "nenhum selecionado")

### Cálculo de datas
- **Último dia = ontem** (nunca hoje)
- `7D` = ontem - 6 dias até ontem (7 dias totais)
- `30D` = ontem - 29 dias até ontem
- `60D` = ontem - 59 dias até ontem
- `90D` = ontem - 89 dias até ontem
- `180D` = ontem - 179 dias até ontem
- `Total` = sem restrição de data (todo o período disponível)

### Como passar o período para o agente
Quando um chip está selecionado, **injetar contexto no início da mensagem do usuário** antes de enviar ao API:

```typescript
// Em chat-interface.tsx, ao montar a mensagem:
function buildMessage(userText: string, period: PeriodSelection | null): string {
  if (!period) return userText;
  
  if (period.type === 'preset') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const endDate = formatDate(yesterday); // YYYY-MM-DD
    
    if (period.value === 'total') {
      return `[PERÍODO: todo o histórico disponível, até ${endDate}]\n\n${userText}`;
    }
    
    const days = parseInt(period.value); // 7, 30, 60, 90, 180
    const startDate = new Date(yesterday);
    startDate.setDate(startDate.getDate() - (days - 1));
    
    return `[PERÍODO: ${formatDate(startDate)} a ${endDate} (${period.value})]\n\n${userText}`;
  }
  
  // ... compare periods (Melhoria 5)
}
```

**No system prompt**, adicionar regra:
```
## PERÍODO PRÉ-SELECIONADO
Se a mensagem começar com [PERÍODO: ...], use EXATAMENTE essas datas na consulta.
Não pergunte sobre período — o usuário já definiu.
Se o usuário mencionar outro período no texto, o texto prevalece sobre o pré-selecionado.
```

### Visual
```
┌─────────────────────────────────────────────────────┐
│ Faça uma pergunta ou solicite um relatório…         │
│                                                     │
│                                                     │
│                                          [Enviar ➤] │
├─────────────────────────────────────────────────────┤
│ Pré-selecionar período   [7D] [30D] [60D] [90D] [180D] [Total]  │
│ ☐ Comparar períodos                                 │
└─────────────────────────────────────────────────────┘
```

Chips não selecionados: borda `#D1D5DB`, texto `#6B7280`, bg transparente.
Chip selecionado: borda `#553679`, texto `#553679`, bg `#F8F5FC`.

### Onde mudar
- `src/components/chat-interface.tsx` — novo componente de chips inline

### Impacto em tokens/performance
~20 tokens extras por mensagem quando período selecionado. Desprezível.
**ECONOMIA potencial:** o agente sabe exatamente o período e não precisa interpretar "últimos 3 meses" = menos chance de erro e re-execução.

---

## MELHORIA 5 — Comparar Períodos

### O que mudar
Abaixo dos chips de período, uma linha com toggle/checkbox: `"Comparar períodos"`.

Ao ativar:
1. **Desabilitar** os chips de período acima (ficam cinza, não clicáveis)
2. Abrir um painel com **dois seletores de período**, cada um com:
   - Presets: mesmos chips (7D, 30D, 60D, 90D, 180D, Total)
   - OU range customizado via calendário (date range picker)
3. Labels: `"Período A"` e `"Período B"`
4. Calendário abre **para cima** (dropup) para não ficar cortado

Ao desativar:
1. Fechar o painel de comparação
2. Reabilitar os chips de período
3. Limpar seleções de comparação

### Visual (comparação ativa)
```
┌─────────────────────────────────────────────────────┐
│ Faça uma pergunta ou solicite um relatório…         │
│                                                     │
│                                          [Enviar ➤] │
├─────────────────────────────────────────────────────┤
│ Pré-selecionar período   [7D] [30D] [60D] [90D] [180D] [Total]  ← DESABILITADO │
│ ☑ Comparar períodos                                 │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Período A: [7D] [30D] [60D] [90D] [180D] [📅]  │ │
│ │ Período B: [7D] [30D] [60D] [90D] [180D] [📅]  │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

📅 = abre date range picker (calendário), direção: para CIMA
```

### Como passar para o agente
```typescript
// Comparação de períodos
if (period.type === 'compare') {
  const { periodA, periodB } = period;
  return `[COMPARAR PERÍODOS]
[PERÍODO A: ${periodA.startDate} a ${periodA.endDate}]
[PERÍODO B: ${periodB.startDate} a ${periodB.endDate}]

${userText}`;
}
```

**No system prompt**, adicionar:
```
## COMPARAÇÃO DE PERÍODOS
Se a mensagem começar com [COMPARAR PERÍODOS], consulte os dados de AMBOS os períodos indicados.
Apresente os resultados lado a lado com variação percentual (Δ%).
Formato: tabela com colunas "Métrica | Período A | Período B | Δ%".
Consulte APENAS os dados dos períodos indicados. Não consulte dados fora desses períodos.
```

### Calendário (Date Range Picker)
- Usar shadcn/ui `Calendar` + `Popover` (já disponível na stack)
- Popover com `side="top"` para abrir para cima
- Permitir selecionar range (start date + end date)
- Formato exibido: `dd/mm/aa` (ex: `01/01/26 - 31/01/26`)
- Último dia selecionável = ontem (não hoje)

### Onde mudar
- `src/components/chat-interface.tsx` — novo subcomponente de comparação
- Pode extrair para `src/components/period-selector.tsx` se ficar grande

### Impacto em tokens/performance
~40 tokens extras por mensagem com comparação. Desprezível.
**A comparação gera 2x tool calls** (uma por período). Isso é esperado e necessário. Não é desperdício.

---

## MELHORIA 6 — Otimização: Consultar Apenas Dados do Período

### O que mudar
Reforçar no system prompt que o agente NUNCA deve consultar dados fora do período solicitado.

### Onde mudar
- `src/lib/system-prompt.ts`

### Texto para adicionar
```
## ECONOMIA DE TOKENS — REGRA DE PERÍODO
Consulte APENAS os dados do período solicitado. Regras:
1. Se o usuário pediu "últimos 30 dias", consulte SÓ os últimos 30 dias. Não busque 90 dias "para ter mais contexto".
2. Se há período pré-selecionado [PERÍODO: ...], use essas datas exatas. Não amplie.
3. Não faça consultas exploratórias. Não busque dados de vendas se o pedido é sobre ATC.
4. Não sugira análises adicionais não solicitadas.
5. Se o período é curto (7D), use limit baixo nas APIs. Se é longo (180D), pagine conforme necessário.

Cada tool call desnecessária custa tokens e tempo. Seja cirúrgico.
```

### Impacto
Pode economizar 30-50% de tokens em queries onde o agente hoje faz consultas extras "para dar contexto".

---

## ORDEM DE IMPLEMENTAÇÃO

Implementar **nesta ordem exata** para evitar conflitos:

| Ordem | Melhoria | Risco |
|---|---|---|
| 1 | Melhoria 1 — Input maior + Shift+Enter | 🟢 Zero risco, puro CSS/UX |
| 2 | Melhoria 2 — Abreviação de ano | 🟢 Zero risco, só system prompt |
| 3 | Melhoria 3 — Confirmação com fontes | 🟢 Baixo risco, só system prompt |
| 4 | Melhoria 6 — Regra de economia de tokens | 🟢 Baixo risco, só system prompt |
| 5 | Melhoria 4 — Chips de período | 🟡 Médio, novo componente + lógica de injeção |
| 6 | Melhoria 5 — Comparar períodos | 🟡 Médio, depende da Melhoria 4 |

### Melhorias 2, 3, 4 e 6 são todas no system prompt
Podem ser feitas de uma vez editando `src/lib/system-prompt.ts`. Mas testar cada uma individualmente.

---

## REGRAS PARA O CLAUDE CODE

1. **NÃO alterar** nenhum arquivo fora do escopo listado em cada melhoria.
2. **NÃO alterar** tools de API (shopify.ts, ga4.ts, google-ads.ts, meta-ads.ts, yampi-legacy.ts).
3. **NÃO alterar** o Dashboard de Criativos, Home ou Auth.
4. **NÃO remover** funcionalidades existentes (sugestões de perguntas, botão copiar, etc.).
5. **Manter** as cores Charme (#553679 primária, #F8F5FC background).
6. **Manter** fonte Geist.
7. **Manter** responsividade mobile.
8. **Testar** cada melhoria antes de seguir para a próxima.
9. Para o date range picker, usar componentes shadcn/ui já disponíveis (`Calendar`, `Popover`). Se precisar instalar `date-fns`, instalar.
10. O calendário SEMPRE abre **para cima** (`side="top"` no Popover).

---

## COMANDO PARA CLAUDE CODE

```
Leia o MELHORIAS-CHAT-V2.md na raiz do projeto. Implemente as 6 melhorias na ordem indicada na seção "ORDEM DE IMPLEMENTAÇÃO". 

Regras:
- Siga a spec técnica de cada melhoria ao pé da letra.
- NÃO altere tools de API, Dashboard de Criativos, Home ou Auth.
- Para as melhorias de system prompt (2, 3, 6 e as regras de período de 4 e 5), edite src/lib/system-prompt.ts.
- Para melhorias de UI (1, 4, 5), edite src/components/chat-interface.tsx.
- Após implementar, me mostre o resultado visual de cada melhoria.
```

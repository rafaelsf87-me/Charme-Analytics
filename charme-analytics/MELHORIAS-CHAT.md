# Melhorias Chat — UX, Branding e Regras de Negócio

> Claude Code: leia e implemente TODAS as mudanças abaixo.

---

## Melhoria 1: Fix de Data "Últimos X Dias"

### Problema
"Últimos 7 dias" está considerando hoje como último dia. Deve considerar **ontem** como último dia.

### Implementação

No system prompt, adicionar regra:

```
## Regra de Datas

"Últimos 7 dias" = 7 dias anteriores contando a partir de ONTEM (não hoje).
Hoje nunca é incluído nos relatórios — dados do dia corrente são parciais.
Exemplo: se hoje é 28/03/2026, "últimos 7 dias" = 21/03 a 27/03.
Aplicar a mesma lógica para 15d, 30d, 60d, 90d, 6m.
Quando o usuário disser "esse mês" e o mês ainda não acabou, o período vai do dia 1 até ontem.
```

Verificar também se os connectors (Shopify, GA4, Google Ads, Meta Ads) usam essa mesma lógica ao montar as datas das queries. Se algum connector monta a data internamente, ajustar pra usar `ontem` como data final.

---

## Melhoria 2: Respostas de Confirmação Mais Curtas

### Problema
Antes de executar, o agente faz perguntas de confirmação muito longas e confusas. Precisa ser curto e direto.

### No system prompt, substituir o bloco de protocolo de confirmação por:

```
## Protocolo de Confirmação (CURTO E DIRETO)

Antes de executar, confirme em formato compacto:

📋 **Confirma?**
- Período: [X] a [Y]
- Fontes: [Shopify + GA4 + Meta]
- Filtro: [se houver]
- Formato: Top [N] por [métrica]

✅ Confirma ou quer ajustar?

NÃO adicione explicações sobre o que cada fonte mede.
NÃO explique por que escolheu determinada fonte.
NÃO liste métricas que vai buscar em cada plataforma.
Seja SUCINTO. Máximo 5 linhas na confirmação.
```

### Para o Racional Técnico (Passo 5.5 do V2):

Manter, mas encurtar:

```
📋 **Racional**
- Pergunta: [resumo curto]
- Fontes: [X, Y, Z]
- Método: [1 frase]
- ⚠️ [armadilha relevante, se houver — senão omitir]

Confirma?
```

Máximo 4-5 linhas. Sem parágrafos explicativos.

---

## Melhoria 3: Sem Itens Adicionais Não Solicitados

### Problema
O agente está incluindo conclusões, insights extras e contexto adicional que não foram pedidos. Isso consome tokens e confunde.

### No system prompt, adicionar regra:

```
## Regra de Escopo da Resposta

Responda APENAS o que foi perguntado. Não adicione:
- Contexto histórico que não foi solicitado
- Comparações com períodos anteriores (a menos que pedido)
- Sugestões de ação (a menos que pedido)
- Insights adicionais além do solicitado

Se houver insights relevantes que valem a pena compartilhar, NÃO inclua no relatório.
Em vez disso, pergunte no final:
"Quer que o Especialista em Marketing gere uma Análise Detalhada deste relatório?"

O relatório deve conter: dados solicitados + tabela + insight CURTO (1-2 frases). Nada mais.
```

---

## Melhoria 4: Desconsiderar UTMs

### Problema
UTMs estão configuradas apenas para CRM (email e WhatsApp). Para Meta e Google estão bagunçadas e geram dados incorretos.

### No system prompt, adicionar regra:

```
## Regra de UTMs

NUNCA usar UTMs (utm_source, utm_medium, utm_campaign) para atribuição de canal de mídia paga.
UTMs nesta loja são confiáveis APENAS para canais de CRM: email e WhatsApp.
Para Meta e Google Ads, UTMs estão inconsistentes — IGNORAR.

Para identificar origem do tráfego de mídia paga:
- Meta Ads → usar API do Meta Ads diretamente (campaign_name, adset_name, ad_name)
- Google Ads → usar API do Google Ads diretamente (campaign.name)
- GA4 → NÃO usar sessionCampaignName pra atribuir a Meta/Google (dados poluídos)

Se o usuário pedir "por canal" ou "por fonte":
- Usar dados de cada plataforma de ads separadamente
- NÃO cruzar com utm_source do GA4
```

Também atualizar o `docs/KNOWN-TRAPS.md` adicionando:

```
## 11. UTMs — Só Confiáveis para CRM

UTMs da Charme do Detalhe são configuradas APENAS para email e WhatsApp.
Para Meta Ads e Google Ads, UTMs estão inconsistentes.
NUNCA usar utm_source/utm_medium/utm_campaign do GA4 para atribuir tráfego de mídia paga.
Usar APIs de cada plataforma diretamente.
```

---

## Melhoria 5: Branding — Cores e Identidade Visual

### Paleta de cores

```
Cor primária (header, botões, destaques): #553679
Cor background: #F8F5FC (lilás bem clarinho, mesma paleta)
Cor background cards/chat bubbles assistant: #F0EBF5
Cor texto principal: #1A1A2E
Cor texto secundário: #6B7280
Cor borda/divisor: #E5DFF0
Cor accent/hover: #6B44A0
Cor user bubble: #553679 (texto branco)
```

### Aplicar em:

1. **Layout geral:** background `#F8F5FC`
2. **Header:** background `#553679`, texto branco
3. **Botões primários:** background `#553679`, hover `#6B44A0`
4. **Cards da Home:** borda `#E5DFF0`, hover com sombra sutil
5. **Chat bubbles:**
   - Usuário: background `#553679`, texto branco
   - Assistant: background `#F0EBF5`, texto `#1A1A2E`
6. **Login:** botão `#553679`, fundo `#F8F5FC`
7. **Tabelas:** header `#553679` com texto branco, zebra striping com `#F8F5FC`
8. **Loading indicator:** cor `#553679`
9. **Links/ações:** cor `#553679`
10. **Dashboard de Criativos:** mesma paleta

### Implementação técnica:

Definir CSS variables no `globals.css` ou `tailwind.config.ts`:

```css
:root {
  --color-primary: #553679;
  --color-primary-hover: #6B44A0;
  --color-bg: #F8F5FC;
  --color-bg-card: #F0EBF5;
  --color-text: #1A1A2E;
  --color-text-secondary: #6B7280;
  --color-border: #E5DFF0;
}
```

Ou via Tailwind config, estendendo as cores.

---

## Melhoria 6: Logo

### Implementação:

1. O usuário vai colocar o logo quadrado em `public/logo.png` (ou .svg)
2. Usar o logo nos seguintes locais:
   - **Tela de login:** logo acima do título "Charme Analytics"
   - **Header:** logo pequeno (32x32) ao lado do nome "Charme Analytics"
   - **Tela Home:** logo acima dos cards
   - **Favicon:** configurar em `src/app/layout.tsx` ou `next.config.ts`
3. Se o arquivo `public/logo.png` não existir, usar fallback texto "Charme Analytics"
4. Tamanhos:
   - Login: 80x80px
   - Header: 32x32px
   - Home: 64x64px
   - Favicon: 32x32px

---

## Melhoria 7: Fonte Geist

### Implementação:

1. Instalar fonte Geist:
   ```bash
   npm install geist
   ```

2. No `src/app/layout.tsx`, importar e aplicar:
   ```typescript
   import { GeistSans } from 'geist/font/sans';
   import { GeistMono } from 'geist/font/mono';

   // No <html> ou <body>:
   <body className={GeistSans.className}>
   ```

3. Para código/dados numéricos em tabelas: usar `GeistMono` (monospaced, mais legível pra números)

4. Remover qualquer font-family anterior (Arial, system-ui, etc)

5. Aplicar em TODO o app (login, home, chat, dashboard de criativos)

---

## Ordem de implementação

1. Fix de data (Melhoria 1)
2. System prompt: confirmação curta + escopo de resposta + UTMs (Melhorias 2, 3, 4)
3. Branding: cores + logo + fonte (Melhorias 5, 6, 7)
4. Atualizar KNOWN-TRAPS.md com regra de UTMs

Após implementar, me mostre:
- System prompt final atualizado
- Screenshot ou confirmação visual das cores aplicadas
- Fonte Geist carregando corretamente

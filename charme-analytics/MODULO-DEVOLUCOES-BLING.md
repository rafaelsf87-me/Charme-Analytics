# MODULO-DEVOLUCOES-BLING.md — Spec de Implementação (API v3) — FINAL
> Para o Claude Code executar. Leia INTEIRO antes de começar.
> Data: 08/04/2026

---

## Contexto

Submódulo **"Análise Devoluções Bling"** dentro do módulo existente "Análise de Avaliações".
A tela `/avaliacoes` agora vira um seletor com 2 opções:
1. **Análise Avaliações Negativas** (já implementado — NÃO alterar)
2. **Análise Devoluções Bling** (NOVO — este doc)

**Objetivo:** Consultar a API Bling v3 (OAuth2), buscar pedidos por período, classificar pelo status atual, extrair itens (SKU + quantidade), calcular taxa de devolução e taxa de cancelamento por SKU.

**Uso:** ~1x por mês. Volume estimado: 1.000-5.000 pedidos por consulta.

---

## Stack e Restrições

- Mesma stack do projeto (Next.js 16, TypeScript, Tailwind, shadcn/ui, Geist)
- Cores Charme: `#553679` primária, `#F8F5FC` background
- **Vercel Hobby** = 60s timeout por function → orquestração por batches obrigatória
- **Bling API v3** — OAuth 2.0, base URL: `https://www.bling.com.br/Api/v3/`
- Rate limit Bling: **3 requisições por segundo**, 120k/dia
- Paginação: 100 registros por página por padrão

---

## Autenticação Bling v3 (OAuth2)

### Tokens

| Token | Validade | Uso |
|---|---|---|
| `access_token` | **6 horas** | Header `Authorization: Bearer {token}` em cada request |
| `refresh_token` | **30 dias** | Usado para gerar novo `access_token` quando expira |

### Fluxo de setup (1ª vez — manual pelo Rafael)

1. Criar aplicativo no Bling: Central de Extensões → Cadastro de aplicativos
2. Preencher: nome, URL de redirecionamento: `https://charme-analytics.vercel.app/api/avaliacoes/devolucoes/callback`
3. Escopos necessários: **Pedidos de Venda** (leitura)
4. Anotar: `client_id` e `client_secret`
5. Autorizar o app → recebe `authorization_code` via redirect
6. Trocar code por tokens → salvar `access_token` e `refresh_token` no `.env.local`

### Auto-refresh de tokens

**CRÍTICO:** O `access_token` expira a cada 6h. O sistema DEVE renovar automaticamente.

```typescript
// src/lib/bling-auth.ts

interface BlingTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // timestamp
}

// Cache em memória (serverless — reinicia a cada cold start)
let cachedTokens: BlingTokens | null = null;

async function getBlingAccessToken(): Promise<string> {
  // Se tem token em cache e não expirou (com 5min de margem)
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - 300_000) {
    return cachedTokens.accessToken;
  }
  
  // Renovar usando refresh_token
  const refreshToken = cachedTokens?.refreshToken || process.env.BLING_REFRESH_TOKEN!;
  const clientId = process.env.BLING_CLIENT_ID!;
  const clientSecret = process.env.BLING_CLIENT_SECRET!;
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  
  if (!res.ok) {
    throw new Error(`Bling token refresh failed: ${res.status} ${await res.text()}`);
  }
  
  const data = await res.json();
  
  cachedTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // Bling retorna novo refresh_token
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  
  return cachedTokens.accessToken;
}

// Helper para fazer requests autenticados
async function blingFetch(path: string): Promise<any> {
  const token = await getBlingAccessToken();
  const res = await fetch(`https://www.bling.com.br/Api/v3${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  
  if (res.status === 401) {
    // Token expirou — forçar refresh e retry
    cachedTokens = null;
    const newToken = await getBlingAccessToken();
    const retry = await fetch(`https://www.bling.com.br/Api/v3${path}`, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Accept': 'application/json',
      },
    });
    return retry.json();
  }
  
  return res.json();
}
```

### Variáveis de Ambiente

```env
BLING_CLIENT_ID=seu_client_id
BLING_CLIENT_SECRET=seu_client_secret
BLING_ACCESS_TOKEN=token_inicial_gerado_no_setup
BLING_REFRESH_TOKEN=refresh_token_inicial_gerado_no_setup
```

**Nota sobre cold starts:** Após o primeiro refresh automático, os tokens ficam em memória. Se o serverless reiniciar, volta aos valores do `.env.local`. Funciona se o `refresh_token` no `.env.local` não expirar (30 dias). O Rafael precisa re-autorizar a cada ~30 dias se não usar.

---

## Regras de Negócio

### Status dos pedidos

| Status | Classificação | Tratamento |
|---|---|---|
| `Verificado` | ✅ Venda concluída | Conta como vendido com sucesso |
| `Devolução` | 📦 Devolvido | Foi venda → depois devolveu. Conta no total vendido E no total devolvido |
| `Cancelado` | ❌ Cancelado | Foi venda → depois cancelou. Conta no total vendido E no total cancelado |
| `Em troca` | ⏭️ Desconsiderar | Gera novo pedido, lógica complexa. Ignorar nesta versão |

### Comportamento dos pedidos no Bling

Quando um pedido é devolvido ou cancelado, o **mesmo pedido** muda de status mantendo a data de emissão original. Não é criado pedido novo (exceto "Em troca" que gera novo pedido — por isso desconsiderado).

### Lógica de cálculo (CORRETA)

```
Total vendido no período = Verificado + Devolução + Cancelado
  (todos foram vendas — o status atual indica o desfecho)

Taxa devolução por SKU = (qtd itens devolvidos ÷ qtd itens total vendido) × 100

Taxa cancelamento por SKU = (qtd itens cancelados ÷ qtd itens total vendido) × 100
```

**Por que somar tudo como "vendido":** Um pedido devolvido foi uma venda que depois voltou. Ele deve estar no denominador. Se contássemos só "Verificado" como total, a taxa seria inflada pois o denominador excluiria justamente os pedidos problemáticos.

### Aviso sobre lag temporal

Pedidos vendidos nos últimos 7-30 dias do período podem ainda não ter sido devolvidos/cancelados (o processo leva dias). Isso significa que a taxa dos últimos dias é artificialmente baixa.

**Solução na UI:** aviso fixo abaixo do date picker:
```
⚠️ Pedidos dos últimos 30 dias do período podem não ter tido tempo suficiente para devolução/cancelamento. 
Para maior precisão, analise períodos encerrados há pelo menos 30 dias.
```

### Filtro "Em troca"

Pedidos com status "Em troca" são **completamente ignorados** — não entram no total vendido, nem no devolvido, nem no cancelado. Serão tratados em versão futura se necessário.

### Consolidação por SKU

- Agrupar por **SKU único** (campo `codigo` do item)
- Ignorar canal de venda (Shopee, ML, loja própria — tudo junto)
- Ocultar SKUs com menos de 5 vendas totais (evitar ruído)

---

## Endpoints Bling v3

### Listar situações (para pegar IDs)

```
GET /situacoes/modulos/{idModulo}
```

Buscar IDs de: "Verificado", "Devolução", "Cancelado" (e "Em troca" para filtrar/excluir).

### Listar pedidos de venda

```
GET /pedidos/vendas?pagina=1&limite=100&dataInicial=2026-01-01&dataFinal=2026-03-31
```

**IMPORTANTE:** Buscar TODOS os pedidos do período **sem filtro de situação**. A classificação por status é feita depois. Isso garante que o denominador (total vendido) inclua todos os desfechos.

Depois, no backend, classificar cada pedido pelo seu `idSituacao`:
- Se idSituacao == ID do "Verificado" → vendido
- Se idSituacao == ID do "Devolução" → devolvido
- Se idSituacao == ID do "Cancelado" → cancelado
- Se idSituacao == ID do "Em troca" → descartar

### Detalhe do pedido (com itens)

```
GET /pedidos/vendas/{id}
```

Retorna pedido completo com array `itens`: `codigo`, `descricao`, `quantidade`.

---

## Arquitetura: Orquestração por Batches

Vercel Hobby = 60s timeout. Orquestração em 3 fases pelo frontend.

### Fase 1 — Listar e Classificar Pedidos (1 request, ~5-20s)

```
POST /api/avaliacoes/devolucoes/listar
Body: { dateFrom: "2026-01-01", dateTo: "2026-03-31" }
```

Backend:
1. Buscar IDs das situações via API de situações (cachear em memória)
2. Buscar TODOS os pedidos do período, paginando (`/pedidos/vendas?dataInicial=...&dataFinal=...&pagina=N&limite=100`)
3. Classificar cada pedido pelo `idSituacao`:
   - Verificado → grupo `vendidos`
   - Devolução → grupo `devolvidos`
   - Cancelado → grupo `cancelados`
   - Em troca → descartar
4. Retornar IDs agrupados

```json
{
  "vendidos": [123456, 123457, ...],
  "devolvidos": [123500, 123501, ...],
  "cancelados": [123600, 123601, ...],
  "descartados": 12,
  "totalVendidos": 2150,
  "totalDevolvidos": 143,
  "totalCancelados": 87
}
```

**Nota:** `totalVendidos` aqui = verificados. O total geral (denominador) = vendidos + devolvidos + cancelados. Calcular no frontend.

### Fase 2 — Buscar Itens em Batches (N requests, ~17s cada)

```
POST /api/avaliacoes/devolucoes/itens
Body: { orderIds: [123456, 123457, ...] }
```

Backend:
1. Para cada ID: `GET /pedidos/vendas/{id}`
2. Extrair itens: `{ codigo, descricao, quantidade }`
3. Rate limit: **340ms entre calls** (3/sec)
4. Se um pedido falhar (404, timeout), pular e continuar

**Batch size:** 50 pedidos por request (~17s, dentro de 60s)

**Processar os 3 grupos em sequência:** primeiro vendidos, depois devolvidos, depois cancelados. O frontend sabe qual grupo está processando e passa o `type` para identificar na agregação.

### Fase 3 — Agregação (frontend, instant)

```typescript
interface SKUResult {
  sku: string;
  name: string;
  qtdVerificado: number;    // vendido com sucesso
  qtdDevolvido: number;     // vendido → devolvido
  qtdCancelado: number;     // vendido → cancelado
  qtdTotalVendido: number;  // verificado + devolvido + cancelado
  taxaDevolucao: number;    // (devolvido / totalVendido) * 100
  taxaCancelamento: number; // (cancelado / totalVendido) * 100
}

function aggregateBySKU(
  vendidosItems: Item[], 
  devolvidosItems: Item[], 
  canceladosItems: Item[]
): SKUResult[] {
  const map = new Map<string, SKUResult>();
  
  // Acumular itens de cada grupo
  for (const item of vendidosItems) {
    const r = getOrCreate(map, item);
    r.qtdVerificado += item.qty;
  }
  for (const item of devolvidosItems) {
    const r = getOrCreate(map, item);
    r.qtdDevolvido += item.qty;
  }
  for (const item of canceladosItems) {
    const r = getOrCreate(map, item);
    r.qtdCancelado += item.qty;
  }
  
  // Calcular totais e taxas
  return Array.from(map.values())
    .map(r => {
      r.qtdTotalVendido = r.qtdVerificado + r.qtdDevolvido + r.qtdCancelado;
      r.taxaDevolucao = r.qtdTotalVendido > 0 ? (r.qtdDevolvido / r.qtdTotalVendido) * 100 : 0;
      r.taxaCancelamento = r.qtdTotalVendido > 0 ? (r.qtdCancelado / r.qtdTotalVendido) * 100 : 0;
      return r;
    })
    .filter(r => r.qtdTotalVendido >= 5) // Ocultar SKUs com < 5 vendas
    .sort((a, b) => b.taxaDevolucao - a.taxaDevolucao);
}
```

---

## Estrutura de Arquivos (CRIAR)

```
src/
├── app/
│   ├── avaliacoes/
│   │   ├── page.tsx                          # EDITAR: seletor com 2 opções
│   │   └── devolucoes/
│   │       └── page.tsx                      # Página de devoluções
│   └── api/
│       └── avaliacoes/
│           └── devolucoes/
│               ├── listar/route.ts           # Fase 1: lista e classifica pedidos
│               ├── itens/route.ts            # Fase 2: busca itens de batch
│               └── callback/route.ts         # OAuth callback (setup inicial)
├── components/
│   └── avaliacoes/
│       ├── devolucoes-form.tsx               # Date picker + aviso lag + botão
│       ├── devolucoes-progress.tsx           # Barra de progresso (3 grupos)
│       └── devolucoes-results.tsx            # Tabela + filtros + export
├── lib/
│   └── bling-auth.ts                         # OAuth2 helper
```

---

## OAuth Callback Route

```typescript
// src/app/api/avaliacoes/devolucoes/callback/route.ts

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  
  if (!code) {
    return new Response('Missing code', { status: 400 });
  }
  
  const clientId = process.env.BLING_CLIENT_ID!;
  const clientSecret = process.env.BLING_CLIENT_SECRET!;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
    }),
  });
  
  const data = await res.json();
  
  return new Response(`
    <html><body style="font-family: monospace; padding: 40px;">
      <h2>Tokens Bling gerados com sucesso!</h2>
      <p>Copie e cole no .env.local:</p>
      <pre>
BLING_ACCESS_TOKEN=${data.access_token}
BLING_REFRESH_TOKEN=${data.refresh_token}
      </pre>
      <p>Access token expira em: ${data.expires_in} segundos</p>
      <p>Após colar no .env.local, faça redeploy na Vercel.</p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } });
}
```

---

## Tela: /avaliacoes (seletor)

2 cards lado a lado:
- Card 1: 📝 Avaliações Negativas (Judge.me) → mostra interface de upload existente
- Card 2: 📦 Devoluções & Cancelamentos (Bling) → navega para `/avaliacoes/devolucoes`

---

## Tela: /avaliacoes/devolucoes

### Estado inicial

```
┌──────────────────────────────────────────────────────┐
│  ← Voltar                                            │
│                                                      │
│  📦 Análise de Devoluções & Cancelamentos — Bling     │
│                                                      │
│  Selecione o período de análise:                     │
│                                                      │
│  De: [📅 dd/mm/aa]    Até: [📅 dd/mm/aa]             │
│                                                      │
│  ⚠️ Pedidos dos últimos 30 dias do período podem      │
│  não ter tido tempo para devolução/cancelamento.     │
│  Para maior precisão, use períodos encerrados há     │
│  pelo menos 30 dias.                                 │
│                                                      │
│  Períodos longos podem levar vários minutos.         │
│  Recomendado: até 90 dias.                           │
│                                                      │
│              [Analisar]                              │
└──────────────────────────────────────────────────────┘
```

- Calendário abre **para cima**
- Data máxima = ontem
- Botão desabilitado até ambas as datas preenchidas

### Durante processamento

```
┌──────────────────────────────────────────────────────┐
│  Analisando...                                       │
│                                                      │
│  Fase 1: Listando pedidos...                  ✅     │
│  📊 2.150 verificados | 143 devolvidos | 87 cancelados│
│  (12 pedidos "Em troca" desconsiderados)             │
│                                                      │
│  Fase 2: Buscando itens...                           │
│  ████████████████░░░░░░░░░░  Batch 15 de 48          │
│  750 de 2.380 pedidos processados                    │
│                                                      │
│  ⏱️ ~3 minutos restantes                              │
│                                                      │
│              [Cancelar]                              │
└──────────────────────────────────────────────────────┘
```

### Resultados

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📦 Devoluções & Cancelamentos — 01/jan'26 a 31/mar'26                       │
│  2.380 pedidos analisados | 143 devolvidos (6,0%) | 87 cancelados (3,7%)     │
│                                                                              │
│  Ordenar: [Taxa Devolução ▼] [Taxa Cancelamento] [Total Vendido]             │
│  Buscar: [________________________]  [Exportar XLSX]                         │
│                                                                              │
│ │     │                      │ Total  │       │ Taxa  │        │ Taxa   │    │
│ │ SKU │ Produto              │Vendido │Devol. │Devol. │Cancel. │Cancel. │    │
│ │─────│──────────────────────│────────│───────│───────│────────│────────│    │
│ │🔴   │ Capa Cadeira Boho    │   340  │  28   │ 8,2%  │   5    │ 1,5%   │    │
│ │🔴   │ Capa Sofá Elastex    │   120  │   9   │ 7,5%  │   3    │ 2,5%   │    │
│ │🟡   │ Capa Cadeira Florata │   580  │  23   │ 4,0%  │  12    │ 2,1%   │    │
│ │🟢   │ Capa Cadeira Modern  │   890  │  12   │ 1,3%  │   4    │ 0,4%   │    │
│ │🟢   │ Capa Sofá Protex     │   210  │   1   │ 0,5%  │   0    │ 0,0%   │    │
│                                                                              │
│  🔴 Devolução > 5%  🟡 3-5%  🟢 < 3%                                        │
│  Ocultos: SKUs com < 5 vendas totais                                        │
│  ⚠️ Últimos 30 dias do período podem ter taxas subestimadas                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Colunas da tabela:**

| SKU | Produto | Total Vendido | Devol. | Taxa Devol. (%) | Cancel. | Taxa Cancel. (%) |
|---|---|---|---|---|---|---|

- **Total Vendido** = verificado + devolvido + cancelado daquele SKU
- Ordenação padrão: Taxa Devolução (desc)
- Indicadores 🔴🟡🟢: baseados na **taxa de devolução** (coluna principal)
- Busca local por SKU ou nome
- Export XLSX com todas as colunas

### KPIs no topo dos resultados

Antes da tabela, mostrar resumo geral:

```
📊 Resumo do período:
• Total pedidos: 2.380 (excl. 12 "Em troca")
• Verificados: 2.150 (90,3%)
• Devolvidos: 143 (6,0%)
• Cancelados: 87 (3,7%)
```

---

## Regras para o Claude Code

1. **NÃO alterar** nenhum arquivo existente além de `avaliacoes/page.tsx`, `.env.example`
2. **NÃO alterar** componentes existentes de avaliações (upload-form, produto-card, etc.)
3. **NÃO alterar** home, chat, criativos, auth, proxy, tools, claude.ts
4. **Manter** cores Charme, fonte Geist, responsividade
5. **Rate limit obrigatório:** 340ms delay entre requests ao Bling (3/sec)
6. **Batch size:** 50 pedidos por request ao endpoint /itens
7. **Filtro mínimo:** ocultar SKUs com < 5 vendas totais
8. **Calendário** abre para CIMA
9. **Retry:** se pedido individual falhar, pular e continuar
10. `bling-auth.ts` é arquivo NOVO em `src/lib/` — não conflita com nada existente
11. Auto-refresh de token DEVE funcionar (401 → refresh → retry)
12. Preservar 100% da funcionalidade existente de avaliações ao editar `avaliacoes/page.tsx`
13. Verificar se `proxy.ts` já cobre `/avaliacoes/devolucoes`
14. **Fase 1 busca TODOS os pedidos do período SEM filtro de status** — classificação por `idSituacao` é feita no backend após receber
15. **"Em troca" é descartado silenciosamente** — não entra em nenhum cálculo, só mostra quantidade descartada no resumo
16. **2 taxas separadas** — nunca combinar devolução + cancelamento numa métrica única

---

## Setup do Rafael (após implementação)

1. **No Bling:** Central de Extensões → Cadastro de aplicativos → "Criar aplicativo"
2. **Nome:** "Charme Analytics"
3. **URL de redirecionamento:** `https://charme-analytics.vercel.app/api/avaliacoes/devolucoes/callback`
4. **Escopos:** "Pedidos de Venda" (leitura)
5. **Salvar** → anotar `client_id` e `client_secret`
6. **No `.env.local`:** preencher `BLING_CLIENT_ID` e `BLING_CLIENT_SECRET`
7. **Deploy na Vercel** (push)
8. **No Bling:** abrir o "Link de convite" do app → autorizar
9. Redirect para `/api/avaliacoes/devolucoes/callback` → exibe tokens
10. **Copiar** `BLING_ACCESS_TOKEN` e `BLING_REFRESH_TOKEN` para `.env.local`
11. **Redeploy** na Vercel
12. Pronto — sistema auto-renova token a cada 6h

**Re-autorização:** Se não usar por 30+ dias, repetir passos 8-11.

---

## Estimativa de Tempo por Volume

| Pedidos no período | Batches (50/batch) | Tempo estimado |
|---|---|---|
| 500 | 10 | ~3 min |
| 1.000 | 20 | ~6 min |
| 2.000 | 40 | ~12 min |
| 3.000 | 60 | ~18 min |

---

## Comando para Claude Code

```
ANTES DE QUALQUER CÓDIGO, leia estes arquivos na ordem:
1. CLAUDE.md
2. MODULO-DEVOLUCOES-BLING.md (este arquivo)

Checklist de segurança:
- Liste TODOS os arquivos que pretende CRIAR e EDITAR
- Se EDITAR tiver algo além de avaliacoes/page.tsx e .env.example, PARE e me explique
- Ao transformar avaliacoes/page.tsx em seletor, preserve 100% da funcionalidade existente

Pontos críticos de lógica:
- Fase 1 busca TODOS os pedidos do período SEM filtro de status, classifica pelo idSituacao no backend
- Total vendido de cada SKU = verificado + devolvido + cancelado (NÃO só verificado)
- "Em troca" é descartado — não entra em nenhum cálculo
- 2 taxas separadas por SKU: devolução e cancelamento
- Indicadores 🔴🟡🟢 baseados na taxa de DEVOLUÇÃO

Implemente na ordem:
1. Criar src/lib/bling-auth.ts (OAuth2 helper com auto-refresh)
2. Criar API routes (callback, listar, itens) em src/app/api/avaliacoes/devolucoes/
3. Criar componentes (devolucoes-form, devolucoes-progress, devolucoes-results)
4. Criar página src/app/avaliacoes/devolucoes/page.tsx
5. Editar avaliacoes/page.tsx para virar seletor com 2 opções
6. Atualizar .env.example com BLING_CLIENT_ID, BLING_CLIENT_SECRET, BLING_ACCESS_TOKEN, BLING_REFRESH_TOKEN

Após implementar, rode npm run build e confirme compilação sem erros.
```

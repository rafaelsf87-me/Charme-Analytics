# Charme Analytics

Central de dados da Charme do Detalhe. Interface de chat que cruza dados de Shopify, GA4, Google Ads e Meta Ads.

## Quick Start

### Pré-requisitos
- Node.js 20+
- Conta Anthropic (API key) — https://console.anthropic.com
- Claude Code instalado — `npm install -g @anthropic-ai/claude-code`
- VS Code

### Como usar este projeto

1. **Abra esta pasta no VS Code**

2. **Abra o terminal integrado e inicie o Claude Code:**
   ```bash
   claude
   ```

3. **Claude Code vai ler o `CLAUDE.md` automaticamente e saberá o que fazer.**

4. **Peça pra ele construir módulo por módulo:**
   ```
   Leia todos os arquivos em docs/ e comece pelo Módulo 0 do BUILD-PLAN.md
   ```

5. **Após o Módulo 0, siga a sequência:**
   ```
   Construa o Módulo 1 (Autenticação)
   ```
   ```
   Construa o Módulo 2 (Interface de Chat)
   ```
   E assim por diante até o Módulo 9.

6. **Após todos os módulos, configure as variáveis de ambiente:**
   - Copie `.env.example` para `.env.local`
   - Preencha todas as chaves (consulte `docs/API-SPECS.md` pra instruções de cada uma)

7. **Rode o projeto:**
   ```bash
   npm run dev
   ```

8. **Deploy:**
   - Push pro GitHub
   - Conecte à Vercel
   - Configure env vars na Vercel

## Estrutura

```
docs/
├── ARCHITECTURE.md    → Diagrama, stack, decisões técnicas
├── SYSTEM-PROMPT.md   → Cérebro do agente (system prompt da Claude API)
├── BUILD-PLAN.md      → 10 módulos de construção em ordem
├── API-SPECS.md       → Specs de Shopify, GA4, Google Ads, Meta Ads
└── ADDENDUM.md        → Performance (parallelismo), tokens, filtros de produto
```

## Custo estimado
- ~R$0,02-0,08 por pergunta (Claude Sonnet com pré-processamento de tokens)
- Vercel: free tier cobre uso do time facilmente

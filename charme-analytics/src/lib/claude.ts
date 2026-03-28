import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from './system-prompt';
import { toolDefinitions, executeTool } from './tools/index';
import { PROGRESS_PREFIX } from './stream-protocol';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

// Mapa de tool name → label legível para o loading indicator
const TOOL_PLATFORM_LABEL: Record<string, string> = {
  shopify_get_orders: 'Shopify',
  shopify_get_top_customers: 'Shopify',
  shopify_get_top_products: 'Shopify',
  shopify_get_products: 'Shopify',
  ga4_run_report: 'GA4',
  ga4_get_top_pages: 'GA4',
  ga4_get_item_report: 'GA4',
  google_ads_campaign_report: 'Google Ads',
  google_ads_search_query: 'Google Ads',
  meta_ads_campaign_insights: 'Meta Ads',
  meta_ads_creative_insights: 'Meta Ads',
  yampi_get_orders: 'Yampi Legacy',
  yampi_get_top_customers: 'Yampi Legacy',
  yampi_search_products: 'Yampi Legacy',
  web_search: 'Web',
};

// ─── Grupos de tools por plataforma ──────────────────────────────────────────

const SHOPIFY_TOOLS = toolDefinitions.filter(t => t.name.startsWith('shopify_'));
const GA4_TOOLS     = toolDefinitions.filter(t => t.name.startsWith('ga4_'));
const GADS_TOOLS    = toolDefinitions.filter(t => t.name.startsWith('google_ads_'));
const META_TOOLS    = toolDefinitions.filter(t => t.name.startsWith('meta_ads_'));
const YAMPI_TOOLS   = toolDefinitions.filter(t => t.name.startsWith('yampi_'));

const WEB_SEARCH_TOOL: Anthropic.Tool[] = [
  { type: 'web_search_20250305', name: 'web_search' } as unknown as Anthropic.Tool,
];

function match(msg: string, keywords: string[]): boolean {
  return keywords.some(k => msg.includes(k));
}

function selectTools(messages: Anthropic.MessageParam[]): Anthropic.Tool[] {
  // Extrai o conteúdo da última mensagem do usuário
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const raw = typeof lastUser?.content === 'string'
    ? lastUser.content
    : (lastUser?.content as Anthropic.ContentBlock[] | undefined)
        ?.filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join(' ') ?? '';
  const msg = raw.toLowerCase();

  const selected: Anthropic.Tool[] = [];

  // Guardrail: ATC/views/checkout são comportamento de site → GA4 APENAS, nunca Shopify
  const isBehaviorQuery = match(msg, ['atc', 'add to cart', 'views', 'view', 'pageview', 'sessão', 'sessões', 'bounce', 'tempo na página', 'comportamento', 'engajamento', 'navegação', 'checkout', 'taxa checkout', 'taxa de checkout', 'taxa payment', 'payment']);

  // GA4 — comportamento no site, métricas de funil por produto
  if (isBehaviorQuery || match(msg, ['tráfego', 'analytics', 'ga4', 'funil', 'carrinho', 'página', 'orgânico', 'canal', 'fonte', 'conversão do site', 'taxa de conversão'])) {
    selected.push(...GA4_TOOLS);
  }

  // Shopify — vendas, pedidos, receita, produtos mais vendidos (SÓ se não for query de comportamento)
  if (!isBehaviorQuery && match(msg, ['cliente', 'pedido', 'receita', 'faturamento', 'vend', 'ticket', 'compra', 'recompra', 'ltv', 'shopify', 'produto mais vendido', 'top produto', 'quantidade vendida', 'unidades vendidas'])) {
    selected.push(...SHOPIFY_TOOLS);
  }

  // Yampi — dados históricos pré-Shopify
  if (match(msg, ['históric', 'yampi', '2023', '2024', 'todos os tempos', 'antes', 'migração', 'antigo'])) {
    selected.push(...YAMPI_TOOLS);
  }

  // Google Ads — mídia paga Google
  if (match(msg, ['google ads', 'google ad', 'keyword', 'pmax', 'demand gen', 'display', 'shopping', 'gaql', 'roas google', 'cpa google'])) {
    selected.push(...GADS_TOOLS);
  }

  // Meta Ads — mídia paga Meta/Facebook/Instagram
  if (match(msg, ['meta', 'facebook', 'instagram', 'criativo', 'adset', 'anúncio', 'roas meta', 'cpa meta'])) {
    selected.push(...META_TOOLS);
  }

  // Web search — concorrência e mercado
  if (match(msg, ['concorrente', 'mercado', 'benchmark', 'preço relativo', 'tendência', 'google trends', 'casa das capas', 'ok darling'])) {
    selected.push(...WEB_SEARCH_TOOL);
  }

  // ROAS/CPA genérico → ambas as plataformas de ads + Shopify para validar
  if (match(msg, ['roas', 'cpa', 'cpm', 'ctr de ads', 'performance de mídia'])) {
    selected.push(...GADS_TOOLS, ...META_TOOLS, ...SHOPIFY_TOOLS);
  }

  // Fallback: nenhum match claro → envia todas as tools analíticas
  if (selected.length === 0) {
    return toolDefinitions as Anthropic.Tool[];
  }

  // Deduplica mantendo ordem
  const seen = new Set<string>();
  return selected.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

function progressMarker(payload: object): Uint8Array {
  return new TextEncoder().encode(
    PROGRESS_PREFIX + JSON.stringify(payload) + '\n'
  );
}

/**
 * Cria um ReadableStream com a resposta do Claude.
 * Emite marcadores de progresso por plataforma antes de cada rodada de tools.
 * Executa o tool use loop com chamadas paralelas antes de transmitir o texto final.
 */
export function createChatStream(
  messages: Anthropic.MessageParam[]
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        let currentMessages: Anthropic.MessageParam[] = [...messages];
        const activeTools = selectTools(messages);
        const hasTools = activeTools.length > 0;

        // Tool use loop: rounds não-streaming até não haver mais tool_use
        while (hasTools) {
          const response = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: [{ type: 'text', text: getSystemPrompt(), cache_control: { type: 'ephemeral' } }],
            messages: currentMessages,
            tools: activeTools,
          });

          if (response.stop_reason !== 'tool_use') break;

          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          );

          if (toolUseBlocks.length === 0) break;

          // Emite marcadores de "iniciando" para cada plataforma envolvida
          const platforms = [...new Set(
            toolUseBlocks.map((t) => TOOL_PLATFORM_LABEL[t.name] ?? t.name)
          )];
          for (const platform of platforms) {
            controller.enqueue(progressMarker({ status: 'loading', platform }));
          }

          // Executa todas as tools em paralelo
          const toolResults = await Promise.all(
            toolUseBlocks.map(async (tool) => {
              // web_search é executada server-side pela Anthropic — não processar localmente
              if (tool.name === 'web_search') return null;

              const platform = TOOL_PLATFORM_LABEL[tool.name] ?? tool.name;
              let result: string;
              let status: 'ok' | 'error' = 'ok';

              try {
                result = await executeTool(
                  tool.name,
                  tool.input as Record<string, unknown>
                );
                // Se o resultado começa com "ERRO", classifica como erro
                if (result.startsWith('ERRO')) status = 'error';
              } catch (err) {
                result = `ERRO [${platform}]: ${(err as Error).message}`;
                status = 'error';
              }

              // Emite marcador de conclusão com status
              controller.enqueue(progressMarker({ status, platform }));

              return {
                type: 'tool_result' as const,
                tool_use_id: tool.id,
                content: result,
              };
            })
          );

          const clientToolResults = toolResults.filter(
            (r): r is NonNullable<typeof r> => r !== null
          ) as Anthropic.ToolResultBlockParam[];

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            { role: 'user' as const, content: clientToolResults },
          ];
        }

        // Sinaliza início do streaming da resposta final
        controller.enqueue(progressMarker({ status: 'assembling' }));

        // Streaming da resposta final de texto
        const stream = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: getSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: currentMessages,
          ...(hasTools ? { tools: activeTools } : {}),
          stream: true,
        });

        const encoder = new TextEncoder();
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        controller.close();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Erro desconhecido';
        // Erro crítico: emite marcador e mensagem legível
        controller.enqueue(progressMarker({ status: 'fatal', message: msg }));
        controller.close();
      }
    },
  });
}

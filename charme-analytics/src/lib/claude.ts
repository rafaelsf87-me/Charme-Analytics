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
  shopify_get_products: 'Shopify',
  ga4_run_report: 'GA4',
  ga4_get_top_pages: 'GA4',
  google_ads_campaign_report: 'Google Ads',
  google_ads_search_query: 'Google Ads',
  meta_ads_campaign_insights: 'Meta Ads',
  meta_ads_creative_insights: 'Meta Ads',
};

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
        const hasTools = toolDefinitions.length > 0;

        // Tool use loop: rounds não-streaming até não haver mais tool_use
        while (hasTools) {
          const response = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: getSystemPrompt(),
            messages: currentMessages,
            tools: toolDefinitions as Anthropic.Tool[],
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

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            { role: 'user' as const, content: toolResults },
          ];
        }

        // Sinaliza início do streaming da resposta final
        controller.enqueue(progressMarker({ status: 'assembling' }));

        // Streaming da resposta final de texto
        const stream = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: getSystemPrompt(),
          messages: currentMessages,
          ...(hasTools ? { tools: toolDefinitions as Anthropic.Tool[] } : {}),
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

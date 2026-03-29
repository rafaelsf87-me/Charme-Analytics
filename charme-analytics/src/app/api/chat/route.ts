import { createChatStream } from '@/lib/claude';
import type { Message } from '@/lib/types';
import type Anthropic from '@anthropic-ai/sdk';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.messages || !Array.isArray(body.messages)) {
    return new Response('Payload inválido', { status: 400 });
  }

  // Trunca para as últimas 40 mensagens (controle de tokens — ~20 trocas)
  const messages: Message[] = (body.messages as Message[]).slice(-40);

  // Converte para formato Anthropic
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = createChatStream(anthropicMessages);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

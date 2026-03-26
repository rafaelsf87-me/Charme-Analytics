import { createChatStream } from '@/lib/claude';
import type { Message } from '@/lib/types';
import type Anthropic from '@anthropic-ai/sdk';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.messages || !Array.isArray(body.messages)) {
    return new Response('Payload inválido', { status: 400 });
  }

  // Trunca para as últimas 10 mensagens (controle de tokens)
  const messages: Message[] = (body.messages as Message[]).slice(-10);

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

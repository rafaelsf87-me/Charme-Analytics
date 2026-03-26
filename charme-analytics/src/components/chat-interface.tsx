'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageBubble } from '@/components/message-bubble';
import { LoadingIndicator, type PlatformStatus } from '@/components/loading-indicator';
import { PROGRESS_PREFIX } from '@/lib/stream-protocol';
import type { Message } from '@/lib/types';

const SUGGESTIONS = [
  { icon: '📊', text: 'Relatório: Top 10 campanhas Meta Ads por ROAS no último mês' },
  { icon: '👥', text: 'Relatório: Top 20 clientes por receita nos últimos 3 meses' },
  { icon: '📈', text: 'Compare: taxa de conversão Google Ads vs Meta Ads este mês' },
  { icon: '🛒', text: 'Relatório: produtos com mais views e menor conversão em vendas' },
  { icon: '💰', text: 'Relatório: receita e pedidos por dia nos últimos 30 dias' },
  { icon: '🔍', text: 'Análise: funil de conversão (sessões → ATC → checkout → compra) este mês' },
];

// Protocolo de progresso — mesmo prefixo que o backend emite
const PREFIX = PROGRESS_PREFIX;

interface ProgressEvent {
  status: 'loading' | 'ok' | 'error' | 'assembling' | 'fatal';
  platform?: string;
  message?: string;
}

function parseProgress(chunk: string): { events: ProgressEvent[]; text: string } {
  const events: ProgressEvent[] = [];
  let text = '';

  const lines = chunk.split('\n');
  for (const line of lines) {
    if (line.startsWith(PREFIX)) {
      try {
        const json = line.slice(PREFIX.length);
        const event: ProgressEvent = JSON.parse(json);
        events.push(event);
      } catch { /* ignora */ }
    } else {
      text += (text || line ? line : '') + (lines.length > 1 ? '' : '');
    }
  }

  // Reconstrói o texto sem marcadores (preserva quebras de linha)
  const cleanText = chunk
    .split('\n')
    .filter((l) => !l.startsWith(PREFIX))
    .join('\n');

  return { events, text: cleanText };
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [loadingPhase, setLoadingPhase] = useState<'thinking' | 'querying' | 'assembling'>('thinking');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function updatePlatformStatus(platform: string, status: PlatformStatus['status']) {
    setPlatforms((prev) => {
      const existing = prev.find((p) => p.platform === platform);
      if (existing) {
        return prev.map((p) => p.platform === platform ? { ...p, status } : p);
      }
      return [...prev, { platform, status }];
    });
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setPlatforms([]);
    setLoadingPhase('thinking');

    try {
      const payload = updatedMessages.slice(-10);

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `Erro HTTP ${res.status}`);
        throw new Error(errText || `Erro ${res.status} ao conectar com o servidor`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let fatalMessage = '';

      if (reader) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const raw = decoder.decode(value, { stream: true });
          const { events, text: cleanText } = parseProgress(raw);

          // Processa eventos de progresso
          for (const event of events) {
            if (event.status === 'loading' && event.platform) {
              setLoadingPhase('querying');
              updatePlatformStatus(event.platform, 'loading');
            } else if ((event.status === 'ok' || event.status === 'error') && event.platform) {
              updatePlatformStatus(event.platform, event.status);
            } else if (event.status === 'assembling') {
              setLoadingPhase('assembling');
            } else if (event.status === 'fatal') {
              fatalMessage = event.message ?? 'Erro interno desconhecido';
            }
          }

          // Acumula apenas o texto limpo
          if (cleanText) {
            assistantContent += cleanText;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: assistantContent,
              };
              return updated;
            });
          }
        }

        // Se houve erro fatal (ex: API key inválida, sem créditos)
        if (fatalMessage) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              content: buildFatalErrorMessage(fatalMessage),
            };
            return updated;
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: buildNetworkErrorMessage(msg),
        },
      ]);
    } finally {
      setLoading(false);
      setPlatforms([]);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">

          {/* Sugestões iniciais */}
          {messages.length === 0 && !loading && (
            <div className="flex flex-col gap-3 mt-8">
              <p className="text-sm text-zinc-400 text-center mb-2">
                Comece com um relatório ou faça uma pergunta
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => sendMessage(s.text)}
                    className="text-left text-sm p-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors text-zinc-700 leading-snug"
                  >
                    <span className="mr-1.5">{s.icon}</span>
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mensagens */}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {/* Loading indicator */}
          {loading && (
            <LoadingIndicator platforms={platforms} phase={loadingPhase} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input fixo */}
      <div className="border-t border-zinc-100 bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Faça uma pergunta ou solicite um relatório..."
            disabled={loading}
            className="flex-1"
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Mensagens de erro formatadas ────────────────────────────────────────────

function buildFatalErrorMessage(msg: string): string {
  if (msg.includes('API key') || msg.includes('authentication') || msg.includes('401')) {
    return `**Erro de autenticação — Claude API**\n\nA chave ANTHROPIC_API_KEY está inválida ou ausente.\n\n**Mensagem:** ${msg}\n\n**Ação:** Verifique o arquivo \`.env.local\` e confirme que a chave está correta.`;
  }
  if (msg.includes('credit') || msg.includes('quota') || msg.includes('429')) {
    return `**Limite de créditos atingido — Claude API**\n\n**Mensagem:** ${msg}\n\n**Ação:** Verifique o saldo da conta Anthropic ou aguarde o reset do limite.`;
  }
  return `**Erro interno**\n\n**Mensagem:** ${msg}\n\n**Ação:** Tente novamente. Se persistir, verifique os logs do servidor.`;
}

function buildNetworkErrorMessage(msg: string): string {
  if (msg.includes('fetch') || msg.includes('network') || msg.toLowerCase().includes('failed')) {
    return `**Erro de conexão com o servidor**\n\nNão foi possível conectar à API. Verifique sua conexão de internet e tente novamente.\n\n**Detalhe:** ${msg}`;
  }
  return `**Erro ao processar sua solicitação**\n\n**Detalhe:** ${msg}\n\n**Ação:** Tente novamente ou reformule a pergunta.`;
}

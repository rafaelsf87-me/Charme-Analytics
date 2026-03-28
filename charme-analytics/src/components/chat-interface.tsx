'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MessageBubble } from '@/components/message-bubble';
import { LoadingIndicator, type PlatformStatus } from '@/components/loading-indicator';
import { PROGRESS_PREFIX } from '@/lib/stream-protocol';
import type { Message } from '@/lib/types';

const SUGGESTIONS = [
  { icon: '🛋️', text: 'Quais Top 10 Capas Sofás com Melhores e Piores ATC nos últimos 30D.' },
  { icon: '📉', text: 'Nos últimos 15D, qual categoria mais caiu em vendas vs período anterior?' },
  { icon: '🔥', text: 'Quais SKUs queimam tráfego nos últimos 7D?' },
  { icon: '💰', text: 'Qual SKU gerou mais receita nos últimos 7D?' },
  { icon: '📊', text: 'Qual o ROAS Google vs. Meta nos últimos 30D?' },
  { icon: '🚨', text: 'Qual campanha consumiu mais verba sem retorno nos últimos 30D?' },
];

const PREFIX = PROGRESS_PREFIX;

// ─── Tipos de período ────────────────────────────────────────────────────────

type PresetKey = '7D' | '30D' | '60D' | '90D' | '180D' | 'Total';

interface ComparePeriod {
  from: string; // YYYY-MM-DD
  to: string;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function presetDates(key: PresetKey): { from: string; to: string } {
  const to = yesterday();
  if (key === 'Total') return { from: '2022-01-01', to: toYMD(to) };
  const days = { '7D': 6, '30D': 29, '60D': 59, '90D': 89, '180D': 179 }[key]!;
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from: toYMD(from), to: toYMD(to) };
}

function buildMessageWithPeriod(
  text: string,
  preset: PresetKey | null,
  comparing: boolean,
  periodA: ComparePeriod,
  periodB: ComparePeriod
): string {
  if (comparing && periodA.from && periodA.to && periodB.from && periodB.to) {
    return `[COMPARAR PERÍODOS]\n[PERÍODO A: ${periodA.from} a ${periodA.to}]\n[PERÍODO B: ${periodB.from} a ${periodB.to}]\n\n${text}`;
  }
  if (preset) {
    const { from, to } = presetDates(preset);
    if (preset === 'Total') return `[PERÍODO: todo o histórico disponível, até ${to}]\n\n${text}`;
    return `[PERÍODO: ${from} a ${to} (${preset})]\n\n${text}`;
  }
  return text;
}

// ─── Progress parsing ────────────────────────────────────────────────────────

interface ProgressEvent {
  status: 'loading' | 'ok' | 'error' | 'assembling' | 'fatal';
  platform?: string;
  message?: string;
}

function parseProgress(chunk: string): { events: ProgressEvent[]; text: string } {
  const events: ProgressEvent[] = [];
  const cleanText = chunk
    .split('\n')
    .filter((l) => {
      if (l.startsWith(PREFIX)) {
        try { events.push(JSON.parse(l.slice(PREFIX.length))); } catch { /* ignore */ }
        return false;
      }
      return true;
    })
    .join('\n');
  return { events, text: cleanText };
}

// ─── Componente principal ────────────────────────────────────────────────────

const CONTEXT_LIMIT = 6; // nº de respostas do assistente antes de alertar

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [loadingPhase, setLoadingPhase] = useState<'thinking' | 'querying' | 'assembling'>('thinking');
  const [contextAlertDismissed, setContextAlertDismissed] = useState(false);

  // Período pré-selecionado
  const [preset, setPreset] = useState<PresetKey | null>(null);

  // Comparar períodos
  const [comparing, setComparing] = useState(false);
  const [periodA, setPeriodA] = useState<ComparePeriod>({ from: '', to: '' });
  const [periodB, setPeriodB] = useState<ComparePeriod>({ from: '', to: '' });

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const maxDate = toYMD(yesterday());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function updatePlatformStatus(platform: string, status: PlatformStatus['status']) {
    setPlatforms((prev) => {
      const existing = prev.find((p) => p.platform === platform);
      if (existing) return prev.map((p) => p.platform === platform ? { ...p, status } : p);
      return [...prev, { platform, status }];
    });
  }

  function autoResizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const finalText = buildMessageWithPeriod(text, preset, comparing, periodA, periodB);
    const userMessage: Message = { role: 'user', content: text.trim() }; // exibe sem o prefixo
    const updatedMessages = [...messages, { role: 'user' as const, content: finalText }];

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);
    setPlatforms([]);
    setLoadingPhase('thinking');
    setContextAlertDismissed(false); // reaparecer alerta após nova mensagem se ainda no limite

    try {
      const payload = updatedMessages.slice(-10);
      abortControllerRef.current = new AbortController();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload }),
        signal: abortControllerRef.current.signal,
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

          if (cleanText) {
            assistantContent += cleanText;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
              return updated;
            });
          }
        }

        if (fatalMessage) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: buildFatalErrorMessage(fatalMessage) };
            return updated;
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setMessages((prev) => [...prev, { role: 'assistant', content: buildNetworkErrorMessage(msg) }]);
    } finally {
      setLoading(false);
      setPlatforms([]);
      textareaRef.current?.focus();
    }
  }

  function stopAnalysis() {
    abortControllerRef.current?.abort();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function togglePreset(key: PresetKey) {
    setPreset((prev) => (prev === key ? null : key));
  }

  function toggleComparing() {
    setComparing((v) => {
      if (!v) { setPreset(null); }
      return !v;
    });
  }

  const PRESETS: PresetKey[] = ['7D', '30D', '60D', '90D', '180D', 'Total'];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">

          {messages.length === 0 && !loading && (
            <div className="flex flex-col gap-3 mt-8">
              <p className="text-base text-zinc-400 text-center mb-2">
                Comece com um relatório ou faça uma pergunta
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => sendMessage(s.text)}
                    className="text-left text-base p-3 rounded-xl border border-charme-border bg-white hover:bg-charme-card hover:border-charme/30 transition-colors text-charme-text leading-snug"
                  >
                    <span className="mr-1.5">{s.icon}</span>
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {loading && <LoadingIndicator platforms={platforms} phase={loadingPhase} />}

          {/* Alerta de contexto no limite */}
          {!loading &&
           !contextAlertDismissed &&
           messages.filter(m => m.role === 'assistant').length >= CONTEXT_LIMIT && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="text-base shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <span className="font-medium">Contexto no limite</span>
                {' — '}posso começar a alucinar.
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => sendMessage('Gere um resumo executivo em tópicos do que foi analisado nessa conversa.')}
                    className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors"
                  >
                    Resumo Final
                  </button>
                  <button
                    onClick={() => { setMessages([]); setContextAlertDismissed(false); }}
                    className="px-3 py-1 rounded-lg border border-amber-400 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                  >
                    Nova Conversa
                  </button>
                  <button
                    onClick={() => setContextAlertDismissed(true)}
                    className="px-3 py-1 rounded-lg text-amber-600 text-xs hover:text-amber-800 transition-colors"
                  >
                    Ignorar
                  </button>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input fixo */}
      <div className="border-t border-charme-border bg-white px-4 pt-3 pb-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">

          {/* Textarea + botão */}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResizeTextarea(); }}
              onKeyDown={handleKeyDown}
              placeholder="Faça uma pergunta ou solicite um relatório..."
              disabled={loading}
              rows={3}
              className="flex-1 min-h-[80px] max-h-[200px] resize-none overflow-y-auto rounded-xl border border-charme-border bg-white px-3 py-2.5 text-sm text-charme-text placeholder:text-zinc-400 focus:outline-none focus:border-charme/50 focus:ring-2 focus:ring-charme/10 disabled:opacity-50 leading-relaxed"
            />
            <div className="flex flex-col gap-1.5 shrink-0">
              {loading ? (
                <Button onClick={stopAnalysis} variant="destructive" className="h-9">
                  Parar
                </Button>
              ) : (
                <Button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="h-9 bg-charme hover:bg-charme-hover text-white"
                >
                  Enviar
                </Button>
              )}
            </div>
          </div>

          {/* Chips de período — só visível antes da primeira mensagem */}
          {messages.length === 0 && <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">Pré-selecionar período</span>
            {PRESETS.map((key) => {
              const active = preset === key && !comparing;
              const disabled = comparing;
              return (
                <button
                  key={key}
                  onClick={() => !disabled && togglePreset(key)}
                  disabled={disabled}
                  className={[
                    'px-2.5 py-0.5 rounded-full text-xs border transition-colors',
                    disabled
                      ? 'border-zinc-200 text-zinc-300 cursor-not-allowed'
                      : active
                      ? 'border-charme text-charme bg-charme-bg font-medium'
                      : 'border-zinc-300 text-zinc-500 hover:border-charme/50 hover:text-charme',
                  ].join(' ')}
                >
                  {key}
                </button>
              );
            })}
          </div>}

          {/* Toggle comparar períodos — só visível antes da primeira mensagem */}
          {messages.length === 0 &&
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                  type="checkbox"
                  checked={comparing}
                  onChange={toggleComparing}
                  className="accent-charme w-3.5 h-3.5"
                />
              <span className="text-xs text-zinc-400">Comparar períodos</span>
            </label>

            {comparing && (
              <div className="flex flex-col sm:flex-row gap-3 p-3 rounded-xl border border-charme-border bg-charme-bg">
                {/* Período A */}
                <div className="flex-1">
                  <p className="text-xs text-zinc-500 mb-1.5 font-medium">Período A</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {PRESETS.filter(k => k !== 'Total').map((key) => {
                      const { from, to } = presetDates(key);
                      const active = periodA.from === from && periodA.to === to;
                      return (
                        <button
                          key={key}
                          onClick={() => setPeriodA(active ? { from: '', to: '' } : { from, to })}
                          className={[
                            'px-2 py-0.5 rounded-full text-xs border transition-colors',
                            active
                              ? 'border-charme text-charme bg-white font-medium'
                              : 'border-zinc-300 text-zinc-500 hover:border-charme/50',
                          ].join(' ')}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={periodA.from}
                      max={periodA.to || maxDate}
                      onChange={e => setPeriodA(p => ({ ...p, from: e.target.value }))}
                      className="text-xs border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:border-charme/50 bg-white"
                    />
                    <span className="text-xs text-zinc-400">até</span>
                    <input
                      type="date"
                      value={periodA.to}
                      min={periodA.from}
                      max={maxDate}
                      onChange={e => setPeriodA(p => ({ ...p, to: e.target.value }))}
                      className="text-xs border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:border-charme/50 bg-white"
                    />
                  </div>
                </div>

                <div className="hidden sm:flex items-center text-zinc-300 text-lg">vs</div>

                {/* Período B */}
                <div className="flex-1">
                  <p className="text-xs text-zinc-500 mb-1.5 font-medium">Período B</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {PRESETS.filter(k => k !== 'Total').map((key) => {
                      const { from, to } = presetDates(key);
                      const active = periodB.from === from && periodB.to === to;
                      return (
                        <button
                          key={key}
                          onClick={() => setPeriodB(active ? { from: '', to: '' } : { from, to })}
                          className={[
                            'px-2 py-0.5 rounded-full text-xs border transition-colors',
                            active
                              ? 'border-charme text-charme bg-white font-medium'
                              : 'border-zinc-300 text-zinc-500 hover:border-charme/50',
                          ].join(' ')}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={periodB.from}
                      max={periodB.to || maxDate}
                      onChange={e => setPeriodB(p => ({ ...p, from: e.target.value }))}
                      className="text-xs border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:border-charme/50 bg-white"
                    />
                    <span className="text-xs text-zinc-400">até</span>
                    <input
                      type="date"
                      value={periodB.to}
                      min={periodB.from}
                      max={maxDate}
                      onChange={e => setPeriodB(p => ({ ...p, to: e.target.value }))}
                      className="text-xs border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:border-charme/50 bg-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>}

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

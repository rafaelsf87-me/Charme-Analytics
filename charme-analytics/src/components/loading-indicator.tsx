'use client';

import { useEffect, useState } from 'react';

export interface PlatformStatus {
  platform: string;
  status: 'loading' | 'ok' | 'error';
}

interface LoadingIndicatorProps {
  platforms?: PlatformStatus[];
  phase?: 'thinking' | 'querying' | 'assembling';
}

const STATUS_ICON: Record<string, string> = {
  loading: '⏳',
  ok: '✓',
  error: '✗',
};

const STATUS_COLOR: Record<string, string> = {
  loading: 'text-zinc-400',
  ok: 'text-green-600',
  error: 'text-red-500',
};

export function LoadingIndicator({ platforms = [], phase = 'thinking' }: LoadingIndicatorProps) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const t = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(t);
  }, []);

  const phaseLabel =
    phase === 'assembling'
      ? 'Montando relatório'
      : phase === 'querying'
      ? 'Consultando fontes'
      : 'Analisando pergunta';

  return (
    <div className="flex flex-col gap-2 py-1">
      {/* Fase atual */}
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="flex gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" />
        </span>
        <span>
          {phaseLabel}
          <span className="inline-block w-5 text-left">{dots}</span>
        </span>
      </div>

      {/* Status por plataforma */}
      {platforms.length > 0 && (
        <div className="flex flex-wrap gap-3 pl-5">
          {platforms.map((p) => (
            <span
              key={p.platform}
              className={`text-xs font-mono flex items-center gap-1 ${STATUS_COLOR[p.status]}`}
            >
              <span>{STATUS_ICON[p.status]}</span>
              <span>{p.platform}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

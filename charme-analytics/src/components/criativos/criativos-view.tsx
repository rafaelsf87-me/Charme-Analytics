'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FiltrosForm, type FiltrosState } from './filtros-form';
import { CriativosTable } from './criativos-table';
import type { CreativeRow } from '@/app/api/criativos/route';

type Mode = 'filters' | 'results';

interface ApiResponse {
  combined?: CreativeRow[];
  errors?: string[];
}

export function CriativosView() {
  const [mode, setMode] = useState<Mode>('filters');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [rows, setRows] = useState<CreativeRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [filtros, setFiltros] = useState<FiltrosState | null>(null);

  async function handleSubmit(f: FiltrosState) {
    setFiltros(f);
    setLoading(true);
    setErrors([]);

    const labels: string[] = [];
    if (f.channel === 'google' || f.channel === 'all') labels.push('Google Ads');
    if (f.channel === 'meta' || f.channel === 'all') labels.push('Meta Ads');
    setLoadingMsg(`Consultando ${labels.join(' e ')}...`);

    try {
      const res = await fetch('/api/criativos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: f.channel,
          dateFrom: f.dateFrom,
          dateTo: f.dateTo,
          campaignTypes: f.campaignTypes,
          campaignId: f.campaignId,
          limit: f.limit,
          sortBy: f.sortBy,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setErrors([err.error ?? 'Erro desconhecido']);
        setRows([]);
      } else {
        const data: ApiResponse = await res.json();
        setRows(data.combined ?? []);
        setErrors(data.errors ?? []);
      }

      setMode('results');
    } catch (err) {
      setErrors([(err as Error).message]);
      setRows([]);
      setMode('results');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-zinc-100 shrink-0">
        <div className="flex items-center gap-3">
          {mode === 'results' ? (
            <button
              onClick={() => setMode('filters')}
              className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              ← Voltar aos Filtros
            </button>
          ) : (
            <Link href="/home" className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors">
              ← Voltar
            </Link>
          )}
          <span className="text-zinc-200">|</span>
          <span className="font-semibold text-zinc-900">Relatório de Criativos</span>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 flex flex-col items-center px-6 py-10">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">{loadingMsg}</p>
          </div>
        )}

        {/* Filtros */}
        {!loading && mode === 'filters' && (
          <div className="w-full max-w-xl">
            <div className="mb-6">
              <h1 className="text-lg font-semibold text-zinc-900">Filtros</h1>
              <p className="text-sm text-zinc-500 mt-0.5">Configure os parâmetros do relatório</p>
            </div>
            <FiltrosForm onSubmit={handleSubmit} loading={loading} />
          </div>
        )}

        {/* Resultados */}
        {!loading && mode === 'results' && filtros && (
          <div className="w-full max-w-7xl">
            <CriativosTable rows={rows} filtros={filtros} errors={errors.length > 0 ? errors : undefined} />
          </div>
        )}
      </main>
    </div>
  );
}

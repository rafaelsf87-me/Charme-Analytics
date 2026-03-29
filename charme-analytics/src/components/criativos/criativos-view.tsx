'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { FiltrosForm, type FiltrosState } from './filtros-form';
import { CriativosTable } from './criativos-table';
import type { CreativeRow } from '@/app/api/criativos/route';

type Mode = 'filters' | 'results';

interface ApiResponse {
  combined?: CreativeRow[];
  errors?: string[];
}

// ─── Seletor de período inline ────────────────────────────────────────────────

function fmtShort(d: string): string {
  const parts = d.split('-');
  if (parts.length < 3) return d;
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${parseInt(parts[2])}/${months[parseInt(parts[1]) - 1]}`;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

interface PeriodEditorProps {
  filtros: FiltrosState;
  onRefresh: (dateFrom: string, dateTo: string) => void;
}

function PeriodEditor({ filtros, onRefresh }: PeriodEditorProps) {
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(filtros.dateFrom);
  const [to, setTo] = useState(filtros.dateTo);

  function handleUpdate() {
    if (!from || !to || from > to) return;
    onRefresh(from, to);
    setEditing(false);
  }

  function handleCancel() {
    setFrom(filtros.dateFrom);
    setTo(filtros.dateTo);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors group"
        title="Clique para alterar o período"
      >
        <span className="font-mono">
          {fmtShort(filtros.dateFrom)} — {fmtShort(filtros.dateTo)}
        </span>
        <span className="text-xs text-zinc-300 group-hover:text-zinc-400 transition-colors">✏️</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-white border border-zinc-200 rounded-lg shadow-sm">
      <input
        type="date"
        value={from}
        max={to}
        onChange={e => setFrom(e.target.value)}
        className="h-7 rounded border border-zinc-200 px-2 text-xs text-zinc-700 focus:outline-none focus:border-zinc-400"
      />
      <span className="text-zinc-300 text-xs">—</span>
      <input
        type="date"
        value={to}
        min={from}
        max={yesterday()}
        onChange={e => setTo(e.target.value)}
        className="h-7 rounded border border-zinc-200 px-2 text-xs text-zinc-700 focus:outline-none focus:border-zinc-400"
      />
      <button
        onClick={handleUpdate}
        disabled={!from || !to || from > to}
        className="h-7 px-3 bg-zinc-900 text-white text-xs rounded hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Atualizar
      </button>
      <button
        onClick={handleCancel}
        className="h-7 w-7 flex items-center justify-center text-zinc-400 hover:text-zinc-600 text-xs transition-colors"
        title="Cancelar"
      >
        ✕
      </button>
    </div>
  );
}

// ─── View principal ───────────────────────────────────────────────────────────

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
          sortBy: 'spend',
          adTypeFilters: f.adTypeFilters,
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

  function handlePeriodRefresh(dateFrom: string, dateTo: string) {
    if (!filtros) return;
    handleSubmit({ ...filtros, dateFrom, dateTo, periodLabel: null });
  }

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          {mode === 'results' ? (
            <button
              onClick={() => setMode('filters')}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              ← Voltar aos Filtros
            </button>
          ) : (
            <Link href="/home" className="text-sm text-white/60 hover:text-white transition-colors">
              ← Voltar
            </Link>
          )}
          <span className="text-white/30">|</span>
          <Image src="/logo.png" alt="Charme Analytics" width={28} height={28} className="rounded-md" />
          <span className="font-semibold text-white">Relatório de Criativos</span>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 flex flex-col items-center px-6 py-10">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <div className="w-8 h-8 border-2 border-charme-border border-t-charme rounded-full animate-spin" />
            <p className="text-sm text-zinc-500 animate-pulse">{loadingMsg}</p>
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
          <div className="w-full max-w-7xl flex flex-col gap-3">
            {/* Seletor de período */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Período:</span>
              <PeriodEditor
                key={filtros.dateFrom + filtros.dateTo}
                filtros={filtros}
                onRefresh={handlePeriodRefresh}
              />
            </div>
            <CriativosTable rows={rows} filtros={filtros} errors={errors.length > 0 ? errors : undefined} />
          </div>
        )}
      </main>
    </div>
  );
}

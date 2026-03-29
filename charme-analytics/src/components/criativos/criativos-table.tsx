'use client';

import { useState, useMemo } from 'react';
import type { CreativeRow } from '@/app/api/criativos/route';
import { CreativeCell } from './creative-cell';
import { ExportButton } from './export-button';
import type { FiltrosState } from './filtros-form';

// ─── Formatação ───────────────────────────────────────────────────────────────

function fmtBRL(n: number) {
  if (n === 0) return 'R$0';
  if (n >= 1000) return `R$${(n / 1000).toFixed(1)}k`;
  return `R$${n.toFixed(0)}`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('pt-BR');
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtROAS(n: number) {
  return n > 0 ? `${n.toFixed(2)}x` : '—';
}

function fmtCPA(n: number) {
  return n > 0 ? fmtBRL(n) : '—';
}

// Formata data "2026-03-22" → "22/mar"
function fmtDateShort(d: string): string {
  const parts = d.split('-');
  if (parts.length < 3) return d;
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  return `${day}/${months[month] ?? parts[1]}`;
}

const PERIOD_LABELS: Record<string, string> = {
  '7d':  'Últimos 7D',
  '15d': 'Últimos 15D',
  '30d': 'Últimos 30D',
  '60d': 'Últimos 60D',
  '90d': 'Últimos 90D',
  '6m':  'Últimos 6M',
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type SortKey = keyof CreativeRow;

interface Col {
  key: SortKey;
  label: string;
  fmt: (row: CreativeRow) => string;
  align?: 'right';
  sticky?: boolean;
}

// Fonte (2ª coluna) → Criativo → Campanha → métricas
const COLS: Col[] = [
  { key: 'platform',        label: 'Fonte',        fmt: r => r.platform },
  { key: 'adName',          label: 'Criativo',     fmt: () => '',        sticky: true },
  { key: 'campaignName',    label: 'Campanha',     fmt: r => r.campaignName },
  { key: 'spend',           label: 'Spend',        fmt: r => fmtBRL(r.spend),        align: 'right' },
  { key: 'impressions',     label: 'Impressões',   fmt: r => fmtNum(r.impressions),  align: 'right' },
  { key: 'clicks',          label: 'Cliques',      fmt: r => fmtNum(r.clicks),       align: 'right' },
  { key: 'ctr',             label: 'CTR',          fmt: r => fmtPct(r.ctr),          align: 'right' },
  { key: 'conversions',     label: 'Conv.',        fmt: r => r.conversions > 0 ? r.conversions.toFixed(0) : '—', align: 'right' },
  { key: 'roas',            label: 'ROAS',         fmt: r => fmtROAS(r.roas),        align: 'right' },
  { key: 'cpa',             label: 'CPA',          fmt: r => fmtCPA(r.cpa),          align: 'right' },
  { key: 'viewConversions', label: 'Conv. View',   fmt: r => r.viewConversions != null ? String(r.viewConversions) : '—', align: 'right' },
];

// ─── Componente ───────────────────────────────────────────────────────────────

interface CriativosTableProps {
  rows: CreativeRow[];
  filtros: FiltrosState;
  errors?: string[];
}

export function CriativosTable({ rows, filtros, errors }: CriativosTableProps) {
  const [filterText, setFilterText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    const q = filterText.toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.adName.toLowerCase().includes(q) ||
      r.campaignName.toLowerCase().includes(q) ||
      r.campaignType.toLowerCase().includes(q) ||
      (r.headline ?? '').toLowerCase().includes(q)
    );
  }, [rows, filterText]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const numA = typeof va === 'number' ? va : 0;
      const numB = typeof vb === 'number' ? vb : 0;
      return sortDir === 'desc' ? numB - numA : numA - numB;
    });
  }, [filtered, sortKey, sortDir]);

  // Título: "Últimos 7D (22/mar — 28/mar) · Google Ads · 20 criativos"
  const canalLabel = filtros.channel === 'google' ? 'Google Ads'
    : filtros.channel === 'meta' ? 'Meta Ads' : 'Todos';

  const periodDisplay = filtros.periodLabel
    ? `${PERIOD_LABELS[filtros.periodLabel] ?? filtros.periodLabel} (${fmtDateShort(filtros.dateFrom)} — ${fmtDateShort(filtros.dateTo)})`
    : `${fmtDateShort(filtros.dateFrom)} — ${fmtDateShort(filtros.dateTo)}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Sumário + erros */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          {periodDisplay} · {canalLabel} · {rows.length} criativos
        </p>
        {errors && errors.length > 0 && (
          <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          placeholder="🔍 Filtrar na tabela..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="h-8 w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
        />
        <ExportButton
          rows={sorted}
          canal={filtros.channel}
          dateFrom={filtros.dateFrom}
          dateTo={filtros.dateTo}
        />
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-charme border-b border-charme/20">
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-white/70 w-8">#</th>
              {COLS.map(col => {
                const isNarrow = ['ctr','conversions','roas','cpa','viewConversions'].includes(col.key as string);
                const isWide = col.key === 'campaignName';
                const isSortable = !(['adName','platform'] as string[]).includes(col.key as string);
                return (
                  <th
                    key={col.key}
                    onClick={() => isSortable && handleSort(col.key)}
                    className={[
                      'px-3 py-2.5 text-xs font-semibold text-white/80 whitespace-nowrap select-none',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      isSortable ? 'cursor-pointer hover:text-white' : '',
                      isNarrow ? 'w-16' : '',
                      isWide ? 'min-w-[180px]' : '',
                    ].join(' ')}
                  >
                    {col.label}
                    {col.key === sortKey && (
                      <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 1} className="text-center py-12 text-sm text-zinc-400">
                  Nenhum criativo encontrado
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={`${row.platform}-${row.adId}-${i}`}
                  className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors"
                >
                  {/* # */}
                  <td className="px-3 py-3 text-xs text-zinc-400 align-top">{i + 1}</td>

                  {/* Fonte — logo PNG, 2ª coluna */}
                  <td className="px-3 py-3 align-top">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={row.platform === 'google' ? '/logo_google.png' : '/images.png'}
                      alt={row.platform === 'google' ? 'Google' : 'Meta'}
                      width={20}
                      height={20}
                      className="object-contain"
                    />
                  </td>

                  {/* Criativo */}
                  <td className="px-3 py-3 align-top min-w-[220px] max-w-[280px]">
                    <CreativeCell row={row} />
                  </td>

                  {/* Campanha + Grupo */}
                  <td className="px-3 py-3 align-top min-w-[180px] max-w-[240px]">
                    <span className="block text-xs text-zinc-700 leading-snug break-words" title={row.campaignName}>
                      {row.campaignName}
                    </span>
                    {row.adGroupName && (
                      <span className="block text-[11px] text-zinc-400 leading-snug break-words mt-0.5" title={row.adGroupName}>
                        {row.adGroupName}
                      </span>
                    )}
                    <span className="block text-[10px] text-zinc-300 mt-0.5">{row.campaignType}</span>
                  </td>

                  {/* Métricas numéricas — COLS.slice(3) */}
                  {COLS.slice(3).map(col => (
                    <td key={col.key} className="px-3 py-3 align-top text-right text-xs text-zinc-700 whitespace-nowrap">
                      {col.fmt(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400 text-right">
        {sorted.length} de {rows.length} criativos
      </p>
    </div>
  );
}

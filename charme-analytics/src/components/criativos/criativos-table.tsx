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

const COLS: Col[] = [
  { key: 'adName',          label: 'Criativo',     fmt: () => '',        sticky: true },
  { key: 'campaignName',    label: 'Campanha',     fmt: r => r.campaignName },
  { key: 'platform',        label: 'Fonte',        fmt: r => r.platform },
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

  const canalLabel = filtros.channel === 'google' ? 'Google Ads' : filtros.channel === 'meta' ? 'Meta Ads' : 'Todos';

  return (
    <div className="flex flex-col gap-4">
      {/* Sumário + erros */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          {filtros.dateFrom} — {filtros.dateTo} · {canalLabel} · {rows.length} criativos
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
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 w-8">#</th>
              {COLS.map(col => {
                const isNarrow = ['ctr','conversions','roas','cpa','viewConversions'].includes(col.key as string);
                const isWide = col.key === 'campaignName';
                return (
                  <th
                    key={col.key}
                    onClick={() => !['adName','platform'].includes(col.key as string) && handleSort(col.key)}
                    className={[
                      'px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap select-none',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      !['adName','platform'].includes(col.key as string) ? 'cursor-pointer hover:text-zinc-800' : '',
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
                  </td>

                  {/* Fonte */}
                  <td className="px-3 py-3 align-top">
                    {row.platform === 'google' ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-100 text-orange-700 whitespace-nowrap">
                        Google
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700 whitespace-nowrap">
                        Meta
                      </span>
                    )}
                  </td>

                  {/* Métricas numéricas */}
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

'use client';

import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';

export interface SKUResult {
  sku: string;
  name: string;
  qtdVerificado: number;
  qtdDevolvido: number;
  qtdCancelado: number;
  qtdTotalVendido: number;
  taxaDevolucao: number;
  taxaCancelamento: number;
}

type SortKey = 'taxaDevolucao' | 'taxaCancelamento' | 'qtdTotalVendido';

interface ResumoGeral {
  totalPedidos: number;
  verificados: number;
  devolvidos: number;
  cancelados: number;
  descartados: number;
}

interface Props {
  resultados: SKUResult[];
  resumo: ResumoGeral;
  periodo: { from: string; to: string };
}

function indicador(taxa: number) {
  if (taxa > 5) return '🔴';
  if (taxa >= 3) return '🟡';
  return '🟢';
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR');
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function exportXlsx(data: SKUResult[], periodo: { from: string; to: string }) {
  const rows = data.map(r => ({
    SKU: r.sku,
    Produto: r.name,
    'Total Vendido': r.qtdTotalVendido,
    'Verificado': r.qtdVerificado,
    'Devolvido': r.qtdDevolvido,
    'Taxa Devolução (%)': +r.taxaDevolucao.toFixed(2),
    'Cancelado': r.qtdCancelado,
    'Taxa Cancelamento (%)': +r.taxaCancelamento.toFixed(2),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Devoluções');
  XLSX.writeFile(wb, `devolucoes_${periodo.from}_${periodo.to}.xlsx`);
}

export function DevolucoesResults({ resultados, resumo, periodo }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('taxaDevolucao');
  const [busca, setBusca] = useState('');

  const sorted = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return [...resultados]
      .filter(r => !q || r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => b[sortKey] - a[sortKey]);
  }, [resultados, sortKey, busca]);

  const totalGeral = resumo.verificados + resumo.devolvidos + resumo.cancelados;
  const pctDev = totalGeral > 0 ? ((resumo.devolvidos / totalGeral) * 100).toFixed(1) : '0,0';
  const pctCan = totalGeral > 0 ? ((resumo.cancelados / totalGeral) * 100).toFixed(1) : '0,0';
  const pctVer = totalGeral > 0 ? ((resumo.verificados / totalGeral) * 100).toFixed(1) : '0,0';

  return (
    <div className="w-full max-w-5xl">
      {/* Título */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-zinc-700">
          📦 Devoluções &amp; Cancelamentos — {fmtDate(periodo.from)} a {fmtDate(periodo.to)}
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          {fmt(resumo.totalPedidos)} pedidos analisados
          {resumo.descartados > 0 && ` (excl. ${resumo.descartados} "Em troca")`}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Pedidos', value: fmt(resumo.totalPedidos), sub: '' },
          { label: 'Verificados', value: fmt(resumo.verificados), sub: `${pctVer}%`, color: 'text-green-600' },
          { label: 'Devolvidos', value: fmt(resumo.devolvidos), sub: `${pctDev}%`, color: 'text-red-500' },
          { label: 'Cancelados', value: fmt(resumo.cancelados), sub: `${pctCan}%`, color: 'text-amber-500' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-charme-border rounded-xl px-4 py-3">
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-0.5">{k.label}</p>
            <p className={`text-lg font-bold ${k.color ?? 'text-zinc-700'}`}>{k.value}</p>
            {k.sub && <p className="text-xs text-zinc-400">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Controles */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Ordenar:</span>
          {(['taxaDevolucao', 'taxaCancelamento', 'qtdTotalVendido'] as SortKey[]).map(k => {
            const label = k === 'taxaDevolucao' ? 'Taxa Devolução' : k === 'taxaCancelamento' ? 'Taxa Cancelamento' : 'Total Vendido';
            return (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`h-7 px-3 text-xs rounded-lg border transition-colors ${
                  sortKey === k
                    ? 'bg-charme text-white border-charme'
                    : 'bg-white text-zinc-500 border-zinc-200 hover:border-charme/40'
                }`}
              >
                {label}{sortKey === k && ' ▼'}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar SKU ou produto..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="h-8 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-700 focus:outline-none focus:border-charme/40 w-44"
          />
          <button
            onClick={() => exportXlsx(sorted, periodo)}
            className="h-8 px-3 bg-white border border-charme-border text-charme text-xs font-medium rounded-lg hover:bg-charme/5 transition-colors"
          >
            📥 Exportar XLSX
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-charme-border rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 text-zinc-400 uppercase tracking-wide text-[10px]">
              <th className="px-4 py-3 text-left w-8"></th>
              <th className="px-4 py-3 text-left">SKU</th>
              <th className="px-4 py-3 text-left">Produto</th>
              <th className="px-4 py-3 text-right">Total Vendido</th>
              <th className="px-4 py-3 text-right">Devol.</th>
              <th className="px-4 py-3 text-right font-semibold text-charme">Taxa Devol.</th>
              <th className="px-4 py-3 text-right">Cancel.</th>
              <th className="px-4 py-3 text-right">Taxa Cancel.</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum SKU com 5+ vendas no período.'}
                </td>
              </tr>
            ) : (
              sorted.map(r => (
                <tr key={r.sku} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-2.5 text-center">{indicador(r.taxaDevolucao)}</td>
                  <td className="px-4 py-2.5 font-mono text-zinc-600">{r.sku}</td>
                  <td className="px-4 py-2.5 text-zinc-700 max-w-[200px] truncate" title={r.name}>{r.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmt(r.qtdTotalVendido)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmt(r.qtdDevolvido)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-charme">{r.taxaDevolucao.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmt(r.qtdCancelado)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{r.taxaCancelamento.toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-zinc-400">
        <span>🔴 Devolução &gt; 5%</span>
        <span>🟡 3–5%</span>
        <span>🟢 &lt; 3%</span>
        <span className="ml-auto">SKUs com &lt; 5 vendas ocultados</span>
      </div>

      <p className="text-[11px] text-amber-600 mt-2">
        ⚠️ Últimos 30 dias do período podem ter taxas subestimadas.
      </p>
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';

export interface RawItem {
  codigo: string;
  descricao: string;
  quantidade: number;
  pedidoId: number;
  tipo: 'vendido' | 'devolvido' | 'cancelado';
}

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

type SortKey = 'qtdTotalVendido' | 'taxaDevolucao' | 'taxaCancelamento';
type ViewMode = 'sku' | 'tipo';
type TopN = 10 | 30 | 50 | 100 | 'all';

interface ResumoGeral {
  totalPedidos: number;
  verificados: number;
  devolvidos: number;
  cancelados: number;
  ignorados: number;
}

interface Props {
  items: RawItem[];
  pedidoLojas: Record<string, string>;
  lojas: string[];
  resumo: ResumoGeral;
  periodo: { from: string; to: string };
  dateFrom: string;
  dateTo: string;
}

// ─── Agrupamento por tipo de produto ──────────────────────────────────────────

function normStr(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function hasAll(title: string, ...words: string[]) {
  const t = normStr(title);
  return words.every(w => t.includes(normStr(w)));
}

const REGRAS_TIPO = [
  // ── Sofás ───────────────────────────────────────────────────────────────────
  { nome: 'Capa Sofá Elastex Retrátil',   match: (t: string) => hasAll(t, 'sofa', 'retratil', 'elastex') },
  { nome: 'Protetor Sofá Retrátil',       match: (t: string) => hasAll(t, 'protetor', 'sofa', 'retratil') },
  { nome: 'Protetor Sofá Padrão',         match: (t: string) => hasAll(t, 'protetora', 'sofa') },
  { nome: 'Capa Sofá Anti Arranhão',      match: (t: string) => hasAll(t, 'sofa', 'anti', 'arranhao') },
  { nome: 'Capa Sofá Drop',               match: (t: string) => hasAll(t, 'sofa', 'special') },
  { nome: 'Capa Sofá Elastex',            match: (t: string) => hasAll(t, 'sofa', 'elastex') },
  { nome: 'Capa Braço Sofá',             match: (t: string) => hasAll(t, 'braco', 'sofa') },

  // ── Assento Cadeira (mais específico primeiro) ──────────────────────────────
  { nome: 'Assento Cadeira Impermeável',  match: (t: string) => hasAll(t, 'assento', 'cadeira', 'impermeav') },
  { nome: 'Assento Cadeira Cristal',      match: (t: string) => hasAll(t, 'assento', 'cadeira', 'cristal') },
  { nome: 'Assento Cadeira',             match: (t: string) => hasAll(t, 'assento', 'cadeira') },

  // ── Cadeiras (mais específico primeiro) ─────────────────────────────────────
  { nome: 'Cadeira Acolchoada',           match: (t: string) => hasAll(t, 'protex', 'grid') || hasAll(t, 'cadeira', 'matelad') || hasAll(t, 'cadeira', 'acolchoada') || hasAll(t, 'cadeira', 'duo') },
  { nome: 'Cadeira Confort',              match: (t: string) => hasAll(t, 'cadeira', 'confort') },
  { nome: 'Cadeira Suede Protex',         match: (t: string) => hasAll(t, 'cadeira', 'suede') },
  { nome: 'Cadeira Impermeável',          match: (t: string) => hasAll(t, 'cadeira', 'impermeav') || hasAll(t, 'cadeira', 'deluxe') },
  { nome: 'Cadeira Boutique',             match: (t: string) => hasAll(t, 'cadeira', 'boutique') },
  { nome: 'Cadeira Escritório',           match: (t: string) => hasAll(t, 'cadeira', 'escritor') },
  { nome: 'Cadeira Elastex',              match: (t: string) => hasAll(t, 'cadeira de jantar') || hasAll(t, 'cadeira sala de jantar') || hasAll(t, 'cadeira', 'malha coladinha') || hasAll(t, 'cadeira', 'elastex') },

  // ── Outros produtos ─────────────────────────────────────────────────────────
  { nome: 'Capa Puff',                    match: (t: string) => hasAll(t, 'puff') },
];

function getTipo(name: string): string {
  for (const r of REGRAS_TIPO) if (r.match(name)) return r.nome;
  return 'Outros';
}

// ─── Agregação ────────────────────────────────────────────────────────────────

const MIN_VENDAS = 5;

function aggregate(
  items: RawItem[],
  pedidoLojas: Record<string, string>,
  selectedLojas: string[],
  allLojas: boolean,
): SKUResult[] {
  const map = new Map<string, SKUResult>();

  function get(item: RawItem): SKUResult {
    if (!map.has(item.codigo)) {
      map.set(item.codigo, {
        sku: item.codigo, name: item.descricao,
        qtdVerificado: 0, qtdDevolvido: 0, qtdCancelado: 0,
        qtdTotalVendido: 0, taxaDevolucao: 0, taxaCancelamento: 0,
      });
    }
    return map.get(item.codigo)!;
  }

  for (const i of items) {
    if (!allLojas) {
      const loja = pedidoLojas[String(i.pedidoId)] ?? 'Sem canal';
      if (!selectedLojas.includes(loja)) continue;
    }
    const r = get(i);
    if (i.tipo === 'vendido')    r.qtdVerificado += i.quantidade;
    else if (i.tipo === 'devolvido')  r.qtdDevolvido  += i.quantidade;
    else if (i.tipo === 'cancelado')  r.qtdCancelado  += i.quantidade;
  }

  return Array.from(map.values())
    .map(r => {
      r.qtdTotalVendido  = r.qtdVerificado + r.qtdDevolvido + r.qtdCancelado;
      r.taxaDevolucao    = r.qtdTotalVendido > 0 ? (r.qtdDevolvido / r.qtdTotalVendido) * 100 : 0;
      r.taxaCancelamento = r.qtdTotalVendido > 0 ? (r.qtdCancelado / r.qtdTotalVendido) * 100 : 0;
      return r;
    })
    .filter(r => r.qtdTotalVendido >= MIN_VENDAS)
    .sort((a, b) => b.qtdTotalVendido - a.qtdTotalVendido);
}

interface GrupoTipo {
  nome: string;
  qtdTotalVendido: number; qtdDevolvido: number; qtdCancelado: number;
  taxaDevolucao: number; taxaCancelamento: number; numSkus: number;
  produtos: { sku: string; name: string }[];
}

function groupByTipo(skus: SKUResult[]): GrupoTipo[] {
  const map = new Map<string, GrupoTipo>();
  for (const r of skus) {
    const tipo = getTipo(r.name);
    if (!map.has(tipo)) map.set(tipo, { nome: tipo, qtdTotalVendido: 0, qtdDevolvido: 0, qtdCancelado: 0, taxaDevolucao: 0, taxaCancelamento: 0, numSkus: 0, produtos: [] });
    const g = map.get(tipo)!;
    g.qtdTotalVendido += r.qtdTotalVendido;
    g.qtdDevolvido    += r.qtdDevolvido;
    g.qtdCancelado    += r.qtdCancelado;
    g.numSkus++;
    g.produtos.push({ sku: r.sku, name: r.name });
  }
  return Array.from(map.values())
    .map(g => ({
      ...g,
      taxaDevolucao:    g.qtdTotalVendido > 0 ? (g.qtdDevolvido / g.qtdTotalVendido) * 100 : 0,
      taxaCancelamento: g.qtdTotalVendido > 0 ? (g.qtdCancelado / g.qtdTotalVendido) * 100 : 0,
    }))
    .sort((a, b) => b.qtdTotalVendido - a.qtdTotalVendido);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function indicador(taxa: number) { return taxa > 5 ? '🔴' : taxa >= 3 ? '🟡' : '🟢'; }
function fmt(n: number) { return n.toLocaleString('pt-BR'); }
function fmtDate(iso: string) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; }

function exportXlsx(data: SKUResult[], periodo: { from: string; to: string }) {
  const rows = data.map(r => ({
    SKU: r.sku, Produto: r.name,
    'Total Vendido': r.qtdTotalVendido, Verificado: r.qtdVerificado,
    Devolvido: r.qtdDevolvido, 'Taxa Devolução (%)': +r.taxaDevolucao.toFixed(2),
    Cancelado: r.qtdCancelado, 'Taxa Cancelamento (%)': +r.taxaCancelamento.toFixed(2),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Devoluções');
  XLSX.writeFile(wb, `devolucoes_${periodo.from}_${periodo.to}.xlsx`);
}

const TOP_N_OPTIONS: { label: string; value: TopN }[] = [
  { label: 'Top 10', value: 10 },
  { label: 'Top 30', value: 30 },
  { label: 'Top 50', value: 50 },
  { label: 'Top 100', value: 100 },
  { label: 'Todos', value: 'all' },
];

// ─── Componente principal ─────────────────────────────────────────────────────

export function DevolucoesResults({ items, pedidoLojas, lojas, resumo, periodo, dateFrom, dateTo }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('qtdTotalVendido');
  const [topN, setTopN] = useState<TopN>(50);
  const [viewMode, setViewMode] = useState<ViewMode>('sku');
  const [busca, setBusca] = useState('');
  const [selectedLojas, setSelectedLojas] = useState<string[]>([]);
  const [showLojaFilter, setShowLojaFilter] = useState(false);
  const [openTipoInfo, setOpenTipoInfo] = useState<string | null>(null);
  const [debugData, setDebugData] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const allLojas = selectedLojas.length === 0;

  // Agregação reativa ao filtro de loja
  const allSkus = useMemo(
    () => aggregate(items, pedidoLojas, selectedLojas, allLojas),
    [items, pedidoLojas, selectedLojas, allLojas]
  );

  // Resumo filtrado por loja (recalcula quando filtra)
  const resumoFiltrado = useMemo(() => {
    if (allLojas) return resumo;
    const filteredItems = items.filter(i => {
      const loja = pedidoLojas[String(i.pedidoId)] ?? 'Sem canal';
      return selectedLojas.includes(loja);
    });
    const pedidosFiltrados = new Set(filteredItems.map(i => i.pedidoId));
    const counts = { vendidos: 0, devolvidos: 0, cancelados: 0 };
    for (const id of pedidosFiltrados) {
      const tipo = filteredItems.find(i => i.pedidoId === id)?.tipo;
      if (tipo === 'vendido') counts.vendidos++;
      else if (tipo === 'devolvido') counts.devolvidos++;
      else if (tipo === 'cancelado') counts.cancelados++;
    }
    const total = counts.vendidos + counts.devolvidos + counts.cancelados;
    return { totalPedidos: total, verificados: counts.vendidos, devolvidos: counts.devolvidos, cancelados: counts.cancelados, ignorados: 0 };
  }, [items, pedidoLojas, selectedLojas, allLojas, resumo]);

  // Ordenação + busca + top N
  const skusFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let list = [...allSkus];
    if (q) list = list.filter(r => r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    list.sort((a, b) => b[sortKey] - a[sortKey]);
    if (topN !== 'all') list = list.slice(0, topN);
    return list;
  }, [allSkus, sortKey, busca, topN]);

  const tipoGrupos = useMemo(() => groupByTipo(skusFiltrados), [skusFiltrados]);

  const totalGeral = resumoFiltrado.verificados + resumoFiltrado.devolvidos + resumoFiltrado.cancelados;
  const pctDev = totalGeral > 0 ? ((resumoFiltrado.devolvidos / totalGeral) * 100).toFixed(1) : '0,0';
  const pctCan = totalGeral > 0 ? ((resumoFiltrado.cancelados / totalGeral) * 100).toFixed(1) : '0,0';
  const pctVer = totalGeral > 0 ? ((resumoFiltrado.verificados / totalGeral) * 100).toFixed(1) : '0,0';

  function toggleLoja(loja: string) {
    setSelectedLojas(prev => prev.includes(loja) ? prev.filter(l => l !== loja) : [...prev, loja]);
  }

  async function handleDebug() {
    setDebugLoading(true);
    setDebugData(null);
    try {
      const res = await fetch('/api/avaliacoes/devolucoes/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      setDebugData(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      setDebugData('Erro: ' + String(e));
    } finally {
      setDebugLoading(false);
    }
  }

  const lojaLabel = allLojas ? 'Todas as lojas' : `${selectedLojas.length} loja${selectedLojas.length > 1 ? 's' : ''}`;

  return (
    <div className="w-full max-w-5xl">

      {/* Título */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-zinc-700">
          📦 Devoluções &amp; Cancelamentos — {fmtDate(periodo.from)} a {fmtDate(periodo.to)}
          {!allLojas && <span className="ml-2 text-charme">· {lojaLabel}</span>}
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          {fmt(resumoFiltrado.totalPedidos)} pedidos analisados
          {resumo.ignorados > 0 && ` (excl. ${resumo.ignorados} sem classificação)`}
        </p>
      </div>

      {/* KPIs — recalculados por loja */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Pedidos', value: fmt(resumoFiltrado.totalPedidos), sub: '', color: '' },
          { label: 'Verificados',   value: fmt(resumoFiltrado.verificados),  sub: `${pctVer}%`, color: 'text-green-600' },
          { label: 'Devolvidos',    value: fmt(resumoFiltrado.devolvidos),   sub: `${pctDev}%`, color: 'text-red-500' },
          { label: 'Cancelados',    value: fmt(resumoFiltrado.cancelados),   sub: `${pctCan}%`, color: 'text-amber-500' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-charme-border rounded-xl px-4 py-3">
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-0.5">{k.label}</p>
            <p className={`text-lg font-bold ${k.color || 'text-zinc-700'}`}>{k.value}</p>
            {k.sub && <p className="text-xs text-zinc-400">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-2 mb-3">

        {/* Linha 1: view + top N */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-zinc-100 rounded-lg p-0.5">
            {(['sku', 'tipo'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${viewMode === v ? 'bg-white text-charme shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                {v === 'sku' ? 'Por SKU' : 'Por Tipo'}
              </button>
            ))}
          </div>
          {TOP_N_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setTopN(o.value)}
              className={`h-7 px-2.5 text-xs rounded-lg border transition-colors ${topN === o.value ? 'bg-charme text-white border-charme' : 'bg-white text-zinc-500 border-zinc-200 hover:border-charme/40'}`}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Linha 2: loja + ordenar + busca + export */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro lojas */}
          {lojas.length > 0 && (
            <div className="relative">
              <button onClick={() => setShowLojaFilter(v => !v)}
                className={`h-8 px-3 text-xs rounded-lg border transition-colors ${!allLojas ? 'bg-charme text-white border-charme' : 'bg-white text-zinc-500 border-zinc-200 hover:border-charme/40'}`}>
                {lojaLabel} ▾
              </button>
              {showLojaFilter && (
                <div className="absolute left-0 top-10 z-20 bg-white border border-zinc-200 rounded-xl shadow-lg p-3 min-w-[260px]">
                  <button onClick={() => setSelectedLojas([])} className="text-xs text-charme hover:underline mb-2 block">
                    Limpar (todas)
                  </button>
                  {lojas.map(loja => (
                    <label key={loja} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input type="checkbox" checked={selectedLojas.includes(loja)} onChange={() => toggleLoja(loja)} className="accent-charme" />
                      <span className="text-xs text-zinc-700 truncate max-w-[220px]" title={loja}>{loja}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ordenar — só na visão SKU */}
          {viewMode === 'sku' && (
            <>
              <span className="text-xs text-zinc-400">Ordenar:</span>
              {([['qtdTotalVendido', 'Mais Vendidos'], ['taxaDevolucao', 'Taxa Devol.'], ['taxaCancelamento', 'Taxa Cancel.']] as [SortKey, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setSortKey(k)}
                  className={`h-7 px-2.5 text-xs rounded-lg border transition-colors ${sortKey === k ? 'bg-charme text-white border-charme' : 'bg-white text-zinc-500 border-zinc-200 hover:border-charme/40'}`}>
                  {label}{sortKey === k && ' ▼'}
                </button>
              ))}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <input type="text" placeholder="Buscar SKU ou produto..." value={busca}
              onChange={e => setBusca(e.target.value)}
              className="h-8 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-700 focus:outline-none focus:border-charme/40 w-44" />
            <button onClick={() => exportXlsx(skusFiltrados, periodo)}
              className="h-8 px-3 bg-white border border-charme-border text-charme text-xs font-medium rounded-lg hover:bg-charme/5 transition-colors">
              📥 XLSX
            </button>
          </div>
        </div>
      </div>

      {/* Tabela Por SKU */}
      {viewMode === 'sku' && (
        <div className="bg-white border border-charme-border rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-3 text-left w-6"></th>
                <th className="px-3 py-3 text-left w-28">SKU</th>
                <th className="px-3 py-3 text-left">Produto</th>
                <th className="px-3 py-3 text-right w-24">Total Vendido</th>
                <th className="px-3 py-3 text-right w-16">Devol.</th>
                <th className="px-3 py-3 text-right w-24 text-charme font-semibold">Taxa Devol.</th>
                <th className="px-3 py-3 text-right w-16">Cancel.</th>
                <th className="px-3 py-3 text-right w-24">Taxa Cancel.</th>
              </tr>
            </thead>
            <tbody>
              {skusFiltrados.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum SKU com 5+ vendas no período.'}
                </td></tr>
              ) : skusFiltrados.map(r => (
                <tr key={r.sku} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors">
                  <td className="px-3 py-2.5 text-center">{indicador(r.taxaDevolucao)}</td>
                  <td className="px-3 py-2.5 font-mono text-zinc-600 whitespace-nowrap">{r.sku}</td>
                  <td className="px-3 py-2.5 text-zinc-700" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 whitespace-nowrap">{fmt(r.qtdTotalVendido)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmt(r.qtdDevolvido)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-charme whitespace-nowrap">{r.taxaDevolucao.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmt(r.qtdCancelado)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500 whitespace-nowrap">{r.taxaCancelamento.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela Por Tipo */}
      {viewMode === 'tipo' && (
        <div className="bg-white border border-charme-border rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-3 text-left w-8"></th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-right">SKUs</th>
                <th className="px-4 py-3 text-right">Total Vendido</th>
                <th className="px-4 py-3 text-right">Devol.</th>
                <th className="px-4 py-3 text-right text-charme font-semibold">Taxa Devol.</th>
                <th className="px-4 py-3 text-right">Cancel.</th>
                <th className="px-4 py-3 text-right">Taxa Cancel.</th>
              </tr>
            </thead>
            <tbody>
              {tipoGrupos.length === 0
                ? <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-400">Nenhum grupo identificado.</td></tr>
                : tipoGrupos.map(g => (
                  <tr key={g.nome} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-2.5 text-center">{indicador(g.taxaDevolucao)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-700">{g.nome}</span>
                        <span className="text-zinc-400">({g.numSkus})</span>
                        <div className="relative">
                          <button
                            onClick={() => setOpenTipoInfo(openTipoInfo === g.nome ? null : g.nome)}
                            className="w-4 h-4 rounded-full bg-zinc-200 text-zinc-500 hover:bg-charme/20 hover:text-charme text-[10px] font-bold leading-none flex items-center justify-center transition-colors"
                            title="Ver produtos desta categoria"
                          >
                            i
                          </button>
                          {openTipoInfo === g.nome && (
                            <div className="absolute left-0 top-6 z-30 bg-white border border-zinc-200 rounded-xl shadow-lg p-3 w-80">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold text-zinc-600">{g.nome} — {g.numSkus} produtos</span>
                                <button
                                  onClick={() => navigator.clipboard.writeText(g.produtos.map(p => `${p.sku} — ${p.name}`).join('\n'))}
                                  className="text-[10px] text-charme hover:underline"
                                >
                                  Copiar
                                </button>
                              </div>
                              <div className="overflow-y-auto max-h-60 space-y-0.5 select-text">
                                {g.produtos.map(p => (
                                  <div key={p.sku} className="text-[11px] text-zinc-600 py-0.5 border-b border-zinc-50 last:border-0">
                                    <span className="font-mono text-zinc-400 mr-1">{p.sku}</span>
                                    {p.name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">{g.numSkus}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmt(g.qtdTotalVendido)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmt(g.qtdDevolvido)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-charme">{g.taxaDevolucao.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmt(g.qtdCancelado)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{g.taxaCancelamento.toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-zinc-400">
        <span>🔴 Devol. &gt; 5%</span><span>🟡 3–5%</span><span>🟢 &lt; 3%</span>
        <span className="ml-auto">SKUs com &lt; 5 vendas ocultados</span>
      </div>
      <p className="text-[11px] text-amber-600 mt-1">⚠️ Últimos 30 dias do período podem ter taxas subestimadas.</p>

      {/* Debug discreto */}
      <div className="mt-6 pt-4 border-t border-zinc-100">
        <button onClick={handleDebug} disabled={debugLoading}
          className="text-[11px] text-zinc-300 hover:text-zinc-400 transition-colors disabled:opacity-50">
          {debugLoading ? 'Carregando...' : '⚙ Debug API'}
        </button>
        {debugData && (
          <pre className="mt-2 text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">
            {debugData}
          </pre>
        )}
      </div>
    </div>
  );
}

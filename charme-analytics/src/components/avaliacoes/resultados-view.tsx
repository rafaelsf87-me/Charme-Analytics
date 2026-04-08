'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import * as XLSX from 'xlsx';
import { UploadForm, type ParsedData } from './upload-form';
import { ProcessingStatus } from './processing-status';
import { ProdutoCard } from './produto-card';
import type { AnalisarResponse, ProdutoResultado, ProblemaResultado, SubCategoria, TipoProblema } from '@/app/api/avaliacoes/analisar/route';
import type { ProdutoImagem } from '@/app/api/avaliacoes/imagens/route';
import { InfoTooltip } from './produto-card';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'upload' | 'processing' | 'results';

// ─── Resumo consolidado ────────────────────────────────────────────────────────

function ResumoConsolidado({ resumoGlobal, totalNegativas, totalProdutos }: {
  resumoGlobal: Record<string, number>;
  totalNegativas: number;
  totalProdutos: number;
}) {
  const top6 = Object.entries(resumoGlobal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (top6.length === 0) return null;

  const top6Sum = top6.reduce((s, [, q]) => s + q, 0);
  const demaisQtd = totalNegativas - top6Sum;
  const max = top6[0][1];

  return (
    <div className="bg-white border border-charme-border rounded-xl shadow-sm p-5 mb-5">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">
        Top 6 Reclamações — Todos os Produtos
      </p>
      <div className="space-y-3">
        {top6.map(([cat, qtd], i) => {
          const pct = totalNegativas > 0 ? (qtd / totalNegativas) * 100 : 0;
          const barPct = max > 0 ? (qtd / max) * 100 : 0;
          const isPositiva = cat === 'Avaliação Positiva';
          return (
            <div key={cat}>
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold text-zinc-400 w-4 shrink-0">#{i + 1}</span>
                  <span className={`text-sm font-medium truncate ${isPositiva ? 'text-green-600' : 'text-zinc-700'}`}>{cat}</span>
                  {isPositiva && <span className="text-[9px] bg-green-100 text-green-600 border border-green-200 rounded px-1 shrink-0">positiva</span>}
                </div>
                <span className="text-xs tabular-nums text-zinc-500 shrink-0">
                  {qtd} <span className="text-zinc-400">({pct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="w-full bg-zinc-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${barPct}%`, backgroundColor: isPositiva ? '#16a34a' : '#553679' }}
                />
              </div>
            </div>
          );
        })}

        {/* Linha de fechamento para somar 100% */}
        {demaisQtd > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-bold text-zinc-300 w-4 shrink-0" />
                <span className="text-sm text-zinc-400 italic truncate">Demais categorias</span>
              </div>
              <span className="text-xs tabular-nums text-zinc-400 shrink-0">
                {demaisQtd} <span className="text-zinc-300">({(demaisQtd / totalNegativas * 100).toFixed(1)}%)</span>
              </span>
            </div>
            <div className="w-full bg-zinc-100 rounded-full h-2">
              <div
                className="h-2 rounded-full"
                style={{ width: `${(demaisQtd / max) * 100}%`, backgroundColor: '#e4e4e7' }}
              />
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-zinc-400 mt-3">
        Base: {totalNegativas.toLocaleString('pt-BR')} avaliações negativas em {totalProdutos} produto{totalProdutos !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

// ─── Classificação por tipo de produto ────────────────────────────────────────

interface TipoProdutoAgregado {
  nome: string;
  nomes_produtos: string[];
  total_negativas: number;
  total_reviews: number;
  problemas: ProblemaResultado[];
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hasAll(title: string, ...words: string[]): boolean {
  const t = norm(title);
  return words.every(w => t.includes(norm(w)));
}

const REGRAS_TIPO: { nome: string; match: (t: string) => boolean }[] = [
  // Ordem importa: mais específicos primeiro
  { nome: 'CAPA SOFÁ ELASTEX RETRÁTIL',  match: t => hasAll(t, 'sofa', 'retratil', 'elastex') },
  { nome: 'PROTETOR SOFÁ RETRÁTIL',      match: t => hasAll(t, 'protetor', 'sofa', 'retratil') },
  { nome: 'PROTETOR SOFÁ PADRÃO',        match: t => hasAll(t, 'protetora', 'sofa') },
  { nome: 'CAPAS SOFÁS ANTI ARRANHÃO',   match: t => hasAll(t, 'sofa', 'anti', 'arranhao') },
  { nome: 'CAPAS SOFÁS DROP',            match: t => hasAll(t, 'sofa', 'special') },
  { nome: 'CAPAS SOFÁS ELASTEX',         match: t => hasAll(t, 'sofa', 'elastex') },
  { nome: 'CAPAS CADEIRAS ACOLCHOADAS',  match: t => hasAll(t, 'cadeira', 'acolchoada') || hasAll(t, 'cadeira', 'duo') },
  { nome: 'CAPAS CADEIRAS CONFORT',      match: t => hasAll(t, 'cadeira', 'confort') },
  { nome: 'CAPAS CADEIRA SUEDE PROTEX',  match: t => hasAll(t, 'cadeira', 'suede') },
  { nome: 'CAPAS CADEIRAS IMPERMEÁVEIS', match: t => hasAll(t, 'cadeira', 'deluxe') },
  { nome: 'CAPAS CADEIRAS BOUTIQUE',     match: t => hasAll(t, 'cadeira', 'boutique') },
  { nome: 'CAPAS CADEIRAS ELASTEX',      match: t => hasAll(t, 'cadeira', 'elastex') },
];

function getTipoProduto(titulo: string): string {
  for (const regra of REGRAS_TIPO) {
    if (regra.match(titulo)) return regra.nome;
  }
  return '__outras__';
}

function agregarPorTipo(
  produtos: ProdutoResultado[],
  imagens: Map<string, ProdutoImagem>
): { grupos: TipoProdutoAgregado[]; outras: string[] } {
  type Acc = {
    nomes: string[];
    neg: number;
    rev: number;
    probs: Map<string, { quantidade: number; tipo: TipoProblema; textos: string[]; subs: Map<string, { quantidade: number; textos: string[] }> }>;
  };

  const map = new Map<string, Acc>();
  const outras: string[] = [];

  for (const p of produtos) {
    const img = imagens.get(p.product_handle);
    const titulo = img?.title && img.title !== img.handle
      ? img.title
      : p.product_handle.replace(/-/g, ' ');
    const tipo = getTipoProduto(titulo);

    if (tipo === '__outras__') { outras.push(titulo); continue; }

    if (!map.has(tipo)) map.set(tipo, { nomes: [], neg: 0, rev: 0, probs: new Map() });
    const g = map.get(tipo)!;
    g.nomes.push(titulo);
    g.neg += p.total_negativas;
    g.rev += p.total_reviews;

    for (const prob of p.problemas) {
      if (!g.probs.has(prob.categoria)) {
        g.probs.set(prob.categoria, { quantidade: 0, tipo: prob.tipo, textos: [], subs: new Map() });
      }
      const gp = g.probs.get(prob.categoria)!;
      gp.quantidade += prob.quantidade;
      gp.textos.push(...prob.textos);
      for (const sub of prob.subcategorias) {
        if (!gp.subs.has(sub.nome)) gp.subs.set(sub.nome, { quantidade: 0, textos: [] });
        const gs = gp.subs.get(sub.nome)!;
        gs.quantidade += sub.quantidade;
        gs.textos.push(...sub.textos);
      }
    }
  }

  function ordemP(p: ProblemaResultado): number {
    if (p.tipo === 'positiva') return 4;
    if (p.categoria === 'Não Recebi (atraso)') return 3;
    if (p.tipo === 'logistica') return 2;
    if (p.tipo === 'outro') return 1;
    return 0;
  }

  const grupos: TipoProdutoAgregado[] = [];
  for (const regra of REGRAS_TIPO) {
    const g = map.get(regra.nome);
    if (!g || g.neg === 0) continue;
    const totalNeg = g.neg;

    const problemas: ProblemaResultado[] = [...g.probs.entries()].map(([cat, data]) => ({
      categoria: cat,
      quantidade: data.quantidade,
      percentual: totalNeg > 0 ? (data.quantidade / totalNeg) * 100 : 0,
      tipo: data.tipo,
      textos: data.textos,
      subcategorias: ([...data.subs.entries()]
        .map(([nome, s]): SubCategoria => ({ nome, quantidade: s.quantidade, textos: s.textos }))
        .sort((a, b) => b.quantidade - a.quantidade)),
    })).sort((a, b) => {
      const diff = ordemP(a) - ordemP(b);
      return diff !== 0 ? diff : b.quantidade - a.quantidade;
    });

    grupos.push({ nome: regra.nome, nomes_produtos: g.nomes, total_negativas: g.neg, total_reviews: g.rev, problemas });
  }

  return { grupos, outras };
}

// ─── TipoCard ─────────────────────────────────────────────────────────────────

function tipoBarColor(tipo: TipoProblema): string {
  if (tipo === 'positiva') return '#16a34a';
  if (tipo === 'logistica') return '#a1a1aa';
  if (tipo === 'outro') return '#d4d4d8';
  return '#553679';
}

function tipoLabelClass(tipo: TipoProblema): string {
  if (tipo === 'positiva') return 'text-green-600 font-medium';
  if (tipo === 'logistica' || tipo === 'outro') return 'text-zinc-400';
  return 'text-zinc-700 font-medium';
}

function tipoValueClass(tipo: TipoProblema): string {
  if (tipo === 'positiva') return 'text-green-500';
  if (tipo === 'logistica' || tipo === 'outro') return 'text-zinc-400';
  return 'text-zinc-500';
}

function TipoCard({ grupo }: { grupo: TipoProdutoAgregado }) {
  const maxQtd = grupo.problemas
    .filter(p => p.tipo === 'produto')
    .reduce((m, p) => Math.max(m, p.quantidade), 1);

  return (
    <div className="bg-white border border-charme-border rounded-xl shadow-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100 bg-charme/[0.03] rounded-t-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-charme uppercase tracking-wide leading-snug">
              {grupo.nome}
            </h3>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              <span className="text-xs text-zinc-500">
                <span className="font-medium text-zinc-700">{grupo.nomes_produtos.length}</span> produto{grupo.nomes_produtos.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-zinc-400">·</span>
              <span className="text-xs text-red-500 font-medium">
                {grupo.total_negativas} negativas
              </span>
            </div>
          </div>
          {/* Lista de produtos incluídos */}
          <InfoTooltip
            textos={grupo.nomes_produtos}
            subcategorias={[]}
            total={grupo.nomes_produtos.length}
          />
        </div>
      </div>

      {/* Problemas */}
      <div className="p-5">
        {grupo.problemas.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">Nenhum problema recorrente consolidado.</p>
        ) : (
          <>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
              Principais Problemas
            </p>
            <div className="space-y-2.5">
              {grupo.problemas.map(prob => {
                const barBase = prob.tipo === 'produto' ? maxQtd : grupo.total_negativas;
                const barPct = barBase > 0 ? (prob.quantidade / barBase) * 100 : 0;
                return (
                  <div key={prob.categoria}>
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {prob.tipo === 'logistica' && (
                          <span className="text-[9px] text-zinc-400 border border-zinc-200 rounded px-1 shrink-0">logística</span>
                        )}
                        <span className={`text-xs truncate ${tipoLabelClass(prob.tipo)}`}>{prob.categoria}</span>
                        <InfoTooltip textos={prob.textos} subcategorias={prob.subcategorias} total={prob.quantidade} />
                      </div>
                      <span className={`text-xs tabular-nums shrink-0 ${tipoValueClass(prob.tipo)}`}>
                        {prob.quantidade}{' '}
                        <span className="text-zinc-400">({prob.percentual.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-zinc-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: `${barPct}%`, backgroundColor: tipoBarColor(prob.tipo) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Export ────────────────────────────────────────────────────────────────────

function exportarXlsx(produtos: ProdutoResultado[], imagens: Map<string, ProdutoImagem>) {
  const rows: Record<string, string | number>[] = [];

  for (const p of produtos) {
    const img = imagens.get(p.product_handle);
    const nomeProduto = img?.title && img.title !== img.handle
      ? img.title
      : p.product_handle.replace(/-/g, ' ');

    if (p.problemas.length === 0) {
      rows.push({
        Produto: nomeProduto,
        'Nota Média': p.nota_media.toFixed(2),
        'Total Avaliações': p.total_reviews,
        'Total Negativas': p.total_negativas,
        Problema: '(nenhum ≥5%)',
        Qtd: '',
        '%': '',
      });
    } else {
      for (const prob of p.problemas) {
        rows.push({
          Produto: nomeProduto,
          'Nota Média': p.nota_media.toFixed(2),
          'Total Avaliações': p.total_reviews,
          'Total Negativas': p.total_negativas,
          Problema: prob.categoria,
          Qtd: prob.quantidade,
          '%': `${prob.percentual.toFixed(1)}%`,
        });
      }
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Avaliações');
  XLSX.writeFile(wb, `avaliacoes_negativas_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AvaliacoesView() {
  const [mode, setMode] = useState<Mode>('upload');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [produtos, setProdutos] = useState<ProdutoResultado[]>([]);
  const [imagens, setImagens] = useState<Map<string, ProdutoImagem>>(new Map());
  const [errosApi, setErrosApi] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [resumoGlobal, setResumoGlobal] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<'produto' | 'tipo'>('produto');

  async function handleConfirm(data: ParsedData) {
    setParsedData(data);
    setMode('processing');
    setErrosApi([]);

    // Só enviar campos necessários — sem dados pessoais
    const reviewsParaEnviar = data.negativas.map(r => ({
      product_handle: r.product_handle,
      title: r.title,
      body: r.body,
      rating: r.rating,
    }));

    try {
      const res = await fetch('/api/avaliacoes/analisar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: reviewsParaEnviar,
          total_reviews_por_produto: data.totalReviewsPorProduto,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setErrosApi([err.error ?? 'Erro na análise']);
        setMode('results');
        return;
      }

      const resultado: AnalisarResponse = await res.json();
      setProdutos(resultado.produtos);
      setResumoGlobal(resultado.resumo_global ?? {});

      if (resultado.batches_com_erro > 0) {
        setErrosApi([`${resultado.batches_com_erro} lote(s) com erro foram ignorados.`]);
      }

      // Buscar imagens
      const handles = resultado.produtos.map(p => p.product_handle);
      if (handles.length > 0) {
        try {
          const imgRes = await fetch('/api/avaliacoes/imagens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handles }),
          });
          if (imgRes.ok) {
            const imgData: { imagens: ProdutoImagem[] } = await imgRes.json();
            const map = new Map<string, ProdutoImagem>();
            for (const img of imgData.imagens) map.set(img.handle, img);
            setImagens(map);
          }
        } catch {
          // Imagens não críticas — continuar sem elas
        }
      }

      setMode('results');
    } catch (err) {
      setErrosApi([(err as Error).message]);
      setMode('results');
    }
  }

  function handleNovaAnalise() {
    setMode('upload');
    setParsedData(null);
    setProdutos([]);
    setImagens(new Map());
    setErrosApi([]);
    setBusca('');
    setResumoGlobal({});
    setViewMode('produto');
  }

  // Top 40 para o dashboard (resumo usa todos)
  const top40 = useMemo(() => produtos.slice(0, 40), [produtos]);

  // Filtrar dentro do top 40
  const produtosFiltrados = useMemo(() => {
    if (!busca.trim()) return top40;
    const q = busca.toLowerCase();
    return top40.filter(p => {
      const img = imagens.get(p.product_handle);
      const nome = img?.title ?? p.product_handle;
      return nome.toLowerCase().includes(q) || p.product_handle.toLowerCase().includes(q);
    });
  }, [top40, imagens, busca]);

  // Agrupamento por tipo (usa TODOS os produtos, não só top 40)
  const { grupos: tipoGrupos, outras: tipoOutras } = useMemo(
    () => agregarPorTipo(produtos, imagens),
    [produtos, imagens]
  );

  // ── Header compartilhado ──────────────────────────────────────────────────

  function Header() {
    return (
      <header className="flex items-center justify-between px-6 py-3 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          {mode === 'results' ? (
            <button
              onClick={handleNovaAnalise}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              ← Nova Análise
            </button>
          ) : (
            <Link href="/home" className="text-sm text-white/60 hover:text-white transition-colors">
              ← Voltar
            </Link>
          )}
          <span className="text-white/30">|</span>
          <Link href="/home"><Image src="/logo.png" alt="Charme Analytics" width={24} height={24} className="rounded-md" /></Link>
          <span className="font-semibold text-white text-sm">Analise Avaliações Negativas Shopify</span>
        </div>
      </header>
    );
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  if (mode === 'upload') {
    return (
      <div className="flex flex-col min-h-screen bg-charme-bg">
        <Header />
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
          <UploadForm onConfirm={handleConfirm} />
        </main>
      </div>
    );
  }

  // ── Processando ───────────────────────────────────────────────────────────

  if (mode === 'processing') {
    return (
      <div className="flex flex-col min-h-screen bg-charme-bg">
        <Header />
        <main className="flex flex-1 flex-col px-6">
          <ProcessingStatus totalNegativas={parsedData?.totalNegativas ?? 0} />
        </main>
      </div>
    );
  }

  // ── Resultados ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      <Header />
      <main className="flex-1 px-6 py-6">
        <div className="max-w-6xl mx-auto">

          {/* Erros */}
          {errosApi.length > 0 && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
              {errosApi.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          {/* Sem resultados */}
          {produtos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-zinc-500 text-sm">Nenhum produto com avaliações negativas encontrado.</p>
              <button
                onClick={handleNovaAnalise}
                className="mt-4 px-4 py-2 bg-charme text-white text-sm rounded-lg hover:bg-charme-hover transition-colors"
              >
                Nova Análise
              </button>
            </div>
          ) : (
            <>
              {/* Barra de controles */}
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
                {/* Esquerda: toggle visão + busca (só na visão por produto) */}
                <div className="flex items-center gap-2 flex-1">
                  {/* Toggle Por Produto / Por Tipo */}
                  <div className="flex items-center bg-zinc-100 rounded-lg p-0.5 shrink-0">
                    <button
                      onClick={() => setViewMode('produto')}
                      className={`h-8 px-3 text-xs font-medium rounded-md transition-colors ${
                        viewMode === 'produto'
                          ? 'bg-white text-charme shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      Por Produto
                    </button>
                    <button
                      onClick={() => setViewMode('tipo')}
                      className={`h-8 px-3 text-xs font-medium rounded-md transition-colors ${
                        viewMode === 'tipo'
                          ? 'bg-white text-charme shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      Por Tipo
                    </button>
                  </div>

                  {/* Busca — só na visão por produto */}
                  {viewMode === 'produto' && (
                    <input
                      type="text"
                      placeholder="Buscar produto..."
                      value={busca}
                      onChange={e => setBusca(e.target.value)}
                      className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:border-charme/40 w-full sm:w-56"
                    />
                  )}
                </div>

                {/* Direita: contagem + export */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">
                    {viewMode === 'produto'
                      ? `${produtosFiltrados.length} produto${produtosFiltrados.length !== 1 ? 's' : ''}`
                      : `${tipoGrupos.length} tipo${tipoGrupos.length !== 1 ? 's' : ''}`}
                  </span>
                  <button
                    onClick={() => exportarXlsx(produtosFiltrados, imagens)}
                    className="h-9 px-4 bg-white border border-charme-border text-charme text-sm font-medium rounded-lg hover:bg-charme/5 transition-colors"
                  >
                    📥 Exportar Excel
                  </button>
                </div>
              </div>

              {/* Resumo consolidado — sempre visível */}
              <ResumoConsolidado
                resumoGlobal={resumoGlobal}
                totalNegativas={produtos.reduce((s, p) => s + p.total_negativas, 0)}
                totalProdutos={produtos.length}
              />

              {/* ── Visão Por Produto ── */}
              {viewMode === 'produto' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {produtosFiltrados.map(p => (
                      <ProdutoCard
                        key={p.product_handle}
                        produto={p}
                        imagem={imagens.get(p.product_handle)}
                      />
                    ))}
                  </div>
                  {produtosFiltrados.length === 0 && busca && (
                    <p className="text-center text-sm text-zinc-400 mt-8">
                      Nenhum produto encontrado para &quot;{busca}&quot;.
                    </p>
                  )}
                </>
              )}

              {/* ── Visão Por Tipo ── */}
              {viewMode === 'tipo' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tipoGrupos.map(g => (
                      <TipoCard key={g.nome} grupo={g} />
                    ))}
                  </div>

                  {/* Card "Outros" — produtos sem tipo identificado */}
                  {tipoOutras.length > 0 && (
                    <div className="mt-4 bg-white border border-charme-border rounded-xl shadow-sm p-5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">
                          Outros produtos não classificados
                        </span>
                        <InfoTooltip
                          textos={tipoOutras}
                          subcategorias={[]}
                          total={tipoOutras.length}
                        />
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">
                        {tipoOutras.length} produto{tipoOutras.length !== 1 ? 's' : ''} sem combinação de keywords definida
                      </p>
                    </div>
                  )}

                  {tipoGrupos.length === 0 && (
                    <p className="text-center text-sm text-zinc-400 mt-8">
                      Nenhum produto correspondeu às categorias de tipo definidas.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

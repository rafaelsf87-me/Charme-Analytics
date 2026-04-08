'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import * as XLSX from 'xlsx';
import { UploadForm, type ParsedData } from './upload-form';
import { ProcessingStatus } from './processing-status';
import { ProdutoCard } from './produto-card';
import type { AnalisarResponse, ProdutoResultado } from '@/app/api/avaliacoes/analisar/route';
import type { ProdutoImagem } from '@/app/api/avaliacoes/imagens/route';

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
                <div className="flex flex-1">
                  {/* Busca */}
                  <input
                    type="text"
                    placeholder="Buscar produto..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:border-charme/40 w-full sm:w-64"
                  />
                </div>

                {/* Export + resumo */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">
                    {produtosFiltrados.length} produto{produtosFiltrados.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => exportarXlsx(produtosFiltrados, imagens)}
                    className="h-9 px-4 bg-white border border-charme-border text-charme text-sm font-medium rounded-lg hover:bg-charme/5 transition-colors"
                  >
                    📥 Exportar Excel
                  </button>
                </div>
              </div>

              {/* Resumo consolidado — usa resumo_global (dados brutos da IA, sem filtro MIN_OCORRENCIAS) */}
              <ResumoConsolidado
                resumoGlobal={resumoGlobal}
                totalNegativas={produtos.reduce((s, p) => s + p.total_negativas, 0)}
                totalProdutos={produtos.length}
              />

              {/* Grid de cards */}
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
        </div>
      </main>
    </div>
  );
}

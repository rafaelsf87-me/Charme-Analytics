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

type Ordenacao = 'negativas' | 'nota' | 'total';
type Mode = 'upload' | 'processing' | 'results';

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
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('negativas');
  const [busca, setBusca] = useState('');

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
    setOrdenacao('negativas');
  }

  // Filtrar + ordenar
  const produtosFiltrados = useMemo(() => {
    let lista = [...produtos];

    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(p => {
        const img = imagens.get(p.product_handle);
        const nome = img?.title ?? p.product_handle;
        return nome.toLowerCase().includes(q) || p.product_handle.toLowerCase().includes(q);
      });
    }

    if (ordenacao === 'negativas') lista.sort((a, b) => b.total_negativas - a.total_negativas);
    else if (ordenacao === 'nota') lista.sort((a, b) => a.nota_media - b.nota_media);
    else if (ordenacao === 'total') lista.sort((a, b) => b.total_reviews - a.total_reviews);

    return lista;
  }, [produtos, imagens, busca, ordenacao]);

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
          <Image src="/logo.png" alt="Charme Analytics" width={24} height={24} className="rounded-md" />
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
                <div className="flex flex-col sm:flex-row gap-2 flex-1">
                  {/* Busca */}
                  <input
                    type="text"
                    placeholder="Buscar produto..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:border-charme/40 w-full sm:w-56"
                  />

                  {/* Ordenação */}
                  <select
                    value={ordenacao}
                    onChange={e => setOrdenacao(e.target.value as Ordenacao)}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:border-charme/40"
                  >
                    <option value="negativas">Mais reclamações</option>
                    <option value="nota">Pior nota média</option>
                    <option value="total">Mais avaliações</option>
                  </select>
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

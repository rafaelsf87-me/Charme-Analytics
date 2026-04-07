'use client';

import { useCallback, useRef, useState } from 'react';
import Papa from 'papaparse';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewRow {
  body: string;
  title: string;
  rating: number;
  product_handle: string;
  review_date: string;
}

export interface ParsedData {
  negativas: ReviewRow[];
  total: number;
  totalNegativas: number;
  produtosUnicos: number;
  periodoInicio: string;
  periodoFim: string;
  totalReviewsPorProduto: Record<string, { total: number; nota_media: number }>;
}

interface UploadFormProps {
  onConfirm: (data: ParsedData) => void;
}

const REQUIRED_COLS = ['body', 'rating', 'product_handle'];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '?';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
}

function parseCsv(file: File): Promise<ParsedData | string> {
  return new Promise(resolve => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const fields = results.meta.fields ?? [];
        const missing = REQUIRED_COLS.filter(c => !fields.includes(c));
        if (missing.length > 0) {
          resolve(`Colunas obrigatórias ausentes: ${missing.join(', ')}`);
          return;
        }

        type RawRow = Record<string, string>;
        const rows = results.data as RawRow[];
        const all: ReviewRow[] = rows.map(r => ({
          body: r.body ?? '',
          title: r.title ?? '',
          rating: parseFloat(r.rating ?? '5'),
          product_handle: r.product_handle ?? '',
          review_date: r.review_date ?? '',
        }));

        // Agregar totais por produto (todas as reviews)
        const totalReviewsPorProduto: Record<string, { total: number; soma_nota: number; nota_media: number }> = {};
        for (const r of all) {
          if (!r.product_handle) continue;
          if (!totalReviewsPorProduto[r.product_handle]) {
            totalReviewsPorProduto[r.product_handle] = { total: 0, soma_nota: 0, nota_media: 0 };
          }
          totalReviewsPorProduto[r.product_handle].total++;
          totalReviewsPorProduto[r.product_handle].soma_nota += r.rating;
        }
        const totaisFinal: Record<string, { total: number; nota_media: number }> = {};
        for (const [h, v] of Object.entries(totalReviewsPorProduto)) {
          totaisFinal[h] = { total: v.total, nota_media: v.total > 0 ? v.soma_nota / v.total : 0 };
        }

        const negativas = all.filter(r => r.rating <= 3 && r.product_handle);
        const produtosSet = new Set(negativas.map(r => r.product_handle));

        const datas = negativas.map(r => r.review_date).filter(Boolean).sort();
        const periodoInicio = datas[0] ?? '';
        const periodoFim = datas[datas.length - 1] ?? '';

        resolve({
          negativas,
          total: all.length,
          totalNegativas: negativas.length,
          produtosUnicos: produtosSet.size,
          periodoInicio,
          periodoFim,
          totalReviewsPorProduto: totaisFinal,
        });
      },
      error(err) {
        resolve(`Erro ao ler arquivo: ${err.message}`);
      },
    });
  });
}

// ─── Componente ────────────────────────────────────────────────────────────────

export function UploadForm({ onConfirm }: UploadFormProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setError('Arquivo deve ser .csv');
      return;
    }
    setParsing(true);
    setError(null);
    setParsed(null);

    const result = await parseCsv(file);
    setParsing(false);

    if (typeof result === 'string') {
      setError(result);
    } else {
      setParsed(result);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleReset() {
    setParsed(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  // ── Resumo após parse ──────────────────────────────────────────────────────

  if (parsed) {
    const pct = parsed.total > 0 ? ((parsed.totalNegativas / parsed.total) * 100).toFixed(1) : '0';
    const semNegativas = parsed.totalNegativas === 0;

    return (
      <div className="w-full max-w-lg mx-auto">
        {/* Título pós-upload */}
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-charme-text">Arquivo Importado com Sucesso</h1>
          <p className="mt-1 text-sm text-zinc-500">Revise o resumo antes de iniciar a análise</p>
        </div>

        <div className="bg-white border border-charme-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📊</span>
            <h2 className="font-semibold text-charme-text">Resumo do arquivo</h2>
          </div>

          <div className="space-y-2 text-sm text-zinc-600 mb-6">
            <div className="flex justify-between">
              <span>Total de avaliações</span>
              <span className="font-medium text-zinc-900">{parsed.total.toLocaleString('pt-BR')}</span>
            </div>
            <div className="flex justify-between">
              <span>Avaliações negativas (≤ 3 estrelas)</span>
              <span className="font-medium text-red-600">
                {parsed.totalNegativas.toLocaleString('pt-BR')} ({pct}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Produtos com avaliações negativas</span>
              <span className="font-medium text-zinc-900">{parsed.produtosUnicos}</span>
            </div>
            {parsed.periodoInicio && (
              <div className="flex justify-between">
                <span>Período</span>
                <span className="font-medium text-zinc-900">
                  {fmtDate(parsed.periodoInicio)} a {fmtDate(parsed.periodoFim)}
                </span>
              </div>
            )}
          </div>

          {semNegativas ? (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 mb-4">
              Nenhuma avaliação negativa encontrada neste arquivo.
            </div>
          ) : null}

          <div className="flex gap-3">
            <button
              onClick={() => onConfirm(parsed)}
              disabled={semNegativas}
              className="flex-1 py-2.5 bg-charme text-white text-sm font-medium rounded-lg hover:bg-charme-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Analisar Avaliações
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2.5 border border-zinc-200 text-zinc-600 text-sm rounded-lg hover:bg-zinc-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Área de upload ─────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Título pré-upload */}
      <div className="mb-6 text-center">
        <h1 className="text-lg font-semibold text-charme-text">Upload de Avaliações</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Importe o CSV exportado do Judge.me para análise automática
        </p>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-4 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-all
          ${dragging
            ? 'border-charme bg-charme/5'
            : 'border-zinc-200 bg-white hover:border-charme/40 hover:bg-charme/[0.02]'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleInputChange}
        />

        {parsing ? (
          <>
            <div className="w-8 h-8 border-2 border-charme-border border-t-charme rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">Lendo arquivo...</p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-charme/10 flex items-center justify-center text-2xl">
              📄
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-700">
                Arraste o arquivo CSV aqui
              </p>
              <p className="text-xs text-zinc-400 mt-1">ou clique para selecionar</p>
            </div>
            <p className="text-xs text-zinc-400">
              Exportação Judge.me — apenas <code className="bg-zinc-100 px-1 rounded">.csv</code>
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

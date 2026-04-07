'use client';

import Image from 'next/image';
import type { ProdutoResultado } from '@/app/api/avaliacoes/analisar/route';
import type { ProdutoImagem } from '@/app/api/avaliacoes/imagens/route';

interface ProdutoCardProps {
  produto: ProdutoResultado;
  imagem: ProdutoImagem | undefined;
}

function humanizeHandle(handle: string): string {
  return handle
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function ProdutoCard({ produto, imagem }: ProdutoCardProps) {
  const titulo = imagem?.title && imagem.title !== imagem.handle
    ? imagem.title
    : humanizeHandle(produto.product_handle);

  const maxQtd = produto.problemas[0]?.quantidade ?? 1;

  return (
    <div className="bg-white border border-charme-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-4 p-5 border-b border-zinc-100">
        {/* Thumbnail */}
        <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 flex items-center justify-center">
          {imagem?.imageUrl ? (
            <Image
              src={imagem.imageUrl}
              alt={imagem.imageAlt ?? titulo}
              width={64}
              height={64}
              className="object-cover w-full h-full"
            />
          ) : (
            <span className="text-2xl">🛍️</span>
          )}
        </div>

        {/* Título + métricas */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-charme-text leading-snug line-clamp-2">
            {titulo}
          </h3>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            <span className="text-xs text-zinc-500">
              ⭐ <span className="font-medium text-zinc-700">{produto.nota_media.toFixed(1)}</span> média
            </span>
            <span className="text-xs text-zinc-400">·</span>
            <span className="text-xs text-zinc-500">
              <span className="font-medium text-zinc-700">{produto.total_reviews.toLocaleString('pt-BR')}</span> avaliações
            </span>
            <span className="text-xs text-zinc-400">·</span>
            <span className="text-xs text-red-500 font-medium">
              {produto.total_negativas.toLocaleString('pt-BR')} negativas
            </span>
          </div>
        </div>
      </div>

      {/* Problemas */}
      <div className="p-5">
        {produto.problemas.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">Nenhum problema com ≥5% das avaliações negativas.</p>
        ) : (
          <>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
              Principais Problemas
            </p>
            <div className="space-y-2.5">
              {produto.problemas.map(prob => {
                const baraPct = maxQtd > 0 ? (prob.quantidade / maxQtd) * 100 : 0;
                return (
                  <div key={prob.categoria}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-700 font-medium">{prob.categoria}</span>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {prob.quantidade} <span className="text-zinc-400">({fmtPct(prob.percentual)})</span>
                      </span>
                    </div>
                    <div className="w-full bg-zinc-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          width: `${baraPct}%`,
                          backgroundColor: '#553679',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {produto.omitidas > 0 && (
              <p className="mt-3 text-[11px] text-zinc-400 italic">
                {produto.omitidas} {produto.omitidas === 1 ? 'avaliação omitida' : 'avaliações omitidas'} por representar menos de 5% das negativas.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

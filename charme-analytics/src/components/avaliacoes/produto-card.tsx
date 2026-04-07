'use client';

import Image from 'next/image';
import type { ProdutoResultado, TipoProblema } from '@/app/api/avaliacoes/analisar/route';
import type { ProdutoImagem } from '@/app/api/avaliacoes/imagens/route';

interface ProdutoCardProps {
  produto: ProdutoResultado;
  imagem: ProdutoImagem | undefined;
}

function humanizeHandle(handle: string): string {
  return handle.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function barColor(tipo: TipoProblema): string {
  if (tipo === 'logistica') return '#a1a1aa';
  if (tipo === 'outro') return '#d4d4d8';
  return '#553679';
}

function labelClass(tipo: TipoProblema): string {
  if (tipo === 'logistica' || tipo === 'outro') return 'text-zinc-400';
  return 'text-zinc-700 font-medium';
}

function valueClass(tipo: TipoProblema): string {
  if (tipo === 'logistica' || tipo === 'outro') return 'text-zinc-400';
  return 'text-zinc-500';
}

// ─── Tooltip "i" ───────────────────────────────────────────────────────────────

function InfoTooltip({ textos }: { textos: string[] }) {
  if (textos.length === 0) return null;
  return (
    <div className="relative group/tip inline-flex items-center shrink-0 ml-1.5">
      {/* Ícone */}
      <div className="w-4 h-4 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-400 text-[9px] font-bold flex items-center justify-center cursor-help select-none hover:bg-zinc-200 transition-colors">
        i
      </div>

      {/* Tooltip — aparece acima do ícone */}
      <div className="
        absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
        hidden group-hover/tip:block
        w-80 bg-zinc-900 text-zinc-100 text-[11px] leading-relaxed
        rounded-xl shadow-2xl
        pointer-events-none
      ">
        {/* Conteúdo */}
        <div className="p-3 max-h-56 overflow-y-auto space-y-2">
          {textos.map((t, i) => (
            <p
              key={i}
              className="border-b border-zinc-700/60 pb-2 last:border-0 last:pb-0"
            >
              &ldquo;{t}&rdquo;
            </p>
          ))}
        </div>

        {/* Seta */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-zinc-900" />
      </div>
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────

export function ProdutoCard({ produto, imagem }: ProdutoCardProps) {
  const titulo = imagem?.title && imagem.title !== imagem.handle
    ? imagem.title
    : humanizeHandle(produto.product_handle);

  const maxQtdProduto = produto.problemas
    .filter(p => p.tipo === 'produto')
    .reduce((m, p) => Math.max(m, p.quantidade), 1);

  const temConteudo = produto.problemas.length > 0 || produto.outros > 0;

  return (
    // overflow-visible necessário para o tooltip não ser cortado pelo card
    <div className="bg-white border border-charme-border rounded-xl shadow-sm">

      {/* Header */}
      <div className="flex items-start gap-4 p-5 border-b border-zinc-100">
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
              <span className="font-medium text-zinc-700">{produto.total_reviews.toLocaleString('pt-BR')}</span>{' '}
              {produto.total_reviews === 1 ? 'avaliação' : 'avaliações'}
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
        {!temConteudo ? (
          <p className="text-xs text-zinc-400 italic">
            Nenhum problema recorrente encontrado (mínimo 2 ocorrências).
          </p>
        ) : (
          <>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
              Principais Problemas
            </p>
            <div className="space-y-2.5">

              {produto.problemas.map(prob => {
                const barBase = prob.tipo === 'produto' ? maxQtdProduto : produto.total_negativas;
                const baraPct = barBase > 0 ? (prob.quantidade / barBase) * 100 : 0;

                return (
                  <div key={prob.categoria}>
                    <div className="flex items-center justify-between mb-1 gap-2">
                      {/* Label + badge logística + ícone i */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {prob.tipo === 'logistica' && (
                          <span className="text-[9px] text-zinc-400 border border-zinc-200 rounded px-1 shrink-0">
                            logística
                          </span>
                        )}
                        <span className={`text-xs truncate ${labelClass(prob.tipo)}`}>
                          {prob.categoria}
                        </span>
                        <InfoTooltip textos={prob.textos} />
                      </div>
                      {/* Contagem */}
                      <span className={`text-xs tabular-nums shrink-0 ${valueClass(prob.tipo)}`}>
                        {prob.quantidade}{' '}
                        <span className="text-zinc-400">({fmtPct(prob.percentual)})</span>
                      </span>
                    </div>
                    <div className="w-full bg-zinc-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: `${baraPct}%`, backgroundColor: barColor(prob.tipo) }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Outros não identificados */}
              {produto.outros > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <div className="flex items-center min-w-0 flex-1">
                      <span className="text-xs text-zinc-400 italic">Outros não identificados</span>
                      <InfoTooltip textos={produto.textos_outros} />
                    </div>
                    <span className="text-xs text-zinc-400 tabular-nums shrink-0">
                      {produto.outros}{' '}
                      <span className="text-zinc-300">
                        ({fmtPct((produto.outros / produto.total_negativas) * 100)})
                      </span>
                    </span>
                  </div>
                  <div className="w-full bg-zinc-100 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${(produto.outros / produto.total_negativas) * 100}%`,
                        backgroundColor: '#e4e4e7',
                      }}
                    />
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  );
}

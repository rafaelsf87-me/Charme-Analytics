'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import type { ProdutoResultado, TipoProblema, SubCategoria } from '@/app/api/avaliacoes/analisar/route';
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
  if (tipo === 'positiva') return '#16a34a';
  if (tipo === 'logistica') return '#a1a1aa';
  if (tipo === 'outro') return '#d4d4d8';
  return '#553679';
}

function labelClass(tipo: TipoProblema): string {
  if (tipo === 'positiva') return 'text-green-600 font-medium';
  if (tipo === 'logistica' || tipo === 'outro') return 'text-zinc-400';
  return 'text-zinc-700 font-medium';
}

function valueClass(tipo: TipoProblema): string {
  if (tipo === 'positiva') return 'text-green-500';
  if (tipo === 'logistica' || tipo === 'outro') return 'text-zinc-400';
  return 'text-zinc-500';
}

// ─── Tooltip de avaliações ──────────────────────────────────────────────────────

function InfoTooltip({ textos, subcategorias, total }: { textos: string[]; subcategorias: SubCategoria[]; total: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  if (total === 0) return null;

  function handleCopy() {
    let lines: string[] = [];
    if (subcategorias.length > 0) {
      for (const sub of subcategorias) {
        lines.push(`— ${sub.nome} (${sub.quantidade})`);
        sub.textos.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
        lines.push('');
      }
      // textos que ficaram diretamente no pai (não em sub)
      const subTextos = new Set(subcategorias.flatMap(s => s.textos));
      const diretos = textos.filter(t => !subTextos.has(t));
      if (diretos.length > 0) {
        lines.push('— Sem subcategoria');
        diretos.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
      }
    } else {
      lines = textos.map((t, i) => `${i + 1}. ${t}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="relative inline-flex items-center shrink-0 ml-1.5" ref={ref}>
      {/* Botão — mostra contagem de avaliações */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-0.5 text-[10px] border rounded px-1 py-0.5 transition-colors cursor-pointer ${
          open
            ? 'bg-zinc-700 border-zinc-600 text-zinc-100'
            : 'bg-zinc-100 border-zinc-200 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600'
        }`}
      >
        <span className="font-medium">ver</span>
        <span className="font-bold">{total}</span>
      </button>

      {/* Painel */}
      {open && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-84 min-w-[320px] max-w-[360px] bg-zinc-900 text-zinc-100 text-[11px] leading-relaxed rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-zinc-700/60">
            <span className="text-[10px] text-zinc-400 font-medium">
              {total} avaliação{total !== 1 ? 'ões' : ''}
              {subcategorias.length > 0 && ` · ${subcategorias.length} subcategorias`}
            </span>
            <button
              onClick={handleCopy}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {copied ? '✓ Copiado' : 'Copiar tudo'}
            </button>
          </div>

          {/* Conteúdo com scroll */}
          <div className="p-3 max-h-72 overflow-y-auto space-y-3">
            {subcategorias.length > 0 ? (
              <>
                {subcategorias.map(sub => (
                  <div key={sub.nome}>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">
                      {sub.nome} ({sub.quantidade})
                    </p>
                    <div className="space-y-1.5">
                      {sub.textos.map((t, i) => (
                        <p key={i} className="text-zinc-200 border-b border-zinc-700/40 pb-1.5 last:border-0 last:pb-0 select-text">
                          &ldquo;{t}&rdquo;
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
                {/* Textos diretos no pai (sem subcategoria específica) */}
                {(() => {
                  const subTextos = new Set(subcategorias.flatMap(s => s.textos));
                  const diretos = textos.filter(t => !subTextos.has(t));
                  return diretos.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">
                        Outros ({diretos.length})
                      </p>
                      <div className="space-y-1.5">
                        {diretos.map((t, i) => (
                          <p key={i} className="text-zinc-200 border-b border-zinc-700/40 pb-1.5 last:border-0 last:pb-0 select-text">
                            &ldquo;{t}&rdquo;
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
              </>
            ) : (
              textos.map((t, i) => (
                <p key={i} className="text-zinc-200 border-b border-zinc-700/40 pb-2 last:border-0 last:pb-0 select-text">
                  &ldquo;{t}&rdquo;
                </p>
              ))
            )}
          </div>

          {/* Seta */}
          <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-zinc-900" />
        </div>
      )}
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
                        <InfoTooltip textos={prob.textos} subcategorias={prob.subcategorias} total={prob.quantidade} />
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
                      <InfoTooltip textos={produto.textos_outros} subcategorias={[]} total={produto.textos_outros.length} />
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AvaliacoesView } from './resultados-view';

type Selected = null | 'avaliacoes';

export function AvaliacoesSelectorView() {
  const [selected, setSelected] = useState<Selected>(null);

  if (selected === 'avaliacoes') {
    return <AvaliacoesView />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 bg-charme border-b border-charme/20 shrink-0">
        <Link href="/home" className="text-sm text-white/60 hover:text-white transition-colors">
          ← Voltar
        </Link>
        <span className="text-white/30">|</span>
        <Link href="/home">
          <Image src="/logo.png" alt="Charme Analytics" width={24} height={24} className="rounded-md" />
        </Link>
        <span className="font-semibold text-white text-sm">Análise Avaliações Negativas e Devoluções</span>
      </header>

      {/* Seletor */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <p className="text-sm text-zinc-500 mb-6">Selecione o tipo de análise:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-xl">

          {/* Card 1 — Avaliações Negativas */}
          <button
            onClick={() => setSelected('avaliacoes')}
            className="group flex flex-col items-start gap-3 bg-white border border-charme-border rounded-xl shadow-sm p-6 text-left hover:border-charme/40 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <Image src="/logo_shopify.png" alt="Shopify" width={32} height={32} className="rounded-lg" />
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Judge.me</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-800 group-hover:text-charme transition-colors">
                Avaliações Negativas
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Análise de reclamações por produto com upload de CSV
              </p>
            </div>
          </button>

          {/* Card 2 — Devoluções Bling */}
          <Link
            href="/avaliacoes/devolucoes"
            className="group flex flex-col items-start gap-3 bg-white border border-charme-border rounded-xl shadow-sm p-6 text-left hover:border-charme/40 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <Image src="/bling_logo.png" alt="Bling" width={32} height={32} className="rounded-lg" />
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Bling v3</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-800 group-hover:text-charme transition-colors">
                Devoluções &amp; Cancelamentos
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Taxa de devolução e cancelamento por SKU via API Bling
              </p>
            </div>
          </Link>

        </div>
      </main>
    </div>
  );
}

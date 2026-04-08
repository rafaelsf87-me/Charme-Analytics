import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Brain, BarChart2, FileSpreadsheet, Lightbulb } from 'lucide-react';
import { LogoutButton } from '@/components/logout-button';

export default async function HomPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/home"><Image src="/logo.png" alt="Charme Analytics" width={28} height={28} className="rounded-lg" /></Link>
          <span className="font-semibold text-white">Charme Analytics</span>
          <span className="ml-1 text-xs text-white/60 hidden sm:inline">Central de Inteligência</span>
        </div>
        <LogoutButton />
      </header>

      {/* Conteúdo */}
      <main className="flex flex-1 flex-col items-center justify-start px-6 pt-10 pb-6">
        <div className="mb-6 text-center">
          <Image
            src="/logo.png"
            alt="Charme Analytics"
            width={52}
            height={52}
            className="rounded-2xl mx-auto mb-4 shadow-sm"
          />
          <h1 className="text-xl font-semibold text-charme-text">O que você quer fazer?</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Escolha uma ferramenta para começar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-4xl">
          {/* Card 1 — Central de Dados */}
          <Link href="/chat" className="group">
            <div className="flex flex-col h-full bg-white border border-charme-border rounded-xl p-6 shadow-sm transition-all hover:shadow-md hover:border-charme/30 cursor-pointer">
              <div className="mb-4 flex items-center justify-between">
                <Brain className="text-charme" size={30} strokeWidth={1.5} />
                <div className="flex items-center gap-1.5">
                  <Image src="/logo_analytics.png" alt="GA4" width={18} height={18} className="object-contain opacity-80" />
                  <Image src="/logo_shopify.png" alt="Shopify" width={18} height={18} className="object-contain opacity-80" />
                  <Image src="/images.png" alt="Meta" width={18} height={18} className="object-contain opacity-80" />
                  <Image src="/logo_google.png" alt="Google Ads" width={18} height={18} className="object-contain opacity-80" />
                </div>
              </div>
              <h2 className="text-base font-semibold text-charme-text mb-1.5">Dados e Insights</h2>
              <p className="text-xs text-zinc-500 flex-1 leading-relaxed">
                Relatórios em linguagem natural cruzando Shopify, GA4, Google Ads e Meta Ads.
              </p>
              <div className="mt-4 flex items-center text-sm font-medium text-charme group-hover:text-charme-hover transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>

          {/* Card 2 — Relatório de Criativos */}
          <Link href="/criativos" className="group">
            <div className="flex flex-col h-full bg-white border border-charme-border rounded-xl p-6 shadow-sm transition-all hover:shadow-md hover:border-charme/30 cursor-pointer">
              <div className="mb-4 flex items-center justify-between">
                <BarChart2 className="text-charme" size={30} strokeWidth={1.5} />
                <div className="flex items-center gap-1.5">
                  <Image src="/logo_google.png" alt="Google Ads" width={18} height={18} className="object-contain opacity-80" />
                  <Image src="/images.png" alt="Meta" width={18} height={18} className="object-contain opacity-80" />
                </div>
              </div>
              <h2 className="text-base font-semibold text-charme-text mb-1.5">Relatório ADS</h2>
              <p className="text-xs text-zinc-500 flex-1 leading-relaxed">
                Performance dos anúncios por criativo com thumbnails, Google Ads e Meta Ads.
              </p>
              <div className="mt-4 flex items-center text-sm font-medium text-charme group-hover:text-charme-hover transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>

          {/* Card 3 — Análise de Avaliações */}
          <Link href="/avaliacoes" className="group">
            <div className="flex flex-col h-full bg-white border border-charme-border rounded-xl p-6 shadow-sm transition-all hover:shadow-md hover:border-charme/30 cursor-pointer">
              <div className="mb-4 flex items-center justify-between">
                <FileSpreadsheet className="text-charme" size={30} strokeWidth={1.5} />
                <div className="flex items-center gap-1.5">
                  <FileSpreadsheet size={18} className="text-zinc-400" strokeWidth={1.5} />
                  <Lightbulb size={18} className="text-zinc-400" strokeWidth={1.5} />
                </div>
              </div>
              <h2 className="text-base font-semibold text-charme-text mb-1.5">Analise Avaliações Negativas Shopify</h2>
              <p className="text-xs text-zinc-500 flex-1 leading-relaxed">
                Upload do CSV Judge.me e identificação automática dos problemas por produto.
              </p>
              <div className="mt-4 flex items-center text-sm font-medium text-charme group-hover:text-charme-hover transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

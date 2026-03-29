import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Brain, BarChart2 } from 'lucide-react';
import { LogoutButton } from '@/components/logout-button';

export default async function HomPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Charme Analytics" width={32} height={32} className="rounded-lg" />
          <span className="font-semibold text-white">Charme Analytics</span>
          <span className="ml-1 text-xs text-white/60 hidden sm:inline">Central de Inteligência</span>
        </div>
        <LogoutButton />
      </header>

      {/* Conteúdo */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mb-10 text-center">
          <Image
            src="/logo.png"
            alt="Charme Analytics"
            width={64}
            height={64}
            className="rounded-2xl mx-auto mb-5 shadow-sm"
          />
          <h1 className="text-2xl font-semibold text-charme-text">O que você quer fazer?</h1>
          <p className="mt-1 text-sm text-zinc-500">Escolha uma ferramenta para começar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
          {/* Card 1 — Central de Dados */}
          <Link href="/chat" className="group">
            <div className="flex flex-col h-full bg-white border border-charme-border rounded-xl p-8 shadow-sm transition-all hover:shadow-md hover:border-charme/30 cursor-pointer">
              <div className="mb-5 flex items-center justify-between">
                <Brain className="text-charme" size={36} strokeWidth={1.5} />
                <div className="flex items-center gap-2">
                  <Image src="/logo_analytics.png" alt="GA4" width={22} height={22} className="object-contain opacity-80" />
                  <Image src="/logo_shopify.png" alt="Shopify" width={22} height={22} className="object-contain opacity-80" />
                  <Image src="/images.png" alt="Meta" width={22} height={22} className="object-contain opacity-80" />
                  <Image src="/logo_google.png" alt="Google Ads" width={22} height={22} className="object-contain opacity-80" />
                </div>
              </div>
              <h2 className="text-lg font-semibold text-charme-text mb-2">Dados e Insights</h2>
              <p className="text-sm text-zinc-500 flex-1 leading-relaxed">
                Perguntas e relatórios em linguagem natural cruzando Shopify, GA4, Google Ads e Meta Ads.
              </p>
              <div className="mt-6 flex items-center text-sm font-medium text-charme group-hover:text-charme-hover transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>

          {/* Card 2 — Relatório de Criativos */}
          <Link href="/criativos" className="group">
            <div className="flex flex-col h-full bg-white border border-charme-border rounded-xl p-8 shadow-sm transition-all hover:shadow-md hover:border-charme/30 cursor-pointer">
              <div className="mb-5 flex items-center justify-between">
                <BarChart2 className="text-charme" size={36} strokeWidth={1.5} />
                <div className="flex items-center gap-2">
                  <Image src="/logo_google.png" alt="Google Ads" width={22} height={22} className="object-contain opacity-80" />
                  <Image src="/images.png" alt="Meta" width={22} height={22} className="object-contain opacity-80" />
                </div>
              </div>
              <h2 className="text-lg font-semibold text-charme-text mb-2">Relatório ADS</h2>
              <p className="text-sm text-zinc-500 flex-1 leading-relaxed">
                Performance dos anúncios por criativo com thumbnails e métricas de Google Ads e Meta Ads.
              </p>
              <div className="mt-6 flex items-center text-sm font-medium text-charme group-hover:text-charme-hover transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

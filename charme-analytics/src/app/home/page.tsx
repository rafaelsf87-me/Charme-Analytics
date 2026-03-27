import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';

export default async function HomPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-zinc-100">
        <div>
          <span className="font-semibold text-zinc-900">Charme Analytics</span>
          <span className="ml-2 text-xs text-zinc-400">Central de Inteligência</span>
        </div>
        <LogoutButton />
      </header>

      {/* Conteúdo */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">O que você quer fazer?</h1>
          <p className="mt-1 text-sm text-zinc-500">Escolha uma ferramenta para começar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
          {/* Card 1 — Central de Dados */}
          <Link href="/chat" className="group">
            <div className="flex flex-col h-full bg-white border border-zinc-200 rounded-xl p-8 shadow-sm transition-all hover:shadow-md hover:border-zinc-300 cursor-pointer">
              <div className="text-4xl mb-5">📊</div>
              <h2 className="text-lg font-semibold text-zinc-900 mb-2">Central de Dados</h2>
              <p className="text-sm text-zinc-500 flex-1 leading-relaxed">
                Perguntas e relatórios em linguagem natural cruzando Shopify, GA4, Google Ads e Meta Ads.
              </p>
              <div className="mt-6 flex items-center text-sm font-medium text-zinc-700 group-hover:text-zinc-900 transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>

          {/* Card 2 — Relatório de Criativos */}
          <Link href="/criativos" className="group">
            <div className="flex flex-col h-full bg-white border border-zinc-200 rounded-xl p-8 shadow-sm transition-all hover:shadow-md hover:border-zinc-300 cursor-pointer">
              <div className="text-4xl mb-5">🎯</div>
              <h2 className="text-lg font-semibold text-zinc-900 mb-2">Relatório de Criativos</h2>
              <p className="text-sm text-zinc-500 flex-1 leading-relaxed">
                Performance dos anúncios por criativo com thumbnails e métricas de Google Ads e Meta Ads.
              </p>
              <div className="mt-6 flex items-center text-sm font-medium text-zinc-700 group-hover:text-zinc-900 transition-colors">
                Acessar <span className="ml-1">→</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

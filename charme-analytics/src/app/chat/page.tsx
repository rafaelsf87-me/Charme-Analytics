import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChatInterface } from '@/components/chat-interface';
import { LogoutButton } from '@/components/logout-button';

export default async function ChatPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-50">
      {/* Header fixo */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-zinc-100 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/home" className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors">
            ← Voltar
          </Link>
          <span className="text-zinc-200">|</span>
          <span className="font-semibold text-zinc-900">Charme Analytics</span>
          <span className="text-xs text-zinc-400 hidden sm:inline">Central de Dados</span>
        </div>
        <LogoutButton />
      </header>

      {/* Chat */}
      <ChatInterface />
    </div>
  );
}

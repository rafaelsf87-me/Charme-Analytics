import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChatInterface } from '@/components/chat-interface';
import { LogoutButton } from '@/components/logout-button';

export default async function ChatPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return (
    <div className="flex flex-col h-screen bg-charme-bg">
      {/* Header fixo */}
      <header className="flex items-center justify-between px-4 py-3 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/home" className="text-sm text-white/60 hover:text-white transition-colors">
            ← Voltar
          </Link>
          <span className="text-white/30">|</span>
          <Link href="/home"><Image src="/logo.png" alt="Charme Analytics" width={28} height={28} className="rounded-md" /></Link>
          <span className="font-semibold text-white">Charme Analytics</span>
          <span className="text-xs text-white/50 hidden sm:inline">Central de Dados</span>
        </div>
        <LogoutButton />
      </header>

      {/* Chat */}
      <ChatInterface />
    </div>
  );
}

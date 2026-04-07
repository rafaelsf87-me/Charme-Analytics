import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AvaliacoesView } from '@/components/avaliacoes/resultados-view';

export default async function AvaliacoesPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return <AvaliacoesView />;
}

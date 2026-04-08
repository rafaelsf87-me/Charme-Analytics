import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AvaliacoesSelectorView } from '@/components/avaliacoes/avaliacoes-selector';

export default async function AvaliacoesPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return <AvaliacoesSelectorView />;
}

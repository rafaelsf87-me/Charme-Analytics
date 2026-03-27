import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CriativosView } from '@/components/criativos/criativos-view';

export default async function CriativosPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('charme_auth')?.value) {
    redirect('/');
  }

  return <CriativosView />;
}

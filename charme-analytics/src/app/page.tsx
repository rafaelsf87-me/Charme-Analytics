import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';

export default async function HomePage() {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('charme_auth');

  // Se já autenticado, vai pra home
  if (authCookie?.value) {
    redirect('/home');
  }

  return <LoginForm />;
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Image from 'next/image';

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/home');
      } else {
        const data = await res.json();
        setError(data.error ?? 'Senha incorreta');
      }
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-charme-bg px-4">
      <Card className="w-full max-w-sm shadow-sm border-charme-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Charme Analytics"
              width={48}
              height={48}
              className="rounded-xl shrink-0"
              priority
            />
            <div>
              <CardTitle className="text-xl font-semibold tracking-tight text-charme-text">
                Charme Analytics
              </CardTitle>
              <CardDescription className="text-zinc-500 text-sm">
                Central de Dados
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
            <Input
              type="password"
              placeholder="Senha de acesso"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={loading}
              className="border-charme-border focus-visible:ring-charme/30"
            />
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            <Button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-charme hover:bg-charme-hover text-white"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

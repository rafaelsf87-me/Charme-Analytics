// ─── OAuth Callback — Setup inicial Bling ────────────────────────────────────
// Recebe o authorization_code após o Rafael autorizar o app no Bling.
// Exibe os tokens na tela para copiar para o .env.local.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Parâmetro "code" ausente na URL.', { status: 400 });
  }

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(
      'BLING_CLIENT_ID e BLING_CLIENT_SECRET não configurados no .env.',
      { status: 500 }
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return new Response(`Erro ao trocar código por token: ${res.status} — ${body}`, {
      status: 500,
    });
  }

  const data = await res.json();
  const expiresInHours = Math.round((data.expires_in ?? 21600) / 3600);

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bling — Tokens Gerados</title>
  <style>
    body { font-family: monospace; background: #F8F5FC; padding: 40px; max-width: 700px; margin: 0 auto; }
    h2 { color: #553679; }
    pre { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; white-space: pre-wrap; word-break: break-all; font-size: 13px; }
    .warn { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; color: #9a3412; font-size: 14px; margin-top: 20px; }
    .step { margin: 8px 0; }
  </style>
</head>
<body>
  <h2>✅ Tokens Bling gerados com sucesso!</h2>
  <p>Copie e cole no <strong>.env.local</strong> (e configure também na Vercel → Settings → Environment Variables):</p>
  <pre>BLING_ACCESS_TOKEN=${data.access_token ?? ''}
BLING_REFRESH_TOKEN=${data.refresh_token ?? ''}</pre>
  <div class="warn">
    <strong>⚠️ Próximos passos:</strong>
    <div class="step">1. Cole as variáveis acima no <code>.env.local</code></div>
    <div class="step">2. Configure as mesmas variáveis na Vercel (Settings → Environment Variables)</div>
    <div class="step">3. Faça redeploy na Vercel</div>
    <div class="step">4. O sistema renovará o token automaticamente a cada ${expiresInHours}h</div>
    <div class="step">5. Re-autorize em ~30 dias quando o refresh_token expirar</div>
  </div>
</body>
</html>
  `.trim();

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

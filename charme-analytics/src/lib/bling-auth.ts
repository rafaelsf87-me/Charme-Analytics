// ─── Bling OAuth2 Helper ──────────────────────────────────────────────────────
// Estratégia: no cold start, usa BLING_ACCESS_TOKEN do env diretamente.
// Só faz refresh quando a API retorna 401 (token expirado de verdade).
// Isso evita invalidar o refresh_token desnecessariamente.

interface BlingTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedTokens: BlingTokens | null = null;

async function doRefresh(refreshToken: string): Promise<BlingTokens> {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('BLING_CLIENT_ID e BLING_CLIENT_SECRET não configurados no .env');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bling token refresh falhou: ${res.status} — ${body}`);
  }

  const data = await res.json();
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt:    Date.now() + (data.expires_in * 1000),
  };
}

function getEnvToken(): string {
  const token = process.env.BLING_ACCESS_TOKEN;
  if (!token) throw new Error('BLING_ACCESS_TOKEN não configurado. Complete o setup OAuth no Bling.');
  return token;
}

function getEnvRefreshToken(): string {
  const token = process.env.BLING_REFRESH_TOKEN;
  if (!token) throw new Error('BLING_REFRESH_TOKEN não configurado. Complete o setup OAuth no Bling.');
  return token;
}

function getCurrentToken(): string {
  // Cache válido com 5min de margem
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - 300_000) {
    return cachedTokens.accessToken;
  }
  // Cold start ou expirado: usa o access_token do env diretamente (sem refresh prévio)
  return cachedTokens?.accessToken ?? getEnvToken();
}

/**
 * Faz uma requisição autenticada à API Bling v3.
 * Tenta o access_token atual; em 401, faz refresh e tenta uma vez mais.
 */
export async function blingFetch(path: string): Promise<unknown> {
  const doFetch = (token: string) =>
    fetch(`https://www.bling.com.br/Api/v3${path}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

  let token = getCurrentToken();
  let res = await doFetch(token);

  // 401 → refresh e retry único
  if (res.status === 401) {
    const refreshToken = cachedTokens?.refreshToken ?? getEnvRefreshToken();
    cachedTokens = await doRefresh(refreshToken);
    token = cachedTokens.accessToken;
    res = await doFetch(token);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bling API ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

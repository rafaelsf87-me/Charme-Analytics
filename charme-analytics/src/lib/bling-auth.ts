// ─── Bling OAuth2 Helper ──────────────────────────────────────────────────────
// Auto-refresh: access_token expira em 6h, refresh_token em 30 dias.
// Cache em memória (serverless — reinicia a cada cold start, volta ao .env).

interface BlingTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // timestamp ms
}

// Cache em memória do processo serverless
let cachedTokens: BlingTokens | null = null;

async function refreshTokens(refreshToken: string): Promise<BlingTokens> {
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
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bling token refresh falhou: ${res.status} — ${body}`);
  }

  const data = await res.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken, // Bling pode retornar novo refresh_token
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
}

/**
 * Retorna um access_token válido, renovando automaticamente se necessário.
 * Usa cache em memória — safe para serverless (recai para .env no cold start).
 */
export async function getBlingAccessToken(): Promise<string> {
  // Usar cache se token ainda válido (com 5min de margem)
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - 300_000) {
    return cachedTokens.accessToken;
  }

  // Tentar usar access_token do .env diretamente se ainda não expirou
  // (não temos a data de expiração do .env, então partimos pro refresh)
  const refreshToken = cachedTokens?.refreshToken ?? process.env.BLING_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error(
      'BLING_REFRESH_TOKEN não configurado. Complete o setup OAuth no Bling primeiro.'
    );
  }

  cachedTokens = await refreshTokens(refreshToken);
  return cachedTokens.accessToken;
}

/**
 * Faz uma requisição autenticada à API Bling v3.
 * Retry automático em 401 (token expirado durante a requisição).
 */
export async function blingFetch(path: string): Promise<unknown> {
  const token = await getBlingAccessToken();

  const doFetch = (t: string) =>
    fetch(`https://www.bling.com.br/Api/v3${path}`, {
      headers: {
        'Authorization': `Bearer ${t}`,
        'Accept': 'application/json',
      },
    });

  let res = await doFetch(token);

  // 401 → forçar refresh e retry único
  if (res.status === 401) {
    cachedTokens = null;
    const newToken = await getBlingAccessToken();
    res = await doFetch(newToken);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bling API ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

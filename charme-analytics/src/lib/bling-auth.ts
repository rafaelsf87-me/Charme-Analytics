// ─── Bling OAuth2 Helper ──────────────────────────────────────────────────────
// Tokens são persistidos no Upstash KV para sobreviver a cold starts.
// Fallback para env vars na primeira execução ou se o KV não estiver disponível.

import { Redis } from '@upstash/redis';

interface BlingTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const KV_KEY = 'bling_tokens';

// Cache em memória para evitar roundtrips ao KV na mesma instância
let memCache: BlingTokens | null = null;

function getKv(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function loadTokens(skipMemCache = false): Promise<BlingTokens | null> {
  if (!skipMemCache && memCache) return memCache;
  const kv = getKv();
  if (kv) {
    const stored = await kv.get<BlingTokens>(KV_KEY);
    if (stored) { memCache = stored; return stored; }
  }
  // Fallback: env vars (primeira execução)
  const accessToken = process.env.BLING_ACCESS_TOKEN;
  const refreshToken = process.env.BLING_REFRESH_TOKEN;
  if (accessToken && refreshToken) {
    return { accessToken, refreshToken, expiresAt: 0 };
  }
  return null;
}

async function saveTokens(tokens: BlingTokens): Promise<void> {
  memCache = tokens;
  const kv = getKv();
  if (kv) await kv.set(KV_KEY, tokens);
}

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

/**
 * Faz uma requisição autenticada à API Bling v3.
 * Carrega tokens do KV; em 401, faz refresh, persiste e tenta uma vez mais.
 */
export async function blingFetch(path: string): Promise<unknown> {
  const doFetch = (token: string) =>
    fetch(`https://www.bling.com.br/Api/v3${path}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

  const tokens = await loadTokens();
  if (!tokens) throw new Error('Bling: nenhum token disponível. Configure BLING_ACCESS_TOKEN e BLING_REFRESH_TOKEN.');

  let res = await doFetch(tokens.accessToken);

  // 401 → tenta refresh; se falhar (race condition), busca token mais recente do KV e tenta uma última vez
  if (res.status === 401) {
    let freshTokens: BlingTokens;
    try {
      freshTokens = await doRefresh(tokens.refreshToken);
      await saveTokens(freshTokens);
    } catch (err) {
      // Outro request pode ter feito o refresh antes — busca do KV ignorando cache
      const kvTokens = await loadTokens(true);
      if (kvTokens && kvTokens.accessToken !== tokens.accessToken) {
        freshTokens = kvTokens;
      } else {
        throw err;
      }
    }
    res = await doFetch(freshTokens.accessToken);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bling API ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

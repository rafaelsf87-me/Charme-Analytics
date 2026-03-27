import { OAuth2Client } from 'google-auth-library';
import { formatBRL, formatBRLFromMicros, formatPercent, compactTable } from '@/lib/formatters';

const TIMEOUT_MS = 30_000;
const CUSTOMER_ID = () => (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
const ENDPOINT = () =>
  `https://googleads.googleapis.com/v20/customers/${CUSTOMER_ID()}/googleAds:searchStream`;

// ─── Auth ────────────────────────────────────────────────────────────────────

let oauth2Client: OAuth2Client | null = null;

function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new OAuth2Client(
      process.env.GOOGLE_ADS_CLIENT_ID,
      process.env.GOOGLE_ADS_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });
  }
  return oauth2Client;
}

async function getAccessToken(): Promise<string> {
  const client = getOAuth2Client();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Não foi possível obter token Google Ads');
  return token;
}

// ─── HTTP + Retry ─────────────────────────────────────────────────────────────

async function fetchWithRetry(gaqlQuery: string, attempt = 1): Promise<Response> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
        'login-customer-id': (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '') || CUSTOMER_ID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: gaqlQuery }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 429 && attempt <= 3) {
      await delay(1000 * 3 ** (attempt - 1));
      return fetchWithRetry(gaqlQuery, attempt + 1);
    }

    return res;
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') throw new Error('Timeout após 30s');
    throw err;
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Parser da resposta searchStream ─────────────────────────────────────────
// A API retorna NDJSON (um JSON por linha no body)

interface GAdsRow {
  campaign?: { name: string };
  metrics?: {
    impressions: string;
    clicks: string;
    cost_micros: string;
    conversions: string;
    conversions_value: string;
    ctr: string;
  };
}

interface GAdsStreamChunk {
  results?: GAdsRow[];
  error?: { message: string };
}

async function parseStreamResponse(res: Response): Promise<GAdsRow[]> {
  const text = await res.text();
  const rows: GAdsRow[] = [];

  // searchStream retorna um array JSON (ou NDJSON)
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      for (const chunk of parsed as GAdsStreamChunk[]) {
        if (chunk.error) throw new Error(chunk.error.message);
        if (chunk.results) rows.push(...chunk.results);
      }
    } else if (parsed.error) {
      throw new Error(parsed.error.message ?? JSON.stringify(parsed.error));
    }
  } catch (e) {
    if ((e as Error).message.includes('Unexpected')) {
      // Tenta NDJSON (uma linha por chunk)
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          const chunk: GAdsStreamChunk = JSON.parse(line);
          if (chunk.error) throw new Error(chunk.error.message);
          if (chunk.results) rows.push(...chunk.results);
        } catch {
          // ignora linhas inválidas
        }
      }
    } else {
      throw e;
    }
  }

  return rows;
}

// ─── Validação de datas ──────────────────────────────────────────────────────

function validateDates(date_from: string, date_to: string): string | null {
  const from = new Date(date_from);
  const to = new Date(date_to);
  const now = new Date();
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 'Datas inválidas (use YYYY-MM-DD)';
  if (from > to) return 'date_from deve ser anterior a date_to';
  if (to > now) return 'date_to não pode ser no futuro';
  return null;
}

// ─── google_ads_campaign_report ──────────────────────────────────────────────

interface CampaignReportInput {
  date_from: string;
  date_to: string;
  limit?: number;
}

export async function google_ads_campaign_report(
  input: CampaignReportInput
): Promise<string> {
  const { date_from, date_to, limit = 20 } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Google Ads]: ${validErr}`;

  const safeLimit = Math.min(Math.max(1, limit), 100);

  const gaql = `
    SELECT
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr
    FROM campaign
    WHERE segments.date BETWEEN '${date_from}' AND '${date_to}'
      AND campaign.status = 'ENABLED'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${safeLimit}
  `.trim();

  try {
    const res = await fetchWithRetry(gaql);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const rows = await parseStreamResponse(res);

    if (rows.length === 0) {
      return `[Google Ads] Nenhuma campanha ativa encontrada no período ${date_from} a ${date_to}.`;
    }

    // Calcula totais
    let totalGasto = 0;
    let totalConversoes = 0;
    let totalReceita = 0;

    const tableRows = rows.map((row, i) => {
      const nome = row.campaign?.name ?? 'N/D';
      const impressoes = parseInt(row.metrics?.impressions ?? '0').toLocaleString('pt-BR');
      const cliques = parseInt(row.metrics?.clicks ?? '0').toLocaleString('pt-BR');
      const custoMicros = parseInt(row.metrics?.cost_micros ?? '0');
      const custo = custoMicros / 1_000_000;
      const conversoes = parseFloat(row.metrics?.conversions ?? '0');
      const receita = parseFloat(row.metrics?.conversions_value ?? '0');
      const ctr = parseFloat(row.metrics?.ctr ?? '0');

      // Métricas calculadas no backend
      const roas = custo > 0 ? receita / custo : 0;
      const cpa = conversoes > 0 ? custo / conversoes : 0;

      totalGasto += custo;
      totalConversoes += conversoes;
      totalReceita += receita;

      return [
        String(i + 1),
        nome,
        impressoes,
        cliques,
        formatPercent(ctr),
        formatBRL(custo),
        conversoes.toFixed(1),
        formatBRL(receita),
        roas > 0 ? `${roas.toFixed(2)}x` : 'N/D',
        cpa > 0 ? formatBRL(cpa) : 'N/D',
      ];
    });

    const table = compactTable(
      ['#', 'Campanha', 'Impressões', 'Cliques', 'CTR', 'Gasto', 'Conv.', 'Receita', 'ROAS', 'CPA'],
      tableRows
    );

    const roasTotal = totalGasto > 0 ? (totalReceita / totalGasto).toFixed(2) : 'N/D';

    return (
      `[Google Ads] Campanhas — ${date_from} a ${date_to} (${rows.length} campanhas)\n` +
      `${table}\n` +
      `Total: Gasto ${formatBRL(totalGasto)} | Conv. ${totalConversoes.toFixed(0)} | Receita ${formatBRL(totalReceita)} | ROAS ${roasTotal}x`
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Google Ads]: Timeout ao buscar campanhas. Sugestão: tente um período menor.`;
    }
    if (msg.includes('RESOURCE_EXHAUSTED')) {
      return `ERRO [Google Ads]: Rate limit atingido. Sugestão: aguarde alguns minutos e tente novamente.`;
    }
    return `ERRO [Google Ads]: ${msg}. Sugestão: verifique as credenciais OAuth2.`;
  }
}

// ─── google_ads_search_query ─────────────────────────────────────────────────

interface SearchQueryInput {
  gaql_query: string;
}

export async function google_ads_search_query(
  input: SearchQueryInput
): Promise<string> {
  const { gaql_query } = input;

  if (!gaql_query?.trim()) return 'ERRO [Google Ads]: Query GAQL obrigatória.';

  // Segurança: apenas SELECT permitido
  if (!/^\s*SELECT\s/i.test(gaql_query)) {
    return 'ERRO [Google Ads]: Apenas queries SELECT são permitidas.';
  }

  try {
    const res = await fetchWithRetry(gaql_query.trim());

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(errText);
    }

    const rows = await parseStreamResponse(res);

    if (rows.length === 0) {
      return '[Google Ads] Query executada — nenhum resultado retornado.';
    }

    // Extrai campos dinamicamente da primeira linha
    const firstRow = rows[0];
    const fields = extractFields(firstRow);
    const headers = fields.map(({ path }) => path.split('.').pop() ?? path);

    const tableRows = rows.map((row) =>
      fields.map(({ path }) => {
        const value = getNestedValue(row, path);
        return formatGAdsValue(path, value);
      })
    );

    const table = compactTable(headers, tableRows);
    return `[Google Ads] Query customizada (${rows.length} resultados)\n${table}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Google Ads]: Timeout ao executar query. Sugestão: adicione LIMIT à query.`;
    }
    return `ERRO [Google Ads]: ${msg}. Sugestão: verifique a sintaxe GAQL.`;
  }
}

// ─── Helpers para extração dinâmica de campos ─────────────────────────────────

function extractFields(
  obj: object,
  prefix = ''
): Array<{ path: string }> {
  const result: Array<{ path: string }> = [];
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object') {
      result.push(...extractFields(val as object, path));
    } else {
      result.push({ path });
    }
  }
  return result;
}

function getNestedValue(obj: object, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function formatGAdsValue(path: string, value: unknown): string {
  if (value === undefined || value === null) return 'N/D';
  const str = String(value);

  if (path.includes('cost_micros') || path.includes('average_cpc')) {
    return formatBRLFromMicros(parseInt(str) || 0);
  }
  if (path.includes('ctr') || path.includes('rate')) {
    return formatPercent(parseFloat(str) || 0);
  }
  if (path.includes('impressions') || path.includes('clicks')) {
    return parseInt(str).toLocaleString('pt-BR');
  }
  return str || 'N/D';
}

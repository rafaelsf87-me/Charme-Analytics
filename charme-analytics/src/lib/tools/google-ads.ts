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
  let token: string | null | undefined;
  try {
    ({ token } = await client.getAccessToken());
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('invalid_grant')) {
      throw new Error('Token Google Ads expirado — regenere o GOOGLE_ADS_REFRESH_TOKEN no .env');
    }
    throw err;
  }
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
    costMicros: string;
    conversions: string;
    conversionsValue: string;
    ctr: string;
    averageCpc: string;
    allConversions: string;
    allConversionsValue: string;
    viewThroughConversions: string;
  };
}

interface GAdsStreamChunk {
  results?: GAdsRow[];
  error?: { message: string };
}

async function parseStreamResponse(res: Response): Promise<GAdsRow[]> {
  const text = await res.text();
  const rows: GAdsRow[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Não é JSON válido — tenta NDJSON (uma linha por chunk)
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const chunk: GAdsStreamChunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error.message);
        if (chunk.results) rows.push(...chunk.results);
      } catch (lineErr) {
        if ((lineErr as Error).message !== 'SyntaxError') throw lineErr;
        // ignora linhas inválidas
      }
    }
    return rows;
  }

  if (Array.isArray(parsed)) {
    for (const chunk of parsed as GAdsStreamChunk[]) {
      if (chunk.error) throw new Error(chunk.error.message);
      if (chunk.results) rows.push(...chunk.results);
    }
  } else if ((parsed as GAdsStreamChunk).error) {
    throw new Error((parsed as GAdsStreamChunk).error!.message ?? JSON.stringify((parsed as GAdsStreamChunk).error));
  }

  return rows;
}

async function extractApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    const msg = json?.error?.message ?? json?.error?.details?.[0]?.message;
    if (msg) return `HTTP ${res.status}: ${msg}`;
  } catch {
    // não é JSON
  }
  return `HTTP ${res.status}: ${text.slice(0, 300)}`;
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
  include_paused?: boolean;
}

export async function google_ads_campaign_report(
  input: CampaignReportInput
): Promise<string> {
  const { date_from, date_to, limit = 20, include_paused = false } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Google Ads]: ${validErr}`;

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const statusFilter = include_paused
    ? `campaign.status IN ('ENABLED', 'PAUSED')`
    : `campaign.status = 'ENABLED'`;

  const gaql = `
    SELECT
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.all_conversions,
      metrics.all_conversions_value,
      metrics.view_through_conversions
    FROM campaign
    WHERE segments.date BETWEEN '${date_from}' AND '${date_to}'
      AND ${statusFilter}
    ORDER BY metrics.cost_micros DESC
    LIMIT ${safeLimit}
  `.trim();

  try {
    const res = await fetchWithRetry(gaql);

    if (!res.ok) {
      throw new Error(await extractApiError(res));
    }

    const rows = await parseStreamResponse(res);

    if (rows.length === 0) {
      return `[Google Ads] Nenhuma campanha ativa encontrada no período ${date_from} a ${date_to}.`;
    }

    // Calcula totais
    let totalGasto = 0;
    let totalConversoes = 0;
    let totalReceita = 0;
    let totalAllConv = 0;
    let totalAllConvValue = 0;
    let totalViewThrough = 0;

    interface ProcessedCampaignRow {
      i: number;
      nome: string;
      impressoes: string;
      cliques: string;
      ctr: number;
      cpc: number;
      custo: number;
      conversoes: number;
      receita: number;
      roas: number;
      cpa: number;
      allConv: number;
      allConvValue: number;
      viewThrough: number;
      roasPlus: number;
      cpaPlus: number;
    }

    const processed: ProcessedCampaignRow[] = rows.map((row, i) => {
      const nome = row.campaign?.name ?? 'N/D';
      const impressoes = parseInt(row.metrics?.impressions ?? '0').toLocaleString('pt-BR');
      const cliques = parseInt(row.metrics?.clicks ?? '0').toLocaleString('pt-BR');
      const custoMicros = parseInt(row.metrics?.costMicros ?? '0');
      const custo = custoMicros / 1_000_000;
      const cpcMicros = parseInt(row.metrics?.averageCpc ?? '0');
      const cpc = cpcMicros / 1_000_000;
      const conversoes = parseFloat(row.metrics?.conversions ?? '0');
      const receita = parseFloat(row.metrics?.conversionsValue ?? '0');
      const ctr = parseFloat(row.metrics?.ctr ?? '0');
      const allConv = parseFloat(row.metrics?.allConversions ?? '0');
      const allConvValue = parseFloat(row.metrics?.allConversionsValue ?? '0');
      const viewThrough = parseFloat(row.metrics?.viewThroughConversions ?? '0');

      const roas = custo > 0 ? receita / custo : 0;
      const cpa = conversoes > 0 ? custo / conversoes : 0;
      const roasPlus = custo > 0 && allConvValue > 0 ? allConvValue / custo : 0;
      const cpaPlus = allConv > 0 ? custo / allConv : 0;

      totalGasto += custo;
      totalConversoes += conversoes;
      totalReceita += receita;
      totalAllConv += allConv;
      totalAllConvValue += allConvValue;
      totalViewThrough += viewThrough;

      return { i, nome, impressoes, cliques, ctr, cpc, custo, conversoes, receita, roas, cpa, allConv, allConvValue, viewThrough, roasPlus, cpaPlus };
    });

    const tableRows = processed.map(p => [
      String(p.i + 1),
      p.nome,
      p.impressoes,
      p.cliques,
      formatPercent(p.ctr),
      p.cpc > 0 ? formatBRL(p.cpc) : 'N/D',
      formatBRL(p.custo),
      p.conversoes.toFixed(1),
      formatBRL(p.receita),
      p.roas > 0 ? `${p.roas.toFixed(2)}x` : 'N/D',
      p.cpa > 0 ? formatBRL(p.cpa) : 'N/D',
    ]);

    const table = compactTable(
      ['#', 'Campanha', 'Impressões', 'Cliques', 'CTR', 'CPC Médio', 'Gasto', 'Conv.', 'Receita', 'ROAS', 'CPA'],
      tableRows
    );

    const roasTotal = totalGasto > 0 ? (totalReceita / totalGasto).toFixed(2) : 'N/D';

    let output =
      `[Google Ads] Campanhas — ${date_from} a ${date_to} (${rows.length} campanhas)\n` +
      `${table}\n` +
      `Total: Gasto ${formatBRL(totalGasto)} | Conv. ${totalConversoes.toFixed(0)} | Receita ${formatBRL(totalReceita)} | ROAS ${roasTotal}x`;

    // Seção suplementar: conversões por visualização (Demand Gen — "comparável à plataforma")
    // Só exibe se houver view_through_conversions > 0 em alguma campanha
    if (totalViewThrough > 0) {
      const suppRows = processed.map(p => [
        p.nome,
        p.viewThrough > 0 ? p.viewThrough.toFixed(0) : '—',
        p.allConv > 0 ? p.allConv.toFixed(1) : '—',
        p.roasPlus > 0 ? `${p.roasPlus.toFixed(2)}x` : '—',
        p.cpaPlus > 0 ? formatBRL(p.cpaPlus) : '—',
      ]);

      const roasPlusTotal = totalGasto > 0 && totalAllConvValue > 0
        ? `${(totalAllConvValue / totalGasto).toFixed(2)}x` : 'N/D';
      const cpaPlusTotal = totalAllConv > 0
        ? formatBRL(totalGasto / totalAllConv) : 'N/D';

      const suppTable = compactTable(
        ['Campanha', 'Conv. Viz', 'Conv.+', 'ROAS+', 'CPA+'],
        suppRows
      );

      output +=
        `\n\n[Google Ads — Demand Gen] Métricas c/ Conversão por Visualização ("comparável à plataforma")\n` +
        `${suppTable}\n` +
        `Total: Conv. Viz ${totalViewThrough.toFixed(0)} | Conv.+ ${totalAllConv.toFixed(0)} | ROAS+ ${roasPlusTotal} | CPA+ ${cpaPlusTotal}\n` +
        `Conv. Viz = view-through conversions. Conv.+ / ROAS+ / CPA+ incluem clique + visualização.`;
    }

    return output;
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
      throw new Error(await extractApiError(res));
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

  if (path.includes('costMicros') || path.includes('averageCpc')) {
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

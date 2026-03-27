import { GoogleAuth } from 'google-auth-library';
import { formatBRL, formatDate, compactTable } from '@/lib/formatters';

const GA4_ENDPOINT = `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`;
const TIMEOUT_MS = 30_000;

// ─── Auth ────────────────────────────────────────────────────────────────────

let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (!authClient) {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
    authClient = new GoogleAuth({
      credentials: JSON.parse(keyJson),
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
  }
  return authClient;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuthClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error('Não foi possível obter token GA4');
  return tokenResponse.token;
}

// ─── HTTP + Retry ─────────────────────────────────────────────────────────────

async function fetchWithRetry(
  body: object,
  attempt = 1
): Promise<Response> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GA4_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 429 && attempt <= 3) {
      await delay(1000 * 3 ** (attempt - 1));
      return fetchWithRetry(body, attempt + 1);
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

// ─── Sanitização de termos para filtros GA4 (case-sensitive) ─────────────────

export function sanitizeForGA4(term: string): string {
  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, '-'); // espaços → hífens
}

/**
 * Retorna fragmento sem a primeira letra — contorna case-sensitivity do GA4.
 * Ex: "Sofá" e "sofá" são ambos capturados por "ofá".
 * Usar quando filtro exato retornar zero resultados.
 */
export function ga4Fragment(term: string): string {
  const sanitized = sanitizeForGA4(term);
  return sanitized.length > 1 ? sanitized.slice(1) : sanitized;
}

// Mapa de termos conhecidos → fragmento seguro confirmado
export const GA4_SAFE_FRAGMENTS: Record<string, string> = {
  sofa: 'ofá',
  sofá: 'ofá',
  cadeira: 'adeira',
  cortina: 'ortina',
  toalha: 'oalha',
  tapete: 'apete',
};

// ─── Formatação de métricas ───────────────────────────────────────────────────

function formatMetricValue(metricName: string, value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value || 'N/D';

  switch (metricName) {
    case 'purchaseRevenue':
    case 'itemRevenue':
      return formatBRL(num);
    case 'averageSessionDuration':
      return `${Math.round(num)}s`;
    default:
      // Percentuais já calculados (ex: bounceRate)
      if (metricName.toLowerCase().includes('rate')) {
        return `${(num * 100).toFixed(1)}%`;
      }
      // Inteiros grandes
      return num % 1 === 0 ? num.toLocaleString('pt-BR') : num.toFixed(2);
  }
}

// ─── Labels legíveis para métricas e dimensões ───────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  sessions: 'Sessões',
  totalUsers: 'Usuários',
  screenPageViews: 'Pageviews',
  conversions: 'Conversões',
  ecommercePurchases: 'Compras',
  purchaseRevenue: 'Receita',
  addToCarts: 'ATC',
  checkouts: 'Checkouts',
  itemRevenue: 'Receita Item',
  averageSessionDuration: 'Duração Média',
};

const DIMENSION_LABELS: Record<string, string> = {
  sessionSource: 'Fonte',
  sessionMedium: 'Mídia',
  sessionCampaignName: 'Campanha',
  pagePath: 'Página',
  pageTitle: 'Título',
  deviceCategory: 'Dispositivo',
  country: 'País',
  city: 'Cidade',
  eventName: 'Evento',
  itemName: 'Produto',
};

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

// ─── ga4_run_report ──────────────────────────────────────────────────────────

interface RunReportInput {
  date_from: string;
  date_to: string;
  metrics: string[];
  dimensions: string[];
  filters?: string; // ex: "pagePath contains sofa"
  limit?: number;
}

interface GA4ReportRow {
  dimensionValues: Array<{ value: string }>;
  metricValues: Array<{ value: string }>;
}

interface GA4ReportResponse {
  rows?: GA4ReportRow[];
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string }>;
  rowCount?: number;
}

export async function ga4_run_report(input: RunReportInput): Promise<string> {
  const { date_from, date_to, metrics, dimensions, filters, limit = 10 } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [GA4]: ${validErr}`;

  if (!metrics?.length) return 'ERRO [GA4]: Informe ao menos uma métrica.';
  if (!dimensions?.length) return 'ERRO [GA4]: Informe ao menos uma dimensão.';

  // Warning automático: addToCarts conta eventos, não sessões únicas
  const atcWarning = metrics.includes('addToCarts')
    ? '⚠️ addToCarts conta eventos (cliques no botão), não sessões únicas. Se o cliente adiciona 4 unidades = 4 eventos. Para taxa de ATC real (pessoas únicas), use sessões com evento add_to_cart.\n\n'
    : '';

  // Warning automático: análise de canais com dimensões de source/medium
  const metaChannelDims = ['sessionSource', 'sessionMedium', 'sessionCampaignName'];
  const metaWarning = dimensions.some((d) => metaChannelDims.includes(d))
    ? '⚠️ Atribuição do Meta no GA4 está comprometida nesta loja: tráfego Meta aparece fragmentado em Organic Social (~39%), Cross-network (~24%) e Paid Social (<1%). Para análise de Meta Ads, use a API do Meta diretamente.\n\n'
    : '';

  const safeLimit = Math.min(Math.max(1, limit), 50);

  // Constrói filtro de dimensão se fornecido
  let dimensionFilter: object | undefined;
  if (filters) {
    // Formato esperado: "pagePath contains termo"
    const match = filters.match(/^(\w+)\s+contains\s+(.+)$/i);
    if (match) {
      dimensionFilter = {
        filter: {
          fieldName: match[1],
          stringFilter: {
            matchType: 'CONTAINS',
            value: sanitizeForGA4(match[2]),
          },
        },
      };
    }
  }

  // Ordena pela primeira métrica, decrescente
  const orderBys = [
    { metric: { metricName: metrics[0] }, desc: true },
  ];

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: date_from, endDate: date_to }],
    dimensions: dimensions.map((d) => ({ name: d })),
    metrics: metrics.map((m) => ({ name: m })),
    limit: safeLimit,
    orderBys,
  };

  if (dimensionFilter) body.dimensionFilter = dimensionFilter;

  try {
    const res = await fetchWithRetry(body);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }

    const data: GA4ReportResponse = await res.json();
    const rows = data.rows ?? [];

    if (rows.length === 0) {
      // Sugere fragmento sem primeira letra para contornar case-sensitivity do GA4
      let suggestion = '';
      if (filters) {
        const rawTerm = filters.split(' ').pop() ?? '';
        const termLower = rawTerm.toLowerCase().replace(/[àáâãä]/g, 'a').replace(/[éê]/g, 'e');
        const knownFragment = GA4_SAFE_FRAGMENTS[termLower];
        const fragment = knownFragment ?? ga4Fragment(rawTerm);
        suggestion = ` ⚠️ Filtro GA4 é case-sensitive. Tente o fragmento "${fragment}" em vez de "${rawTerm}" — captura variações com/sem acento e maiúsculas.`;
      }
      return `[GA4] Nenhum resultado para o período ${formatDate(date_from)} a ${formatDate(date_to)}.${suggestion}`;
    }

    const dimHeaders = dimensions.map((d) => DIMENSION_LABELS[d] ?? d);
    const metHeaders = metrics.map((m) => METRIC_LABELS[m] ?? m);
    const headers = [...dimHeaders, ...metHeaders];

    const tableRows = rows.map((row) => {
      const dims = row.dimensionValues.map((d) => d.value || 'N/D');
      const mets = row.metricValues.map((m, i) =>
        formatMetricValue(metrics[i], m.value)
      );
      return [...dims, ...mets];
    });

    const table = compactTable(headers, tableRows);
    return `${atcWarning}${metaWarning}[GA4] ${dimHeaders.join(' × ')} — ${metHeaders.join(', ')} (${formatDate(date_from)} a ${formatDate(date_to)})\n${table}\nTotal de linhas: ${data.rowCount ?? rows.length}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [GA4]: Timeout ao executar relatório. Sugestão: reduza o período ou o número de dimensões.`;
    }
    return `ERRO [GA4]: ${msg}. Sugestão: verifique as credenciais do Service Account.`;
  }
}

// ─── ga4_get_top_pages ───────────────────────────────────────────────────────

interface TopPagesInput {
  date_from: string;
  date_to: string;
  limit?: number;
  sort_by?: 'views' | 'conversions' | 'revenue';
}

export async function ga4_get_top_pages(input: TopPagesInput): Promise<string> {
  const { date_from, date_to, limit = 10, sort_by = 'views' } = input;

  const metricMap = {
    views: 'screenPageViews',
    conversions: 'ecommercePurchases',
    revenue: 'purchaseRevenue',
  };

  const primaryMetric = metricMap[sort_by];
  const metrics = [primaryMetric, 'sessions', 'ecommercePurchases', 'purchaseRevenue'];
  const uniqueMetrics = [...new Set(metrics)];

  return ga4_run_report({
    date_from,
    date_to,
    metrics: uniqueMetrics,
    dimensions: ['pagePath', 'pageTitle'],
    limit,
  });
}

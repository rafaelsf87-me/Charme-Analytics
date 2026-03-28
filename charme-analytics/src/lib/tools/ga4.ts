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

// Mapa de termos conhecidos → fragmento seguro confirmado (mantido para compatibilidade)
export const GA4_SAFE_FRAGMENTS: Record<string, string> = {
  sofa: 'ofá',
  sofá: 'ofá',
  cadeira: 'adeira',
  cortina: 'ortina',
  toalha: 'oalha',
  tapete: 'apete',
};

/**
 * Constrói filtro OR para itemName com suporte a case-insensitive e variantes com/sem acento.
 * Ex: "sofá" gera OR(contains "sofá", contains "sofa") — NÃO bate em "almofada".
 * Ex: "cadeira" gera contains "cadeira" (sem acento, variante única).
 */
function buildItemNameOrFilter(term: string): object {
  const stripped = term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const original = term.toLowerCase();

  const makeContains = (v: string) => ({
    filter: {
      fieldName: 'itemName',
      stringFilter: { matchType: 'CONTAINS', value: v, caseSensitive: false },
    },
  });

  // Se a versão sem acento é igual, basta um filtro simples
  if (original === stripped) return makeContains(original);

  // Variantes diferentes → OR para cobrir ambas
  return {
    orGroup: {
      expressions: [makeContains(original), makeContains(stripped)],
    },
  };
}

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
  dimensionFilterObject?: object; // raw GA4 dimensionFilter (sobrescreve `filters`)
  metricFilterObject?: object;    // raw GA4 metricFilter (ex: itemsViewed >= 3000)
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
  const { date_from, date_to, metrics, dimensions, filters, dimensionFilterObject, metricFilterObject, limit = 10 } = input;

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

  // Constrói filtro de dimensão — prioridade: dimensionFilterObject > filters string
  let dimensionFilter: object | undefined = dimensionFilterObject;
  if (!dimensionFilter && filters) {
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
  if (metricFilterObject) body.metricFilter = metricFilterObject;

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

// ─── ga4_get_item_report ─────────────────────────────────────────────────────

interface ItemReportInput {
  date_from: string;
  date_to: string;
  product_filter?: string; // termo para filtrar por itemName (ex: "sofá", "cadeira")
  limit?: number;
  sort_by?: 'views' | 'atc' | 'purchases' | 'revenue' | 'checkout';
  ranking_mode?: 'best' | 'worst' | 'both'; // 'best'=top N, 'worst'=bottom N, 'both'=top+bottom
  min_views?: number;              // mínimo de itemsViewed para incluir (padrão: 0 = sem filtro)
  highlight_min_views?: number;    // produtos acima desse nº de views sempre aparecem (seção Destaque)
  highlight_min_revenue?: number;  // produtos acima dessa receita sempre aparecem (seção Destaque)
}

/**
 * Relatório de performance por produto (item-scoped).
 * Sempre retorna: Views, Taxa ATC (%), Compras, Receita.
 * ATC é exibido como TAXA (atcCount/views × 100%) — nunca como contagem bruta.
 * Padrão: top 10 produtos ordenados por receita.
 * product_filter usa OR automático com/sem acento + case-insensitive.
 */
export async function ga4_get_item_report(input: ItemReportInput): Promise<string> {
  const {
    date_from, date_to, product_filter, limit = 10, sort_by = 'revenue',
    ranking_mode = 'best', min_views, highlight_min_views, highlight_min_revenue,
  } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [GA4]: ${validErr}`;

  const safeLimit = Math.min(Math.max(1, limit), 50);
  const hasHighlight = (highlight_min_views ?? 0) > 0 || (highlight_min_revenue ?? 0) > 0;
  const isBoth = ranking_mode === 'both';
  const isCheckout = sort_by === 'checkout';

  const METRICS = ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'];

  // Para métricas computadas (atc, checkout), ordenar no servidor pela proxy mais próxima
  // e re-ordenar client-side depois
  const serverSort =
    sort_by === 'atc'      || isCheckout ? 'itemsAddedToCart' :
    sort_by === 'views'                  ? 'itemsViewed'      :
    sort_by === 'purchases'              ? 'itemsPurchased'   :
    /* revenue (padrão) */                 'itemRevenue';

  const dimensionFilterObject = product_filter
    ? buildItemNameOrFilter(product_filter)
    : undefined;

  const metricFilterObject = min_views && min_views > 0
    ? {
        filter: {
          fieldName: 'itemsViewed',
          numericFilter: {
            operation: 'GREATER_THAN_OR_EQUAL',
            value: { int64Value: String(min_views) },
          },
        },
      }
    : undefined;

  // Para ranking 'both' ou checkout (precisa re-ordenar client-side), buscar mais dados
  // Destaques: busca 100. Both: precisa de produtos suficientes para ter top e bottom distintos
  const fetchLimit = hasHighlight || isBoth || isCheckout
    ? 100
    : sort_by === 'atc'
    ? Math.min(safeLimit * 5, 50)
    : safeLimit;

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: date_from, endDate: date_to }],
    dimensions: [{ name: 'itemName' }],
    metrics: METRICS.map(m => ({ name: m })),
    limit: fetchLimit,
    orderBys: [{ metric: { metricName: serverSort }, desc: true }],
  };
  if (dimensionFilterObject) body.dimensionFilter = dimensionFilterObject;
  if (metricFilterObject) body.metricFilter = metricFilterObject;

  try {
    const res = await fetchWithRetry(body);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
    }

    const data: GA4ReportResponse = await res.json();
    const rawRows = data.rows ?? [];

    if (rawRows.length === 0) {
      return `[GA4] Nenhum produto encontrado${product_filter ? ` com filtro "${product_filter}"` : ''} no período ${formatDate(date_from)} a ${formatDate(date_to)}.`;
    }

    // ── Processamento e cálculos ─────────────────────────────────────────────
    // Cadeiras: clientes adicionam ~5 unidades → itemsAddedToCart ÷ 5 para aproximar pessoas únicas
    let cadeiraCorrectionApplied = false;
    const processed = rawRows.map(row => {
      const name      = row.dimensionValues[0]?.value ?? 'N/D';
      const views     = parseInt(row.metricValues[0]?.value ?? '0') || 0;
      const rawAtc    = parseInt(row.metricValues[1]?.value ?? '0') || 0;
      const purchases = parseInt(row.metricValues[2]?.value ?? '0') || 0;
      const revenue   = parseFloat(row.metricValues[3]?.value ?? '0') || 0;

      const isCadeira  = name.toLowerCase().includes('cadeira');
      const atcCount   = isCadeira ? Math.round(rawAtc / 5) : rawAtc;
      if (isCadeira && rawAtc > 0) cadeiraCorrectionApplied = true;

      const atcRate      = views     > 0 ? (atcCount / views)    * 100 : 0;
      const checkoutRate = atcCount  > 0 ? (purchases / atcCount) * 100 : 0;

      return { name, views, atcCount, rawAtc, atcRate, checkoutRate, purchases, revenue };
    });

    // Re-ordenação client-side para métricas computadas
    if (sort_by === 'atc')      processed.sort((a, b) => b.atcRate      - a.atcRate);
    if (isCheckout)             processed.sort((a, b) => b.checkoutRate - a.checkoutRate);
    if (ranking_mode === 'worst') processed.reverse();

    // ── Médias globais para marcadores 🟢🔴 ────────────────────────────────
    const avgAtcRate      = processed.reduce((s, r) => s + r.atcRate, 0)      / (processed.length || 1);
    const avgCheckoutRate = processed.reduce((s, r) => s + r.checkoutRate, 0) / (processed.length || 1);
    const avgRevenue      = processed.reduce((s, r) => s + r.revenue, 0)      / (processed.length || 1);

    // 🟢 Alta taxa + alta receita | 🔴 Alta receita + baixa taxa
    const getRateForMarker = (r: typeof processed[0]) =>
      isCheckout ? r.checkoutRate : r.atcRate;
    const avgRate = isCheckout ? avgCheckoutRate : avgAtcRate;

    const getMarker = (r: typeof processed[0]): string => {
      const highRevenue = r.revenue  >= 1.5 * avgRevenue;
      const highRate    = getRateForMarker(r) >= 1.5 * avgRate;
      const lowRate     = getRateForMarker(r) <= 0.6 * avgRate;
      if (highRate && highRevenue)  return '🟢 ';
      if (highRevenue && lowRate)   return '🔴 ';
      return '';
    };

    // ── Cabeçalhos da tabela ─────────────────────────────────────────────────
    const rateHeader    = isCheckout ? 'Taxa Checkout' : 'Taxa ATC';
    const headers       = ['#', 'Produto', 'Views', 'Taxa ATC', 'Compras', 'Taxa Checkout', 'Receita'];
    const headersSimple = ['#', 'Produto', 'Views', rateHeader, 'Compras', 'Receita'];

    // Para relatório de checkout, exibe as 3 taxas (ATC + Checkout); senão, exibe só a taxa relevante
    const toRow = (r: typeof processed[0], i: number): string[] => {
      if (isCheckout) {
        return [
          String(i + 1),
          getMarker(r) + r.name,
          r.views.toLocaleString('pt-BR'),
          `${r.atcRate.toFixed(1)}%`,
          String(r.purchases),
          `${r.checkoutRate.toFixed(1)}%`,
          formatBRL(r.revenue),
        ];
      }
      return [
        String(i + 1),
        getMarker(r) + r.name,
        r.views.toLocaleString('pt-BR'),
        `${r.atcRate.toFixed(1)}%`,
        String(r.purchases),
        formatBRL(r.revenue),
      ];
    };

    const usedHeaders = isCheckout ? headers : headersSimple;

    const sortLabel: Record<string, string> = {
      atc: 'taxa ATC', views: 'views', purchases: 'compras', revenue: 'receita', checkout: 'taxa checkout',
    };
    const filterNote = product_filter ? ` | Categoria: "${product_filter}"` : '';
    const viewsNote  = min_views ? ` | Mín. ${min_views.toLocaleString('pt-BR')} views` : '';

    const periodStr = `${formatDate(date_from)} a ${formatDate(date_to)}${filterNote}${viewsNote}`;

    // ── Montagem do output ───────────────────────────────────────────────────
    let output = '';

    if (isBoth) {
      // TOP N Melhores + TOP N Piores (sorted desc, piores = last N)
      const best  = processed.slice(0, safeLimit);
      const worst = processed.slice(-safeLimit).reverse(); // pior primeiro

      const bestTable  = compactTable(usedHeaders, best.map(toRow));
      const worstTable = compactTable(usedHeaders, worst.map(toRow));

      output =
        `[GA4] Top ${safeLimit} Melhores × Piores por ${sortLabel[sort_by] ?? sort_by} (${periodStr})\n` +
        `Total produtos analisados: ${rawRows.length}\n\n` +
        `🏆 **TOP ${safeLimit} MELHORES** — ${sortLabel[sort_by] ?? sort_by}\n` +
        `${bestTable}\n\n` +
        `💔 **TOP ${safeLimit} PIORES** — ${sortLabel[sort_by] ?? sort_by}\n` +
        `${worstTable}`;
    } else {
      const display   = ranking_mode === 'worst'
        ? processed.slice(0, safeLimit)  // já estava reversed
        : processed.slice(0, safeLimit);
      const rankLabel = ranking_mode === 'worst' ? 'Piores' : 'Top';
      const mainTable = compactTable(usedHeaders, display.map(toRow));

      output =
        `[GA4] ${rankLabel} ${display.length} produtos por ${sortLabel[sort_by] ?? sort_by}` +
        ` (${periodStr})\n` +
        `${mainTable}\n` +
        `Total produtos encontrados: ${rawRows.length}`;
    }

    if (cadeiraCorrectionApplied) {
      output += `\nℹ️ ATC de cadeiras corrigido ÷5 (clientes compram ~5 unidades/pedido)`;
    }
    if (isCheckout) {
      output += `\nℹ️ Taxa Checkout = Compras ÷ ATC (eventos corrigidos) × 100`;
    }

    // Marcadores de correlação
    const anyMarker = processed.some(r => getMarker(r) !== '');
    if (anyMarker) {
      output += `\n🟢 ${isCheckout ? 'Checkout' : 'ATC'} + receita acima da média | 🔴 Receita alta com ${isCheckout ? 'checkout' : 'ATC'} baixo`;
    }

    // ── Seção "Produtos Destaque a Considerar" ──────────────────────────────
    if (hasHighlight) {
      const minV = highlight_min_views ?? 0;
      const minR = highlight_min_revenue ?? 0;

      // Produtos que estão nos rankings principais
      const displayedNames = new Set<string>();
      if (isBoth) {
        processed.slice(0, safeLimit).forEach(r => displayedNames.add(r.name));
        processed.slice(-safeLimit).forEach(r => displayedNames.add(r.name));
      } else {
        processed.slice(0, safeLimit).forEach(r => displayedNames.add(r.name));
      }

      const highlights = processed.filter(r =>
        !displayedNames.has(r.name) && (r.views >= minV || r.revenue >= minR)
      );

      if (highlights.length > 0) {
        const hlTable = compactTable(usedHeaders, highlights.map(toRow));
        output +=
          `\n\n⭐ **Produtos Destaque a Considerar** (views ≥${minV.toLocaleString('pt-BR')} ou receita ≥${formatBRL(minR)} — fora dos rankings principais)\n` +
          hlTable;
      }
    }

    return output;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) return `ERRO [GA4]: Timeout. Sugestão: reduza o período.`;
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

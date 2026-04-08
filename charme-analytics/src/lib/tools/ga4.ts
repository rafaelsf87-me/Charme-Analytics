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
    let rows = data.rows ?? [];

    if (rows.length === 0) {
      let suggestion = '';
      if (filters) {
        const rawTerm = filters.split(' ').pop() ?? '';
        const field = filters.split(' ')[0] ?? '';
        if (field.toLowerCase().includes('pagepath') || field.toLowerCase().includes('url') || field.toLowerCase().includes('page')) {
          suggestion = ` ⚠️ Filtro de URL é case-sensitive no GA4. Tente "${rawTerm.toLowerCase()}" (lowercase sem acentos).`;
        } else {
          suggestion = ` ⚠️ Nenhum dado encontrado para "${rawTerm}". Verifique se o termo está correto ou use ga4_get_item_report com product_filter para filtros de produto (suporta OR automático com/sem acento).`;
        }
      }
      return `[GA4] Nenhum resultado para o período ${formatDate(date_from)} a ${formatDate(date_to)}.${suggestion}`;
    }

    // Normalizar pagePath: "/foo/" e "/foo" são a mesma página — somar métricas
    // Só aplica quando pagePath é dimensão E todas as métricas são somáveis (não médias)
    const NON_SUMMABLE_METRICS = new Set([
      'averageSessionDuration', 'bounceRate', 'sessionConversionRate',
      'engagementRate', 'averagePurchaseRevenue', 'cartToViewRate',
      'purchaseToViewRate', 'userEngagementDuration',
    ]);
    const pagePathIdx = dimensions.indexOf('pagePath');
    const allMetricsSummable = metrics.every(m => !NON_SUMMABLE_METRICS.has(m));

    if (pagePathIdx !== -1 && allMetricsSummable) {
      const merged = new Map<string, GA4ReportRow>();
      for (const row of rows) {
        const dims = row.dimensionValues.map(d => ({ ...d }));
        const rawPath = dims[pagePathIdx]?.value ?? '';
        // Normaliza: remove barra final exceto para a raiz "/"
        const normalizedPath = rawPath.length > 1 && rawPath.endsWith('/')
          ? rawPath.slice(0, -1)
          : rawPath;
        dims[pagePathIdx] = { value: normalizedPath };

        // Chave: só o pagePath normalizado (ignora pageTitle para garantir merge mesmo com títulos diferentes)
        const key = normalizedPath;
        if (!merged.has(key)) {
          merged.set(key, { dimensionValues: dims, metricValues: row.metricValues.map(m => ({ ...m })) });
        } else {
          const existing = merged.get(key)!;
          existing.metricValues = existing.metricValues.map((m, i) => {
            const a = parseFloat(m.value ?? '0');
            const b = parseFloat(row.metricValues[i]?.value ?? '0');
            return { value: String(Math.round((a + b) * 1000) / 1000) };
          });
        }
      }
      // Re-ordenar pela primeira métrica desc após merge e aplicar limit
      rows = [...merged.values()]
        .sort((a, b) => parseFloat(b.metricValues[0]?.value ?? '0') - parseFloat(a.metricValues[0]?.value ?? '0'))
        .slice(0, safeLimit);
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

  // Para ranking 'both', checkout, destaques ou quando há product_filter (contexto de categoria),
  // buscar 100 para garantir ranking completo e benchmarks corretos da categoria.
  // Sem isso, a tool retorna N itens e o modelo reporta posições erradas ("16º de 18" quando há 25+).
  const fetchLimit = hasHighlight || isBoth || isCheckout || !!product_filter
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

    // ── Rank-based markers 🟢🔴 (top/bottom 30%) ──────────────────────────
    const getRateForMarker = (r: typeof processed[0]) =>
      isCheckout ? r.checkoutRate : r.atcRate;

    const sortedByRate = [...processed].sort((a, b) => getRateForMarker(b) - getRateForMarker(a));
    const sortedByRev  = [...processed].sort((a, b) => b.revenue - a.revenue);
    const topN = Math.max(1, Math.ceil(processed.length * 0.3));
    const topRateNames    = new Set(sortedByRate.slice(0, topN).map(r => r.name));
    const topRevNames     = new Set(sortedByRev.slice(0, topN).map(r => r.name));
    const bottomRateNames = new Set(sortedByRate.slice(-topN).map(r => r.name));

    // 🟢 top 30% taxa E top 30% receita | 🔴 top 30% receita E bottom 30% taxa
    const getMarker = (r: typeof processed[0]): string => {
      if (topRateNames.has(r.name) && topRevNames.has(r.name))    return '🟢 ';
      if (topRevNames.has(r.name) && bottomRateNames.has(r.name)) return '🔴 ';
      return '';
    };

    // ── Cabeçalhos da tabela ─────────────────────────────────────────────────
    const viewsHeader = min_views ? `Views (>${min_views.toLocaleString('pt-BR')})` : 'Views';
    const headers     = ['#', 'Produto', viewsHeader, 'ATC', 'ATC (%)', 'Checkout', 'Checkout (%)', 'Receita'];

    // Sempre exibe todas as colunas: ATC count, ATC %, Checkout count, Checkout %, Receita
    const toRow = (r: typeof processed[0], i: number): string[] => [
      String(i + 1),
      getMarker(r) + r.name,
      r.views.toLocaleString('pt-BR'),
      r.atcCount.toLocaleString('pt-BR'),
      `${r.atcRate.toFixed(1)}%`,
      String(r.purchases),
      r.atcCount > 0 ? `${r.checkoutRate.toFixed(1)}%` : '—',
      formatBRL(r.revenue),
    ];

    const usedHeaders = headers;

    const sortLabel: Record<string, string> = {
      atc: 'taxa ATC', views: 'views', purchases: 'compras', revenue: 'receita', checkout: 'taxa checkout',
    };
    const filterNote = product_filter ? ` | Categoria: "${product_filter}"` : '';
    const viewsNote  = min_views ? ` | Mín. ${min_views.toLocaleString('pt-BR')} views` : '';

    const periodStr = `${formatDate(date_from)} a ${formatDate(date_to)}${filterNote}${viewsNote}`;

    // ── Montagem do output ───────────────────────────────────────────────────
    let output = '';

    if (isBoth) {
      // Garante que best e worst não se sobreponham quando há poucos produtos
      const half      = Math.floor(processed.length / 2);
      const bestCount = Math.min(safeLimit, half);
      const worstCount = Math.min(safeLimit, processed.length - bestCount);

      const best  = processed.slice(0, bestCount);
      const worst = processed.slice(processed.length - worstCount).reverse(); // pior primeiro

      const bestTable  = compactTable(usedHeaders, best.map(toRow));
      const worstTable = compactTable(usedHeaders, worst.map((r, i) => toRow(r, i)));

      const overlapNote = processed.length < safeLimit * 2
        ? `⚠️ Apenas ${processed.length} produtos no período — listas limitadas a ${bestCount} cada para evitar sobreposição.\n`
        : '';

      output =
        `[GA4] Top ${bestCount} Melhores × Piores por ${sortLabel[sort_by] ?? sort_by} (${periodStr})\n` +
        `Total produtos analisados: ${rawRows.length}\n` +
        overlapNote +
        `\n🏆 **TOP ${bestCount} MELHORES** — ${sortLabel[sort_by] ?? sort_by}\n` +
        `${bestTable}\n\n` +
        `💔 **TOP ${worstCount} PIORES** — ${sortLabel[sort_by] ?? sort_by}\n` +
        `${worstTable}`;
    } else {
      const display   = processed.slice(0, safeLimit);
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
      const rateLabel = isCheckout ? 'Checkout (%)' : 'ATC (%)';
      output += `\n🟢 ${rateLabel} + receita acima da média | 🔴 Receita alta com ${rateLabel} baixo`;
    }

    // ── Seção "Produtos Destaque a Considerar" (comparação relativa) ────────
    {
      const displayedNames = new Set<string>();
      if (isBoth) {
        processed.slice(0, safeLimit).forEach(r => displayedNames.add(r.name));
        processed.slice(-safeLimit).forEach(r => displayedNames.add(r.name));
      } else {
        processed.slice(0, safeLimit).forEach(r => displayedNames.add(r.name));
      }

      const displayed = processed.filter(r => displayedNames.has(r.name));

      if (displayed.length > 0 && processed.length > displayed.length) {
        const minViews     = Math.min(...displayed.map(r => r.views));
        const minPurchases = Math.min(...displayed.map(r => r.purchases));
        const minRevenue   = Math.min(...displayed.map(r => r.revenue));

        const highlights = processed.filter(r => {
          if (displayedNames.has(r.name)) return false;
          return r.views > minViews || r.purchases > minPurchases || r.revenue > minRevenue;
        });

        if (highlights.length > 0) {
          const hlTable = compactTable(usedHeaders, highlights.map((r, i) => toRow(r, i)));
          output +=
            `\n\n⭐ **Produtos Destaque a Considerar** (fora do ranking principal, mas com volume acima do menor item exibido)\n` +
            hlTable;
        }
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

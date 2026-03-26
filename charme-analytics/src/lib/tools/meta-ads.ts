import { formatBRL, formatPercent, compactTable } from '@/lib/formatters';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Extrai valor de actions[] ou action_values[] pelo action_type
function extractAction(
  arr: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!arr?.length) return 0;
  // Tenta o tipo exato e variante com prefixo offsite_conversion
  const found =
    arr.find((a) => a.action_type === type) ??
    arr.find((a) => a.action_type === `offsite_conversion.fb_pixel_${type}`);
  return found ? parseFloat(found.value) : 0;
}

// ─── Fetch com retry ──────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  attempt = 1
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN ?? ''}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Rate limit: checa x-app-usage
    const usage = res.headers.get('x-app-usage');
    if (usage) {
      try {
        const u = JSON.parse(usage) as Record<string, number>;
        const max = Math.max(...Object.values(u));
        if (max > 75) {
          // Desacelera se próximo do limite
          await delay(2000);
        }
      } catch { /* ignora parse error */ }
    }

    // 429 ou error code 17 (rate limit Meta)
    if ((res.status === 429 || res.status === 400) && attempt <= 3) {
      const body = await res.clone().json().catch(() => ({})) as { error?: { code?: number } };
      if (res.status === 429 || body?.error?.code === 17) {
        await delay(1000 * 3 ** (attempt - 1));
        return fetchWithRetry(url, attempt + 1);
      }
    }

    return res;
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') throw new Error('Timeout após 30s');
    throw err;
  }
}

// ─── Validação de datas ───────────────────────────────────────────────────────

function validateDates(date_from: string, date_to: string): string | null {
  const from = new Date(date_from);
  const to = new Date(date_to);
  const now = new Date();
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 'Datas inválidas (use YYYY-MM-DD)';
  if (from > to) return 'date_from deve ser anterior a date_to';
  if (to > now) return 'date_to não pode ser no futuro';
  return null;
}

// ─── Tipos de resposta da API ─────────────────────────────────────────────────

interface MetaInsightRow {
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  // breakdowns
  age?: string;
  gender?: string;
  device_platform?: string;
  publisher_platform?: string;
}

interface MetaInsightsResponse {
  data?: MetaInsightRow[];
  error?: { message: string; code?: number };
  paging?: object;
}

// ─── Processamento de uma linha ───────────────────────────────────────────────

function processRow(row: MetaInsightRow) {
  const impressoes = parseInt(row.impressions ?? '0');
  const cliques = parseInt(row.clicks ?? '0');
  const gasto = parseFloat(row.spend ?? '0');
  const ctr = parseFloat(row.ctr ?? '0');
  const cpm = parseFloat(row.cpm ?? '0');

  const purchases = extractAction(row.actions, 'purchase');
  const addToCarts = extractAction(row.actions, 'add_to_cart');
  const purchaseValue = extractAction(row.action_values, 'purchase');

  const roas = gasto > 0 ? purchaseValue / gasto : 0;
  const cpa = purchases > 0 ? gasto / purchases : 0;
  const atcRate = cliques > 0 ? addToCarts / cliques : 0;

  return {
    impressoes,
    cliques,
    gasto,
    ctr,
    cpm,
    purchases,
    addToCarts,
    purchaseValue,
    roas,
    cpa,
    atcRate,
  };
}

// ─── meta_ads_campaign_insights ───────────────────────────────────────────────

interface CampaignInsightsInput {
  date_from: string;
  date_to: string;
  level?: 'campaign' | 'adset' | 'ad';
  limit?: number;
  breakdowns?: string;
}

export async function meta_ads_campaign_insights(
  input: CampaignInsightsInput
): Promise<string> {
  const { date_from, date_to, level = 'campaign', limit = 20, breakdowns } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Meta Ads]: ${validErr}`;

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const adAccountId = process.env.META_AD_ACCOUNT_ID ?? '';

  const fields = [
    'campaign_name',
    'impressions',
    'clicks',
    'spend',
    'ctr',
    'cpm',
    'actions',
    'action_values',
    ...(level !== 'campaign' ? ['adset_name'] : []),
    ...(level === 'ad' ? ['ad_name'] : []),
  ].join(',');

  const timeRange = JSON.stringify({ since: date_from, until: date_to });
  const filtering = JSON.stringify([
    { field: 'campaign.delivery_status', operator: 'IN', value: ['active', 'completed'] },
  ]);

  let url =
    `${GRAPH_BASE}/${adAccountId}/insights` +
    `?fields=${encodeURIComponent(fields)}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&level=${level}` +
    `&limit=${safeLimit}` +
    `&filtering=${encodeURIComponent(filtering)}` +
    `&sort=spend_descending`;

  if (breakdowns) url += `&breakdowns=${encodeURIComponent(breakdowns)}`;

  try {
    const res = await fetchWithRetry(url);
    const json: MetaInsightsResponse = await res.json();

    if (json.error) throw new Error(json.error.message);

    const rows = json.data ?? [];

    if (rows.length === 0) {
      return `[Meta Ads] Nenhuma campanha encontrada no período ${date_from} a ${date_to}.`;
    }

    // Label do identificador principal
    const nameKey = level === 'ad' ? 'ad_name' : level === 'adset' ? 'adset_name' : 'campaign_name';
    const nameLabel = level === 'ad' ? 'Anúncio' : level === 'adset' ? 'Adset' : 'Campanha';

    // Colunas extras de breakdown
    const breakdownCols: string[] = breakdowns ? breakdowns.split(',') : [];

    let totalGasto = 0;
    let totalPurchases = 0;
    let totalReceita = 0;

    const tableRows = rows.map((row, i) => {
      const nome = (row[nameKey as keyof MetaInsightRow] as string) ?? 'N/D';
      const m = processRow(row);

      totalGasto += m.gasto;
      totalPurchases += m.purchases;
      totalReceita += m.purchaseValue;

      const base = [
        String(i + 1),
        nome,
        m.impressoes.toLocaleString('pt-BR'),
        m.cliques.toLocaleString('pt-BR'),
        formatPercent(m.ctr / 100), // Meta retorna CTR como "2.5" (não decimal)
        formatBRL(m.gasto),
        m.purchases > 0 ? m.purchases.toFixed(0) : '0',
        m.purchaseValue > 0 ? formatBRL(m.purchaseValue) : 'N/D',
        m.roas > 0 ? `${m.roas.toFixed(2)}x` : 'N/D',
        m.cpa > 0 ? formatBRL(m.cpa) : 'N/D',
        m.addToCarts > 0 ? m.addToCarts.toFixed(0) : '0',
      ];

      // Adiciona colunas de breakdown se houver
      const extraCols = breakdownCols.map(
        (b) => (row[b as keyof MetaInsightRow] as string) ?? 'N/D'
      );

      return [...base, ...extraCols];
    });

    const baseHeaders = [
      '#', nameLabel, 'Impressões', 'Cliques', 'CTR',
      'Gasto', 'Compras', 'Receita', 'ROAS', 'CPA', 'ATC',
    ];
    const headers = [...baseHeaders, ...breakdownCols];

    const table = compactTable(headers, tableRows);
    const roasTotal = totalGasto > 0 ? (totalReceita / totalGasto).toFixed(2) : 'N/D';

    return (
      `[Meta Ads] ${nameLabel}s — ${date_from} a ${date_to}${breakdowns ? ` | breakdown: ${breakdowns}` : ''}\n` +
      `${table}\n` +
      `Total: Gasto ${formatBRL(totalGasto)} | Compras ${totalPurchases.toFixed(0)} | Receita ${formatBRL(totalReceita)} | ROAS ${roasTotal}x`
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Meta Ads]: Timeout ao buscar insights. Sugestão: tente um período menor.`;
    }
    if (msg.toLowerCase().includes('token') || msg.includes('190')) {
      return `ERRO [Meta Ads]: Token inválido ou expirado. Sugestão: renove o META_ACCESS_TOKEN.`;
    }
    return `ERRO [Meta Ads]: ${msg}. Sugestão: verifique as credenciais.`;
  }
}

// ─── meta_ads_creative_insights ───────────────────────────────────────────────

interface CreativeInsightsInput {
  date_from: string;
  date_to: string;
  limit?: number;
}

export async function meta_ads_creative_insights(
  input: CreativeInsightsInput
): Promise<string> {
  // Reutiliza campaign_insights com level=ad para análise de criativos
  return meta_ads_campaign_insights({
    ...input,
    level: 'ad',
  });
}

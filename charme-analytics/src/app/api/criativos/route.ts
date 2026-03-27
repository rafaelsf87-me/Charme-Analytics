import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CreativeRow {
  platform: 'google' | 'meta';
  adId: string;
  adName: string;
  campaignName: string;
  adGroupName: string | null;
  campaignType: string;
  thumbnailUrl: string | null;
  headline: string | null;
  description: string | null;
  adText: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number;
  viewConversions: number | null;
}

interface RequestBody {
  channel: 'google' | 'meta' | 'all';
  dateFrom: string;
  dateTo: string;
  campaignTypes: string[];
  campaignId?: string;
  limit: number;
  sortBy: string;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

let gadsOAuthClient: OAuth2Client | null = null;

async function getGadsToken(): Promise<string> {
  if (!gadsOAuthClient) {
    gadsOAuthClient = new OAuth2Client(
      process.env.GOOGLE_ADS_CLIENT_ID,
      process.env.GOOGLE_ADS_CLIENT_SECRET
    );
    gadsOAuthClient.setCredentials({ refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN });
  }
  const { token } = await gadsOAuthClient.getAccessToken();
  if (!token) throw new Error('Não foi possível obter token Google Ads');
  return token;
}

const GRAPH = 'https://graph.facebook.com/v21.0';
const GADS_ENDPOINT = () =>
  `https://googleads.googleapis.com/v20/customers/${
    (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  }/googleAds:searchStream`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMetaAction(
  arr: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!arr?.length) return 0;
  const found =
    arr.find(a => a.action_type === type) ??
    arr.find(a => a.action_type === `offsite_conversion.fb_pixel_${type}`);
  return found ? parseFloat(found.value) : 0;
}

function mapMetaObjective(obj: string): string {
  const map: Record<string, string> = {
    OUTCOME_SALES: 'Conversão',
    OUTCOME_TRAFFIC: 'Tráfego',
    OUTCOME_AWARENESS: 'Awareness',
    OUTCOME_LEADS: 'Leads',
    OUTCOME_ENGAGEMENT: 'Engajamento',
    OUTCOME_APP_PROMOTION: 'App',
  };
  return map[obj] ?? obj;
}

function mapGadsChannelType(type: string, subType?: string): string {
  if (type === 'DEMAND_GEN' || subType === 'DEMAND_GEN') return 'Demand Gen';
  const map: Record<string, string> = {
    SEARCH: 'Search',
    PERFORMANCE_MAX: 'PMax',
    DISPLAY: 'Display',
    SHOPPING: 'Shopping',
  };
  return map[type] ?? type;
}

function sortRows(rows: CreativeRow[], sortBy: string): CreativeRow[] {
  const key = sortBy as keyof CreativeRow;
  return [...rows].sort((a, b) => {
    const va = (a[key] as number) ?? 0;
    const vb = (b[key] as number) ?? 0;
    return vb - va;
  });
}

// ─── Google Ads ───────────────────────────────────────────────────────────────

interface GadsAdRow {
  adGroupAd?: {
    ad?: {
      id?: string;
      name?: string;
      type?: string;
      responsiveSearchAd?: {
        headlines?: Array<{ text?: string }>;
        descriptions?: Array<{ text?: string }>;
      };
      responsiveDisplayAd?: {
        headlines?: Array<{ text?: string }>;
        descriptions?: Array<{ text?: string }>;
      };
    };
  };
  adGroup?: {
    name?: string;
  };
  campaign?: {
    id?: string;
    name?: string;
    advertisingChannelType?: string;
    advertisingChannelSubType?: string;
  };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: string;
    conversionsValue?: string;
    viewThroughConversions?: string;
  };
}

async function fetchGoogleCreatives(body: RequestBody): Promise<CreativeRow[]> {
  const token = await getGadsToken();

  // Monta filtro de tipo de campanha
  const typeFilters: string[] = [];
  const types = body.campaignTypes.length > 0 ? body.campaignTypes : [];

  if (types.length > 0) {
    const channelTypes = types.filter(t => t !== 'DEMAND_GEN');
    if (channelTypes.length > 0) {
      typeFilters.push(
        `campaign.advertising_channel_type IN (${channelTypes.map(t => `'${t}'`).join(', ')})`
      );
    }
    if (types.includes('DEMAND_GEN')) {
      // DEMAND_GEN pode ser channel_type ou sub_type dependendo da versão da API
      typeFilters.push(`campaign.advertising_channel_type = 'DEMAND_GEN'`);
    }
  }

  const campaignFilter = body.campaignId
    ? `AND campaign.id = '${body.campaignId}'`
    : '';

  const typeFilter =
    typeFilters.length > 0 ? `AND (${typeFilters.join(' OR ')})` : '';

  const gaql = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_display_ad.headlines,
      ad_group_ad.ad.responsive_display_ad.descriptions,
      ad_group.name,
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.view_through_conversions
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${body.dateFrom}' AND '${body.dateTo}'
      AND ad_group_ad.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
      AND metrics.cost_micros > 0
      ${typeFilter}
      ${campaignFilter}
    ORDER BY metrics.cost_micros DESC
    LIMIT ${body.limit}
  `.trim();

  const res = await fetch(GADS_ENDPOINT(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
      'login-customer-id': (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: gaql }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Google Ads HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const text = await res.text();
  const rows: GadsAdRow[] = [];

  try {
    const parsed = JSON.parse(text);
    const chunks = Array.isArray(parsed) ? parsed : [parsed];
    for (const chunk of chunks) {
      if (chunk.error) throw new Error(chunk.error.message);
      if (chunk.results) rows.push(...chunk.results);
    }
  } catch {
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const chunk = JSON.parse(line);
        if (chunk.results) rows.push(...chunk.results);
      } catch { /* ignora */ }
    }
  }

  return rows.map((row): CreativeRow => {
    const ad = row.adGroupAd?.ad;
    const m = row.metrics;
    const camp = row.campaign;
    const adGroupName = row.adGroup?.name ?? null;

    const spend = parseInt(m?.costMicros ?? '0') / 1_000_000;
    const impressions = parseInt(m?.impressions ?? '0');
    const clicks = parseInt(m?.clicks ?? '0');
    const conversions = parseFloat(m?.conversions ?? '0');
    const revenue = parseFloat(m?.conversionsValue ?? '0');
    const roas = spend > 0 ? revenue / spend : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;

    // Extrai texto do anúncio
    const rsa = ad?.responsiveSearchAd;
    const rda = ad?.responsiveDisplayAd;
    const headlines = (rsa?.headlines ?? rda?.headlines ?? [])
      .slice(0, 3)
      .map(h => h.text)
      .filter(Boolean)
      .join(' | ');
    const descriptions = (rsa?.descriptions ?? rda?.descriptions ?? [])
      .slice(0, 1)
      .map(d => d.text)
      .filter(Boolean)
      .join(' ');

    return {
      platform: 'google',
      adId: ad?.id ?? '',
      adName: ad?.name ?? 'N/D',
      campaignName: camp?.name ?? 'N/D',
      adGroupName,
      campaignType: mapGadsChannelType(
        camp?.advertisingChannelType ?? '',
        camp?.advertisingChannelSubType
      ),
      thumbnailUrl: null, // Google: sem thumbnail na v1
      headline: headlines || null,
      description: descriptions || null,
      adText: headlines ? `${headlines}\n${descriptions}`.trim() : null,
      spend,
      impressions,
      clicks,
      ctr,
      conversions,
      revenue,
      roas,
      cpa,
      viewConversions: parseInt(m?.viewThroughConversions ?? '0') || null,
    };
  });
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────

interface MetaInsightRow {
  ad_id?: string;
  ad_name?: string;
  campaign_name?: string;
  adset_name?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  purchase_roas?: Array<{ action_type: string; value: string }>;
}

interface MetaCreativeNode {
  id?: string;
  name?: string;
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    title?: string;
    body?: string;
    video_id?: string;
  };
  campaign?: { objective?: string };
}

async function fetchMetaCreatives(body: RequestBody): Promise<CreativeRow[]> {
  const token = process.env.META_ACCESS_TOKEN ?? '';
  const rawAccountId = process.env.META_AD_ACCOUNT_ID ?? '';
  const accountId = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;
  const timeRange = JSON.stringify({ since: body.dateFrom, until: body.dateTo });

  // Filtro de campanha específica
  const filteringBase: Array<{ field: string; operator: string; value: unknown }> = [];
  if (body.campaignId) {
    filteringBase.push({ field: 'campaign.id', operator: 'EQUAL', value: body.campaignId });
  }

  // Campos mínimos: sem actions nem action_values (arrays pesados)
  const fields = [
    'ad_id', 'ad_name', 'campaign_name', 'adset_name',
    'impressions', 'clicks', 'spend', 'ctr',
    'purchase_roas',
  ].join(',');

  // 1. Insights por ad
  const insightsUrl =
    `${GRAPH}/${accountId}/insights` +
    `?level=ad` +
    `&fields=${encodeURIComponent(fields)}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&action_attribution_windows=${encodeURIComponent('["7d_click","1d_view"]')}` +
    (filteringBase.length > 0 ? `&filtering=${encodeURIComponent(JSON.stringify(filteringBase))}` : '') +
    `&sort=spend_descending` +
    `&limit=${Math.min(body.limit, 25)}`; // Meta: cap em 25 para evitar payload grande

  const insightsRes = await fetch(insightsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!insightsRes.ok) {
    const err = await insightsRes.text().catch(() => '');
    throw new Error(`Meta Ads insights HTTP ${insightsRes.status}: ${err.slice(0, 200)}`);
  }

  const insightsJson = await insightsRes.json() as {
    data?: MetaInsightRow[];
    error?: { message: string };
  };

  if (insightsJson.error) throw new Error(insightsJson.error.message);

  const insightRows = insightsJson.data ?? [];
  if (insightRows.length === 0) return [];

  // 2. Batch fetch de creative info por ad_id
  const adIds = insightRows.map(r => r.ad_id).filter(Boolean) as string[];
  const creativeMap = new Map<string, MetaCreativeNode>();

  if (adIds.length > 0) {
    const batchUrl =
      `${GRAPH}?ids=${adIds.join(',')}` +
      `&fields=${encodeURIComponent('id,name,creative{thumbnail_url,image_url,title,body,video_id},campaign{objective}')}` +
      `&access_token=${token}`;

    const creativeRes = await fetch(batchUrl);
    if (creativeRes.ok) {
      const creativeJson = await creativeRes.json() as Record<string, MetaCreativeNode>;
      for (const [id, node] of Object.entries(creativeJson)) {
        creativeMap.set(id, node);
      }
    }
  }

  // 3. Filtro de tipo de campanha (Meta) — feito no frontend via objectives
  let rows = insightRows;
  if (body.campaignTypes.length > 0) {
    // Filtra por objective se temos info da campanha (melhor esforço)
    // Se não temos, mantém tudo
    rows = insightRows.filter(r => {
      const creative = creativeMap.get(r.ad_id ?? '');
      const objective = creative?.campaign?.objective;
      if (!objective) return true; // sem info, mantém
      return body.campaignTypes.includes(objective);
    });
  }

  return rows.map((row): CreativeRow => {
    const creative = creativeMap.get(row.ad_id ?? '');
    const c = creative?.creative;

    const spend = parseFloat(row.spend ?? '0');
    const impressions = parseInt(row.impressions ?? '0');
    const clicks = parseInt(row.clicks ?? '0');
    const ctr = parseFloat(row.ctr ?? '0') / 100;
    // purchase_roas retorna [{action_type: "omni_purchase", value: "2.5"}]
    const roasRaw = parseFloat(row.purchase_roas?.[0]?.value ?? '0');
    const roas = roasRaw > 0 ? roasRaw : 0;
    const revenue = spend * roas;
    // Conversions não disponível sem o campo 'actions' (removido por payload)
    const conversions = 0;
    const cpa = 0;

    const thumbnailUrl = c?.thumbnail_url ?? c?.image_url ?? null;
    const isVideo = !!(c?.video_id);
    const objective = creative?.campaign?.objective;

    return {
      platform: 'meta',
      adId: row.ad_id ?? '',
      adName: row.ad_name ?? 'N/D',
      campaignName: row.campaign_name ?? 'N/D',
      adGroupName: row.adset_name ?? null,
      campaignType: objective ? mapMetaObjective(objective) : 'N/D',
      thumbnailUrl: isVideo && !thumbnailUrl ? '__video__' : thumbnailUrl,
      headline: c?.title ?? null,
      description: c?.body ?? null,
      adText: [c?.title, c?.body].filter(Boolean).join('\n') || null,
      spend,
      impressions,
      clicks,
      ctr,
      conversions,
      revenue,
      roas,
      cpa,
      viewConversions: null,
    };
  });
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as RequestBody | null;

  if (!body?.channel || !body?.dateFrom || !body?.dateTo) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios: channel, dateFrom, dateTo' }, { status: 400 });
  }

  const errors: string[] = [];
  let google: CreativeRow[] = [];
  let meta: CreativeRow[] = [];

  if (body.channel === 'google' || body.channel === 'all') {
    try {
      google = await fetchGoogleCreatives(body);
    } catch (err) {
      errors.push(`Google Ads: ${(err as Error).message}`);
    }
  }

  if (body.channel === 'meta' || body.channel === 'all') {
    try {
      meta = await fetchMetaCreatives(body);
    } catch (err) {
      errors.push(`Meta Ads: ${(err as Error).message}`);
    }
  }

  // Combina e ordena
  const combined = sortRows([...google, ...meta], body.sortBy ?? 'spend');

  return NextResponse.json({
    google: body.channel !== 'meta' ? sortRows(google, body.sortBy) : undefined,
    meta: body.channel !== 'google' ? sortRows(meta, body.sortBy) : undefined,
    combined,
    errors: errors.length > 0 ? errors : undefined,
  });
}

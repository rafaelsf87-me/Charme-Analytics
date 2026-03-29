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
  adType: 'standard' | 'catalog' | 'pmax';
  creativeType: string | null;
}

interface RequestBody {
  channel: 'google' | 'meta' | 'all';
  dateFrom: string;
  dateTo: string;
  campaignTypes: string[];
  campaignId?: string;
  limit: number;
  sortBy: string;
  adTypeFilter?: 'all' | 'standard' | 'catalog' | 'pmax';
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
    PRODUCT_CATALOG_SALES: 'Catálogo',
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

function mapGadsAdType(adType: string): string {
  const map: Record<string, string> = {
    RESPONSIVE_SEARCH_AD: 'Pesquisa Responsiva',
    RESPONSIVE_DISPLAY_AD: 'Display Responsivo',
    EXPANDED_TEXT_AD: 'Texto Expandido',
    SHOPPING_PRODUCT_AD: 'Shopping',
    VIDEO_RESPONSIVE_AD: 'Vídeo Responsivo',
    DEMAND_GEN_MULTI_ASSET_AD: 'Demand Gen',
    DEMAND_GEN_RESPONSIVE_AD: 'Demand Gen Responsivo',
    DEMAND_GEN_PRODUCT_AD: 'Demand Gen Produto',
    CALL_AD: 'Chamada',
    APP_AD: 'App',
    SMART_CAMPAIGN_AD: 'Campanha Inteligente',
    IMAGE_AD: 'Imagem',
    HTML5_UPLOAD_AD: 'HTML5',
    LEGACY_RESPONSIVE_DISPLAY_AD: 'Display (legado)',
  };
  return map[adType] ?? adType;
}

function mapPMaxFieldType(fieldType: string): string {
  const map: Record<string, string> = {
    MARKETING_IMAGE: 'Imagem horizontal',
    SQUARE_MARKETING_IMAGE: 'Imagem quadrada',
    PORTRAIT_MARKETING_IMAGE: 'Imagem vertical',
    LOGO: 'Logo',
    LANDSCAPE_LOGO: 'Logo horizontal',
    YOUTUBE_VIDEO: 'Vídeo YouTube',
    HEADLINE: 'Título',
    LONG_HEADLINE: 'Título Longo',
    DESCRIPTION: 'Descrição',
    BUSINESS_NAME: 'Nome da Empresa',
    CALL_TO_ACTION_SELECTION: 'CTA',
    SITELINK: 'Sitelink',
  };
  return map[fieldType] ?? fieldType;
}

function sortRows(rows: CreativeRow[], sortBy: string): CreativeRow[] {
  const key = sortBy as keyof CreativeRow;
  return [...rows].sort((a, b) => {
    const va = (a[key] as number) ?? 0;
    const vb = (b[key] as number) ?? 0;
    return vb - va;
  });
}

// ─── Google Ads (anúncios padrão + catálogo shopping) ─────────────────────────

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
  const adTypeFilter = body.adTypeFilter ?? 'all';

  // Filtro de tipo de campanha (objetivo da campanha)
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
      typeFilters.push(`campaign.advertising_channel_type = 'DEMAND_GEN'`);
    }
  }

  // Filtro de adType (Padrão / Produto Direto) — PMax nunca vem aqui
  let adTypeCondition = `AND campaign.advertising_channel_type != 'PERFORMANCE_MAX'`;
  if (adTypeFilter === 'standard') {
    adTypeCondition = `AND campaign.advertising_channel_type NOT IN ('PERFORMANCE_MAX', 'SHOPPING') AND ad_group_ad.ad.type != 'DEMAND_GEN_PRODUCT_AD'`;
  } else if (adTypeFilter === 'catalog') {
    adTypeCondition = `AND campaign.advertising_channel_type != 'PERFORMANCE_MAX' AND (campaign.advertising_channel_type = 'SHOPPING' OR ad_group_ad.ad.type = 'DEMAND_GEN_PRODUCT_AD')`;
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
      ${adTypeCondition}
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
    const channelType = camp?.advertisingChannelType ?? '';

    const spend = parseInt(m?.costMicros ?? '0') / 1_000_000;
    const impressions = parseInt(m?.impressions ?? '0');
    const clicks = parseInt(m?.clicks ?? '0');
    const conversions = parseFloat(m?.conversions ?? '0');
    const revenue = parseFloat(m?.conversionsValue ?? '0');
    const roas = spend > 0 ? revenue / spend : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;

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

    const adTypeStr = ad?.type ?? '';
    const isCatalog = channelType === 'SHOPPING' || adTypeStr === 'DEMAND_GEN_PRODUCT_AD';
    const adTypeCategory: 'standard' | 'catalog' = isCatalog ? 'catalog' : 'standard';
    const creativeType = channelType === 'SHOPPING' ? 'Shopping' : mapGadsAdType(adTypeStr);

    return {
      platform: 'google',
      adId: ad?.id ?? '',
      adName: ad?.name ?? 'N/D',
      campaignName: camp?.name ?? 'N/D',
      adGroupName,
      campaignType: mapGadsChannelType(channelType, camp?.advertisingChannelSubType),
      thumbnailUrl: null,
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
      adType: adTypeCategory,
      creativeType: creativeType || null,
    };
  });
}

// ─── Google Ads PMax (asset_group + asset_group_asset) ───────────────────────

async function fetchGooglePMaxAssets(body: RequestBody): Promise<CreativeRow[]> {
  const token = await getGadsToken();
  const reqHeaders = {
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
    'login-customer-id': (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, ''),
    'Content-Type': 'application/json',
  };

  const campaignFilter = body.campaignId
    ? `AND campaign.id = '${body.campaignId}'`
    : '';

  // asset_group_asset NÃO suporta metrics + segments.date — usar duas queries separadas:
  // Query 1: métricas por asset_group (suporta date range e metrics)
  const metricsGaql = `
    SELECT
      asset_group.id,
      asset_group.name,
      campaign.id,
      campaign.name,
      campaign.shopping_setting.merchant_id,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM asset_group
    WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      AND segments.date BETWEEN '${body.dateFrom}' AND '${body.dateTo}'
      AND campaign.status = 'ENABLED'
      AND metrics.cost_micros > 0
      ${campaignFilter}
    ORDER BY metrics.cost_micros DESC
    LIMIT ${body.limit}
  `.trim();

  // Query 2: assets visuais por asset_group (sem date range, sem metrics)
  const assetsGaql = `
    SELECT
      asset_group_asset.field_type,
      asset.id,
      asset.name,
      asset.image_asset.full_size.url,
      asset.youtube_video_asset.youtube_video_id,
      asset_group.id,
      asset_group.name,
      campaign.id
    FROM asset_group_asset
    WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      AND campaign.status = 'ENABLED'
      AND asset_group_asset.status = 'ENABLED'
      AND asset_group_asset.field_type IN (
        'MARKETING_IMAGE', 'SQUARE_MARKETING_IMAGE', 'PORTRAIT_MARKETING_IMAGE',
        'YOUTUBE_VIDEO'
      )
      ${campaignFilter}
    LIMIT 500
  `.trim();

  async function gadsQuery(gaql: string, label: string): Promise<object[]> {
    const res = await fetch(GADS_ENDPOINT(), {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({ query: gaql }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Google Ads PMax ${label} HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const text = await res.text();
    const rows: object[] = [];
    try {
      const parsed = JSON.parse(text);
      const chunks = Array.isArray(parsed) ? parsed : [parsed];
      for (const chunk of chunks) {
        const c = chunk as { error?: { message: string }; results?: object[] };
        if (c.error) throw new Error(c.error.message);
        if (c.results) rows.push(...c.results);
      }
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!msg.includes('JSON') && !msg.includes('token') && !msg.includes('Unexpected')) throw e;
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          const chunk = JSON.parse(line) as { results?: object[] };
          if (chunk.results) rows.push(...chunk.results);
        } catch { /* ignora */ }
      }
    }
    return rows;
  }

  const [rawMetrics, rawAssets] = await Promise.all([
    gadsQuery(metricsGaql, 'métricas'),
    gadsQuery(assetsGaql, 'assets'),
  ]);

  if (rawMetrics.length === 0) return [];

  type MetricRow = {
    assetGroup?: { id?: string; name?: string };
    campaign?: { id?: string; name?: string; shoppingSetting?: { merchantId?: string } };
    metrics?: { costMicros?: string; impressions?: string; clicks?: string; conversions?: string; conversionsValue?: string };
  };
  type AssetRow = {
    assetGroupAsset?: { fieldType?: string };
    asset?: { id?: string; name?: string; imageAsset?: { fullSize?: { url?: string } }; youtubeVideoAsset?: { youtubeVideoId?: string } };
    assetGroup?: { id?: string; name?: string };
    campaign?: { id?: string };
  };

  const metrics = rawMetrics as MetricRow[];
  const assets = rawAssets as AssetRow[];

  // Mapa: asset_group.id → row de métricas
  const metricsById = new Map<string, MetricRow>();
  for (const r of metrics) {
    const id = r.assetGroup?.id;
    if (id) metricsById.set(id, r);
  }

  // Top N asset groups por spend (já vêm ordenados pelo GAQL, mas garantimos)
  const topGroupIds = new Set(
    metrics
      .sort((a, b) => parseInt(b.metrics?.costMicros ?? '0') - parseInt(a.metrics?.costMicros ?? '0'))
      .slice(0, body.limit)
      .map(r => r.assetGroup?.id)
      .filter((id): id is string => !!id)
  );

  // Agrupar assets pelos top groups
  const assetsByGroup = new Map<string, AssetRow[]>();
  for (const row of assets) {
    const agId = row.assetGroup?.id;
    if (!agId || !topGroupIds.has(agId)) continue;
    if (!assetsByGroup.has(agId)) assetsByGroup.set(agId, []);
    assetsByGroup.get(agId)!.push(row);
  }

  const result: CreativeRow[] = [];

  for (const [agId, agAssets] of assetsByGroup.entries()) {
    const m = metricsById.get(agId);
    if (!m) continue;

    const spend = parseInt(m.metrics?.costMicros ?? '0') / 1_000_000;
    const impressions = parseInt(m.metrics?.impressions ?? '0');
    const clicks = parseInt(m.metrics?.clicks ?? '0');
    const conversions = parseFloat(m.metrics?.conversions ?? '0');
    const revenue = parseFloat(m.metrics?.conversionsValue ?? '0');
    const roas = spend > 0 ? revenue / spend : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;

    // Detecção de feed de produto: merchant_id presente → campanha usa Shopping feed
    const hasFeed = !!(m.campaign?.shoppingSetting?.merchantId);

    for (const row of agAssets) {
      const asset = row.asset;
      const fieldType = row.assetGroupAsset?.fieldType ?? '';

      let thumbnailUrl: string | null = null;
      const videoId = asset?.youtubeVideoAsset?.youtubeVideoId;
      if (videoId) {
        thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      } else if (asset?.imageAsset?.fullSize?.url) {
        thumbnailUrl = asset.imageAsset.fullSize.url;
      }

      const isVideo = fieldType === 'YOUTUBE_VIDEO';
      const assetName = asset?.name || 'Asset PMax';
      const baseType = mapPMaxFieldType(fieldType);
      const creativeType = hasFeed ? `${baseType} · Feed` : baseType;

      result.push({
        platform: 'google',
        adId: asset?.id ?? '',
        adName: assetName,
        campaignName: m.campaign?.name ?? 'N/D',
        adGroupName: m.assetGroup?.name ?? null,
        campaignType: 'PMax',
        thumbnailUrl: isVideo && !thumbnailUrl ? '__video__' : thumbnailUrl,
        headline: assetName,
        description: null,
        adText: assetName,
        spend,
        impressions,
        clicks,
        ctr,
        conversions,
        revenue,
        roas,
        cpa,
        viewConversions: null,
        adType: 'pmax',
        creativeType,
      });
    }
  }

  return result.sort((a, b) => b.spend - a.spend);
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
  adset?: { promoted_object?: { product_set_id?: string } };
}

async function fetchMetaCreatives(body: RequestBody): Promise<CreativeRow[]> {
  const token = process.env.META_ACCESS_TOKEN ?? '';
  const rawAccountId = process.env.META_AD_ACCOUNT_ID ?? '';
  const accountId = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;
  const timeRange = JSON.stringify({ since: body.dateFrom, until: body.dateTo });

  const filteringBase: Array<{ field: string; operator: string; value: unknown }> = [];
  if (body.campaignId) {
    filteringBase.push({ field: 'campaign.id', operator: 'EQUAL', value: body.campaignId });
  }

  const fields = [
    'ad_id', 'ad_name', 'campaign_name', 'adset_name',
    'impressions', 'clicks', 'spend', 'ctr',
    'purchase_roas',
  ].join(',');

  const insightsUrl =
    `${GRAPH}/${accountId}/insights` +
    `?level=ad` +
    `&fields=${encodeURIComponent(fields)}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&action_attribution_windows=${encodeURIComponent('["7d_click","1d_view"]')}` +
    (filteringBase.length > 0 ? `&filtering=${encodeURIComponent(JSON.stringify(filteringBase))}` : '') +
    `&sort=spend_descending` +
    `&limit=${Math.min(body.limit, 25)}`;

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

  // Batch fetch: creative + campaign objective + adset.promoted_object (catálogo)
  const adIds = insightRows.map(r => r.ad_id).filter(Boolean) as string[];
  const creativeMap = new Map<string, MetaCreativeNode>();

  if (adIds.length > 0) {
    const batchFields = encodeURIComponent(
      'id,name,creative{thumbnail_url,image_url,title,body,video_id},campaign{objective},adset{promoted_object}'
    );
    const batchUrl =
      `${GRAPH}?ids=${adIds.join(',')}` +
      `&fields=${batchFields}` +
      `&access_token=${token}`;

    const creativeRes = await fetch(batchUrl);
    if (creativeRes.ok) {
      const creativeJson = await creativeRes.json() as Record<string, MetaCreativeNode>;
      for (const [id, node] of Object.entries(creativeJson)) {
        creativeMap.set(id, node);
      }
    }
  }

  // Filtro de tipo de campanha (objective)
  let rows = insightRows;
  if (body.campaignTypes.length > 0) {
    rows = insightRows.filter(r => {
      const creative = creativeMap.get(r.ad_id ?? '');
      const objective = creative?.campaign?.objective;
      if (!objective) return true;
      return body.campaignTypes.includes(objective);
    });
  }

  const mappedRows: CreativeRow[] = rows.map((row): CreativeRow => {
    const creative = creativeMap.get(row.ad_id ?? '');
    const c = creative?.creative;

    const spend = parseFloat(row.spend ?? '0');
    const impressions = parseInt(row.impressions ?? '0');
    const clicks = parseInt(row.clicks ?? '0');
    const ctr = parseFloat(row.ctr ?? '0') / 100;
    const roasRaw = parseFloat(row.purchase_roas?.[0]?.value ?? '0');
    const roas = roasRaw > 0 ? roasRaw : 0;
    const revenue = spend * roas;
    const conversions = 0;
    const cpa = 0;

    const thumbnailUrl = c?.thumbnail_url ?? c?.image_url ?? null;
    const isVideo = !!(c?.video_id);
    const objective = creative?.campaign?.objective ?? '';
    const promotedObject = creative?.adset?.promoted_object;
    const isCatalog = !!(promotedObject?.product_set_id || objective === 'PRODUCT_CATALOG_SALES');

    const hasImage = !!(thumbnailUrl);
    const creativeType = isCatalog
      ? 'Catálogo'
      : isVideo ? 'Vídeo' : hasImage ? 'Imagem' : 'Texto';

    return {
      platform: 'meta',
      adId: row.ad_id ?? '',
      adName: row.ad_name ?? 'N/D',
      campaignName: row.campaign_name ?? 'N/D',
      adGroupName: row.adset_name ?? null,
      campaignType: mapMetaObjective(objective) || 'N/D',
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
      adType: isCatalog ? 'catalog' : 'standard',
      creativeType,
    };
  });

  // Aplicar filtro de adType
  const adTypeFilter = body.adTypeFilter ?? 'all';
  if (adTypeFilter === 'standard') return mappedRows.filter(r => r.adType === 'standard');
  if (adTypeFilter === 'catalog') return mappedRows.filter(r => r.adType === 'catalog');
  return mappedRows;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as RequestBody | null;

  if (!body?.channel || !body?.dateFrom || !body?.dateTo) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios: channel, dateFrom, dateTo' }, { status: 400 });
  }

  const adTypeFilter = body.adTypeFilter ?? 'all';
  const errors: string[] = [];
  let google: CreativeRow[] = [];
  let meta: CreativeRow[] = [];

  // Google: padrão/catálogo via ad_group_ad, PMax via asset_group_asset
  if (body.channel === 'google' || body.channel === 'all') {
    const fetchStandard = adTypeFilter !== 'pmax';
    const fetchPMax = adTypeFilter === 'pmax' || adTypeFilter === 'all';

    const results = await Promise.allSettled([
      fetchStandard ? fetchGoogleCreatives(body) : Promise.resolve([]),
      fetchPMax ? fetchGooglePMaxAssets(body) : Promise.resolve([]),
    ]);

    if (results[0].status === 'fulfilled') {
      google = [...google, ...results[0].value];
    } else {
      errors.push(`Google Ads: ${(results[0].reason as Error).message}`);
    }

    if (results[1].status === 'fulfilled') {
      google = [...google, ...results[1].value];
    } else if (fetchPMax) {
      errors.push(`Google Ads PMax: ${(results[1].reason as Error).message}`);
    }
  }

  // Meta: sem PMax equivalente — pular se filtro for pmax
  if ((body.channel === 'meta' || body.channel === 'all') && adTypeFilter !== 'pmax') {
    try {
      meta = await fetchMetaCreatives(body);
    } catch (err) {
      errors.push(`Meta Ads: ${(err as Error).message}`);
    }
  }

  const combined = sortRows([...google, ...meta], body.sortBy ?? 'spend');

  return NextResponse.json({
    google: body.channel !== 'meta' ? sortRows(google, body.sortBy) : undefined,
    meta: body.channel !== 'google' ? sortRows(meta, body.sortBy) : undefined,
    combined,
    errors: errors.length > 0 ? errors : undefined,
  });
}

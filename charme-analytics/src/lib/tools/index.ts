import type Anthropic from '@anthropic-ai/sdk';
import {
  shopify_get_orders,
  shopify_get_top_customers,
  shopify_get_products,
} from './shopify';
import { ga4_run_report, ga4_get_top_pages } from './ga4';
import { google_ads_campaign_report, google_ads_search_query } from './google-ads';
import { meta_ads_campaign_insights, meta_ads_creative_insights } from './meta-ads';

// ─── Definições das tools (descriptions curtas — max 2 frases) ───────────────

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'shopify_get_orders',
    description:
      'Busca pedidos da Shopify com filtros de data e status. Retorna dados de pedidos incluindo cliente, produtos e valores.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description: 'Data inicial no formato YYYY-MM-DD',
        },
        date_to: {
          type: 'string',
          description: 'Data final no formato YYYY-MM-DD',
        },
        status: {
          type: 'string',
          description: 'Status financeiro: paid, pending, refunded, any (padrão: any)',
        },
        limit: {
          type: 'number',
          description: 'Número máximo de pedidos (1-100, padrão: 50)',
        },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'shopify_get_top_customers',
    description:
      'Ranking de clientes por receita ou nº de pedidos em um período. Retorna nome, total gasto, pedidos, ticket médio.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description: 'Data inicial no formato YYYY-MM-DD',
        },
        date_to: {
          type: 'string',
          description: 'Data final no formato YYYY-MM-DD',
        },
        limit: {
          type: 'number',
          description: 'Número de clientes no ranking (1-100, padrão: 10)',
        },
        sort_by: {
          type: 'string',
          enum: ['revenue', 'orders'],
          description: 'Ordenar por receita total (revenue) ou nº de pedidos (orders)',
        },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'shopify_get_products',
    description:
      'Lista ou busca produtos da loja. Retorna título, tipo, estoque e preços.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Número máximo de produtos (1-100, padrão: 20)',
        },
        search_query: {
          type: 'string',
          description: 'Termo de busca para filtrar produtos por título',
        },
      },
      required: [],
    },
  },
  {
    name: 'ga4_run_report',
    description:
      'Relatório customizado do GA4 com métricas, dimensões e filtros. Use para dados de tráfego, sessões, conversões e comportamento.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Métricas: sessions, totalUsers, screenPageViews, conversions, ecommercePurchases, purchaseRevenue, addToCarts, checkouts, itemRevenue, averageSessionDuration',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Dimensões: sessionSource, sessionMedium, sessionCampaignName, pagePath, pageTitle, deviceCategory, country, city, eventName, itemName',
        },
        filters: {
          type: 'string',
          description:
            'Filtro de dimensão no formato "dimensionName contains termo" (ex: "pagePath contains sofa")',
        },
        limit: {
          type: 'number',
          description: 'Número de linhas (1-50, padrão: 10)',
        },
      },
      required: ['date_from', 'date_to', 'metrics', 'dimensions'],
    },
  },
  {
    name: 'meta_ads_campaign_insights',
    description:
      'Performance Meta Ads por campanha, adset ou anúncio. Inclui spend, conversões, ROAS, CPA. Suporta breakdowns por idade, gênero, device.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        level: {
          type: 'string',
          enum: ['campaign', 'adset', 'ad'],
          description: 'Nível de granularidade (padrão: campaign)',
        },
        limit: { type: 'number', description: 'Número de linhas (1-100, padrão: 20)' },
        breakdowns: {
          type: 'string',
          description:
            'Breakdowns opcionais separados por vírgula: age, gender, device_platform, publisher_platform',
        },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'meta_ads_creative_insights',
    description:
      'Performance no nível de anúncio individual do Meta Ads com nome do criativo e adset.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        limit: { type: 'number', description: 'Número de anúncios (1-100, padrão: 20)' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'google_ads_campaign_report',
    description:
      'Performance de campanhas Google Ads com impressões, cliques, custo, conversões e ROAS.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        limit: { type: 'number', description: 'Número de campanhas (1-100, padrão: 20)' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'google_ads_search_query',
    description:
      'Executa query GAQL customizada no Google Ads. Apenas SELECT permitido.',
    input_schema: {
      type: 'object',
      properties: {
        gaql_query: {
          type: 'string',
          description:
            'Query GAQL completa começando com SELECT. Ex: SELECT campaign.name, metrics.clicks FROM campaign WHERE ...',
        },
      },
      required: ['gaql_query'],
    },
  },
  {
    name: 'ga4_get_top_pages',
    description:
      'Ranking de páginas do site por views, conversões ou receita em um período.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        limit: { type: 'number', description: 'Número de páginas (1-50, padrão: 10)' },
        sort_by: {
          type: 'string',
          enum: ['views', 'conversions', 'revenue'],
          description: 'Ordenar por views, conversões ou receita',
        },
      },
      required: ['date_from', 'date_to'],
    },
  },
];

// ─── Dispatcher ─────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

export async function executeTool(
  name: string,
  input: ToolInput
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i = input as any;
  switch (name) {
    case 'shopify_get_orders':
      return shopify_get_orders(i);
    case 'shopify_get_top_customers':
      return shopify_get_top_customers(i);
    case 'shopify_get_products':
      return shopify_get_products(i);
    case 'ga4_run_report':
      return ga4_run_report(i);
    case 'ga4_get_top_pages':
      return ga4_get_top_pages(i);
    case 'google_ads_campaign_report':
      return google_ads_campaign_report(i);
    case 'google_ads_search_query':
      return google_ads_search_query(i);
    case 'meta_ads_campaign_insights':
      return meta_ads_campaign_insights(i);
    case 'meta_ads_creative_insights':
      return meta_ads_creative_insights(i);
    default:
      return `ERRO: Tool "${name}" não reconhecida.`;
  }
}

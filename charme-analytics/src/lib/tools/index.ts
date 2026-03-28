import type Anthropic from '@anthropic-ai/sdk';
import {
  shopify_get_orders,
  shopify_get_top_customers,
  shopify_get_products,
  shopify_get_top_products,
} from './shopify';
import { ga4_run_report, ga4_get_top_pages, ga4_get_item_report } from './ga4';
import { google_ads_campaign_report, google_ads_search_query } from './google-ads';
import { meta_ads_campaign_insights, meta_ads_creative_insights } from './meta-ads';
import {
  yampi_get_orders,
  yampi_get_top_customers,
  yampi_search_products,
} from './yampi-legacy';

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
    name: 'shopify_get_top_products',
    description:
      'Ranking de produtos mais vendidos por receita ou quantidade, a partir de TODOS os pedidos pagos do período (paginação completa — sem limite de 100). Use para "top produtos", "produtos mais vendidos", "faturamento por produto", "ranking de vendas". Suporta filtro por fragmento de título (ex: "ofá" para sofás, "adeira" para cadeiras). NÃO use para ATC ou views — essas métricas são do GA4.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        limit: { type: 'number', description: 'Número de produtos no ranking (1-100, padrão: 20)' },
        sort_by: {
          type: 'string',
          enum: ['revenue', 'quantity'],
          description: 'Ordenar por receita (revenue, padrão) ou unidades vendidas (quantity)',
        },
        product_filter: {
          type: 'string',
          description: 'Fragmento de texto para filtrar por título. Para sofá use "ofá", cadeira use "adeira". Case-insensitive.',
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
    name: 'yampi_get_orders',
    description:
      'Pedidos históricos da Yampi (antes do Shopify) com filtro de data. Dados de Dez/2022 a ~Abr/2025 com gaps conhecidos.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        limit: { type: 'number', description: 'Número máximo de pedidos (padrão: 50)' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'yampi_get_top_customers',
    description:
      'Ranking de clientes históricos por receita ou nº de compras. Dados pré-Shopify (Yampi).',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        limit: { type: 'number', description: 'Número de clientes (padrão: 10)' },
        sort_by: {
          type: 'string',
          enum: ['revenue', 'orders'],
          description: 'Ordenar por receita (revenue) ou nº de compras (orders)',
        },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'yampi_search_products',
    description:
      'Busca vendas de um produto nos dados históricos (Yampi) por nome ou SKU.',
    input_schema: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'Nome do produto ou SKU para buscar' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (opcional)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (opcional)' },
      },
      required: ['search_term'],
    },
  },
  {
    name: 'ga4_get_item_report',
    description:
      'Performance de produtos individuais no GA4 por itemName. Use SEMPRE que a pergunta envolver ATC, checkout, views ou conversões por produto específico. Métricas item-scoped: itemsViewed, itemsAddedToCart, itemsPurchased, itemRevenue. NÃO use ga4_run_report com addToCarts para análise de produto. product_filter usa OR automático com/sem acento + case-insensitive: "sofá" captura Sofá/SOFÁ/sofa mas NÃO Almofada. Usar NOME COMPLETO da categoria. Para "melhores e piores", usar ranking_mode: "both". Para "taxa checkout" (conversão do carrinho), usar sort_by: "checkout". Taxa Checkout = Compras ÷ ATC (eventos corrigidos para cadeira) × 100.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD' },
        product_filter: {
          type: 'string',
          description: 'Termo de categoria para filtrar itemName. Usar nome completo: "sofá", "cadeira", "cortina", "almofada". O sistema aplica OR com variantes acento/sem acento + case-insensitive automaticamente.',
        },
        limit: { type: 'number', description: 'Número de produtos por grupo (1-50, padrão: 10). Em ranking_mode "both", retorna limit melhores + limit piores.' },
        sort_by: {
          type: 'string',
          enum: ['views', 'atc', 'purchases', 'revenue', 'checkout'],
          description: 'Ordenar por: revenue (PADRÃO), views, atc (taxa ATC %), purchases, checkout (taxa checkout = compras÷ATC×100). ATC e checkout sempre como taxa % — nunca contagem bruta.',
        },
        ranking_mode: {
          type: 'string',
          enum: ['best', 'worst', 'both'],
          description: 'best (padrão) = top N melhores. worst = top N piores. both = top N melhores + top N piores no mesmo relatório. Usar "both" quando o usuário pedir "melhores e piores".',
        },
        min_views: {
          type: 'number',
          description: 'Mínimo de views (itemsViewed) para incluir produto. Padrão: 500.',
        },
        highlight_min_views: {
          type: 'number',
          description: 'OBRIGATÓRIO em toda análise de produto. Produtos com views acima desse valor aparecem em "Produtos Destaque a Considerar". Usar conforme período: 7D→1000, 15D→2000, 30D→3000, 60D→5000, 90D→7000.',
        },
        highlight_min_revenue: {
          type: 'number',
          description: 'OBRIGATÓRIO em toda análise de produto. Produtos com receita acima desse valor aparecem em "Produtos Destaque a Considerar". Usar conforme período: 7D→2000, 15D→3000, 30D→4000, 60D→6000, 90D→8000.',
        },
      },
      required: ['date_from', 'date_to'],
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
    case 'shopify_get_top_products':
      return shopify_get_top_products(i);
    case 'shopify_get_products':
      return shopify_get_products(i);
    case 'ga4_run_report':
      return ga4_run_report(i);
    case 'ga4_get_item_report':
      return ga4_get_item_report(i);
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
    case 'yampi_get_orders':
      return yampi_get_orders(i);
    case 'yampi_get_top_customers':
      return yampi_get_top_customers(i);
    case 'yampi_search_products':
      return yampi_search_products(i);
    default:
      return `ERRO: Tool "${name}" não reconhecida.`;
  }
}

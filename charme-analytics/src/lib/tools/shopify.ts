import { formatBRL, formatDate, compactTable } from '@/lib/formatters';
import { mergeConsecutiveOrders } from './order-utils';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_URL = `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`;
const TIMEOUT_MS = 30_000;

// Cache em memória do token (renova automaticamente ao expirar)
let cachedToken = process.env.SHOPIFY_ACCESS_TOKEN ?? '';
let tokenExpiresAt = 0; // epoch ms

async function getAccessToken(): Promise<string> {
  const agora = Date.now();
  // Renova se não há token ou se expira nos próximos 5 minutos
  if (!cachedToken || agora >= tokenExpiresAt - 5 * 60 * 1000) {
    const res = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      }),
    });
    if (!res.ok) throw new Error(`Falha ao renovar token Shopify: HTTP ${res.status}`);
    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = agora + data.expires_in * 1000;
  }
  return cachedToken;
}

// Retry com backoff exponencial em 429/THROTTLED (max 3x, delays: 1s, 3s, 9s)
async function fetchWithRetry(
  body: string,
  attempt = 1
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const token = await getAccessToken();

  try {
    const res = await fetch(SHOPIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body,
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
    if ((err as Error).name === 'AbortError') {
      throw new Error('Timeout após 30s');
    }
    throw err;
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shopifyQuery<T>(query: string): Promise<T> {
  const res = await fetchWithRetry(JSON.stringify({ query }));

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();

  // Checa erros GraphQL de throttling
  if (json.errors) {
    const isThrottled = json.errors.some(
      (e: { extensions?: { code?: string } }) => e.extensions?.code === 'THROTTLED'
    );
    if (isThrottled) throw new Error('Rate limit Shopify');
    throw new Error(json.errors[0]?.message ?? 'Erro GraphQL');
  }

  return json.data as T;
}

// Validação de datas
function validateDates(date_from: string, date_to: string): string | null {
  const from = new Date(date_from);
  const to = new Date(date_to);
  const now = new Date();
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 'Datas inválidas (use YYYY-MM-DD)';
  if (from > to) return 'date_from deve ser anterior a date_to';
  if (to > now) return 'date_to não pode ser no futuro';
  return null;
}

// ─── shopify_get_orders ──────────────────────────────────────────────────────

interface OrdersInput {
  date_from: string;
  date_to: string;
  status?: string;
  limit?: number;
}

// Status financeiros que representam pedidos pagos (filtro feito no backend, não no GraphQL)
const PAID_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

interface ShopifyOrdersData {
  orders: {
    pageInfo?: { hasNextPage: boolean; endCursor: string };
    edges: Array<{
      node: {
        name: string;
        createdAt: string;
        displayFinancialStatus: string;
        totalPriceSet: { shopMoney: { amount: string } };
        customer: { firstName: string; lastName: string; email: string } | null;
        lineItems: {
          edges: Array<{
            node: { title: string; quantity: number };
          }>;
        };
      };
    }>;
  };
}

export async function shopify_get_orders(input: OrdersInput): Promise<string> {
  const { date_from, date_to, limit = 50 } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Shopify]: ${validErr}`;

  const displayLimit = Math.min(Math.max(1, limit), 100);

  try {
    // Paginação completa para totais corretos — exibe só os primeiros `displayLimit`
    type OrderNode = ShopifyOrdersData['orders']['edges'][0]['node'];
    const allOrders: OrderNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause: string = cursor ? `, after: "${cursor}"` : '';
      const q = `{
        orders(first: 250${afterClause}, query: "created_at:>=${date_from} created_at:<=${date_to}", sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              name
              createdAt
              displayFinancialStatus
              totalPriceSet { shopMoney { amount } }
              customer { firstName lastName email }
              lineItems(first: 20) {
                edges { node { title quantity } }
              }
            }
          }
        }
      }`;
      const data = await shopifyQuery<ShopifyOrdersData>(q);
      allOrders.push(...data.orders.edges.map((e) => e.node));
      hasNextPage = data.orders.pageInfo?.hasNextPage ?? false;
      cursor = data.orders.pageInfo?.endCursor ?? null;
    }

    // Filtra por status no backend (evita restrições do filtro GraphQL)
    const paidOrders = allOrders.filter((o) => PAID_STATUSES.has(o.displayFinancialStatus));

    if (paidOrders.length === 0) {
      return `[SHOPIFY] Nenhum pedido pago encontrado no período ${date_from} a ${date_to}.`;
    }

    // Totais calculados sobre todos os pedidos pagos
    const totalReceita = paidOrders.reduce(
      (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
      0
    );
    const ticketMedio = totalReceita / paidOrders.length;

    // Exibe apenas os primeiros `displayLimit` na tabela
    const rows = paidOrders.slice(0, displayLimit).map((o, i) => {
      const cliente = o.customer
        ? `${o.customer.firstName ?? ''} ${o.customer.lastName ?? ''}`.trim() || o.customer.email
        : 'N/D';
      const produtos = o.lineItems.edges
        .map((e) => `${e.node.title} (${e.node.quantity}x)`)
        .join(', ') || 'N/D';
      return [
        String(i + 1),
        o.name,
        formatDate(o.createdAt),
        cliente,
        formatBRL(parseFloat(o.totalPriceSet.shopMoney.amount)),
        produtos,
      ];
    });

    const table = compactTable(
      ['#', 'Pedido', 'Data', 'Cliente', 'Valor', 'Produtos'],
      rows
    );

    const suffix = paidOrders.length > displayLimit
      ? ` (exibindo ${displayLimit} de ${paidOrders.length})`
      : ` (${paidOrders.length} pedidos)`;

    return (
      `[SHOPIFY] Pedidos ${date_from} a ${date_to}${suffix}\n` +
      `ℹ️ Valores = totalPrice (produtos + frete + impostos − descontos). Para receita só de produtos, use subtotalPrice.\n` +
      `${table}\n` +
      `Total: ${paidOrders.length} pedidos | Receita: ${formatBRL(totalReceita)} | Ticket médio: ${formatBRL(ticketMedio)}`
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Shopify]: Timeout ao buscar pedidos. Sugestão: tente um período menor.`;
    }
    return `ERRO [Shopify]: ${msg}. Sugestão: verifique as credenciais ou tente novamente.`;
  }
}

// ─── shopify_get_top_customers ───────────────────────────────────────────────

interface TopCustomersInput {
  date_from: string;
  date_to: string;
  limit?: number;
  sort_by?: 'revenue' | 'orders';
}

interface CustomerAgg {
  name: string;
  email: string;
  totalRevenue: number;
  orderCount: number;
  firstOrder: string;
  lastOrder: string;
}

export async function shopify_get_top_customers(
  input: TopCustomersInput
): Promise<string> {
  const { date_from, date_to, limit = 10, sort_by = 'revenue' } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Shopify]: ${validErr}`;

  const safeLimit = Math.min(Math.max(1, limit), 100);

  try {
    // Paginação completa para garantir agregação correta
    type OrderNode = ShopifyOrdersData['orders']['edges'][0]['node'];
    const allOrders: OrderNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause: string = cursor ? `, after: "${cursor}"` : '';
      const q = `{
        orders(first: 250${afterClause}, query: "created_at:>=${date_from} created_at:<=${date_to}", sortKey: CREATED_AT, reverse: false) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              createdAt
              displayFinancialStatus
              totalPriceSet { shopMoney { amount } }
              customer { firstName lastName email }
            }
          }
        }
      }`;
      const data = await shopifyQuery<ShopifyOrdersData>(q);
      allOrders.push(...data.orders.edges.map((e) => e.node));
      hasNextPage = data.orders.pageInfo?.hasNextPage ?? false;
      cursor = data.orders.pageInfo?.endCursor ?? null;
    }

    // Filtra por status no backend
    const orders = allOrders.filter((o) => PAID_STATUSES.has(o.displayFinancialStatus));

    if (orders.length === 0) {
      return `[SHOPIFY] Nenhum pedido pago encontrado no período ${date_from} a ${date_to}.`;
    }

    // Aplica regra de pedidos consecutivos (≤2 dias = mesma compra)
    const ordersForMerge = orders
      .filter((o) => o.customer)
      .map((o) => ({
        date: new Date(o.createdAt),
        customerEmail: o.customer!.email,
        customerName: `${o.customer!.firstName ?? ''} ${o.customer!.lastName ?? ''}`.trim() || o.customer!.email,
        totalPaid: parseFloat(o.totalPriceSet.shopMoney.amount),
        orderNumbers: [] as number[],
      }));

    const merged = mergeConsecutiveOrders(ordersForMerge);

    // Agrega compras mescladas por cliente
    const map = new Map<string, CustomerAgg>();
    for (const purchase of merged) {
      const existing = map.get(purchase.customerEmail);
      const lastDate = purchase.date.toISOString();
      if (existing) {
        existing.totalRevenue += purchase.totalPaid;
        existing.orderCount += 1;
        if (lastDate > existing.lastOrder) existing.lastOrder = lastDate;
      } else {
        map.set(purchase.customerEmail, {
          name: purchase.customerName ?? purchase.customerEmail,
          email: purchase.customerEmail,
          totalRevenue: purchase.totalPaid,
          orderCount: 1,
          firstOrder: lastDate,
          lastOrder: lastDate,
        });
      }
    }

    // Ordena e limita
    const sorted = Array.from(map.values())
      .sort((a, b) =>
        sort_by === 'revenue'
          ? b.totalRevenue - a.totalRevenue
          : b.orderCount - a.orderCount
      )
      .slice(0, safeLimit);

    const rows = sorted.map((c, i) => [
      String(i + 1),
      c.name,
      String(c.orderCount),
      formatBRL(c.totalRevenue),
      formatBRL(c.totalRevenue / c.orderCount),
      formatDate(c.lastOrder),
    ]);

    const table = compactTable(
      ['#', 'Cliente', 'Compras', 'Receita Total', 'Ticket Médio', 'Última Compra'],
      rows
    );

    const totalRev = sorted.reduce((s, c) => s + c.totalRevenue, 0);
    return (
      `ℹ️ Pedidos consecutivos (≤2 dias) do mesmo cliente foram mesclados como compra única.\n` +
      `ℹ️ Receita = totalPrice (produtos + frete + impostos − descontos). Diverge de get_top_products que usa valor líquido sem frete.\n` +
      `[SHOPIFY] Top ${safeLimit} clientes por ${sort_by === 'revenue' ? 'receita' : 'nº compras'} (${date_from} a ${date_to})\n` +
      `${table}\n` +
      `Total: ${sorted.length} clientes | Receita agregada: ${formatBRL(totalRev)}`
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Shopify]: Timeout ao buscar clientes. Sugestão: tente um período menor.`;
    }
    return `ERRO [Shopify]: ${msg}. Sugestão: verifique as credenciais ou tente novamente.`;
  }
}

// ─── shopify_get_top_products ────────────────────────────────────────────────

interface TopProductsInput {
  date_from: string;
  date_to: string;
  limit?: number;
  sort_by?: 'quantity' | 'revenue';
  product_filter?: string; // fragmento de texto para filtrar por título (ex: "ofá", "adeira")
}

/**
 * Agrega vendas por produto a partir de todos os pedidos do período.
 * Pagina todos os pedidos (sem limite de 100), captura até 20 line items por pedido.
 * Use para "top produtos mais vendidos", "faturamento por produto", "ranking de vendas".
 */
export async function shopify_get_top_products(input: TopProductsInput): Promise<string> {
  const { date_from, date_to, limit = 20, sort_by = 'revenue', product_filter } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Shopify]: ${validErr}`;

  const safeLimit = Math.min(Math.max(1, limit), 100);

  try {
    type OrderNode = {
      displayFinancialStatus: string;
      lineItems: { edges: Array<{ node: { title: string; quantity: number; discountedTotalSet: { shopMoney: { amount: string } } } }> };
    };

    const allOrders: OrderNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause: string = cursor ? `, after: "${cursor}"` : '';
      const q: string = `{
        orders(first: 250${afterClause}, query: "created_at:>=${date_from} created_at:<=${date_to}", sortKey: CREATED_AT) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              displayFinancialStatus
              lineItems(first: 20) {
                edges { node { title quantity discountedTotalSet { shopMoney { amount } } } }
              }
            }
          }
        }
      }`;
      type TopProductsPage = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: OrderNode }> } };
      const data: TopProductsPage = await shopifyQuery<TopProductsPage>(q);
      allOrders.push(...data.orders.edges.map((e: { node: OrderNode }) => e.node));
      hasNextPage = data.orders.pageInfo?.hasNextPage ?? false;
      cursor = data.orders.pageInfo?.endCursor ?? null;
    }

    // Filtra apenas pedidos pagos
    const paid = allOrders.filter(o => PAID_STATUSES.has(o.displayFinancialStatus));

    if (paid.length === 0) {
      return `[SHOPIFY] Nenhum pedido pago encontrado no período ${date_from} a ${date_to}.`;
    }

    // Agrega por título de produto
    const map = new Map<string, { quantity: number; revenue: number }>();
    const filterLower = product_filter?.toLowerCase();

    for (const order of paid) {
      for (const { node: item } of order.lineItems.edges) {
        if (filterLower && !item.title.toLowerCase().includes(filterLower)) continue;
        const existing = map.get(item.title);
        const rev = parseFloat(item.discountedTotalSet?.shopMoney?.amount ?? '0');
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue += rev;
        } else {
          map.set(item.title, { quantity: item.quantity, revenue: rev });
        }
      }
    }

    if (map.size === 0) {
      return `[SHOPIFY] Nenhum produto encontrado${product_filter ? ` com filtro "${product_filter}"` : ''} no período ${date_from} a ${date_to}.`;
    }

    const sorted = Array.from(map.entries())
      .sort((a, b) => sort_by === 'quantity' ? b[1].quantity - a[1].quantity : b[1].revenue - a[1].revenue)
      .slice(0, safeLimit);

    const rows = sorted.map(([title, data], i) => [
      String(i + 1),
      title,
      String(data.quantity),
      formatBRL(data.revenue),
      data.quantity > 0 ? formatBRL(data.revenue / data.quantity) : 'N/D',
    ]);

    const table = compactTable(['#', 'Produto', 'Unidades', 'Receita', 'Preço Médio'], rows);

    const filterNote = product_filter ? ` | Filtro: "${product_filter}"` : '';
    return (
      `ℹ️ Receita = valor líquido de produtos após descontos, sem frete. Diverge de get_orders/get_top_customers que usam totalPrice (inclui frete).\n` +
      `[SHOPIFY] Top ${safeLimit} produtos por ${sort_by === 'quantity' ? 'unidades vendidas' : 'receita'} (${date_from} a ${date_to}${filterNote})\n` +
      `Total pedidos pagos analisados: ${paid.length}\n` +
      `${table}`
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) return `ERRO [Shopify]: Timeout. Tente um período menor.`;
    return `ERRO [Shopify]: ${msg}`;
  }
}

// ─── shopify_get_order_mix ───────────────────────────────────────────────────

interface OrderMixInput {
  date_from: string;
  date_to: string;
}

/**
 * Calcula % de pedidos com +1 SKU distinto (mix de produtos).
 * Útil para medir efetividade de incentivos de ticket médio (ex: "frete grátis acima de X").
 * Analisa TODOS os pedidos pagos do período, não uma amostra.
 */
export async function shopify_get_order_mix(input: OrderMixInput): Promise<string> {
  const { date_from, date_to } = input;

  const validErr = validateDates(date_from, date_to);
  if (validErr) return `ERRO [Shopify]: ${validErr}`;

  try {
    interface MixOrderNode {
      name: string;
      displayFinancialStatus: string;
      totalPriceSet: { shopMoney: { amount: string } };
      lineItems: { edges: Array<{ node: { title: string; quantity: number; sku: string | null } }> };
    }
    interface MixOrdersData {
      orders: {
        pageInfo?: { hasNextPage: boolean; endCursor: string };
        edges: Array<{ node: MixOrderNode }>;
      };
    }

    const allOrders: MixOrderNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause: string = cursor ? `, after: "${cursor}"` : '';
      const q = `{
        orders(first: 250${afterClause}, query: "created_at:>=${date_from} created_at:<=${date_to}", sortKey: CREATED_AT) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              name
              displayFinancialStatus
              totalPriceSet { shopMoney { amount } }
              lineItems(first: 50) {
                edges { node { title quantity sku } }
              }
            }
          }
        }
      }`;
      const data = await shopifyQuery<MixOrdersData>(q);
      allOrders.push(...data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo?.hasNextPage ?? false;
      cursor = data.orders.pageInfo?.endCursor ?? null;
    }

    const paid = allOrders.filter(o => PAID_STATUSES.has(o.displayFinancialStatus));
    if (paid.length === 0) {
      return `[SHOPIFY] Nenhum pedido pago encontrado no período ${date_from} a ${date_to}.`;
    }

    // Para cada pedido: conta SKUs distintos (usa título como fallback se SKU nulo)
    let singleSku = 0;
    let multiSku = 0;
    let totalItems = 0;
    let totalRevenueSingle = 0;
    let totalRevenueMulti = 0;
    const multiSkuSamples: Array<{ name: string; revenue: number; products: string[] }> = [];

    for (const order of paid) {
      const items = order.lineItems.edges.map(e => e.node);
      const uniqueKeys = new Set(items.map(i => i.sku ?? i.title));
      const orderRevenue = parseFloat(order.totalPriceSet.shopMoney.amount);
      totalItems += items.reduce((s, i) => s + i.quantity, 0);

      if (uniqueKeys.size > 1) {
        multiSku++;
        totalRevenueMulti += orderRevenue;
        // Captura até 5 exemplos reais para o modelo citar
        if (multiSkuSamples.length < 5) {
          multiSkuSamples.push({
            name: order.name,
            revenue: orderRevenue,
            products: items.map(i => `${i.title}${i.quantity > 1 ? ` (x${i.quantity})` : ''}`),
          });
        }
      } else {
        singleSku++;
        totalRevenueSingle += orderRevenue;
      }
    }

    const pctMulti = (multiSku / paid.length * 100).toFixed(1);
    const pctSingle = (singleSku / paid.length * 100).toFixed(1);
    const ticketMulti = multiSku > 0 ? totalRevenueMulti / multiSku : 0;
    const ticketSingle = singleSku > 0 ? totalRevenueSingle / singleSku : 0;
    const avgItems = (totalItems / paid.length).toFixed(1);

    const table = compactTable(
      ['Tipo de Pedido', 'Pedidos', '%', 'Receita Total', 'Ticket Médio'],
      [
        ['1 SKU (mono-produto)', String(singleSku), `${pctSingle}%`, formatBRL(totalRevenueSingle), formatBRL(ticketSingle)],
        ['+1 SKU (mix)',         String(multiSku),  `${pctMulti}%`,  formatBRL(totalRevenueMulti),  formatBRL(ticketMulti)],
        ['Total',               String(paid.length), '100%', formatBRL(totalRevenueSingle + totalRevenueMulti), formatBRL((totalRevenueSingle + totalRevenueMulti) / paid.length)],
      ]
    );

    const samplesText = multiSkuSamples.length > 0
      ? `\nExemplos reais de pedidos multi-SKU (use APENAS estes ao citar exemplos — nunca invente):\n` +
        multiSkuSamples.map(s =>
          `  ${s.name} (${formatBRL(s.revenue)}): ${s.products.join(' | ')}`
        ).join('\n')
      : '';

    return (
      `[SHOPIFY] Mix de SKUs por pedido — ${date_from} a ${date_to} (${paid.length} pedidos pagos)\n` +
      `ℹ️ Pedidos com +1 SKU distinto = cliente incluiu produtos de categorias/modelos diferentes. Itens da mesma cadeira (ex: 4x mesmo modelo) contam como 1 SKU.\n` +
      `Média de itens por pedido: ${avgItems}\n` +
      `${table}` +
      samplesText
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) return `ERRO [Shopify]: Timeout. Tente um período menor.`;
    return `ERRO [Shopify]: ${msg}`;
  }
}

// ─── shopify_get_products ────────────────────────────────────────────────────

interface ProductsInput {
  limit?: number;
  search_query?: string;
}

interface ShopifyProductsData {
  products: {
    edges: Array<{
      node: {
        title: string;
        handle: string;
        productType: string;
        vendor: string;
        totalInventory: number;
        variants: {
          edges: Array<{ node: { price: string; inventoryQuantity: number } }>;
        };
      };
    }>;
  };
}

export async function shopify_get_products(input: ProductsInput): Promise<string> {
  const { limit = 20, search_query } = input;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const searchFilter = search_query ? `, query: "${search_query}"` : '';

  const query = `{
    products(first: ${safeLimit}${searchFilter}) {
      edges {
        node {
          title
          handle
          productType
          vendor
          totalInventory
          variants(first: 3) {
            edges { node { price inventoryQuantity } }
          }
        }
      }
    }
  }`;

  try {
    const data = await shopifyQuery<ShopifyProductsData>(query);
    const products = data.products.edges.map((e) => e.node);

    if (products.length === 0) {
      return `[SHOPIFY] Nenhum produto encontrado${search_query ? ` para "${search_query}"` : ''}.`;
    }

    const rows = products.map((p, i) => {
      const precos = p.variants.edges
        .map((v) => formatBRL(parseFloat(v.node.price)))
        .join(' / ');
      return [
        String(i + 1),
        p.title,
        p.handle,
        p.productType || 'N/D',
        String(p.totalInventory ?? 0),
        precos || 'N/D',
      ];
    });

    const table = compactTable(
      ['#', 'Produto', 'Handle (URL)', 'Tipo', 'Estoque', 'Preços'],
      rows
    );

    return `[SHOPIFY] Produtos${search_query ? ` — busca: "${search_query}"` : ''} (${products.length} resultados)\nℹ️ Handle = slug permanente da URL. Use para cruzar com GA4 (pagePath) e detectar produtos duplicados por mudança de título.\n${table}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Shopify]: Timeout ao buscar produtos. Sugestão: tente novamente.`;
    }
    return `ERRO [Shopify]: ${msg}. Sugestão: verifique as credenciais.`;
  }
}

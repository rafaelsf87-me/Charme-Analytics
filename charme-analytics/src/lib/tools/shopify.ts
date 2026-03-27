import { formatBRL, formatDate, compactTable } from '@/lib/formatters';

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

interface ShopifyOrdersData {
  orders: {
    pageInfo?: { hasNextPage: boolean; endCursor: string };
    edges: Array<{
      node: {
        name: string;
        createdAt: string;
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
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const q = `{
        orders(first: 250${afterClause}, query: "created_at:>=${date_from} created_at:<=${date_to} financial_status:paid", sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              name
              createdAt
              totalPriceSet { shopMoney { amount } }
              customer { firstName lastName email }
              lineItems(first: 3) {
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

    if (allOrders.length === 0) {
      return `[SHOPIFY] Nenhum pedido encontrado no período ${date_from} a ${date_to}.`;
    }

    // Totais calculados sobre todos os pedidos
    const totalReceita = allOrders.reduce(
      (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
      0
    );
    const ticketMedio = totalReceita / allOrders.length;

    // Exibe apenas os primeiros `displayLimit` na tabela
    const rows = allOrders.slice(0, displayLimit).map((o, i) => {
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

    const suffix = allOrders.length > displayLimit
      ? ` (exibindo ${displayLimit} de ${allOrders.length})`
      : ` (${allOrders.length} pedidos)`;

    return (
      `[SHOPIFY] Pedidos ${date_from} a ${date_to}${suffix}\n` +
      `${table}\n` +
      `Total: ${allOrders.length} pedidos | Receita: ${formatBRL(totalReceita)} | Ticket médio: ${formatBRL(ticketMedio)}`
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
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const q = `{
        orders(first: 250${afterClause}, query: "created_at:>=${date_from} created_at:<=${date_to} financial_status:paid", sortKey: CREATED_AT, reverse: false) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              createdAt
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

    const orders = allOrders;

    if (orders.length === 0) {
      return `[SHOPIFY] Nenhum pedido encontrado no período ${date_from} a ${date_to}.`;
    }

    // Agrupa por cliente
    const map = new Map<string, CustomerAgg>();
    for (const order of orders) {
      if (!order.customer) continue;
      const key = order.customer.email;
      const value = parseFloat(order.totalPriceSet.shopMoney.amount);
      const existing = map.get(key);
      if (existing) {
        existing.totalRevenue += value;
        existing.orderCount += 1;
        if (order.createdAt < existing.firstOrder) existing.firstOrder = order.createdAt;
        if (order.createdAt > existing.lastOrder) existing.lastOrder = order.createdAt;
      } else {
        const nome = `${order.customer.firstName ?? ''} ${order.customer.lastName ?? ''}`.trim() || key;
        map.set(key, {
          name: nome,
          email: key,
          totalRevenue: value,
          orderCount: 1,
          firstOrder: order.createdAt,
          lastOrder: order.createdAt,
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
      ['#', 'Cliente', 'Pedidos', 'Receita Total', 'Ticket Médio', 'Último Pedido'],
      rows
    );

    const totalRev = sorted.reduce((s, c) => s + c.totalRevenue, 0);
    return `[SHOPIFY] Top ${safeLimit} Clientes por ${sort_by === 'revenue' ? 'Receita' : 'Pedidos'} (${date_from} a ${date_to})\n${table}\nTotal: ${sorted.length} clientes | Receita agregada: ${formatBRL(totalRev)}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Shopify]: Timeout ao buscar clientes. Sugestão: tente um período menor.`;
    }
    return `ERRO [Shopify]: ${msg}. Sugestão: verifique as credenciais ou tente novamente.`;
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
        p.productType || 'N/D',
        p.vendor || 'N/D',
        String(p.totalInventory ?? 0),
        precos || 'N/D',
      ];
    });

    const table = compactTable(
      ['#', 'Produto', 'Tipo', 'Fornecedor', 'Estoque', 'Preços'],
      rows
    );

    return `[SHOPIFY] Produtos${search_query ? ` — busca: "${search_query}"` : ''} (${products.length} resultados)\n${table}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Timeout')) {
      return `ERRO [Shopify]: Timeout ao buscar produtos. Sugestão: tente novamente.`;
    }
    return `ERRO [Shopify]: ${msg}. Sugestão: verifique as credenciais.`;
  }
}

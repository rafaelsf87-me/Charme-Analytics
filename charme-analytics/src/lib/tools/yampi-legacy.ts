import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { formatBRL, compactTable } from '@/lib/formatters';
import { mergeConsecutiveOrders } from './order-utils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface LegacyOrder {
  date: Date;
  orderNumber: number;
  customerName: string;
  customerEmail: string;
  products: Array<{ name: string; sku: string; quantity: number }>;
  totalPaid: number;
  totalProducts: number;
  totalDiscount: number;
  totalShipping: number;
  status: 'paid' | 'cancelled';
  coupon: string | null;
  source: 'yampi-2023' | 'yampi-2024' | 'yampi-2025';
}

// ─── Status mapping ───────────────────────────────────────────────────────────

const YAMPI_PAID_STATUSES = new Set([
  'Em transporte',
  'Faturado',
  'Pagamento aprovado',
  'Entregue',
]);

function mapYampiStatus(status: string): 'paid' | 'cancelled' {
  return YAMPI_PAID_STATUSES.has(status?.trim()) ? 'paid' : 'cancelled';
}

// ─── Parsing de data Yampi (DD/MM/YYYY HH:MM:SS ou número serial Excel) ──────

function parseYampiDate(raw: unknown): Date | null {
  if (!raw) return null;

  // Número serial do Excel (ex: 45123)
  if (typeof raw === 'number') {
    const date = XLSX.SSF.parse_date_code(raw);
    if (date) return new Date(date.y, date.m - 1, date.d, date.H ?? 0, date.M ?? 0);
    return null;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Formato DD/MM/YYYY HH:MM ou DD/MM/YYYY HH:MM:SS
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(`${year}-${month}-${day}T00:00:00`);
  }

  // ISO ou outro formato
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Parsing de número BRL ("202,92" → 202.92) ───────────────────────────────

function parseBRL(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  return parseFloat(String(raw).replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Carregamento das planilhas ───────────────────────────────────────────────

const FILES: Array<{ filename: string; source: LegacyOrder['source'] }> = [
  { filename: 'Base_Pedidos_Yampi_2023.xlsx', source: 'yampi-2023' },
  { filename: 'Base_Pedidos_Yampi_2024.xlsx', source: 'yampi-2024' },
  { filename: 'Base_Pedidos_Yampi_2025-parcial.xlsx', source: 'yampi-2025' },
];

// Cache em memória — dados são estáticos, carregados uma vez
let cachedOrders: LegacyOrder[] | null = null;

function loadAllOrders(): LegacyOrder[] {
  if (cachedOrders !== null) return cachedOrders;

  const dataDir = path.join(process.cwd(), 'data', 'yampi');
  // Mapa para deduplicar linhas do mesmo pedido (múltiplos produtos por pedido)
  const orderMap = new Map<number, LegacyOrder>();

  for (const { filename, source } of FILES) {
    const filepath = path.join(dataDir, filename);
    if (!fs.existsSync(filepath)) continue;

    const workbook = XLSX.readFile(filepath, { cellDates: false, dense: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // Converte para array de objetos usando a primeira linha como header
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    for (const row of rows) {
      const orderNumber = parseInt(String(row['numero_pedido'] ?? '0'));
      if (!orderNumber) continue;

      const date = parseYampiDate(row['data_pagamento']);
      if (!date) continue;

      const product = {
        name: String(row['produto'] ?? 'N/D').trim(),
        sku: String(row['sku'] ?? '').trim(),
        quantity: parseInt(String(row['quantidade'] ?? '1')) || 1,
      };

      if (orderMap.has(orderNumber)) {
        // Pedido já existe — apenas adiciona o produto
        orderMap.get(orderNumber)!.products.push(product);
      } else {
        orderMap.set(orderNumber, {
          date,
          orderNumber,
          customerName: String(row['cliente'] ?? 'N/D').trim(),
          customerEmail: String(row['cliente_email'] ?? '').trim().toLowerCase(),
          products: [product],
          totalPaid: parseBRL(row['total_pago']),
          totalProducts: parseBRL(row['total_produtos']),
          totalDiscount: parseBRL(row['total_desconto']),
          totalShipping: parseBRL(row['total_frete']),
          status: mapYampiStatus(String(row['status'] ?? '')),
          coupon: String(row['cupom'] ?? '').trim() || null,
          source,
        });
      }
    }
  }

  cachedOrders = Array.from(orderMap.values())
    .filter((o) => o.status === 'paid')
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return cachedOrders;
}

// Converte Date para string YYYY-MM-DD para comparação eficiente
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Tool: yampi_get_orders ───────────────────────────────────────────────────

interface GetOrdersInput {
  date_from: string;
  date_to: string;
  limit?: number;
}

export function yampi_get_orders(input: GetOrdersInput): string {
  const { date_from, date_to, limit = 50 } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
    return 'ERRO [Yampi]: Datas devem estar no formato YYYY-MM-DD.';
  }

  try {
    const orders = loadAllOrders();
    const filtered = orders.filter((o) => {
      const ds = dateStr(o.date);
      return ds >= date_from && ds <= date_to;
    });

    if (filtered.length === 0) {
      return `[Yampi Legacy] Nenhum pedido pago encontrado entre ${date_from} e ${date_to}.`;
    }

    const totalReceita = filtered.reduce((s, o) => s + o.totalPaid, 0);
    const sliced = filtered.slice(0, limit);

    const rows = sliced.map((o, i) => {
      const prodStr = o.products.slice(0, 2).map((p) => p.name).join(', ') +
        (o.products.length > 2 ? ` +${o.products.length - 2}` : '');
      return [
        String(i + 1),
        String(o.orderNumber),
        dateStr(o.date),
        o.customerName,
        formatBRL(o.totalPaid),
        prodStr,
      ];
    });

    const table = compactTable(['#', 'Pedido', 'Data', 'Cliente', 'Valor', 'Produtos'], rows);
    const suffix = filtered.length > limit
      ? ` (exibindo ${limit} de ${filtered.length})`
      : ` (${filtered.length} pedidos)`;

    return (
      `[Yampi Legacy] Pedidos ${date_from} a ${date_to}${suffix}\n` +
      `${table}\n` +
      `Total: ${filtered.length} pedidos | Receita: ${formatBRL(totalReceita)} | Ticket médio: ${formatBRL(totalReceita / filtered.length)}`
    );
  } catch (err) {
    return `ERRO [Yampi]: ${(err as Error).message}.`;
  }
}

// ─── Tool: yampi_get_top_customers ───────────────────────────────────────────

interface GetTopCustomersInput {
  date_from: string;
  date_to: string;
  limit?: number;
  sort_by?: 'revenue' | 'orders';
}

export function yampi_get_top_customers(input: GetTopCustomersInput): string {
  const { date_from, date_to, limit = 10, sort_by = 'revenue' } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
    return 'ERRO [Yampi]: Datas devem estar no formato YYYY-MM-DD.';
  }

  try {
    const orders = loadAllOrders();
    const filtered = orders.filter((o) => {
      const ds = dateStr(o.date);
      return ds >= date_from && ds <= date_to;
    });

    if (filtered.length === 0) {
      return `[Yampi Legacy] Nenhum pedido pago encontrado entre ${date_from} e ${date_to}.`;
    }

    // Aplica regra de pedidos consecutivos por cliente
    const ordersForMerge = filtered.map((o) => ({
      date: o.date,
      customerEmail: o.customerEmail || o.customerName.toLowerCase(),
      totalPaid: o.totalPaid,
      orderNumbers: [o.orderNumber],
      customerName: o.customerName,
    }));

    const merged = mergeConsecutiveOrders(ordersForMerge);

    // Agrupa por cliente
    const customerMap = new Map<string, {
      name: string;
      email: string;
      purchases: number;
      revenue: number;
      lastDate: Date;
    }>();

    for (const purchase of merged) {
      const key = purchase.customerEmail;
      const existing = customerMap.get(key);
      if (existing) {
        existing.purchases++;
        existing.revenue += purchase.totalPaid;
        if (purchase.date > existing.lastDate) existing.lastDate = purchase.date;
      } else {
        customerMap.set(key, {
          name: purchase.customerName ?? key,
          email: key,
          purchases: 1,
          revenue: purchase.totalPaid,
          lastDate: purchase.date,
        });
      }
    }

    const sorted = Array.from(customerMap.values())
      .sort((a, b) => sort_by === 'orders' ? b.purchases - a.purchases : b.revenue - a.revenue)
      .slice(0, limit);

    const rows = sorted.map((c, i) => [
      String(i + 1),
      c.name,
      String(c.purchases),
      formatBRL(c.revenue),
      formatBRL(c.revenue / c.purchases),
      dateStr(c.lastDate),
    ]);

    const table = compactTable(
      ['#', 'Cliente', 'Compras', 'Receita Total', 'Ticket Médio', 'Última Compra'],
      rows
    );

    const totalRev = sorted.reduce((s, c) => s + c.revenue, 0);
    return (
      `ℹ️ Pedidos consecutivos (≤2 dias) do mesmo cliente foram mesclados como compra única.\n` +
      `[Yampi Legacy] Top ${sorted.length} clientes por ${sort_by === 'orders' ? 'nº compras' : 'receita'} (${date_from} a ${date_to})\n` +
      `${table}\n` +
      `Receita agregada: ${formatBRL(totalRev)}`
    );
  } catch (err) {
    return `ERRO [Yampi]: ${(err as Error).message}.`;
  }
}

// ─── Tool: yampi_search_products ─────────────────────────────────────────────

interface SearchProductsInput {
  search_term: string;
  date_from?: string;
  date_to?: string;
}

export function yampi_search_products(input: SearchProductsInput): string {
  const { search_term, date_from, date_to } = input;

  if (!search_term?.trim()) return 'ERRO [Yampi]: search_term é obrigatório.';

  try {
    const orders = loadAllOrders();
    const termLower = search_term.toLowerCase();

    // Filtra pedidos que contenham o produto por nome ou SKU
    const matchingOrders = orders.filter((o) => {
      const inRange = !date_from || !date_to
        ? true
        : dateStr(o.date) >= date_from! && dateStr(o.date) <= date_to!;
      const hasProduct = o.products.some(
        (p) => p.name.toLowerCase().includes(termLower) || p.sku.toLowerCase().includes(termLower)
      );
      return inRange && hasProduct;
    });

    if (matchingOrders.length === 0) {
      return `[Yampi Legacy] Nenhum resultado para "${search_term}"${date_from ? ` no período ${date_from} a ${date_to}` : ''}.`;
    }

    // Agrega por nome de produto
    const productMap = new Map<string, { sku: string; qty: number; revenue: number; orders: number }>();

    for (const order of matchingOrders) {
      for (const p of order.products) {
        if (!p.name.toLowerCase().includes(termLower) && !p.sku.toLowerCase().includes(termLower)) continue;
        const existing = productMap.get(p.name);
        if (existing) {
          existing.qty += p.quantity;
          existing.orders++;
          // Receita proporcional: distribui o total_pago pelos produtos do pedido
          existing.revenue += order.products.length > 0 ? order.totalPaid / order.products.length : 0;
        } else {
          productMap.set(p.name, {
            sku: p.sku,
            qty: p.quantity,
            revenue: order.products.length > 0 ? order.totalPaid / order.products.length : 0,
            orders: 1,
          });
        }
      }
    }

    const rows = Array.from(productMap.entries())
      .sort((a, b) => b[1].orders - a[1].orders)
      .map(([name, stats], i) => [
        String(i + 1),
        name,
        stats.sku || 'N/D',
        String(stats.orders),
        String(stats.qty),
        formatBRL(stats.revenue),
      ]);

    const table = compactTable(['#', 'Produto', 'SKU', 'Pedidos', 'Qtd', 'Receita Est.'], rows);
    const dateRange = date_from ? ` | ${date_from} a ${date_to}` : ' | todos os períodos';

    return (
      `[Yampi Legacy] Busca: "${search_term}"${dateRange}\n` +
      `${table}\n` +
      `Total: ${matchingOrders.length} pedidos contendo o produto`
    );
  } catch (err) {
    return `ERRO [Yampi]: ${(err as Error).message}.`;
  }
}

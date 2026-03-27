// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface OrderForMerge {
  date: Date;
  customerEmail: string;
  customerName?: string;
  totalPaid: number;
  orderNumbers: number[];
}

export interface MergedPurchase {
  date: Date;
  customerEmail: string;
  customerName?: string;
  totalPaid: number;
  orderNumbers: number[];
}

// ─── mergeConsecutiveOrders ───────────────────────────────────────────────────

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Mescla pedidos do mesmo cliente feitos em ≤2 dias consecutivos.
 * Cada grupo vira uma "compra" com totalPaid somado.
 * Retorna array de compras ordenado por data decrescente.
 */
export function mergeConsecutiveOrders(orders: OrderForMerge[]): MergedPurchase[] {
  if (orders.length === 0) return [];

  // Ordena por cliente + data crescente
  const sorted = [...orders].sort((a, b) => {
    const emailCmp = a.customerEmail.localeCompare(b.customerEmail);
    if (emailCmp !== 0) return emailCmp;
    return a.date.getTime() - b.date.getTime();
  });

  const merged: MergedPurchase[] = [];
  let current: MergedPurchase = {
    date: sorted[0].date,
    customerEmail: sorted[0].customerEmail,
    customerName: sorted[0].customerName,
    totalPaid: sorted[0].totalPaid,
    orderNumbers: [...sorted[0].orderNumbers],
  };

  for (let i = 1; i < sorted.length; i++) {
    const order = sorted[i];
    const sameCustomer = order.customerEmail === current.customerEmail;
    const withinWindow = order.date.getTime() - current.date.getTime() <= TWO_DAYS_MS;

    if (sameCustomer && withinWindow) {
      // Mescla no grupo atual
      current.totalPaid += order.totalPaid;
      current.orderNumbers.push(...order.orderNumbers);
      // Mantém a data do PRIMEIRO pedido do grupo
    } else {
      merged.push(current);
      current = {
        date: order.date,
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        totalPaid: order.totalPaid,
        orderNumbers: [...order.orderNumbers],
      };
    }
  }
  merged.push(current);

  return merged.sort((a, b) => b.date.getTime() - a.date.getTime());
}

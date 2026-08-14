export type NotifiableSellerOrderStatus = 'SHIPPED' | 'COMPLETED' | 'CANCELLED';

export interface OrderStatusUpdateData {
  orderId: string;
  sellerOrderId: string;
  buyerName: string;
  sellerName: string;
  status: NotifiableSellerOrderStatus;
}

function headingAndBody(
  status: NotifiableSellerOrderStatus,
  sellerName: string,
  shortOrderId: string,
): { heading: string; body: string } {
  switch (status) {
    case 'SHIPPED':
      return {
        heading: 'Your order has shipped',
        body: `${sellerName} has shipped part of order #${shortOrderId}. It's on its way to you.`,
      };
    case 'COMPLETED':
      return {
        heading: 'Your order is complete',
        body: `${sellerName}'s part of order #${shortOrderId} is now complete.`,
      };
    case 'CANCELLED':
      return {
        heading: 'Your order was cancelled',
        body: `${sellerName} cancelled their part of order #${shortOrderId}.`,
      };
  }
}

export function buildOrderStatusUpdateEmailSubject(
  data: OrderStatusUpdateData,
): string {
  const shortOrderId = data.orderId.slice(0, 8);
  const { heading } = headingAndBody(
    data.status,
    data.sellerName,
    shortOrderId,
  );
  return `${heading} — Order #${shortOrderId}`;
}

export function buildOrderStatusUpdateEmailHtml(
  data: OrderStatusUpdateData,
): string {
  const shortOrderId = data.orderId.slice(0, 8);
  // Escaped once, up front — every downstream use (heading text never
  // includes it, only body) is already-safe.
  const { heading, body } = headingAndBody(
    data.status,
    escapeHtml(data.sellerName),
    shortOrderId,
  );

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">${heading}</h1>
      <p>Hi ${escapeHtml(data.buyerName)},</p>
      <p>${body}</p>
      <p>You can track its status any time from your orders page.</p>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

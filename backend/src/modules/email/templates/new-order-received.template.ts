// subtotal arrives as an already-formatted decimal string — same
// float-avoidance rule as the payment receipt template.
export interface NewOrderReceivedData {
  orderId: string;
  sellerOrderId: string;
  sellerName: string;
  buyerName: string;
  subtotal: string;
}

export function buildNewOrderReceivedEmailHtml(
  data: NewOrderReceivedData,
): string {
  const shortOrderId = data.orderId.slice(0, 8);

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">You've got a new order</h1>
      <p>Hi ${escapeHtml(data.sellerName)},</p>
      <p>${escapeHtml(data.buyerName)} just placed an order (#${shortOrderId}) for $${escapeHtml(data.subtotal)} of your items.</p>
      <p>Head to your seller dashboard to prepare it for shipping.</p>
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

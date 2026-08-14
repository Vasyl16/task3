// receipt.totalAmount is already a formatted decimal string (see
// EmailConsumer, which casts Order.totalAmount via ::text — same
// float-avoidance rule as analytics, see backend.md) — never a number
// here, so this template never re-does money math.
export interface PaymentReceiptData {
  orderId: string;
  buyerName: string;
  totalAmount: string;
  placedAt: Date;
}

export function buildPaymentReceiptEmailHtml(
  receipt: PaymentReceiptData,
): string {
  const shortOrderId = receipt.orderId.slice(0, 8);
  const placedAt = receipt.placedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">Payment received</h1>
      <p>Hi ${escapeHtml(receipt.buyerName)},</p>
      <p>We've received your payment for order #${shortOrderId}.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Order</td>
          <td style="padding: 8px 0; text-align: right;">#${shortOrderId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Placed</td>
          <td style="padding: 8px 0; text-align: right;">${placedAt}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; font-weight: 600;">Total</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">$${escapeHtml(receipt.totalAmount)}</td>
        </tr>
      </table>
      <p>Thanks for shopping with us.</p>
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

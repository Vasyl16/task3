// winningAmount arrives as an already-formatted decimal string (see
// AuctionEndedEvent) — same float-avoidance rule as the payment receipt
// template, never a number here.
export interface AuctionWonData {
  auctionId: string;
  productName: string;
  winnerName: string;
  winningAmount: string;
  checkoutDeadline: Date | null;
}

export function buildAuctionWonEmailHtml(data: AuctionWonData): string {
  const deadline = data.checkoutDeadline
    ? data.checkoutDeadline.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">You won the auction!</h1>
      <p>Hi ${escapeHtml(data.winnerName)},</p>
      <p>Your bid of $${escapeHtml(data.winningAmount)} won the auction for "${escapeHtml(data.productName)}".</p>
      ${
        deadline
          ? `<p>Complete checkout from your account's My Auctions page by <strong>${deadline}</strong> to claim it.</p>`
          : ''
      }
      <p>Congratulations!</p>
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

// The refund saga's failure terminus: every retry against the payment
// provider was exhausted and the buyer's money is still owed.
//
// This event is deliberately NOT a rollback signal. By the time it
// fires, the cancellation's other compensations (stock restored, ledger
// reversed) are long committed and correct — the order really is
// cancelled. What failed is only the outward money movement, which no
// amount of database work can undo. So the compensating action here is
// ESCALATION: put the refund in a terminal FAILED state a human can see
// and act on, and tell them about it. Silently swallowing this would
// mean a buyer who never gets their money back and no record of why.
export const REFUND_FAILED_EVENT = 'RefundFailed';

export interface RefundFailedEvent {
  refundId: string;
  sellerOrderId: string;
  buyerId: string;
  amount: string;
  attempts: number;
  failureReason: string;
}

// The refund saga's success terminus: the payment provider accepted the
// refund and the Refund row is PROCESSED. Recorded in the same
// transaction as that status change, so a notification can never claim
// money went back that didn't.
export const REFUND_PROCESSED_EVENT = 'RefundProcessed';

export interface RefundProcessedEvent {
  refundId: string;
  sellerOrderId: string;
  buyerId: string;
  amount: string;
  gatewayRef: string;
}

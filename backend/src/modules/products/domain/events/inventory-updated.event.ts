// Recorded in the SAME transaction as the stock change it describes (see
// ProductsService.decrementStockForCheckout / restoreStock) — so a
// rolled-back checkout never announces a decrement that didn't happen.
//
// quantityAvailable/quantityReserved are the values AS OF that
// transaction; by the time a subscriber receives the resulting WebSocket
// broadcast they may already be out of date. That is expected and safe:
// the broadcast is a hint to re-render, never an input to a purchase
// decision — checkout re-reads inventory inside its own transaction
// regardless of what any client was shown.
export const INVENTORY_UPDATED_EVENT = 'InventoryUpdated';

export type InventoryUpdateReason = 'CHECKOUT' | 'CANCELLATION';

export interface InventoryUpdatedEvent {
  productId: string;
  quantityAvailable: number;
  quantityReserved: number;
  version: number;
  reason: InventoryUpdateReason;
}

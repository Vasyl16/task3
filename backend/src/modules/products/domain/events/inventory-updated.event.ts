// Recorded in the SAME transaction as the stock change it describes (see
// ProductsService.reserveStockForCheckout / commitReservationForShipment)
// — so a
// rolled-back checkout never announces a decrement that didn't happen.
//
// quantityAvailable/quantityReserved are the values AS OF that
// transaction; by the time a subscriber receives the resulting WebSocket
// broadcast they may already be out of date. That is expected and safe:
// the broadcast is a hint to re-render, never an input to a purchase
// decision — checkout re-reads inventory inside its own transaction
// regardless of what any client was shown.
export const INVENTORY_UPDATED_EVENT = 'InventoryUpdated';

// AUCTION_HOLD/AUCTION_RELEASE move quantityReserved only — the units
// stay in stock, they just stop being sellable through the cart while an
// auction lot has a claim on them.
// CHECKOUT holds units (quantityReserved up, stock untouched); SHIPMENT
// converts that hold into a real reduction; CANCELLATION frees it again.
export type InventoryUpdateReason =
  | 'CHECKOUT'
  | 'SHIPMENT'
  | 'CANCELLATION'
  // An admin force-cancelling an order that already SHIPPED/COMPLETED.
  // Distinct from CANCELLATION: by this point the hold had already been
  // consumed (see SHIPMENT), so there is no reservation left to release
  // — the units genuinely left the shelf and this puts them back on it,
  // the same as a return.
  | 'RETURN'
  | 'SELLER_ADJUSTMENT'
  | 'AUCTION_HOLD'
  | 'AUCTION_RELEASE';

export interface InventoryUpdatedEvent {
  productId: string;
  quantityAvailable: number;
  quantityReserved: number;
  version: number;
  reason: InventoryUpdateReason;
}

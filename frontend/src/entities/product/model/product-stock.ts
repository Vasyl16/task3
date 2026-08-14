// The realtime snapshot/event shape for the `product:{id}` room — the
// ONLY source for live stock, since GET /products doesn't join
// Inventory. See src/infrastructure/realtime/realtime.gateway.ts.
export interface ProductStockState {
  productId: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  quantityAvailable: number;
  quantityReserved: number;
  version: number;
  updatedAt: string | null;
}

export interface InventoryUpdatedPayload {
  productId: string;
  quantityAvailable: number;
  quantityReserved: number;
  version: number;
  reason: 'CHECKOUT' | 'CANCELLATION';
}

import { useState } from 'react';
import { useRealtimeRoom } from '../../../shared/realtime';
import type {
  InventoryUpdatedPayload,
  ProductStockState,
} from './product-stock';

// Not a TanStack Query hook: there is no REST endpoint for stock (see
// product-stock.ts), so there is nothing to invalidate-and-refetch. The
// realtime subscribe ack IS the fetch, and 'inventory.updated' events
// keep it current. A dropped connection re-subscribes from scratch
// (handled by useRealtimeRoom) rather than trusting whatever the count
// was before the drop.
export function useProductStock(productId: string | null): {
  stock: ProductStockState | null;
  status: 'idle' | 'subscribing' | 'subscribed' | 'error';
} {
  const [stock, setStock] = useState<ProductStockState | null>(null);

  const { status } = useRealtimeRoom<
    ProductStockState,
    InventoryUpdatedPayload
  >(productId ? `product:${productId}` : null, {
    events: ['inventory.updated'],
    onSnapshot: (state) => setStock(state),
    onEvent: (_eventName, payload) =>
      setStock((current) =>
        current
          ? {
              ...current,
              quantityAvailable: payload.quantityAvailable,
              quantityReserved: payload.quantityReserved,
              version: payload.version,
            }
          : current,
      ),
  });

  return { stock, status };
}

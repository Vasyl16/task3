import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRoom } from '../../../shared/realtime';
import { orderKeys } from '../api/order-api';
import type {
  OrderStatus,
  OrderWithSellerOrders,
  SellerOrderStatus,
} from './order';

interface OrderSnapshotState {
  orderId: string;
  status: OrderStatus;
  updatedAt: string;
  sellerOrders: {
    sellerOrderId: string;
    sellerId: string;
    status: SellerOrderStatus;
    updatedAt: string;
  }[];
}

interface SellerOrderStatusUpdatedPayload {
  sellerOrderId: string;
  orderId: string;
  status: SellerOrderStatus;
  orderStatus: OrderStatus;
}

// Keeps an order-detail page (buyer view) live as sellers progress their
// SellerOrders — a checkout with items from three sellers shows all
// three ship independently.
export function useOrderRealtime(orderId: string | null) {
  const queryClient = useQueryClient();

  return useRealtimeRoom<OrderSnapshotState, SellerOrderStatusUpdatedPayload>(
    orderId ? `order:${orderId}` : null,
    {
      events: ['seller-order.status.updated'],
      onSnapshot: (state) => {
        queryClient.setQueryData<OrderWithSellerOrders>(
          orderKeys.detail(state.orderId),
          (current) =>
            current && {
              ...current,
              status: state.status,
              sellerOrders: current.sellerOrders.map((sellerOrder) => {
                const patch = state.sellerOrders.find(
                  (entry) => entry.sellerOrderId === sellerOrder.id,
                );
                return patch
                  ? { ...sellerOrder, status: patch.status }
                  : sellerOrder;
              }),
            },
        );
      },
      onEvent: (_eventName, payload) => {
        queryClient.setQueryData<OrderWithSellerOrders>(
          orderKeys.detail(payload.orderId),
          (current) =>
            current && {
              ...current,
              status: payload.orderStatus,
              sellerOrders: current.sellerOrders.map((sellerOrder) =>
                sellerOrder.id === payload.sellerOrderId
                  ? { ...sellerOrder, status: payload.status }
                  : sellerOrder,
              ),
            },
        );
      },
    },
  );
}

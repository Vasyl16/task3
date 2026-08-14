import { api } from '../../../shared/api';
import type {
  OrderWithSellerOrders,
  SellerOrder,
  SellerOrderStatus,
  SellerOrderWithOrderContext,
} from '../model/order';

export const orderApi = {
  list: () => api.get<OrderWithSellerOrders[]>('/orders'),
  byId: (id: string) => api.get<OrderWithSellerOrders>(`/orders/${id}`),
  // SELLER-only; the backend resolves sellerId from the caller's own
  // approved profile — there is no id to spoof here.
  mySellerOrders: () =>
    api.get<SellerOrderWithOrderContext[]>('/orders/seller-orders'),
  checkout: (idempotencyKey: string) =>
    api.post<OrderWithSellerOrders>('/orders/checkout', undefined, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  checkoutAuction: (auctionId: string, idempotencyKey: string) =>
    api.post<OrderWithSellerOrders>(
      `/orders/checkout/auctions/${auctionId}`,
      undefined,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    ),
  updateSellerOrderStatus: (sellerOrderId: string, status: SellerOrderStatus) =>
    api.patch<SellerOrder>(`/orders/seller-orders/${sellerOrderId}/status`, {
      status,
    }),
};

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
  mySellerOrders: () => [...orderKeys.all, 'my-seller-orders'] as const,
};

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SellerOrderStatus } from '../../../entities/order';
import { orderApi, orderKeys } from '../../../entities/order';

// Ownership (this SellerOrder belongs to the caller) and the transition
// itself (see SELLER_ORDER_NEXT_STATUS for the UI-side mirror) are both
// re-checked authoritatively by the backend — a request for someone
// else's SellerOrder id, or an invalid transition, is rejected there
// regardless of what this form shows.
export function useUpdateSellerOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sellerOrderId,
      status,
    }: {
      sellerOrderId: string;
      status: SellerOrderStatus;
    }) => orderApi.updateSellerOrderStatus(sellerOrderId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orderKeys.mySellerOrders(),
      });
    },
  });
}

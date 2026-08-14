import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SellerProfileStatus } from '../../../entities/seller';
import { sellerApi, sellerKeys } from '../../../entities/seller';

export function useReviewSellerApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sellerId,
      status,
    }: {
      sellerId: string;
      status: SellerProfileStatus;
    }) => sellerApi.adminReview(sellerId, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sellerKeys.all });
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productKeys } from '../../../entities/product';
import { reviewApi, reviewKeys } from '../../../entities/review';
import type { CreateReviewInput } from '../../../entities/review';

export function useLeaveReview(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewInput) => reviewApi.create(input),
    onSuccess: () => {
      // The rating lives on the product projection as well as in the
      // review list, and the backend recomputes it per request — so both
      // have to be refetched or the page shows a new review above a
      // stale average.
      void queryClient.invalidateQueries({
        queryKey: reviewKeys.forProduct(productId),
      });
      void queryClient.invalidateQueries({ queryKey: reviewKeys.mine() });
      void queryClient.invalidateQueries({
        queryKey: productKeys.detail(productId),
      });
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

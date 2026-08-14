import { useQuery } from '@tanstack/react-query';
import { reviewApi, reviewKeys } from '../api/review-api';

export function useProductReviews(productId: string | undefined) {
  return useQuery({
    queryKey: reviewKeys.forProduct(productId ?? ''),
    queryFn: () => reviewApi.listForProduct(productId as string),
    enabled: Boolean(productId),
  });
}

// Reviews the signed-in customer has already written. Used to tell which
// of their delivered purchases still need one.
export function useMyReviews(enabled = true) {
  return useQuery({
    queryKey: reviewKeys.mine(),
    queryFn: () => reviewApi.mine(),
    enabled,
  });
}

// Which of the viewer's delivered purchases still need a review. Only
// fetched when signed in — it is a 401 otherwise, and an anonymous
// visitor browsing a product has nothing to review.
export function useReviewablePurchases(enabled = true) {
  return useQuery({
    queryKey: reviewKeys.pending(),
    queryFn: () => reviewApi.pending(),
    enabled,
  });
}

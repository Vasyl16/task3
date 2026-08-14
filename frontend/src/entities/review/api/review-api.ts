import { api } from '../../../shared/api';
import type {
  CreateReviewInput,
  ProductRating,
  Review,
  ReviewablePurchase,
} from '../model/review';

export const reviewApi = {
  listForProduct: (productId: string) =>
    api.get<Review[]>(`/products/${productId}/reviews`),
  ratingForProduct: (productId: string) =>
    api.get<ProductRating>(`/products/${productId}/rating`),
  mine: () => api.get<Review[]>('/reviews/mine'),
  pending: () => api.get<ReviewablePurchase[]>('/reviews/pending'),
  create: (body: CreateReviewInput) => api.post<Review>('/reviews', body),
};

export const reviewKeys = {
  all: ['reviews'] as const,
  forProduct: (productId: string) =>
    [...reviewKeys.all, 'product', productId] as const,
  ratingForProduct: (productId: string) =>
    [...reviewKeys.all, 'rating', productId] as const,
  mine: () => [...reviewKeys.all, 'mine'] as const,
  pending: () => [...reviewKeys.all, 'pending'] as const,
};

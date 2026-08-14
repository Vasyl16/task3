import { api } from '../../../shared/api';
import type { Cart, CartItem } from '../model/cart';

export const cartApi = {
  get: () => api.get<Cart>('/cart'),
  addItem: (productId: string, quantity: number) =>
    api.post<CartItem>('/cart/items', { productId, quantity }),
  // Sets an ABSOLUTE quantity — distinct from addItem, which increments.
  updateItem: (productId: string, quantity: number) =>
    api.patch<CartItem>(`/cart/items/${productId}`, { quantity }),
  removeItem: (productId: string) =>
    api.delete<void>(`/cart/items/${productId}`),
};

export const cartKeys = {
  all: ['cart'] as const,
  detail: () => [...cartKeys.all, 'detail'] as const,
};

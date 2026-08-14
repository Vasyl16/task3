import { useQuery } from '@tanstack/react-query';
import { cartApi, cartKeys } from '../api/cart-api';

export function useCart() {
  return useQuery({
    queryKey: cartKeys.detail(),
    queryFn: cartApi.get,
  });
}

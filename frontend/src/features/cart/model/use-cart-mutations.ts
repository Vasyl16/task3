import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart } from '../../../entities/cart';
import { cartApi, cartKeys } from '../../../entities/cart';

// Every mutation here follows the same optimistic-update/rollback shape:
// snapshot the current cache, apply the change locally so the UI reacts
// instantly, then either let the background refetch (onSettled)
// reconcile with the server's real numbers, or restore the snapshot if
// the request failed. This is safe specifically because a cart edit has
// no side effect beyond the row itself — checkout (features/checkout) is
// NOT optimistic, because money and stock are involved there.

interface MutationContext {
  previousCart: Cart | undefined;
}

function snapshotCart(
  queryClient: ReturnType<typeof useQueryClient>,
): MutationContext {
  return { previousCart: queryClient.getQueryData<Cart>(cartKeys.detail()) };
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  context: MutationContext | undefined,
): void {
  if (context?.previousCart) {
    queryClient.setQueryData(cartKeys.detail(), context.previousCart);
  }
}

export function useAddToCart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      productId,
      quantity,
    }: {
      productId: string;
      quantity: number;
    }) => cartApi.addItem(productId, quantity),
    onMutate: async ({ productId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: cartKeys.detail() });
      const context = snapshotCart(queryClient);

      queryClient.setQueryData<Cart>(cartKeys.detail(), (current) => {
        if (!current) return current;
        const existing = current.items.find(
          (item) => item.productId === productId,
        );
        return {
          ...current,
          items: existing
            ? current.items.map((item) =>
                item.productId === productId
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              )
            : [
                ...current.items,
                {
                  // Temporary id: real removeItem/updateItem calls key by
                  // productId, not this — it only needs to be unique for
                  // React's list rendering until the refetch replaces it.
                  id: `optimistic-${productId}`,
                  cartId: current.id,
                  productId,
                  quantity,
                  addedAt: new Date().toISOString(),
                },
              ],
        };
      });

      return context;
    },
    onError: (_error, _variables, context) => rollback(queryClient, context),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      productId,
      quantity,
    }: {
      productId: string;
      quantity: number;
    }) => cartApi.updateItem(productId, quantity),
    onMutate: async ({ productId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: cartKeys.detail() });
      const context = snapshotCart(queryClient);

      queryClient.setQueryData<Cart>(
        cartKeys.detail(),
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              item.productId === productId ? { ...item, quantity } : item,
            ),
          },
      );

      return context;
    },
    onError: (_error, _variables, context) => rollback(queryClient, context),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (productId: string) => cartApi.removeItem(productId),
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: cartKeys.detail() });
      const context = snapshotCart(queryClient);

      queryClient.setQueryData<Cart>(
        cartKeys.detail(),
        (current) =>
          current && {
            ...current,
            items: current.items.filter((item) => item.productId !== productId),
          },
      );

      return context;
    },
    onError: (_error, _variables, context) => rollback(queryClient, context),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}

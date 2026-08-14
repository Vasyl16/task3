import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cartKeys } from '../../../entities/cart';
import { orderApi, orderKeys } from '../../../entities/order';

// Checkout is deliberately NOT optimistic — unlike a cart edit
// (features/cart), it involves money and an authoritative stock
// decrement the backend re-validates from scratch; the frontend has
// nothing safe to guess at ahead of the response (see
// .claude/rules/frontend.md: don't duplicate backend business logic).
//
// The Idempotency-Key is generated once per mount and reused for every
// retry of THIS checkout attempt (e.g. a second click after a timed-out
// first request) — never regenerated on a bare retry, or the backend
// would treat it as a brand new checkout and could place the order
// twice.
export function useCartCheckout() {
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: () => orderApi.checkout(idempotencyKey),
    onSuccess: (order) => {
      // The cart is server-side emptied by a successful checkout —
      // clearing it locally too avoids a stale "3 items" flash before
      // the next cart fetch confirms it.
      void queryClient.invalidateQueries({ queryKey: cartKeys.detail() });
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      queryClient.setQueryData(orderKeys.detail(order.id), order);
    },
  });

  return { checkout: mutation.mutate, ...mutation };
}

export function useAuctionCheckout(auctionId: string) {
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: () => orderApi.checkoutAuction(auctionId, idempotencyKey),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      queryClient.setQueryData(orderKeys.detail(order.id), order);
    },
  });

  return { checkout: mutation.mutate, ...mutation };
}

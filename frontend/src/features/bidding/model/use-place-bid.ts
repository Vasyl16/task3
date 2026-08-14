import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { auctionApi, auctionKeys } from '../../../entities/auction';

// A bid is not optimistic — a stale "you're winning!" that a concurrent
// higher bid immediately invalidates would be actively misleading, and
// the backend's optimistic-locking retry (see BiddingService) means the
// accepted amount can legitimately differ from what was submitted.
//
// The Idempotency-Key is reused across resubmits of the SAME amount
// (protects a retried click after a timeout from placing the bid
// twice) and regenerated the moment the amount actually changes (a
// different amount is a genuinely different bid, not a retry).
export function usePlaceBid(auctionId: string) {
  const queryClient = useQueryClient();
  const lastAttempt = useRef<{ amount: number; key: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (amount: number) => {
      const key =
        lastAttempt.current?.amount === amount
          ? lastAttempt.current.key
          : crypto.randomUUID();
      lastAttempt.current = { amount, key };
      return auctionApi.placeBid(auctionId, amount, key);
    },
    onSuccess: () => {
      lastAttempt.current = null;
      void queryClient.invalidateQueries({
        queryKey: auctionKeys.detail(auctionId),
      });
      void queryClient.invalidateQueries({
        queryKey: auctionKeys.bids(auctionId),
      });
    },
  });

  return { placeBid: mutation.mutate, ...mutation };
}

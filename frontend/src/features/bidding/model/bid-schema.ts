import { z } from 'zod';

// Mirrors the backend's own minimum-bid rule (see BiddingService) purely
// for UX — catching an obviously-too-low bid before a round trip. The
// backend re-validates the SAME rule against the current highest bid at
// the moment it processes the request and is the only authority that
// actually matters; a bid that passes this schema can still be rejected
// there if someone else outbid in between.
// Plain z.number(), not z.coerce.number(): RHF's `valueAsNumber` does the
// string->number conversion before validation runs, so the schema's
// input and output types match — z.coerce's input type is `unknown`,
// which trips up zodResolver's generic inference against useForm<T>.
export function buildBidSchema(minimumBid: number) {
  return z.object({
    amount: z
      .number()
      .min(minimumBid, `Bid must be at least $${minimumBid.toFixed(2)}`),
  });
}

export type BidFormValues = z.infer<ReturnType<typeof buildBidSchema>>;

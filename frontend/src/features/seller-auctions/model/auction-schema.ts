import { z } from 'zod';

// Mirrors CreateAuctionDto. startsAt/endsAt come from <input
// type="datetime-local">, which has no timezone — converted to a full
// ISO string before submit (see create-auction-form.tsx), not validated
// as one here.
export const createAuctionSchema = z
  .object({
    productId: z.uuid('Choose a product'),
    // The lot size — awarded entirely to the single winning bidder. The
    // backend re-validates this against the product's currently
    // uncommitted stock (see BiddingService.createAuction); this is
    // only a client-side sanity floor.
    quantity: z
      .number()
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1'),
    startingPrice: z
      .number()
      .min(0.01, 'Starting price must be at least $0.01'),
    minBidIncrement: z.number().min(0.01, 'Increment must be at least $0.01'),
    startsAt: z.string().min(1, 'Choose a start time'),
    endsAt: z.string().min(1, 'Choose an end time'),
  })
  .refine((values) => new Date(values.endsAt) > new Date(values.startsAt), {
    message: 'End time must be after the start time',
    path: ['endsAt'],
  });

export type CreateAuctionFormValues = z.infer<typeof createAuctionSchema>;

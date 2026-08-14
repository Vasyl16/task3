import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { Auction } from '../../../entities/auction';
import { Button, ErrorAlert, TextField } from '../../../shared/ui';
import { useAuth } from '../../auth';
import { buildBidSchema } from '../model/bid-schema';
import type { BidFormValues } from '../model/bid-schema';
import { usePlaceBid } from '../model/use-place-bid';

export function PlaceBidForm({ auction }: { auction: Auction }) {
  const { status } = useAuth();
  const {
    placeBid,
    isPending,
    error,
    reset: resetMutation,
  } = usePlaceBid(auction.id);

  // Floored at $0.01 to match PlaceBidDto's @Min(0.01) — mostly matters
  // for a pre-existing $0-starting-price auction (no longer creatable,
  // but not retroactively fixed on old rows), where this would otherwise
  // compute to $0.
  const minimumBid = Math.max(
    auction.currentHighestBid
      ? Number(auction.currentHighestBid) + Number(auction.minBidIncrement)
      : Number(auction.startingPrice),
    0.01,
  );

  const {
    register,
    handleSubmit,
    reset: resetForm,
    getValues,
    formState: { errors },
  } = useForm<BidFormValues>({
    resolver: zodResolver(buildBidSchema(minimumBid)),
    defaultValues: { amount: minimumBid },
  });

  // useForm's defaultValues is only read on the first render — it never
  // re-syncs itself as the auction's price moves (your own bid landing,
  // someone else outbidding you). Without this, the input silently keeps
  // showing a now-too-low amount, so resubmitting it unedited fails
  // client-side validation — indistinguishable, from the user's side,
  // from being unable to raise their own leading bid at all. Only bumps
  // the field UP to the new floor; never overwrites a higher amount the
  // user already typed in.
  useEffect(() => {
    if (getValues('amount') < minimumBid) {
      resetForm({ amount: minimumBid });
    }
  }, [minimumBid, getValues, resetForm]);

  if (status !== 'authenticated') {
    return <p className="ui-page-header__subtitle">Sign in to place a bid.</p>;
  }

  if (auction.status !== 'ACTIVE') {
    return null;
  }

  const onSubmit = handleSubmit((values) => {
    resetMutation();
    placeBid(values.amount);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={error} />
      <TextField
        label={`Your bid (minimum $${minimumBid.toFixed(2)})`}
        type="number"
        step="0.01"
        min={minimumBid}
        error={errors.amount?.message}
        {...register('amount', { valueAsNumber: true })}
      />
      <Button type="submit" isLoading={isPending}>
        Place bid
      </Button>
    </form>
  );
}

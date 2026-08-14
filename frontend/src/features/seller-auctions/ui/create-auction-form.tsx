import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useProductStock, type Product } from '../../../entities/product';
import { Button, ErrorAlert, Select, TextField } from '../../../shared/ui';
import { createAuctionSchema } from '../model/auction-schema';
import type { CreateAuctionFormValues } from '../model/auction-schema';
import { useCreateAuction } from '../model/use-create-auction';

// Only the seller's own AUCTION-type products are eligible — the
// backend independently re-checks product.type and product.sellerId
// against the caller (see BiddingService.createAuction), this is just
// to spare a round trip for the obviously-wrong case.
export function CreateAuctionForm({
  auctionableProducts,
  onSuccess,
}: {
  auctionableProducts: Product[];
  onSuccess: () => void;
}) {
  const createAuction = useCreateAuction();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateAuctionFormValues>({
    resolver: zodResolver(createAuctionSchema),
    defaultValues: {
      productId: '',
      quantity: 1,
      startingPrice: 0,
      minBidIncrement: 1,
      startsAt: '',
      endsAt: '',
    },
  });

  // Live stock for whichever product is currently selected — shown as a
  // hint only. The backend is the only real authority on how much of it
  // is actually still uncommitted (other active auctions may already
  // claim some) — see BiddingService.createAuction's own re-check.
  const selectedProductId = watch('productId');
  const { stock } = useProductStock(selectedProductId || null);

  const onSubmit = handleSubmit((values) => {
    createAuction.mutate(
      {
        ...values,
        startsAt: new Date(values.startsAt).toISOString(),
        endsAt: new Date(values.endsAt).toISOString(),
      },
      { onSuccess },
    );
  });

  if (auctionableProducts.length === 0) {
    return (
      <p className="ui-page-header__subtitle">
        Create an auction-type product first — only those are eligible for an
        auction listing.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={createAuction.error} />

      <Select
        label="Product"
        error={errors.productId?.message}
        {...register('productId')}
      >
        <option value="">Select a product</option>
        {auctionableProducts.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </Select>

      <TextField
        label={
          selectedProductId && stock
            ? `Quantity (${stock.quantityAvailable} in stock)`
            : 'Quantity'
        }
        type="number"
        step="1"
        min={1}
        error={errors.quantity?.message}
        {...register('quantity', { valueAsNumber: true })}
      />

      <TextField
        label="Starting price ($)"
        type="number"
        step="0.01"
        min={0}
        error={errors.startingPrice?.message}
        {...register('startingPrice', { valueAsNumber: true })}
      />
      <TextField
        label="Minimum bid increment ($)"
        type="number"
        step="0.01"
        min={0.01}
        error={errors.minBidIncrement?.message}
        {...register('minBidIncrement', { valueAsNumber: true })}
      />
      <TextField
        label="Starts at"
        type="datetime-local"
        error={errors.startsAt?.message}
        {...register('startsAt')}
      />
      <TextField
        label="Ends at"
        type="datetime-local"
        error={errors.endsAt?.message}
        {...register('endsAt')}
      />

      <Button type="submit" isLoading={createAuction.isPending}>
        Create auction
      </Button>
    </form>
  );
}

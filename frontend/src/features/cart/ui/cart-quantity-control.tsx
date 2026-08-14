import { useProductStock } from '../../../entities/product';
import { Button } from '../../../shared/ui';
import {
  useRemoveCartItem,
  useUpdateCartItem,
} from '../model/use-cart-mutations';

export function CartQuantityControl({
  productId,
  quantity,
}: {
  productId: string;
  quantity: number;
}) {
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const isBusy = updateItem.isPending || removeItem.isPending;
  // Same UX-only guard as AddToCartButton — checkout re-validates stock
  // authoritatively regardless (see CartService.updateItemQuantity's
  // "no stock validation here by design" note). While stock is still
  // null (subscribing), the "+" button stays enabled rather than
  // blocking on a snapshot that hasn't arrived yet.
  const { stock } = useProductStock(productId);
  const atStockLimit = stock !== null && quantity >= stock.quantityAvailable;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
    >
      <Button
        variant="secondary"
        aria-label="Decrease quantity"
        disabled={isBusy}
        onClick={() =>
          quantity <= 1
            ? removeItem.mutate(productId)
            : updateItem.mutate({ productId, quantity: quantity - 1 })
        }
      >
        −
      </Button>
      <span style={{ minWidth: '2ch', textAlign: 'center' }}>{quantity}</span>
      <Button
        variant="secondary"
        aria-label="Increase quantity"
        disabled={isBusy || atStockLimit}
        title={atStockLimit ? 'No more stock available' : undefined}
        onClick={() => updateItem.mutate({ productId, quantity: quantity + 1 })}
      >
        +
      </Button>
      <Button
        variant="ghost"
        disabled={isBusy}
        onClick={() => removeItem.mutate(productId)}
      >
        Remove
      </Button>
    </div>
  );
}

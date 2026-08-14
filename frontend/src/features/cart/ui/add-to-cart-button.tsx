import { useState } from 'react';
import { useCart } from '../../../entities/cart';
import { useProductStock, type Product } from '../../../entities/product';
import { useMySellerProfile } from '../../../entities/seller';
import { Button } from '../../../shared/ui';
import { useAuth } from '../../auth';
import { useAddToCart } from '../model/use-cart-mutations';

// Only FIXED_PRICE, ACTIVE products can be added — mirrors the backend's
// own check (see CartService), so the button simply doesn't render
// rather than the user hitting a 400 for a rule they had no way to see.
export function AddToCartButton({ product }: { product: Product }) {
  const { status } = useAuth();
  const addToCart = useAddToCart();
  const [justAdded, setJustAdded] = useState(false);
  // Realtime stock, not the (stockless) Product from GET /products — see
  // use-product-stock.ts. Only disables on a CONFIRMED zero: while stock
  // is still null (subscribing), the button stays enabled rather than
  // blocking on a snapshot that hasn't arrived yet. This is a UX nicety
  // only — checkout re-checks stock authoritatively regardless.
  const { stock } = useProductStock(product.id);
  const isOutOfStock = stock !== null && stock.quantityAvailable <= 0;
  // A single click only ever adds 1, so out-of-stock alone (checked
  // against the CURRENT stock level) isn't enough to stop a buyer
  // clicking past it repeatedly — each click's optimistic update bumps
  // this cart's cached quantity immediately (see use-cart-mutations),
  // so this recomputes, and thus disables, on every click.
  const { data: cart } = useCart();
  const quantityInCart =
    cart?.items.find((item) => item.productId === product.id)?.quantity ?? 0;
  const atCartLimit =
    stock !== null && quantityInCart >= stock.quantityAvailable;
  // Only meaningful for a SELLER-role viewer; returns null for anyone
  // else. Mirrors auction-detail-page's isOwnAuction check — the backend
  // rejects the same add (see CartService.addItem) regardless, this just
  // avoids showing a button that leads to a doomed request.
  const { data: myProfile } = useMySellerProfile();
  const isOwnProduct =
    status === 'authenticated' && myProfile?.id === product.sellerId;

  if (
    product.type !== 'FIXED_PRICE' ||
    product.status !== 'ACTIVE' ||
    isOwnProduct
  ) {
    return null;
  }

  const handleClick = () => {
    addToCart.mutate(
      { productId: product.id, quantity: 1 },
      {
        onSuccess: () => {
          setJustAdded(true);
          setTimeout(() => setJustAdded(false), 1500);
        },
      },
    );
  };

  const disabled = status !== 'authenticated' || isOutOfStock || atCartLimit;
  const title =
    status !== 'authenticated'
      ? 'Sign in to add items to your cart'
      : isOutOfStock
        ? 'This item is out of stock'
        : atCartLimit
          ? 'You already have all the available stock in your cart'
          : undefined;

  return (
    <div>
      <Button
        onClick={handleClick}
        isLoading={addToCart.isPending}
        disabled={disabled}
        title={title}
      >
        {isOutOfStock
          ? 'Out of stock'
          : atCartLimit
            ? 'Max in cart'
            : justAdded
              ? 'Added'
              : 'Add to cart'}
      </Button>
      {addToCart.isError && (
        <p className="ui-field__error" role="alert">
          Couldn&apos;t add this to your cart. Please try again.
        </p>
      )}
    </div>
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '../../../entities/cart';
import { cartApi, cartKeys } from '../../../entities/cart';
import {
  useAddToCart,
  useRemoveCartItem,
  useUpdateCartItem,
} from './use-cart-mutations';

vi.mock('../../../entities/cart', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../entities/cart')>();
  return {
    ...actual,
    cartApi: {
      get: vi.fn(),
      addItem: vi.fn(),
      updateItem: vi.fn(),
      removeItem: vi.fn(),
    },
  };
});

const INITIAL_CART: Cart = {
  id: 'cart-1',
  buyerId: 'buyer-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  items: [
    {
      id: 'item-1',
      cartId: 'cart-1',
      productId: 'p1',
      quantity: 2,
      addedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function getCart(): Cart | undefined {
  return queryClient.getQueryData<Cart>(cartKeys.detail());
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(cartKeys.detail(), INITIAL_CART);
  vi.clearAllMocks();
});

afterEach(() => {
  queryClient.clear();
});

describe('cart optimistic mutations', () => {
  it('adds a new line optimistically, then rolls back to the prior cart on failure', async () => {
    // Never resolves until the test explicitly rejects it — this is what
    // makes the "optimistic state is visible before the network settles"
    // assertion below meaningful rather than racy.
    let rejectAdd!: (error: unknown) => void;
    vi.mocked(cartApi.addItem).mockImplementation(
      () => new Promise((_resolve, reject) => (rejectAdd = reject)),
    );

    const { result } = renderHook(() => useAddToCart(), { wrapper });
    result.current.mutate({ productId: 'p2', quantity: 1 });

    // The UI reacts before the server has answered at all.
    await waitFor(() => {
      expect(getCart()?.items).toHaveLength(2);
    });
    expect(
      getCart()?.items.find((item) => item.productId === 'p2')?.quantity,
    ).toBe(1);

    rejectAdd(new Error('network down'));

    // A failure restores exactly the pre-mutation snapshot, not a
    // partial or re-derived state.
    await waitFor(() => {
      expect(getCart()).toEqual(INITIAL_CART);
    });
  });

  it('increments quantity optimistically for a product already in the cart', async () => {
    vi.mocked(cartApi.addItem).mockResolvedValue({
      id: 'item-1',
      cartId: 'cart-1',
      productId: 'p1',
      quantity: 5,
      addedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = renderHook(() => useAddToCart(), { wrapper });
    result.current.mutate({ productId: 'p1', quantity: 3 });

    await waitFor(() => {
      expect(getCart()?.items).toHaveLength(1);
      expect(getCart()?.items[0].quantity).toBe(5);
    });
  });

  it('rolls back a quantity edit on failure', async () => {
    let rejectUpdate!: (error: unknown) => void;
    vi.mocked(cartApi.updateItem).mockImplementation(
      () => new Promise((_resolve, reject) => (rejectUpdate = reject)),
    );

    const { result } = renderHook(() => useUpdateCartItem(), { wrapper });
    result.current.mutate({ productId: 'p1', quantity: 9 });

    await waitFor(() => {
      expect(getCart()?.items[0].quantity).toBe(9);
    });

    rejectUpdate(new Error('conflict'));

    await waitFor(() => {
      expect(getCart()?.items[0].quantity).toBe(2);
    });
  });

  it('rolls back a removal on failure', async () => {
    let rejectRemove!: (error: unknown) => void;
    vi.mocked(cartApi.removeItem).mockImplementation(
      () => new Promise((_resolve, reject) => (rejectRemove = reject)),
    );

    const { result } = renderHook(() => useRemoveCartItem(), { wrapper });
    result.current.mutate('p1');

    await waitFor(() => {
      expect(getCart()?.items).toHaveLength(0);
    });

    rejectRemove(new Error('conflict'));

    await waitFor(() => {
      expect(getCart()?.items).toHaveLength(1);
    });
  });
});

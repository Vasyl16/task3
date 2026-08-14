import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderApi } from '../../../entities/order';
import { useCartCheckout } from './use-checkout';

vi.mock('../../../entities/order', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../entities/order')>();
  return {
    ...actual,
    orderApi: {
      ...actual.orderApi,
      checkout: vi.fn(),
      checkoutAuction: vi.fn(),
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCartCheckout', () => {
  // The whole point of the header: a client-side retry after a failed
  // (or merely UNANSWERED, e.g. timed-out) first attempt must reuse the
  // same key, or the backend has no way to tell "retry" apart from "a
  // second order" and could place the order twice.
  it('reuses the same Idempotency-Key across repeated checkout attempts from one mount', async () => {
    vi.mocked(orderApi.checkout).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(orderApi.checkout).mockResolvedValueOnce({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: 'NEW',
      totalAmount: '10.00',
      placedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sellerOrders: [],
    });

    const { result } = renderHook(() => useCartCheckout(), { wrapper });

    result.current.checkout();
    await waitFor(() => expect(result.current.isError).toBe(true));

    result.current.checkout();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(orderApi.checkout).toHaveBeenCalledTimes(2);
    const [firstKey] = vi.mocked(orderApi.checkout).mock.calls[0];
    const [secondKey] = vi.mocked(orderApi.checkout).mock.calls[1];
    expect(firstKey).toBe(secondKey);
  });

  // A fresh mount (a new visit to the checkout page) is a genuinely new
  // attempt, not a retry of the old one — it must NOT reuse a key from a
  // previous, unrelated mount.
  it('uses a different key for a separate hook instance', async () => {
    vi.mocked(orderApi.checkout).mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: 'NEW',
      totalAmount: '10.00',
      placedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sellerOrders: [],
    });

    const first = renderHook(() => useCartCheckout(), { wrapper });
    first.result.current.checkout();
    await waitFor(() => expect(orderApi.checkout).toHaveBeenCalledTimes(1));

    const second = renderHook(() => useCartCheckout(), { wrapper });
    second.result.current.checkout();
    await waitFor(() => expect(orderApi.checkout).toHaveBeenCalledTimes(2));

    const [firstKey] = vi.mocked(orderApi.checkout).mock.calls[0];
    const [secondKey] = vi.mocked(orderApi.checkout).mock.calls[1];
    expect(firstKey).not.toBe(secondKey);
  });
});

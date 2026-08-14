import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auctionApi } from '../../../entities/auction';
import { usePlaceBid } from './use-place-bid';

vi.mock('../../../entities/auction', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../entities/auction')>();
  return { ...actual, auctionApi: { ...actual.auctionApi, placeBid: vi.fn() } };
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const BID: import('../../../entities/auction').Bid = {
  id: 'bid-1',
  auctionId: 'auction-1',
  isMine: true,
  amount: '10.00',
  placedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePlaceBid', () => {
  it('reuses the same key when the SAME amount is resubmitted after a failure', async () => {
    vi.mocked(auctionApi.placeBid).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(auctionApi.placeBid).mockResolvedValueOnce(BID);

    const { result } = renderHook(() => usePlaceBid('auction-1'), { wrapper });

    result.current.placeBid(10);
    await waitFor(() => expect(result.current.isError).toBe(true));

    result.current.placeBid(10);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(auctionApi.placeBid).toHaveBeenCalledTimes(2);
    const [, , firstKey] = vi.mocked(auctionApi.placeBid).mock.calls[0];
    const [, , secondKey] = vi.mocked(auctionApi.placeBid).mock.calls[1];
    expect(firstKey).toBe(secondKey);
  });

  // A different amount is a genuinely different bid, not a retry of the
  // old one — reusing the key here would let the backend's idempotency
  // cache silently return the FIRST amount's result for a bid the user
  // never actually placed.
  it('uses a different key when the amount changes', async () => {
    vi.mocked(auctionApi.placeBid).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(auctionApi.placeBid).mockResolvedValueOnce(BID);

    const { result } = renderHook(() => usePlaceBid('auction-1'), { wrapper });

    result.current.placeBid(10);
    await waitFor(() => expect(result.current.isError).toBe(true));

    result.current.placeBid(15);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Call shape is (auctionId, amount, idempotencyKey).
    const [, firstAmount, firstKey] = vi.mocked(auctionApi.placeBid).mock
      .calls[0];
    const [, secondAmount, secondKey] = vi.mocked(auctionApi.placeBid).mock
      .calls[1];
    expect(firstAmount).toBe(10);
    expect(secondAmount).toBe(15);
    expect(firstKey).not.toBe(secondKey);
  });
});

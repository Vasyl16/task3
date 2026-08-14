import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Auction } from '../../../entities/auction';
import { useAuth } from '../../auth';
import { usePlaceBid } from '../model/use-place-bid';
import { PlaceBidForm } from './place-bid-form';

vi.mock('../../auth', () => ({ useAuth: vi.fn() }));
vi.mock('../model/use-place-bid', () => ({ usePlaceBid: vi.fn() }));

function buildAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 'auction-1',
    productId: 'product-1',
    sellerId: 'seller-1',
    quantity: 1,
    startingPrice: '10.00',
    minBidIncrement: '5.00',
    currentHighestBid: null,
    viewerIsHighestBidder: false,
    status: 'ACTIVE',
    version: 0,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-02T00:00:00.000Z',
    checkoutDeadline: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockAuthenticated() {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: {
      id: 'buyer-1',
      email: 'buyer@example.com',
      role: 'CUSTOMER',
    } as never,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

function mockPlaceBid() {
  const placeBid = vi.fn();
  vi.mocked(usePlaceBid).mockReturnValue({
    placeBid,
    isPending: false,
    error: null,
    reset: vi.fn(),
  } as never);
  return placeBid;
}

describe('PlaceBidForm', () => {
  // Regression test: useForm's defaultValues is only read on the first
  // render, so without a resync effect the input keeps showing the OLD
  // minimum after the user's own bid lands — resubmitting that stale,
  // now-too-low amount fails client-side validation before any request
  // is sent, which looks exactly like "the top bidder can't raise their
  // own bid" even though the backend would happily accept a higher one.
  it('bumps the pre-filled amount up once the user becomes the top bidder', () => {
    mockAuthenticated();
    mockPlaceBid();

    const { rerender } = render(
      <PlaceBidForm auction={buildAuction({ currentHighestBid: null })} />,
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(10);

    // The user's $10 bid just landed — they're now the top bidder and
    // the floor for the next bid rose to 10 + 5 increment = 15.
    rerender(
      <PlaceBidForm
        auction={buildAuction({
          currentHighestBid: '10.00',
          viewerIsHighestBidder: false,
        })}
      />,
    );

    expect(screen.getByRole('spinbutton')).toHaveValue(15);
  });

  it('does not clobber a higher amount the user already typed in', async () => {
    mockAuthenticated();
    mockPlaceBid();
    const user = userEvent.setup();

    const { rerender } = render(
      <PlaceBidForm auction={buildAuction({ currentHighestBid: null })} />,
    );
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '100');
    expect(input).toHaveValue(100);

    // A minor price move that's still well under what the user already
    // typed shouldn't overwrite their in-progress input.
    rerender(
      <PlaceBidForm
        auction={buildAuction({
          currentHighestBid: '10.00',
          viewerIsHighestBidder: false,
        })}
      />,
    );

    expect(screen.getByRole('spinbutton')).toHaveValue(100);
  });

  it('lets the same user submit a higher bid once they are already winning', async () => {
    mockAuthenticated();
    const placeBid = mockPlaceBid();
    const user = userEvent.setup();

    render(
      <PlaceBidForm
        auction={buildAuction({
          currentHighestBid: '10.00',
          viewerIsHighestBidder: false,
        })}
      />,
    );

    // Unedited resubmit of the (now correctly bumped) pre-filled amount.
    await user.click(screen.getByRole('button', { name: 'Place bid' }));

    expect(placeBid).toHaveBeenCalledWith(15);
  });
});

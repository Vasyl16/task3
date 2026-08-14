import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useUpdateSellerOrderStatus } from '../model/use-update-seller-order-status';
import { SellerOrderStatusControl } from './seller-order-status-control';

vi.mock('../model/use-update-seller-order-status', () => ({
  useUpdateSellerOrderStatus: vi.fn(),
}));

function mockMutation() {
  const mutate = vi.fn();
  vi.mocked(useUpdateSellerOrderStatus).mockReturnValue({
    mutate,
    isPending: false,
    error: null,
  } as never);
  return mutate;
}

describe('SellerOrderStatusControl', () => {
  it('offers the ordinary next steps for a seller on a PROCESSING order', () => {
    mockMutation();
    render(
      <SellerOrderStatusControl sellerOrderId="so-1" status="PROCESSING" />,
    );

    expect(
      screen.getByRole('button', { name: /mark as shipped/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mark as cancelled/i }),
    ).toBeInTheDocument();
  });

  // The core of this feature: a seller has nothing left to do once an
  // order is COMPLETED, and must never see the force-cancel override —
  // that only makes sense for an admin enacting a dispute ruling.
  it('renders nothing for a seller (non-admin) once the order is COMPLETED', () => {
    mockMutation();
    const { container } = render(
      <SellerOrderStatusControl sellerOrderId="so-1" status="COMPLETED" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('still lets a seller mark a SHIPPED order COMPLETED — that stays self-service', () => {
    mockMutation();
    render(<SellerOrderStatusControl sellerOrderId="so-1" status="SHIPPED" />);

    expect(
      screen.getByRole('button', { name: /mark as completed/i }),
    ).toBeInTheDocument();
    // The admin-only override must not leak in just because the seller
    // control happens to render something at this status.
    expect(
      screen.queryByRole('button', { name: /force cancel/i }),
    ).not.toBeInTheDocument();
  });

  it('offers an admin a force-cancel action on a SHIPPED order', async () => {
    const mutate = mockMutation();
    const user = userEvent.setup();
    render(
      <SellerOrderStatusControl
        sellerOrderId="so-1"
        status="SHIPPED"
        isAdmin
      />,
    );

    const button = screen.getByRole('button', { name: /force cancel/i });
    await user.click(button);

    expect(mutate).toHaveBeenCalledWith({
      sellerOrderId: 'so-1',
      status: 'CANCELLED',
    });
  });

  it('offers an admin a force-cancel action on a COMPLETED order too', () => {
    mockMutation();
    render(
      <SellerOrderStatusControl
        sellerOrderId="so-1"
        status="COMPLETED"
        isAdmin
      />,
    );

    expect(
      screen.getByRole('button', { name: /force cancel/i }),
    ).toBeInTheDocument();
  });

  // Once a SellerOrder is genuinely terminal (already CANCELLED), even
  // an admin gets nothing — there is no dispute ruling that un-cancels
  // an order.
  it('renders nothing at all for an admin on an already-CANCELLED order', () => {
    mockMutation();
    const { container } = render(
      <SellerOrderStatusControl
        sellerOrderId="so-1"
        status="CANCELLED"
        isAdmin
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

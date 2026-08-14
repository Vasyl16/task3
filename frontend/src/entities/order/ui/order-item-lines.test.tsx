import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { OrderItem } from '../model/order';
import { OrderItemLines } from './order-item-lines';

function buildItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    sellerOrderId: 'so-1',
    productId: 'product-1',
    quantity: 2,
    unitPrice: '19.99',
    createdAt: new Date().toISOString(),
    product: {
      id: 'product-1',
      name: 'Merino Wool Sweater',
      slug: 'merino-wool-sweater',
      imageUrl: null,
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

function renderLines(items: OrderItem[] | undefined) {
  return render(
    <MemoryRouter>
      <OrderItemLines items={items} />
    </MemoryRouter>,
  );
}

describe('OrderItemLines', () => {
  it('links each line to its product page', () => {
    renderLines([buildItem()]);

    const link = screen.getByRole('link', { name: 'Merino Wool Sweater' });
    expect(link).toHaveAttribute('href', '/products/product-1');
  });

  it('shows the price that was PAID, not the product’s current price', () => {
    renderLines([buildItem({ unitPrice: '19.99' })]);

    expect(screen.getByText(/19\.99/)).toBeInTheDocument();
  });

  // An archived product still has a page and order history must still
  // link to it — but say so, or the listing looks merely broken.
  it('marks an archived product as no longer listed, but still links to it', () => {
    renderLines([
      buildItem({
        product: { ...buildItem().product, status: 'ARCHIVED' },
      }),
    ]);

    expect(screen.getByText(/no longer listed/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/products/product-1',
    );
  });

  // The regression this component actually shipped with: the checkout
  // response carries no line items, and seeding it into the order-detail
  // cache handed this component `undefined` — which crashed the whole
  // order page rather than rendering nothing.
  it('renders nothing instead of throwing when items are missing entirely', () => {
    expect(() => renderLines(undefined)).not.toThrow();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty order', () => {
    renderLines([]);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

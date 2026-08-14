import { Link } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { formatMoney } from '../../../shared/lib';
import type { OrderItem } from '../model/order';

interface OrderItemLinesProps {
  // Optional on purpose. Not every order payload carries line items —
  // the checkout response does not — and a display component must not
  // be able to take a whole page down over a missing array.
  items: OrderItem[] | undefined;
}

// Shared by the buyer's order detail and the seller's order list — both
// show the same lines, and the link target is the same public product
// page in either case.
export function OrderItemLines({ items }: OrderItemLinesProps) {
  if (!items || items.length === 0) return null;

  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 'var(--space-2) 0 0',
        display: 'grid',
        gap: 'var(--space-1, 0.25rem)',
      }}
    >
      {items.map((item) => (
        <li
          key={item.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
          }}
        >
          <span>
            <Link to={paths.product(item.productId)}>{item.product.name}</Link>
            {/* An archived product still has a page, and order history
                must still link to it — but say so, or the listing looks
                merely missing when the buyer gets there. */}
            {item.product.status === 'ARCHIVED' && (
              <span
                style={{
                  marginLeft: '0.4rem',
                  fontSize: '0.75rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                (no longer listed)
              </span>
            )}
            <span style={{ color: 'var(--color-text-muted)' }}>
              {' '}
              × {item.quantity}
            </span>
          </span>
          {/* The price PAID, snapshotted at purchase — deliberately not
              the product's current basePrice. */}
          <span>{formatMoney(item.unitPrice)}</span>
        </li>
      ))}
    </ul>
  );
}

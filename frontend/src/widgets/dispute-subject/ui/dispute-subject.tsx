import { Link } from 'react-router-dom';
import type { DisputeWithOrder } from '../../../entities/dispute';
import { paths } from '../../../app/routes/paths';
import { formatMoney } from '../../../shared/lib';

interface DisputeSubjectProps {
  dispute: DisputeWithOrder;
}

// What the dispute is actually ABOUT. Shared by the buyer's view and the
// admin queue: an admin cannot rule on "it arrived damaged" without
// seeing which item, and the buyer needs to recognise which order it is.
//
// A line-scoped dispute highlights that one item; an order-wide one
// lists the whole shipment, since the complaint covers all of it.
export function DisputeSubject({ dispute }: DisputeSubjectProps) {
  const { sellerOrder } = dispute;
  const disputed = dispute.orderItemId
    ? sellerOrder.items.filter((item) => item.id === dispute.orderItemId)
    : sellerOrder.items;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
        {dispute.orderItemId ? 'Disputed item' : 'Whole shipment disputed'} ·
        shipment {sellerOrder.id.slice(0, 8)} ·{' '}
        <Link to={paths.order(sellerOrder.orderId)}>view order</Link>
      </div>

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gap: '0.35rem',
        }}
      >
        {disputed.map((item) => (
          <li
            key={item.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
            }}
          >
            <span>
              <Link to={paths.product(item.productId)}>
                {item.product.name}
              </Link>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {' '}
                × {item.quantity}
              </span>
            </span>
            <span>{formatMoney(item.unitPrice)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

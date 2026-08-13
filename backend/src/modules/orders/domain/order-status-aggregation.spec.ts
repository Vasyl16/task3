import { OrderStatus, SellerOrderStatus } from '@prisma/client';
import { aggregateOrderStatus } from './order-status-aggregation';

const { NEW, PROCESSING, SHIPPED, COMPLETED, CANCELLED } = SellerOrderStatus;

describe('aggregateOrderStatus (parent status aggregation)', () => {
  it('all NEW -> NEW', () => {
    expect(aggregateOrderStatus([NEW, NEW])).toBe(OrderStatus.NEW);
  });

  it('a mix of NEW and PROCESSING -> PROCESSING', () => {
    expect(aggregateOrderStatus([NEW, PROCESSING])).toBe(
      OrderStatus.PROCESSING,
    );
  });

  it('all PROCESSING -> PROCESSING', () => {
    expect(aggregateOrderStatus([PROCESSING, PROCESSING])).toBe(
      OrderStatus.PROCESSING,
    );
  });

  it('a mix of SHIPPED and NEW/PROCESSING (not all shipped) -> PARTIALLY_SHIPPED', () => {
    expect(aggregateOrderStatus([SHIPPED, PROCESSING])).toBe(
      OrderStatus.PARTIALLY_SHIPPED,
    );
    expect(aggregateOrderStatus([SHIPPED, NEW])).toBe(
      OrderStatus.PARTIALLY_SHIPPED,
    );
  });

  it('a mix of COMPLETED and NEW/PROCESSING (not all done) -> PARTIALLY_SHIPPED', () => {
    // COMPLETED implies "at least shipped" for the purposes of this rule.
    expect(aggregateOrderStatus([COMPLETED, PROCESSING])).toBe(
      OrderStatus.PARTIALLY_SHIPPED,
    );
  });

  it('every SellerOrder at least SHIPPED (all SHIPPED) -> SHIPPED', () => {
    expect(aggregateOrderStatus([SHIPPED, SHIPPED])).toBe(OrderStatus.SHIPPED);
  });

  it('every SellerOrder at least SHIPPED, mixing SHIPPED/COMPLETED/CANCELLED -> SHIPPED', () => {
    expect(aggregateOrderStatus([SHIPPED, COMPLETED, CANCELLED])).toBe(
      OrderStatus.SHIPPED,
    );
  });

  it('all COMPLETED (none cancelled) -> COMPLETED', () => {
    expect(aggregateOrderStatus([COMPLETED, COMPLETED])).toBe(
      OrderStatus.COMPLETED,
    );
  });

  it('a single SellerOrder, COMPLETED -> COMPLETED', () => {
    expect(aggregateOrderStatus([COMPLETED])).toBe(OrderStatus.COMPLETED);
  });

  // Partial cancellation: some sellers fulfilled, others cancelled — the
  // order as a whole is neither a clean COMPLETED nor a full CANCELLED.
  it('every SellerOrder is COMPLETED or CANCELLED, with at least one CANCELLED -> PARTIALLY_CANCELLED', () => {
    expect(aggregateOrderStatus([COMPLETED, CANCELLED])).toBe(
      OrderStatus.PARTIALLY_CANCELLED,
    );
  });

  it('all CANCELLED -> CANCELLED', () => {
    expect(aggregateOrderStatus([CANCELLED, CANCELLED])).toBe(
      OrderStatus.CANCELLED,
    );
  });

  it('a single SellerOrder, CANCELLED -> CANCELLED', () => {
    expect(aggregateOrderStatus([CANCELLED])).toBe(OrderStatus.CANCELLED);
  });

  it('CANCELLED alongside still-untouched NEW ones -> PROCESSING (not NEW, not CANCELLED)', () => {
    expect(aggregateOrderStatus([CANCELLED, NEW])).toBe(OrderStatus.PROCESSING);
  });

  it('a single SellerOrder, NEW -> NEW', () => {
    expect(aggregateOrderStatus([NEW])).toBe(OrderStatus.NEW);
  });
});

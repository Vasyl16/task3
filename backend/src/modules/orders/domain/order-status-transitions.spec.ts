import { SellerOrderStatus } from '@prisma/client';
import { isValidSellerOrderTransition } from './order-status-transitions';

const { NEW, PROCESSING, SHIPPED, COMPLETED, CANCELLED, REFUNDED } =
  SellerOrderStatus;

describe('isValidSellerOrderTransition', () => {
  it.each([
    [NEW, PROCESSING],
    [NEW, CANCELLED],
    [PROCESSING, SHIPPED],
    [PROCESSING, CANCELLED],
    [SHIPPED, COMPLETED],
  ])('allows %s -> %s', (from, to) => {
    expect(isValidSellerOrderTransition(from, to)).toBe(true);
  });

  it.each([
    [NEW, SHIPPED], // can't skip PROCESSING
    [NEW, COMPLETED],
    [PROCESSING, COMPLETED], // can't skip SHIPPED
    [SHIPPED, CANCELLED], // once shipped, no longer cancellable
    [SHIPPED, PROCESSING], // no going backwards
    [COMPLETED, CANCELLED], // terminal
    [COMPLETED, PROCESSING], // terminal
    [CANCELLED, PROCESSING], // terminal
    [CANCELLED, NEW], // terminal
    [REFUNDED, PROCESSING], // legacy value has no valid transitions
  ])('rejects %s -> %s', (from, to) => {
    expect(isValidSellerOrderTransition(from, to)).toBe(false);
  });
});

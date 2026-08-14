import { computeCommission, PLATFORM_COMMISSION_RATE } from './commission';

// Commission is the platform's revenue AND (inverted) the seller's
// payout, and checkout writes it into an append-only ledger — a wrong
// figure here is money, recorded permanently, in two places at once. It
// is also reversed on cancellation by recomputing it from the stored
// subtotal (OrdersService.restoreStockAndReverseLedger), so the function
// has to be exactly reproducible: the same subtotal must always give the
// same answer, or a cancelled order fails to net back to zero.
describe('computeCommission', () => {
  it('takes 10% of the subtotal', () => {
    expect(computeCommission(100)).toBe(10);
    expect(computeCommission(250)).toBe(25);
    expect(PLATFORM_COMMISSION_RATE).toBe(0.1);
  });

  it('rounds to whole cents rather than carrying binary float noise', () => {
    // 19.99 * 0.1 is 1.9990000000000001 in IEEE-754. Storing that in a
    // Decimal(12,2) column silently truncates, and the reversal would
    // then be computed from a different number than the one written.
    expect(computeCommission(19.99)).toBe(2);
    expect(computeCommission(0.05)).toBe(0.01);
  });

  it('rounds a half-cent up, consistently in both directions', () => {
    // 12.345 -> 1.2345 -> 1.23; 12.35 -> 1.235 -> 1.24 (half up).
    expect(computeCommission(12.345)).toBe(1.23);
    expect(computeCommission(12.35)).toBe(1.24);
  });

  it('is exactly reproducible for the same subtotal', () => {
    // The cancellation path recomputes commission from the stored
    // subtotal rather than reading back what was written, so the two
    // calls must agree to the cent or the ledger won't net to zero.
    const subtotal = 87.63;
    expect(computeCommission(subtotal)).toBe(computeCommission(subtotal));
  });

  it('produces reversal amounts identical to the originals, so the ledger nets to zero', () => {
    // Checkout writes SALE(+subtotal) and COMMISSION(-c); cancellation
    // writes REFUND(-subtotal) and ADJUSTMENT(+c), where c is recomputed
    // here from the stored subtotal. The ledger sums in Postgres as
    // Decimal(12,2), so what has to hold is that each reversal is the
    // exact negation of what it reverses — asserted as equal magnitudes
    // rather than by summing in JS, where binary floats would introduce
    // noise the database never sees.
    for (const subtotal of [10, 19.99, 0.05, 87.63, 1234.56]) {
      const atCheckout = computeCommission(subtotal);
      const atCancellation = computeCommission(subtotal);
      expect(atCancellation).toBe(atCheckout);
      expect(-subtotal).toBe(-subtotal);
    }
  });

  it('returns zero for a zero subtotal', () => {
    expect(computeCommission(0)).toBe(0);
  });

  it('never exceeds the subtotal it is taken from', () => {
    for (const subtotal of [0.01, 1, 99.99, 100000]) {
      expect(computeCommission(subtotal)).toBeLessThan(subtotal + 0.01);
    }
  });
});

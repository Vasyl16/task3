import { foldRevenue, formatMoney, money } from './revenue';
import type { LedgerTotals } from './revenue';

// Ledger sign convention (see the LedgerEntry model): amounts are signed
// from the SELLER's point of view. A sale credits them, the commission
// debits them, a refund debits them back, and the ADJUSTMENT that
// accompanies a refund credits the commission back.
function totals(overrides: Partial<Record<keyof LedgerTotals, string>> = {}) {
  return {
    sale: money(overrides.sale ?? 0),
    commission: money(overrides.commission ?? 0),
    refund: money(overrides.refund ?? 0),
    adjustment: money(overrides.adjustment ?? 0),
    payout: money(overrides.payout ?? 0),
  };
}

describe('foldRevenue', () => {
  it('reports platform commission as a positive figure from the negative ledger debits', () => {
    const result = foldRevenue(
      totals({ sale: '1000.00', commission: '-100.00' }),
    );

    expect(formatMoney(result.netSales)).toBe('1000.00');
    expect(formatMoney(result.platformCommission)).toBe('100.00');
    expect(formatMoney(result.sellerNet)).toBe('900.00');
  });

  // A cancelled SellerOrder writes REFUND (-subtotal) and ADJUSTMENT
  // (+commission), which must net the original sale back out to nothing
  // — see OrdersService.restoreStockAndReverseLedger.
  it('nets a fully reversed sale back to zero across all three figures', () => {
    const result = foldRevenue(
      totals({
        sale: '1000.00',
        commission: '-100.00',
        refund: '-1000.00',
        adjustment: '100.00',
      }),
    );

    expect(formatMoney(result.netSales)).toBe('0.00');
    expect(formatMoney(result.platformCommission)).toBe('0.00');
    expect(formatMoney(result.sellerNet)).toBe('0.00');
  });

  it('reports a partial reversal as the remainder, not as two gross figures', () => {
    const result = foldRevenue(
      totals({
        sale: '1000.00',
        commission: '-100.00',
        refund: '-400.00',
        adjustment: '40.00',
      }),
    );

    expect(formatMoney(result.netSales)).toBe('600.00');
    expect(formatMoney(result.platformCommission)).toBe('60.00');
    expect(formatMoney(result.sellerNet)).toBe('540.00');
  });

  // PAYOUT settles a balance the platform already counted as revenue at
  // the time of sale. Including it would walk earnings back towards zero
  // as sellers get paid, which would be a straightforwardly wrong answer
  // to "how much did this seller earn".
  it('ignores PAYOUT entirely — settling a balance is not negative revenue', () => {
    const withoutPayout = foldRevenue(
      totals({ sale: '500.00', commission: '-50.00' }),
    );
    const withPayout = foldRevenue(
      totals({ sale: '500.00', commission: '-50.00', payout: '-450.00' }),
    );

    expect(formatMoney(withPayout.sellerNet)).toBe(
      formatMoney(withoutPayout.sellerNet),
    );
    expect(formatMoney(withPayout.sellerNet)).toBe('450.00');
  });

  it('returns zeroes for a period with no ledger activity', () => {
    const result = foldRevenue(totals());

    expect(formatMoney(result.netSales)).toBe('0.00');
    expect(formatMoney(result.platformCommission)).toBe('0.00');
    expect(formatMoney(result.sellerNet)).toBe('0.00');
  });

  // The invariant that lets a reader add up the columns on the dashboard
  // and have them agree. It is what makes the three figures one
  // consistent breakdown rather than three separate estimates.
  it('always satisfies netSales - platformCommission === sellerNet', () => {
    const cases: Array<Partial<Record<keyof LedgerTotals, string>>> = [
      { sale: '1000.00', commission: '-100.00' },
      { sale: '33.33', commission: '-3.33' },
      { sale: '1000.00', commission: '-100.00', refund: '-999.99' },
      { sale: '0.01', commission: '-0.01', adjustment: '0.01' },
      { refund: '-250.00', adjustment: '25.00' },
    ];

    for (const input of cases) {
      const result = foldRevenue(totals(input));
      expect(
        formatMoney(result.netSales.minus(result.platformCommission)),
      ).toBe(formatMoney(result.sellerNet));
    }
  });

  // Decimal, not float. `0.1 + 0.2` is the canonical demonstration that
  // binary floating point cannot represent these values exactly; summing
  // thousands of ledger rows that way drifts by cents.
  it('sums money exactly, without floating-point drift', () => {
    const result = foldRevenue(totals({ sale: '0.10', refund: '0.20' }));

    expect(formatMoney(result.netSales)).toBe('0.30');
    // The float version of the same sum is 0.30000000000000004.
    expect(result.netSales.toNumber()).not.toBe(0.1 + 0.2);
  });

  it('keeps precision across a large number of small entries', () => {
    let running = money(0);
    for (let i = 0; i < 1000; i++) {
      running = running.plus(money('0.01'));
    }

    expect(formatMoney(running)).toBe('10.00');
  });
});

import { Prisma } from '@prisma/client';

// Every money figure in this module is a Decimal, never a JS number.
// These are sums of currency read straight out of the ledger; folding
// them through binary floating point would introduce cent-level drift
// into numbers an admin is expected to reconcile against the
// transactional rows.
export type Money = Prisma.Decimal;

export function money(value: string | number | null | undefined): Money {
  return new Prisma.Decimal(value ?? 0);
}

export function formatMoney(value: Money): string {
  return value.toFixed(2);
}

// Raw per-type sums of LedgerEntry.amount over a period, exactly as
// Postgres computed them. Signs are the ledger's own convention: amounts
// are signed from the SELLER's point of view (+credit / -debit), so
// COMMISSION is negative and its ADJUSTMENT reversal is positive.
export interface LedgerTotals {
  sale: Money;
  commission: Money;
  refund: Money;
  adjustment: Money;
  payout: Money;
}

export interface RevenueBreakdown {
  // Merchandise sold, net of reversals — the marketplace's gross volume.
  netSales: Money;
  // What the platform actually earned. Positive by construction.
  platformCommission: Money;
  // What the sellers earned after commission. Excludes PAYOUT: paying a
  // seller their balance moves money that was already counted as revenue
  // when the sale happened, so including it would net earnings back
  // towards zero as settlements are made.
  sellerNet: Money;
}

// The single definition of "revenue" for the whole module — the platform
// figure, the per-seller figure, the chart buckets and the top-sellers
// table all fold through here, so a row in one can never mean something
// different from a row in another.
//
// The invariant, which the tests pin: netSales - platformCommission
// === sellerNet, for any input.
export function foldRevenue(totals: LedgerTotals): RevenueBreakdown {
  const netSales = totals.sale.plus(totals.refund);
  // Negated because a commission is recorded as a debit against the
  // seller; the platform's income is the mirror image of it. ADJUSTMENT
  // is currently only ever the commission reversal written when a
  // SellerOrder is cancelled (see OrdersService.restoreStockAndReverseLedger)
  // — if it ever gains a second meaning, this fold has to be revisited.
  const platformCommission = totals.commission
    .plus(totals.adjustment)
    .negated();

  return {
    netSales,
    platformCommission,
    sellerNet: netSales.minus(platformCommission),
  };
}

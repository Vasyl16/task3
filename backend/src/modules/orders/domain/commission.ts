// Flat platform commission rate applied to every SellerOrder's subtotal
// at checkout. A fixed constant, not per-seller/per-category configurable
// — nothing in this task calls for configurable rates, and inventing that
// infrastructure ahead of an actual requirement would be over-engineering.
// Revisit as a real (probably per-seller) config value if/when the
// business asks for differentiated commission tiers.
export const PLATFORM_COMMISSION_RATE = 0.1; // 10%

export function computeCommission(subtotal: number): number {
  return Math.round(subtotal * PLATFORM_COMMISSION_RATE * 100) / 100;
}

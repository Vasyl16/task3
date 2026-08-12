---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.e2e-spec.ts"
---

# Testing rules

- Test business invariants and observable behavior, not implementation
  details — a refactor that preserves behavior shouldn't break the test.
- **Always require a test, no exceptions**, for:
  - checkout (multi-vendor transaction)
  - inventory reservation/decrement
  - bid placement (concurrency)
  - idempotency (event handlers / outbox consumers)
  - SellerOrder → Order status aggregation
  - authorization / IDOR (ownership checks)
- Don't delete or weaken a test to make it pass — if a test seems wrong,
  say so and ask before changing it.

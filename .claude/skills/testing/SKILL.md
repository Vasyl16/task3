---
name: testing
description: Testing strategy and workflow for this repo — what needs unit vs. integration/e2e tests, how backend e2e tests get a working env without a real database, and the frontend Vitest+RTL setup. Use when deciding how to test a change, writing a new test, or setting up test infrastructure.
---

# Testing strategy

See `.claude/rules/testing.md` for the short always-on rules (what always
needs a test); this is the workflow reference.

## Backend

- Unit test services, especially anything with concurrency control or
  transactional logic — mock Prisma (or the module's repository
  abstraction) only where the test's purpose is pure business-rule logic;
  use a real test DB for anything verifying actual transaction/locking
  behavior.
- e2e tests (`backend/test/*.e2e-spec.ts`) hit real HTTP endpoints via
  supertest, booting the full `AppModule`. Since `AppModule` includes
  `ConfigModule` with required env vars (`DATABASE_URL`,
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`), e2e tests load
  `backend/test/jest-e2e-setup.ts` (via `jest-e2e.json`'s `setupFiles`)
  which sets dummy values with `??=` if not already set — enough to pass
  validation and let `PrismaService` construct its adapter, without
  needing a real reachable database for tests that don't touch it.
- Run `npm run lint`, `npm run typecheck`, and `npm run test` before
  considering a backend change done.

## Frontend

- Vitest + React Testing Library. Test behavior (what the user sees/does),
  not implementation details.
- Critical flows (cart/checkout, bid placement, order status display)
  need at least one test covering the primary path before being
  considered done.
- Run `npm run lint`, `npm run typecheck`, and `npm run test` before
  considering a frontend change done.

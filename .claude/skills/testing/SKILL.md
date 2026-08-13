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
  supertest, booting the full `AppModule`. `backend/test/jest-e2e-setup.ts`
  (via `jest-e2e.json`'s `setupFiles`) first loads the real
  `backend/.env` via `dotenv.config()` (same file `start:dev` uses), then
  sets dummy fallback values with `??=` for anything still unset — so
  e2e tests get the REAL configured `DATABASE_URL` whenever one is
  available (enabling genuine integration tests — see
  `checkout.e2e-spec.ts`, `bidding-concurrency.e2e-spec.ts`), and still
  boot with zero setup (guard-only tests, e.g. `auth.e2e-spec.ts`) in an
  environment with no database at all.
  - Real-DB e2e specs create their own fixtures (users/sellers/
    categories/products) via `test/support/fixtures.ts` — `registerUser`
    goes through the real `/auth/register` endpoint (not a Prisma
    shortcut); `makeApprovedSeller` bypasses the apply/approve HTTP flow
    directly via Prisma (already covered by unit tests, not the point of
    a checkout/bidding test). Always `afterAll`-clean up everything
    created, in FK-safe order (children before parents — see
    `checkout.e2e-spec.ts`'s `afterAll` for the reference order), scoped
    to that file's own created ids only.
  - WebSocket specs (`realtime.e2e-spec.ts`) need `app.listen(0)`, not
    just `app.init()` — Socket.IO requires a real port. Attach any
    listener for a server-pushed event (the `connected` greeting, a
    server-initiated `disconnect`) BEFORE awaiting the client's
    `connect`: those packets can arrive in the same tick, and socket.io
    drops an event with no listener, so attaching afterwards is a race
    that loses whenever the packets share a TCP frame.
  - `app.close()` can be slow to resolve when a BullMQ `Worker` never got
    a Redis connection to close cleanly (no Redis running) — use
    `test/support/close-app.ts`'s `closeApp(app)` (bounded, races a
    timeout) instead of a bare `await app.close()` in `afterEach`/
    `afterAll`. `jest-e2e.json` also sets `forceExit: true` and a raised
    `testTimeout` for the same reason — this doesn't affect real runtime
    behavior, only test teardown.
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

# Project: Multi-Vendor Marketplace + Real-Time Inventory

Monorepo: `backend/` (NestJS modular monolith) + `frontend/` (React/Vite).
Each app is fully independent — its own `package.json`, no root workspace
tooling. See `backend/CLAUDE.md` and `frontend/CLAUDE.md` for app-specific
rules; this file covers cross-cutting rules that apply everywhere.

## Ground rules

- Implement only what the current task asks for. Do not refactor, rename,
  or "improve" unrelated code while doing an unrelated task.
- Do not introduce new architecture, services, or dependencies unless the
  task genuinely requires them. When in doubt, ask before adding.
- Never invent requirements that contradict the agreed technical spec.
  If something is ambiguous, stop and ask rather than guessing.
- Never create a git commit unless explicitly told to. After finishing a
  step: explain what changed, list files touched, flag concerns, then wait.

## Data ownership & consistency

- **PostgreSQL is the single source of truth** for all business-critical
  state (users, vendors, products, inventory, orders, auctions, bids,
  payments). Every write path that matters for correctness goes through it.
- **Meilisearch is a read/search model only.** Never treat it as
  authoritative, never write business logic that depends on Meilisearch
  being up-to-date or even available. It is rebuilt from Postgres via async
  sync — if it's stale or down, the app must still function correctly for
  everything except search itself.
- Be explicit about which parts of a feature are **strongly consistent**
  (same DB transaction, e.g. inventory decrement + order creation) vs.
  **eventually consistent** (outbox → queue → consumer, e.g. search index
  updates, WebSocket notifications). Document this in code comments only
  when it's non-obvious from the flow itself.

## Events, queues, real-time

- Any state change that other systems need to react to (search sync,
  notifications) must be published via the **Transactional Outbox**
  pattern: write the domain change and the outbox row in the same DB
  transaction. Never dual-write (DB write + direct queue push as two
  separate operations).
- **Event handlers/consumers must be idempotent.** Assume at-least-once
  delivery — a handler run twice with the same event must not duplicate
  side effects (upsert semantics, dedupe by event id, etc.).
- BullMQ is for async processing (search sync, notification dispatch), not
  for anything that must be strongly consistent with the originating
  request.
- WebSocket is for real-time notification delivery only — it is never the
  source of truth. Clients must be able to resync full current state from
  the REST API on (re)connect; don't design a feature that only works if
  every WebSocket message was received.
- Correlation IDs must be generated at the edge (HTTP request / WS
  connection) and propagated through synchronous calls, outbox payloads,
  and queue jobs, and included in structured log lines.

## Security

- Every endpoint must have explicit role authorization — no implicit trust.
- Always check resource ownership before allowing access/mutation (IDOR
  protection) — a valid JWT is not sufficient, the resource must belong to
  the requester (or the requester's role must explicitly permit it).
- All external input is validated via DTOs — no exceptions.
- Rate limiting applies to any endpoint that's a plausible abuse target
  (auth, bidding, checkout).
- Never commit secrets. Real config lives in `.env` files (gitignored);
  only `.env.example` with placeholders is committed.

## Testing

- Critical business logic (inventory reservation, bid concurrency, order
  status aggregation, checkout transaction) requires unit tests — no
  exceptions, even under time pressure.
- Prefer integration/e2e tests for anything crossing a transaction or
  queue boundary — a unit test that mocks the DB won't catch a real
  consistency bug.
- Don't delete or weaken a test to make it pass. If a test seems wrong,
  say so and ask before changing it.

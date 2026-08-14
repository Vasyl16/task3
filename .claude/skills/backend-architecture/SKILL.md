---
name: backend-architecture
description: Backend layered architecture reference for this repo — NestJS module folder layout, dependency-direction rules between modules, transaction/consistency conventions, and the outbox/Meilisearch event pattern. Use when designing or reviewing NestJS module boundaries, adding a new module, wiring cross-module dependencies, or explaining why the backend is structured the way it is.
---

# Backend architecture

See `.claude/rules/backend.md` for the short always-on rules; this is the
detailed reference.

## Module folder layout

`backend/src/` is organized as:

- `config/` — env var loading (`@nestjs/config`, `configuration.ts`) and
  validation (`env.validation.ts`, a Joi schema). Add new config keys to
  both files, typed — never read `process.env` directly outside this
  folder. A var with no safe default (secrets, `DATABASE_URL`) must be
  `.required()` so the app fails fast at startup; only give a var a Joi
  `.default()` when running without it locally is genuinely fine.
- `core/` — cross-cutting, app-wide providers (correlation IDs, structured
  logging, global exception filters/guards), `@Global()`, imported once
  into `AppModule`. Not a place for domain logic. `core/auth/` holds the
  `@Public()`/`@Roles()`/`@CurrentUser()` decorators, `AuthenticatedUser`,
  and the two global guards (`JwtAuthGuard`, `RolesGuard`) — deliberately
  separate from `modules/auth/` (see "Authentication & authorization"
  below) so `infrastructure/` and every module can use them without
  depending on the auth module's actual credential business logic.
- `infrastructure/` — shared technical plumbing used across modules:
  `prisma/` (the `PrismaService` DB client, `@Global()`), `outbox/` (the
  `OutboxService` used to record events inside a transaction, plus
  `OutboxPublisherService`, the claim-and-publish worker), `queue/`
  (BullMQ setup — `QueueModule`, `QueueService`, `QueueName`),
  `idempotency/` (`EventIdempotencyService` for consumers,
  `IdempotencyKeyService`/`IdempotencyInterceptor` for client-retried
  commands), `meilisearch/` (`MeilisearchService`, the only place the
  `meilisearch` client is imported), `health/` (`GET /health`). Not a
  place for domain logic — if it needs a business rule, it belongs in a
  module.
- `modules/` — one NestJS module per domain boundary (see root `README.md`
  for the current module list). Don't create a new module for something
  that fits inside an existing one; don't cram unrelated domains into one
  module either — ask if it's unclear which module something belongs in.

Each module follows this internal layout:

```
modules/<name>/
  <name>.module.ts / .controller.ts / .service.ts
  domain/<name>.repository.ts   — abstract class, the persistence port
  domain/events/*.event.ts      — typed outbox payload shapes
  infrastructure/prisma-<name>.repository.ts — concrete Prisma adapter
  dto/*.dto.ts                  — one per input shape, class-validator
```

The service depends on the abstract repository (a DI token), never on
Prisma directly — except for opening a `$transaction` boundary, which is
the one place a service may inject `PrismaService` itself (see
`ProductsService.create` for the reference implementation).

## Dependency direction between modules

A module may import another module and inject its exported *service*
(never reach into its repository or Prisma models directly).

```
infrastructure (Prisma, Outbox) ← core (correlation IDs)
        ↑
    users ← auth
      ↑  ↑
  sellers
      ↑
  categories
      ↑
  products ←── (sellers, categories)
      ↑
  cart ←── (users, products)
      ↑
  bidding ←── (products, sellers, users)
      ↑
  orders ←── (cart, products, sellers, users, bidding)
      ↑
  payments-ledger ←── (orders, sellers)
      ↑
  disputes ←── (orders)
      ↑
  admin ←── (sellers, products, disputes, analytics)

search / notifications — standalone, import no other business module.
This is deliberate: it's what keeps the outbox pattern actually
decoupled (Products never imports Search — they connect only via
OutboxEvent rows).

analytics — imports sellers, and ONLY sellers, ONLY to resolve the
caller's own SellerProfile so a seller can read their own figures
without a client-supplied sellerId. No analytics DATA comes from another
module's service: every figure is aggregated straight from Postgres by
AnalyticsRepository. Keep it that way — the moment analytics starts
calling other services for numbers, it becomes a hub every module has to
be wired into.
```

`admin` is a presentation layer, not a domain: one controller, no
service, no repository. It sits last in the order, imports four modules,
and nothing imports it, so it cannot create a cycle. Every route
delegates to the module that owns the rule — admin behaviour must never
become a second implementation of a rule with its own subtly different
checks. Its single class-level `@Roles(ADMIN)` is also the point: the
complete admin surface is auditable by reading one file, rather than by
grepping every controller for a decorator that might have been left off
one method.

A module must never import something that (directly or transitively)
imports it back. If you find yourself needing that, the module boundary
is probably wrong — ask before adding the import.

## Transactions & consistency

- Any operation that must be atomic (checkout: inventory + order
  creation; bid placement: version check + update) runs inside an
  explicit `prisma.$transaction`. Don't rely on multiple sequential calls
  "usually" succeeding together.
- Auction bids and inventory decrement use explicit concurrency control
  (optimistic, via a `version` column, or a conditional `WHERE` clause
  that's itself the guard) — never a naive read-then-write without
  protection against concurrent writers. See "Auction bidding" below for
  which strategy and why.
- Parent `Order.status` is derived from its `SellerOrder`s. Recompute it
  synchronously, in the same transaction as the `SellerOrder` status
  change that triggers it — don't let it drift into an
  eventually-consistent background job.

### Checkout (`OrdersService.checkout` / `executeOrderTransaction`)

One `$transaction` does, in order: re-read every cart line's product +
inventory from Postgres (never trust the cart's stale snapshot for price
or the client for stock) → reject if any product is gone/archived/not
`FIXED_PRICE` → reject if any line's stock is insufficient →
conditionally decrement stock per line (`ProductsService.
decrementStockForCheckout`, throws `ConflictException` on failure,
aborting the whole transaction — no partial decrement survives) → split
lines by seller → create the parent `Order` + one `SellerOrder` +
`OrderItem`s + initial `SALE`/`COMMISSION` ledger entries per seller
(`OrdersRepository.createFromCheckout`) → record one `SellerOrderCreated`
outbox event per `SellerOrder` (fans out to async processing +
notification) and one `OrderPlaced` for the parent → clear the cart.
Any failure at any step rolls back everything before it.

`executeOrderTransaction` (steps 6–13 above) is shared with the
auction-winner counterpart, `OrdersService.checkoutAuctionWin` — a
single-line "order" at the auction's `currentHighestBid` (never
`Product.basePrice`), gated by `BiddingService.assertCanCheckoutAsWinner`
(caller is the actual winner, auction is `ENDED`, `checkoutDeadline`
hasn't passed) and finished by marking the `Auction` `COMPLETED` in the
same transaction. Both callers validate their own lines BEFORE calling
this helper — it trusts its input.

Idempotency against a client retrying the checkout HTTP request is a
*separate* concern from the transaction's own atomicity — see
`IdempotencyInterceptor` on the controller route.

### SellerOrder lifecycle & Order status aggregation

`SellerOrderStatus` transitions (`domain/order-status-transitions.ts`):
`NEW → PROCESSING → SHIPPED → COMPLETED`, or `NEW|PROCESSING →
CANCELLED`. Once `SHIPPED`, no longer cancellable. Checked explicitly in
`OrdersService.updateSellerOrderStatus` — an invalid transition is a 400,
never silently coerced.

Cancelling a `SellerOrder` restores stock for exactly its own
`OrderItem`s (`ProductsService.restoreStock`) and appends
`REFUND`/`ADJUSTMENT` ledger entries that net its `SALE`/`COMMISSION`
entries back to zero (`LedgerEntry` is append-only — never mutate a
prior entry). It never touches a different seller's `SellerOrder` under
the same `Order`.

`Order.status` is derived from the SET of its `SellerOrder` statuses —
see `domain/order-status-aggregation.ts` for the exact precedence rules
(all cancelled → `CANCELLED`; all done with ≥1 cancelled →
`PARTIALLY_CANCELLED`; all done, none cancelled → `COMPLETED`; all
at-least-shipped → `SHIPPED`; some shipped → `PARTIALLY_SHIPPED`; some
processing (or cancelled mixed with untouched) → `PROCESSING`; otherwise
`NEW`). Recomputed synchronously in the same transaction as the
triggering `SellerOrder` status write — never a background job.

A `SellerOrder` moving `NEW → PROCESSING` also happens automatically,
driven by `OrderProcessingConsumer` reacting to `SellerOrderCreated` —
see "Events & Meilisearch" above.

### Auction bidding (`BiddingService.placeBid`)

Optimistic locking via `Auction.version`, not pessimistic row locking
(`SELECT ... FOR UPDATE`) — deliberately: bid placement is a short, fast
write, and the common case (no colliding bidder at this exact instant)
should pay zero locking overhead; a popular auction can have many
concurrent readers alongside occasional colliding writers, and nothing
here needs to block reads. The conditional `UPDATE ... WHERE version = ?`
(`BiddingRepository.tryAcceptBid`) IS the safety property: Postgres
serializes two concurrent UPDATEs to the same row, so a loser's `WHERE`
clause re-evaluates against the winner's already-committed version and
matches 0 rows — never a lost update. A version-mismatch loss is
retried (bounded, `MAX_BID_ATTEMPTS`) against freshly re-read state,
rather than hard-failed on the first collision.

Deadline processing (`SCHEDULED → ACTIVE` at `startsAt`, `ACTIVE →
ENDED|EXPIRED` at `endsAt`, `ENDED → EXPIRED` at `checkoutDeadline`) is
driven by BullMQ delayed jobs scheduled at auction-creation/-ending time
(`AuctionDeadlineConsumer`), backstopped by a periodic Postgres sweep
(`AuctionDeadlineSweeperService`) — see "Scheduled (delayed) jobs" above
for why both exist. All three transitions are idempotent-by-construction
guarded updates (`BiddingRepository.transitionStatusIfCurrent`), so the
queued job and the sweep can never double-apply one.

## Events & Meilisearch

- Writes that need to reach Meilisearch or trigger a WebSocket
  notification go through the outbox table, in the same transaction as
  the domain write. Never call the Meilisearch client, BullMQ, or emit a
  WS event directly from inside a business transaction.
- Meilisearch sync consumers must be idempotent (upsert by entity id, not
  "insert").
- Never add a code path where correctness depends on reading from
  Meilisearch. It's a search index, not a queryable source of truth.

### The full pipeline: Outbox → Publisher → BullMQ → Worker

```
business transaction (Product write + OutboxService.record(tx, event))
        |  (same Postgres transaction, or neither commits)
        v
   OutboxEvent row (PENDING)
        |  polled by OutboxPublisherService (infrastructure/outbox/
        |  outbox-publisher.service.ts) — claims via SKIP LOCKED,
        |  never marks PUBLISHED until the BullMQ add() below resolves
        v
   BullMQ queue (infrastructure/queue — QueueName picked by
   infrastructure/outbox/event-queue-map.ts, keyed on eventType)
        |
        v
   Worker (a @Processor class, e.g. SearchSyncConsumer) — wraps its
   side effect in EventIdempotencyService.run(consumerName, eventId, ...)
   before doing anything, so a redelivered job is a no-op.
```

- **At-least-once, not exactly-once.** A crash between a successful
  BullMQ enqueue and the OutboxEvent row being marked PUBLISHED
  republishes that event on the next poll; a crash inside a worker after
  its side effect but before BullMQ marks the job complete redelivers
  the job. Every consumer MUST be idempotent (via
  `EventIdempotencyService`, `infrastructure/idempotency/`) — never
  assume a handler runs exactly once.
- **Two different idempotency mechanisms exist — don't conflate them**
  (`infrastructure/idempotency/`):
  - `EventIdempotencyService` — event-CONSUMER idempotency. A BullMQ
    worker may see the same job twice; guards via a `ProcessedEvent`
    unique constraint on `(eventId, consumerName)`, inserted in the same
    transaction as the side effect.
  - `IdempotencyKeyService` (+ `IdempotencyInterceptor`) — API
    idempotency. A client may retry the same command with an
    `Idempotency-Key` header; guards via an `IdempotencyKey` row unique
    on `(key, userId)`. Opt-in per route via
    `@UseInterceptors(IdempotencyInterceptor)` — wired on
    `POST /orders/checkout`, `POST /orders/checkout/auctions/:id`, and
    `POST /auctions/:id/bids` (copy this for any future command
    endpoint where a client retry must not duplicate the effect).
- **New producers**: add the event type to
  `infrastructure/outbox/event-queue-map.ts`; add a new
  `infrastructure/queue/queue.constants.ts` `QueueName` only if it's a
  genuinely new processing lane. An event type with NO mapping yet is
  left `PENDING` (not `FAILED`) by the publisher and rechecked
  infrequently — "no consumer implemented yet" is expected, ongoing
  project scope (several event types — `SellerOrderStatusChanged`,
  `BidPlaced`, `AuctionEnded` — are recorded today with no consumer yet,
  by design). A value in
  the map can be a single `QueueName` or an array, for one fact that
  should fan out to more than one independent reaction (see
  `SellerOrderCreated`, which drives both order-processing and
  notifications).
- **New consumers**: a `@Processor(QueueName.X)` class extending
  `WorkerHost` from `@nestjs/bullmq`, registered via
  `BullModule.registerQueue({ name: QueueName.X })` in that consumer's
  own module — see `modules/search/search.module.ts` +
  `modules/search/consumers/search-sync.consumer.ts` for the reference
  implementation (also the demonstration flow: Outbox → Publisher →
  BullMQ → Worker → Meilisearch). Currently wired:
  `SearchSyncConsumer`, `OrderProcessingConsumer` (auto-advances a new
  `SellerOrder` NEW → PROCESSING), `NotificationsConsumer` (notifies the
  seller), `EmailConsumer` (sends the buyer a payment-receipt email via
  `EmailService`/Resend on `OrderPlaced` — standalone like
  `SearchSyncConsumer`, re-reads Order+buyer from Postgres inside the
  idempotency transaction rather than trusting the event payload or
  importing `OrdersModule`; a Resend failure is logged and swallowed,
  never thrown, since email is best-effort, not a source of truth),
  `AuctionDeadlineConsumer` (ends auctions / expires unclaimed
  wins — see "Auction bidding" below), `RealtimeConsumer` (WebSocket
  fan-out — see "Real-time layer" below).
- **Scheduled (delayed) jobs are NOT the outbox pattern** — a job for a
  future point in time (e.g. an auction's `endsAt`) is scheduled
  directly via `QueueService.scheduleDelayed`, not via an OutboxEvent
  (there's no "fact that already happened" to relay reliably; it's a
  future action). `scheduleDelayed` is bounded and best-effort (times
  out and logs a warning rather than hanging the request if Redis is
  unreachable) — pair it with a periodic Postgres-backed reconciliation
  sweep as the reliability backstop (see `AuctionDeadlineSweeperService`
  for the reference pattern: poll Postgres for rows whose deadline has
  passed and the status hasn't moved on, drive the same idempotent
  guarded transition the queued job would have).
- Search is eventually consistent with Postgres — never read Meilisearch
  as authoritative for stock/price/availability; checkout etc. always
  re-reads Postgres directly.

## Real-time layer (`infrastructure/realtime/`)

NestJS WebSocket gateway on Socket.IO, namespace `/realtime`. **A
WebSocket message is a notification, never a source of truth** — the
same rule Meilisearch lives under. Nothing server-side ever makes a
decision because a broadcast happened, and no client may treat a
payload as authoritative for a purchase.

- **Separation from business logic is structural, not conventional.**
  `RealtimeGateway` is the only class in the app that imports Socket.IO;
  no business service injects it or emits anything. Facts arrive
  exclusively through the outbox → BullMQ pipeline, so the whole
  directory could be deleted and every domain rule would still work.
  `RealtimeModule` imports no business module, and no business module
  imports it.
- **Three broadcast events**, each recorded in the same transaction as
  the change it describes: `InventoryUpdated` (→ `product:{id}`),
  `BidPlaced` / `AuctionEnded` (→ `auction:{id}`), and
  `SellerOrderStatusChanged` (→ BOTH `order:{orderId}` and
  `seller-order:{sellerOrderId}`, as two separate envelopes so each
  subscription gets a correctly-labelled `room`).
- **Rooms are `{type}:{id}`, parsed only by `parseRoom`** — the security
  boundary between a client string and `socket.join()`. An unknown type
  or a malformed id is rejected, so a client can never join a room of
  its own invention.
- **Authorization**: `product:` / `auction:` rooms are public (that data
  is already `@Public()` over REST — gating it would be theatre).
  `order:` / `seller-order:` rooms require a verified identity AND an
  ownership check in `RealtimeRoomsService.authorize`, which mirrors
  `OrdersService.findById`'s rule including returning NOT_FOUND rather
  than FORBIDDEN so room names can't be probed for existence. Re-checked
  on every `resync`, never granted once and assumed.
- **Connections may be anonymous.** A handshake token
  (`auth.token`, or a bearer `Authorization` header) is verified and
  attached; an INVALID token disconnects the socket rather than silently
  downgrading it to anonymous, so a client with an expired access token
  finds out instead of quietly receiving nothing.
- **Reconnect/resync is the whole design**: `subscribe` joins the room
  AND returns a Postgres-read snapshot in one round trip, and `resync`
  returns the same snapshot without re-joining. A reconnecting client
  re-subscribes and is immediately correct — it never needs to know what
  it missed, and there is no replay log. Every envelope also carries
  `authoritativeSource`, the REST endpoint that IS the truth for that
  room. **This is what makes a missed broadcast survivable; keep it
  working.**
- **`RealtimeConsumer` deliberately does NOT use
  `EventIdempotencyService`** — unlike every other consumer. Its side
  effect is a broadcast, which carries no authority and is applied on
  top of a snapshot the client fetched itself, so re-delivering one is
  harmless and a per-broadcast database round-trip would buy nothing.
  This is the single exception to "every consumer dedupes"; don't copy
  it to a consumer that writes.
- **Single-process assumption.** Socket.IO rooms are per-process and a
  BullMQ job is consumed by exactly one instance, so running more than
  one backend replica would deliver each broadcast to only the replica
  that happened to process the job. Fine for this modular monolith; if
  it is ever scaled horizontally, add `@socket.io/redis-adapter` in
  `ConfiguredIoAdapter` (`realtime.adapter.ts`) — that is the single
  place it plugs in, and nothing else changes.

## Validation

- Validate at the boundary (controller/DTO). Don't re-validate the same
  shape deeper in the call stack — trust internal code once past the DTO.

## Authentication & authorization

Authentication (who are you) and authorization (what can you do) are
deliberately separate mechanisms — see `.claude/rules/backend.md`.

- **Authentication**: `JwtAuthGuard` (global, in `CoreModule`) requires a
  valid access token on every route unless `@Public()`. It populates
  `req.user: AuthenticatedUser` (`{ id, email, role }`) from the verified
  token payload — never from anything client-supplied.
- **Role authorization**: `@Roles(UserRole.SELLER, UserRole.ADMIN)` +
  `RolesGuard` (also global) checks `req.user.role` against the
  decorator's list. No `@Roles()` = any authenticated user. This is
  necessary but never sufficient for a resource-scoped action.
- **Ownership authorization (IDOR prevention)**: role alone doesn't prove
  a seller owns the specific resource being acted on. Every
  mutating/resource-scoped endpoint does this in the *service*, not the
  controller:
  1. Take the actor from `@CurrentUser()`, never from the request body or
     a route param.
  2. Resolve their own resource via
     `SellersService.getOwnApprovedSellerProfileOrThrow(callerId)` (throws
     `ForbiddenException` if there's no approved profile).
  3. Compare that resolved id against the target resource's owning id
     (`product.sellerId`, `sellerOrder.sellerId`, ...); mismatch → 403.
  4. `ADMIN` bypasses step 2–3 entirely (explicit override, checked first)
     — see `ProductsService.assertOwnsProductOrIsAdmin` and
     `OrdersService.assertOwnsSellerOrderOrIsAdmin` for the reference
     pattern (same shape in both, copy it for new owned resources).
  - A caller who owns nothing should generally get 404 rather than 403
    when looking up someone else's specific resource by id (don't
    confirm to a stranger that the id exists) — see `OrdersService.findById`.
- **Refresh tokens**: rotated on every use (`AuthService.refresh`), and
  only a SHA-256 hash is ever stored (`RefreshToken.tokenHash`) — a DB
  read can't be turned into a usable token. Presenting an already-revoked
  token revokes every active token for that user (reuse ⇒ assume theft).
- **Role sync**: `User.role` is a real column, not derived on every read,
  for `RolesGuard` to check without a DB hit — but it only ever changes
  in `SellersService.review`'s transaction, atomically with the
  `SellerProfile.status` change that causes it (`APPROVED` → `SELLER`,
  anything else → `CUSTOMER`). Never set `role` from anywhere else.

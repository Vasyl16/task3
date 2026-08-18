# Full repository analysis — Outbox, Idempotency, Sagas, Queues, and more

This report documents how the backend implements asynchronous delivery, idempotency, sagas (refund), queueing (BullMQ), rollbacks/compensation, and where the main features live in the codebase. It also covers the frontend parts that touch reviews/rating, lists known edge-cases, and addresses the task3 checklist from the project owner.

---

## Executive summary

- Outbox pattern: implemented (transactional writes + separate publisher). Key files:
  - backend/src/infrastructure/outbox/outbox.service.ts
  - backend/src/infrastructure/outbox/outbox-publisher.service.ts
  - backend/src/infrastructure/outbox/event-queue-map.ts

- Queueing: BullMQ is used via a thin `QueueService` adapter. Key files:
  - backend/src/infrastructure/queue/queue.service.ts
  - backend/src/infrastructure/queue/domain-event.consumer.ts
  - queue constants: backend/src/infrastructure/queue/queue.constants.ts

- API idempotency (client retries): implemented via an `IdempotencyInterceptor` + `IdempotencyKey` DB table.
  - backend/src/infrastructure/idempotency/idempotency.interceptor.ts
  - backend/src/infrastructure/idempotency/idempotency-key.service.ts
  - Prisma model: `IdempotencyKey` in backend/prisma/schema.prisma

- Event-consumer idempotency (at-least-once -> guarded side-effects): implemented using `ProcessedEvent` + `EventIdempotencyService`.
  - backend/src/infrastructure/idempotency/event-idempotency.service.ts
  - Prisma model: `ProcessedEvent` in backend/prisma/schema.prisma

- Refund saga: implemented as a consumer-driven saga reacting to seller-order cancellation events.
  - consumer and saga coordinator: backend/src/modules/payments-ledger/consumers/refund.consumer.ts
  - payments ledger service (open/settle/fail steps): backend/src/modules/payments-ledger/payments-ledger.service.ts
  - mock gateway used to simulate provider behavior: backend/src/modules/payments-ledger/infrastructure/mock-payment-gateway.service.ts

- Reviews & rating: the backend contains a reviews implementation that enforces "verified purchase" (only COMPLETED purchases). Key files:
  - backend/src/modules/reviews/reviews.service.ts
  - backend/src/modules/reviews/* (controller, dto, repository)
  - Prisma model: `Review` in backend/prisma/schema.prisma

---

## Outbox pattern (why, how, and implementation details)

What it is:
- The transactional outbox pattern makes the database the single atomic write for both domain state and events: domain changes and an OutboxEvent row are written in the same DB transaction. A separate process (publisher) polls the DB and pushes the events to the message broker (BullMQ). This gives atomicity for the domain write while providing eventual delivery to consumers.

How this repo implements it:
- Writing events: domain services call `OutboxService.record(tx, event)` inside the same Prisma transaction that updates domain rows. (See: backend/src/infrastructure/outbox/outbox.service.ts.)
- Publisher: `OutboxPublisherService` polls Postgres, claims rows using a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` query, enqueues jobs to BullMQ via `QueueService.enqueueDomainEvent()`, and only marks events `PUBLISHED` after every mapped queue's enqueue resolved. (See: backend/src/infrastructure/outbox/outbox-publisher.service.ts.)
- Mapping event types → queues: `EVENT_QUEUE_MAP` in backend/src/infrastructure/outbox/event-queue-map.ts centralizes where each event must be sent. The publisher uses this mapping to fan-out.

Key reliability details (found in outbox code):
- Claiming is done in a single SQL statement with `FOR UPDATE SKIP LOCKED` to avoid double-claim across multiple app instances.
- If enqueue fails the publisher computes an exponential backoff and retries up to `MAX_ATTEMPTS` (constant in outbox-publisher.constants.ts). After exhaustion the event is marked `FAILED` (operator attention required), but the row is never deleted.
- If an event type has no mapping, it is left `PENDING` (not `FAILED`) and rechecked later — by design, to allow recording events before implementing consumers.
- The pattern is at-least-once delivery: a crash between successful BullMQ enqueue and marking PUBLISHED will cause re-publication; consumers MUST be idempotent. The code documents this explicitly.

Files to read for deeper detail:
- backend/src/infrastructure/outbox/outbox-publisher.service.ts
- backend/src/infrastructure/outbox/event-queue-map.ts
- backend/src/infrastructure/outbox/outbox-publisher.constants.ts

Notes about event sizes and payloads:
- OutboxEvent.payload is Prisma `Json` and stored as an opaque JSON blob. Consumers rehydrate types from the message body. Be mindful of payload size — large payloads in DB can increase Postgres load and replication costs.

---

## Queueing (BullMQ) and `QueueService` details

Adapter responsibilities:
- `QueueService` is the only place that talks to BullMQ for enqueuing jobs (keeps business layers independent of queue library). See backend/src/infrastructure/queue/queue.service.ts.
- When enqueueing domain events, the job id is set to the outbox event id (`jobId: eventId`). That provides a queue-level idempotency layer: adding a job with the same id is a no-op if the job still exists in the queue.
- The enqueue options include `attempts`, `backoff`, and `removeOnComplete`/`removeOnFail` configuration.

Delayed / scheduled jobs:
- `scheduleDelayed()` is exposed for deadlines (auction deadlines). It is not part of the outbox pattern and is best-effort: if Redis is unavailable the method times out, logs a warning, and the system relies on a periodic sweeper (`AuctionDeadlineSweeperService`) as a reconciliation/backstop.

Consumer base:
- `DomainEventConsumer` (backend/src/infrastructure/queue/domain-event.consumer.ts) is the base class for consumers. It restores the correlation id from job payload and records metrics. Concrete consumers implement `handleEvent(job)`.

---

## Idempotency — two different but related problems

There are two idempotency concerns here; both are implemented but serve different threat models:

1) API/client idempotency (client retries) — `Idempotency-Key` header
- Purpose: avoid a user re-submitting a command (checkout, place bid) twice when they retry after a client timeout. This is opt-in per route via `@UseInterceptors(IdempotencyInterceptor)`.
- Implementation:
  - `IdempotencyInterceptor` reads the `Idempotency-Key` header, computes a request hash, and calls `IdempotencyKeyService.begin(key, userId, requestHash)`.
  - `IdempotencyKeyService.begin()` inserts a row with status PROCESSING; unique constraint on `(key,userId)` makes concurrent inserts safe — DB chooses the winner, others get a handled error. If a prior completed result exists the stored response is replayed.
  - On success, the application runs the command and then calls `IdempotencyKeyService.complete()` to save response status/body.
  - On error the interceptor calls `IdempotencyKeyService.release()` to delete the PROCESSING marker so retries are possible.
  - Key DB model: `IdempotencyKey` in backend/prisma/schema.prisma.

  - Wired routes: e.g., `POST /orders/checkout` and `POST /auctions/:id/bids` use the interceptor.

Risks / notes:
- The stored `responseBody` may contain PII or large payloads; consider trimming or limiting stored size or obfuscating sensitive fields.
- The interceptor requires authentication (userId is mandatory) — anonymous idempotency is intentionally not supported.

2) Event-consumer idempotency (worker duplicate delivery) — `ProcessedEvent` / EventIdempotencyService
- Purpose: consumers may receive the same outbox event more than once (publisher republish or BullMQ redelivery). The consumer must ensure side-effects (like creating a refund row, ledger entries, sending notifications) happen at most once.
- Implementation:
  - `EventIdempotencyService.run(consumerName, eventId, work)` performs a single transaction: it inserts a `ProcessedEvent` row (unique constraint on `(eventId, consumerName)`) and runs `work(tx)` in the same transaction. If another worker tries the same pair, its insert will fail with unique-violation and `run()` returns `'skipped'` and does not run `work`.
  - This ensures atomicity: marker + side effects committed together.
  - Prisma model: `ProcessedEvent` in backend/prisma/schema.prisma.

Examples:
- Refund saga: `RefundConsumer` wraps `openCancellationRefund()` with `eventIdempotency.run(...)` so opening the refund is atomic with the ProcessedEvent marker. If the handler dies later, `ProcessedEvent` is rolled back and a future delivery can try again.

---

## Refund saga (step-by-step)

Where: backend/src/modules/payments-ledger/consumers/refund.consumer.ts and backend/src/modules/payments-ledger/payments-ledger.service.ts

High-level flow:
1. OrdersModule writes `SellerOrderStatusChanged` -> outbox -> `QueueName.PAYMENTS` (event recorded transactionally when seller order is cancelled).
2. `RefundConsumer` receives the event (BullMQ job). It filters cancellations and performs a three-step saga:
   - Step 1 (atomic with ProcessedEvent): create/open a `Refund` row in DB with `status = REQUESTED` (if one already exists, reuse). This is run inside `EventIdempotencyService.run` so the processed marker and refund creation are atomic.
   - Step 2 (outside any DB tx): call the payment gateway (here a `MockPaymentGatewayService.refund(...)`) using the refund id as the idempotency key for the provider. This network call is intentionally outside a DB transaction.
   - Step 3: if the gateway accepted, call `PaymentsLedgerService.settleRefund()` inside a DB transaction to transition the `Refund` to `PROCESSED` and record an OutboxEvent `RefundProcessed`; if retries exhausted or the gateway rejects, call `failRefund()` to mark `FAILED` and emit `RefundFailed`.

Why this structure:
- The gateway call cannot be inside the DB transaction (it is an external network hop). Doing so would risk moving money and then rolling back the DB (or keeping tx open until the gateway responds). Splitting the saga into separate commits with a unique marker and guarded transitions is the established safe approach.

Gateway behavior:
- `MockPaymentGatewayService` simulates provider idempotency by storing processed idempotency keys and returning the prior `gatewayRef` for a replayed idempotency key. See backend/src/modules/payments-ledger/infrastructure/mock-payment-gateway.service.ts.

Observability & retry:
- BullMQ retry/backoff handles repeated attempts at the gateway step. On a final failure the saga marks the refund `FAILED` and logs/escalates — no automatic money-movement rollback is possible.

---

## Rollbacks and compensation logic

- Domain changes that share the same DB (stock holds/releases, ledger entries, sellerOrder status changes) are done inside single transactions so they can be rolled back together. Example: `OrdersService.checkout()` performs many writes in one transaction; any failure rolls them back.
  - See: backend/src/modules/orders/orders.service.ts

- Cancellation: the status transition that cancels a SellerOrder restores stock and writes reversing ledger entries in the same transaction (no partially-applied ledger or stock change). See `restoreStockAndReverseLedger()` in `OrdersService`.

- External side-effects (movement of money) cannot be rolled back by DB transactions. They are handled via the refund saga described above: success is recorded in DB; failure produces a terminal `FAILED` state and human escalation.

---

## Reviews / rating feature (verification and mapping)

- Backend enforces the verified purchase rule: `ReviewsService.create()` checks that the order item exists, the caller is the buyer, the related `SellerOrder` status is `COMPLETED`, and a unique constraint prevents duplicate reviews per `orderItemId`.
  - backend/src/modules/reviews/reviews.service.ts
  - Prisma model: `Review` in backend/prisma/schema.prisma
- Frontend has review-related entities and UI hooks: `frontend/src/entities/review/*` and the product list has a `minRating` filter in `frontend/src/widgets/search-filters/ui/search-filters-bar.tsx`.

Conclusion for task3 item #1: contrary to the checklist text in the prompt, the repository contains a `reviews` module that enforces "confirmed purchase" (COMPLETED), and the frontend contains review components and API calls. So the feature exists and is implemented by these files.

---

## The task3 checklist you supplied — review and status

I reproduced your text where relevant and added status notes.

### 1. Рейтинг товару на основі підтверджених відгуків — відсутнє
- Status: IMPLEMENTED. See `backend/src/modules/reviews/reviews.service.ts` and `prisma/schema.prisma` (Review model). The service requires `SellerOrderStatus.COMPLETED` before accepting a review.

### 2. Storybook — відсутній
- Status: MISSING. I could not find Storybook config, stories, or `storybook` npm scripts in `frontend/package.json`. If you want, I can add a minimal Storybook setup for key UI components.

### 3. Часткове повернення на рівні товару — не реалізовано
- Status: PARTIAL / NOT IMPLEMENTED. The system supports cancelling a full `SellerOrder` and running a refund for that SellerOrder. There is no API or ledger logic that performs a partial refund for a single OrderItem within an active SellerOrder. Doing partial refund would require changes to domain model (refunds tied to orderItem) and ledger computations.

### 4. Юніт-тести на ключову бізнес-логіку — не підтверджено
- Status: PARTIAL. The repository contains many e2e and unit tests (e.g. bidding concurrency, checkout e2e), but the checklist points to specific unit-tests for stock decrement on checkout, commission calculation, accept/reject bid logic, and parent Order status aggregation. Search for tests in `backend/test` and module `*.spec.ts` files; if you want, I can enumerate missing unit tests and add templates.

### 5. Міграції "з нуля" в CI — noted gap
- Status: RECOGNIZED/KNOWN. The project documents using `prisma db push` in e2e CI rather than `prisma migrate deploy` due to squashed migrations missing `CREATE TYPE`. This is a repository-level migration workflow decision that can cause CI to not fully verify migrations from a blank DB. See `backend/README.md` and `prisma/migrations` notes.

Priority guidance (as requested):
1. Reviews — already present (so no action required unless you want enhancements).
2. Storybook — quick win; I can scaffold if you approve.
3. Unit tests for critical logic — add targeted tests next.
4. Partial refunds per item — medium/high effort, requires domain changes.
5. CI migrations — document and, if desired, fix migrations instead of `db push`.

Why the migration issue happened (short explanation):
- When migrations are squashed (to reduce many small migrations into one), subtle SQL constructs like custom enum `CREATE TYPE` statements may be lost in the squashed artifact or ordering, which makes `prisma migrate deploy` from zero produce a different schema than applying the historical migrations. The team chose `prisma db push` in CI as a pragmatic workaround; that avoids the migrate/deploy requirement but does not prove the migration history can be replayed from zero in CI. If you require full verification of migrations from a blank database, the safest fix is to un-squash or rework the migration history so that `prisma migrate deploy` reproduces the production schema (or add an automated job that runs a schema-diff check between `migrate deploy` and `db push` as a CI guard).

---

## Edge cases, potential vulnerabilities, and hardening suggestions

- Duplicate delivery / at-least-once: the system assumes consumers are idempotent by design. This is correctly implemented via `ProcessedEvent` in critical consumers (e.g., `RefundConsumer`). Review other consumers to ensure each one uses `EventIdempotencyService` where side-effects are not pure/readonly.

- Crash between enqueue and marking PUBLISHED: handled by the at-least-once design. Consumers must be idempotent. The system uses `jobId = eventId` in BullMQ which also helps.

- Long-running consumer work: if a consumer performs long external work without checkpoints the worker could get killed and the processed marker might be rolled back (good), but partial external side-effects might still occur. Design handlers to make external calls idempotent (e.g., provider idempotency keys) and/or to persist external-progress markers.

- Idempotency-Key storage size / sensitive data: `IdempotencyKey.responseBody` stores the entire response. Consider limiting size, redacting sensitive fields, or storing a reference to an external store if responses can be large.

- Reused Idempotency-Key with different request body: the system guards this with a `requestHash` check and rejects with 409. Good. Ensure clients use unpredictable keys (UUIDs) and rotate appropriately.

- Outbox payload growth: Outbox rows hold payload JSON. A stream of large events could bloat Postgres WAL and cause replication pressure; consider a max payload size or compressing large payloads and storing minimal fields needed for consumers.

- Backpressure on queues: if a particular consumer's queue is slow, the outbox publisher still enqueues to multiple queues; enqueue is awaited for all mapped queues per event. That means slow queues can cause backpressure to the publisher loop. This is a deliberate design choice (publisher marks PUBLISHED only when every mapped queue accepted the job). It is fine for small scale, but if you expect high throughput and divergent fan-out, consider making fan-out independent with per-queue status tracking.

- FAILED outbox rows: the publisher marks a row FAILED after MAX_ATTEMPTS. There is no automatic alerting in code — ensure your operator tooling/alerts surface these rows (e.g., Prometheus alert when `outbox_events_failed_total` increases).

- Permissions & IDOR concerns: controllers frequently say they return 404 rather than 403 to avoid existence probing (good). However, ensure any future endpoints follow the same rule consistently.

---

## Mapping: main features → key files (quick reference)

- Orders / Checkout / SellerOrder lifecycle:
  - backend/src/modules/orders/orders.service.ts
  - backend/src/modules/orders/orders.controller.ts
  - backend/src/modules/orders/domain/* (repositories and DTOs)

- Outbox & async processing:
  - backend/src/infrastructure/outbox/outbox.service.ts
  - backend/src/infrastructure/outbox/outbox-publisher.service.ts
  - backend/src/infrastructure/outbox/event-queue-map.ts

- Queueing (BullMQ adapter):
  - backend/src/infrastructure/queue/queue.service.ts
  - backend/src/infrastructure/queue/domain-event.consumer.ts

- Idempotency:
  - backend/src/infrastructure/idempotency/idempotency.interceptor.ts
  - backend/src/infrastructure/idempotency/idempotency-key.service.ts
  - backend/src/infrastructure/idempotency/event-idempotency.service.ts

- Refund saga / payments ledger:
  - backend/src/modules/payments-ledger/consumers/refund.consumer.ts
  - backend/src/modules/payments-ledger/payments-ledger.service.ts
  - backend/src/modules/payments-ledger/infrastructure/mock-payment-gateway.service.ts

- Reviews:
  - backend/src/modules/reviews/reviews.service.ts
  - backend/src/modules/reviews/*
  - frontend/src/entities/review/*

---

## Recommended next steps (practical, prioritized)

1. Add Storybook (if required by spec): scaffold a minimal Storybook for core components. I can create a PR that adds config + a few stories.
2. Add unit tests that the spec mentions (stock decrement on checkout, commission calc, bid acceptance/optimistic locking, order aggregation). I can generate test templates.
3. Audit consumers for `EventIdempotencyService` usage: ensure any consumer that performs non-idempotent external side-effects uses the guard.
4. Add monitoring/alerting for outbox FAILED rows and failed refunds.
5. Consider limiting stored `responseBody` size or redaction for `IdempotencyKey` entries.

---

## If you want me to continue

If you want, I can now:
- run a quick scan that enumerates any consumers that DO NOT call `EventIdempotencyService` (to check idempotency coverage),
- or scaffold Storybook,
- or generate the missing unit test templates mentioned above.

Tell me which of the above you'd like next and I'll proceed.

---

## Concrete examples (excerpts) — how pieces are used in practice

- Outbox write inside a transaction (pattern used across services):

```ts
// inside a Prisma transaction in a service method
await prisma.$transaction(async (tx) => {
  // domain write
  const sellerOrder = await tx.sellerOrder.create({ data: { /* ... */ } });

  // record outbox event atomically with the same tx
  await outboxService.record(tx, {
    aggregateType: 'SellerOrder',
    aggregateId: sellerOrder.id,
    eventType: 'SellerOrderCreated',
    payload: { sellerOrderId: sellerOrder.id },
    correlationId,
  });
});
```

- Event-consumer idempotency wrapper (how `EventIdempotencyService` is consumed):

```ts
await eventIdempotency.run('refund', eventId, async (tx) => {
  // This block runs at most once per (eventId, consumerName).
  // Any writes here are atomic with the ProcessedEvent marker.
  await paymentsLedgerService.openCancellationRefund(tx, { sellerOrderId, amount });
});
```

- API idempotency usage (controller-level):

```ts
@UseInterceptors(IdempotencyInterceptor)
@Post('checkout')
checkout(@CurrentUser() user: User) {
  return ordersService.checkout(user.id);
}
```

- Gateway call idempotency (what the mock simulates):

```ts
// provider.refund({ idempotencyKey: refundId, amount, reference: refundId })
// Provider returns the same gatewayRef when the same idempotencyKey is retried.
```

---

## Practical improvements & best practices (recommended)

- Monitor and alert on outbox failures: add Prometheus alerts for FAILED OutboxEvent rows and for Refunds that reach `FAILED` status. Provide an operator dashboard.
- Limit stored response size for `IdempotencyKey.responseBody` (truncate or hash large responses) and redact sensitive fields. Alternatively store large responses in a secure object store and reference them.
- Add per-queue health checks and backpressure metrics. If a queue lags, surface which consumer is slow and which downstream system (e.g., Email) is the bottleneck.
- Add an operator-run reconciliation job that scans `Refund` rows in `REQUESTED` state for longer-than-expected durations and triggers a reconciliation (replay gateway call or notify ops).
- Ensure all consumers that perform non-idempotent external actions use `EventIdempotencyService.run(...)`. Add an automated reviewer script that flags consumers missing this pattern.
- Consider limiting OutboxEvent payload size or moving large payload parts to an external store. Large JSON blobs in the DB can increase WAL and backup costs.
- Introduce circuit breakers and bounded timeouts around external calls (gateway.refund) to avoid blocking worker threads and to allow graceful fallback/metrics.
- Secure webhooks: if you add payment-provider webhooks, verify signatures and rate-limit them. Treat webhooks as an external source of truth for finality, but validate with stored gatewayRef before applying state transitions.
- Add an operator UI for handling `Refund.failed` cases with context (attempts, failureReason, gateway logs) to reduce manual work.

---

## How the saga would differ with a real payment provider (example: Payoneer/Stripe/Adyen)

Key differences and additional concerns when swapping `MockPaymentGatewayService` for a real provider:

- Provider idempotency: most real providers accept an idempotency key — always send your generated refund id as the provider idempotency key. This allows safe replay of refund calls if your handler is redelivered.

- Asynchronous finality & webhooks: many providers do not synchronously return final settlement. They may accept a refund request and later send a webhook for `refund.succeeded` or `refund.failed`. Your saga must support driving state transitions from both the original caller (if it gets a synchronous success) and from webhook callbacks.

- Possible flows to support:
  1. Synchronous success: provider returns `succeeded` and a gatewayRef. Transition REFUND -> PROCESSED and emit `RefundProcessed`.
  2. Synchronous decline: provider immediately rejects; on final retry mark REFUND -> FAILED and emit `RefundFailed`.
  3. Accepted-but-pending: provider returns an `accepted`/`pending` status and later posts a webhook for final success/failure. In this case store provider's intermediate status and rely on the webhook to finalize the DB row.
  4. Webhook arrives but your DB transition was lost: webhooks must be idempotent and reconciled against stored `gatewayRef` or `refundId` — verify idempotency and only transition if current state is REQUESTED or pending.

- Example handler changes (high-level):
  - When calling the provider, record the `providerRequestId` (gatewayRef) and the provider-returned status.
  - If the provider returns `pending`, do NOT mark REFUND PROCESSED; instead persist `providerRequestId` and wait for webhook. Optionally schedule a reconciliation job.
  - Implement webhook endpoint that verifies signature, looks up the refund by `providerRequestId` or `refundId`, and then transitions `REQUESTED -> PROCESSED` or `REQUESTED -> FAILED`.

- Example webhook reconciliation sketch:

```ts
// webhook controller
async handleRefundWebhook(body) {
  const { providerRequestId, status } = body;
  const refund = await refundsRepo.findByGatewayRef(providerRequestId);
  if (!refund) return 404;
  if (refund.status !== 'REQUESTED') return 200; // idempotent: already settled
  if (status === 'succeeded') {
    await paymentsLedgerService.settleRefund(refund.id, { gatewayRef: providerRequestId, attempts: currentAttempt, buyerId: refund.buyerId });
  } else if (status === 'failed') {
    await paymentsLedgerService.failRefund(refund.id, { failureReason: 'provider failed', attempts: currentAttempt, buyerId: refund.buyerId });
  }
}
```

- Race and duplicate-scenarios to handle:
  - Your app calls provider and receives a success, but crashes before committing DB: provider may have executed the refund. On restart the consumer may re-run the gateway call; provider idempotency key prevents double refunds, and provider returns the same gatewayRef which you can persist when the DB transaction completes.
  - Provider processes refund, but webhook delivery fails: reconciliation job must poll provider or rely on provider dashboard/web UI to resolve; avoid assuming webhook delivered.
  - Provider reports refund succeeded but your DB update failed: reconciliation must detect this and set DB state to PROCESSED (ideally by matching providerRequestId).

- Partial refunds and per-item refunds with real provider:
  - To support refund per item, extend Refund model to reference `orderItemId` (or add `RefundItem` rows), and calculate the correct amount per item.
  - You must coordinate ledger entries to reflect partial refund amounts and commission adjustments. Ensure amounts sum correctly and that `Refund` uniqueness or guarded transitions prevent double-refunding the same orderItem.

- Operational & compliance concerns:
  - PCI scope: storing card details or creating charges may introduce PCI requirements. Use provider tokenization (no raw card data in DB).
  - Currency/rounding: be careful with decimal rounding — store minor units (cents) or use fixed-decimal types consistently.
  - Provider limits & idempotency window: providers often expire idempotency keys after a limited window; design reconciliation for keys older than that window.

---

## Minimal operator playbook for refund failures with a real provider

1. Alert fires for `Refund` in `FAILED` state or `OutboxEvent` FAILED.
2. Operator UI shows refund details: attempts, failureReason, gateway logs, buyer id, sellerOrder id.
3. Operator can attempt manual retry (re-run refund via provider dashboard or trigger a replay job) or mark resolved by issuing alternative settlement.
4. Record manual actions in the ledger/audit trail.

---

If you'd like, I can now:
- enumerate consumers that aren't wrapped by `EventIdempotencyService`, or
- scaffold webhook handler + reconciliation job example for a chosen provider (Stripe/Adyen), or
- implement the operator reconciliation job and a small admin UI mock.

Which of these should I do next?

---
name: observability
description: How this repo does structured logging, correlation-ID propagation across HTTP/outbox/queue/worker hops, Prometheus metrics, and the local Grafana + Loki + Promtail stack. Use when adding a log line or metric, debugging a traced operation, or changing the observability wiring.
---

# Observability

Two signals, one join key. Logs answer "what happened in this one
operation", metrics answer "what is happening in aggregate", and
`correlationId` is what lets you jump from the second to the first.

## Structured logging

`core/logging/app-logger.service.ts` is installed as Nest's global
logger (`app.useLogger()` in `main.ts`), so **every** `new Logger(X)`
call in the codebase — and Nest's own framework logs — comes out as
newline-delimited JSON with no change at the call site.

Write logs as an **object**, not an interpolated string:

```ts
this.logger.log({
  event: 'checkout.completed',   // required: stable, machine-queryable
  userId: buyerId,               // when the caller is authenticated
  entityType: 'Order',           // what the line is about
  entityId: order.id,
  sellerOrderCount: 3,           // any extra context, passed through
});
```

- **`event` is a stable identifier**, dot-namespaced (`domain.thing_happened`).
  Dashboards and Loki queries key on it; message text may be reworded
  freely, `event` may not.
- **Never pass `correlationId` yourself.** `AppLogger` reads it from
  `CorrelationIdService`'s AsyncLocalStorage at write time. The only
  exception is a BullMQ `@OnWorkerEvent` handler, which fires outside
  the job's context — there, read it off `job.data`.
- **Pass errors raw** (`error: err`), not pre-serialized. `AppLogger`
  turns them into `{ name, message, stack }`. `serializeError` is
  idempotent as a safety net, but double-serializing is still a smell.
- Levels: `error` = the system is broken; `warn` = a rule fired or a
  retry is expected; `log`/`info` = normal. A 4xx is a `warn`, a 5xx is
  an `error` — don't page someone because a cart was empty.
- Output goes to stdout AND to `LOG_FILE` (default `backend/logs/app.log`)
  for Promtail. Tests force `LOG_FILE=''` (see `test/jest-e2e-setup.ts`)
  so a test run never appends to the stream you're watching in Grafana.

## Correlation ID propagation

The requirement is that ONE operation is traceable across every hop, and
that **no hop invents a new id**:

```
HTTP request  ── X-Correlation-ID header, or a generated UUID
    │            (CorrelationIdMiddleware; echoed back on the response)
    ▼          stored in AsyncLocalStorage — no threading through signatures
service        every log line inside the request picks it up automatically
    │
    ▼          OutboxService.record(tx, { correlationId }) — same transaction
OutboxEvent row
    │          OutboxPublisherService relays each row INSIDE that row's own
    ▼          correlation context, so the DB→queue hop isn't a gap
BullMQ job     DomainEventJob.correlationId
    │
    ▼          DomainEventConsumer re-enters the context before the handler
worker/handler  runs — ALS does NOT survive a hop through Redis
```

- **`DomainEventConsumer`** (`infrastructure/queue/domain-event.consumer.ts`)
  is the base class for every outbox-driven consumer. Subclasses
  implement `handleEvent()`, never `process()`. It re-establishes the
  correlation context and records the queue-job metric.
- **Self-initiated work mints its own id, once.** `AuctionDeadlineConsumer`
  and `AuctionDeadlineSweeperService` fire because wall-clock time
  passed, not because anyone asked — reviving the id of the request that
  created the auction days earlier would splice two unrelated operations
  into one trace. They generate one id at the boundary and let it flow
  through everything downstream, including outbox events they record.
- Anything reading `correlationIdService.getId() ?? randomUUID()` is
  inheriting when it can and minting only as a fallback. Never mint
  unconditionally inside a request or job.

## Metrics

`infrastructure/metrics/metrics.service.ts` owns **its own `Registry`**
(not prom-client's global default) — e2e tests boot several Nest apps in
one process, and a shared registry would throw on duplicate
registration. `GET /metrics` is `@Public()` because Prometheus scrapes
unauthenticated; it exposes only aggregate counters, never per-user data.

Add a metric by adding a field and a `record*` method there — never by
touching prom-client from a business service.

**Two rules that matter more than the rest:**

1. **Labels must be low-cardinality.** Route labels are the route
   *pattern* (`/orders/:id`), never the concrete URL. Never label by
   user id, order id, or correlation id.
2. **Record business metrics AFTER the transaction commits**, never
   inside it. A rolled-back checkout reserved no stock and placed no
   order; counting at the point of the write would permanently overstate
   both. `OrdersService.checkout` carries the unit counts out of the
   transaction and records them once it has returned — that also avoids
   re-querying.

Checkout distinguishes `rejected` (a business rule fired — normal) from
`failed` (unexpected), so an alert on "checkout is broken" doesn't fire
every time someone races another customer to the last unit.

## Local stack (Grafana + Loki + Promtail + Prometheus)

`docker compose up -d` brings up the whole thing alongside Redis and
Meilisearch. Configs live in `observability/`; Grafana is provisioned
with both datasources and an overview dashboard, so there is no UI
setup.

- Grafana: http://localhost:3001 (anonymous admin — local only)
- Prometheus scrapes `host.docker.internal:3000/metrics`; the **backend
  runs on the host**, not in the stack (same reasoning as PostgreSQL —
  hot reload against a remote DB), so the port is a literal in
  `observability/prometheus/prometheus.yml` and must be changed there if
  `PORT` changes.
- Promtail tails `backend/logs/*.log` read-only. It labels by `level`,
  `event`, and `context` only — **`correlationId` is deliberately NOT a
  Loki label**, because it is unique per request and would create one
  stream per request, destroying the index. It stays in the line, where
  `| json | correlationId = "..."` filters on it perfectly well.

To trace one operation: grab the `X-Correlation-ID` from the response
header, paste it into the dashboard's Correlation ID variable, and every
line from HTTP handler through outbox relay, worker, and event handler
appears in order.

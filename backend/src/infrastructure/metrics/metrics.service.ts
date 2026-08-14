import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

// Buckets tuned for an API that talks to a REMOTE Postgres: the
// interesting range starts around 50ms, not 1ms, and the tail matters
// because checkout holds a transaction open.
const HTTP_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const JOB_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60];

export type CheckoutResult = 'success' | 'rejected' | 'failed';
export type BidResult = 'accepted' | 'rejected' | 'conflict';
export type JobResult = 'completed' | 'failed';

// Owns its OWN Registry rather than prom-client's global default. Two
// reasons: e2e tests boot several Nest apps in one process, and a shared
// global registry would throw on duplicate metric registration the
// second time; and it keeps /metrics output limited to what this app
// actually declares.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // ---------- HTTP ----------
  private readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, by route and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: HTTP_BUCKETS,
    registers: [this.registry],
  });

  // Separate from http_requests_total{status_code=~"5.."} on purpose:
  // this one carries the exception class, which is what actually tells
  // you WHAT broke rather than just that something did.
  private readonly httpErrors = new Counter({
    name: 'http_errors_total',
    help: 'HTTP requests that ended in an error response',
    labelNames: ['method', 'route', 'status_code', 'error_type'] as const,
    registers: [this.registry],
  });

  // ---------- Checkout ----------
  private readonly checkouts = new Counter({
    name: 'marketplace_checkout_attempts_total',
    help: 'Checkout attempts by outcome (success, rejected by a business rule, failed unexpectedly)',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  private readonly checkoutDuration = new Histogram({
    name: 'marketplace_checkout_duration_seconds',
    help: 'Duration of the whole multi-vendor checkout transaction',
    buckets: HTTP_BUCKETS,
    registers: [this.registry],
  });

  private readonly ordersPlaced = new Counter({
    name: 'marketplace_orders_placed_total',
    help: 'Parent orders successfully created',
    registers: [this.registry],
  });

  private readonly sellerOrdersCreated = new Counter({
    name: 'marketplace_seller_orders_created_total',
    help: 'SellerOrders created (one per seller per order) — the multi-vendor fan-out',
    registers: [this.registry],
  });

  private readonly orderValue = new Counter({
    name: 'marketplace_order_value_total',
    help: 'Cumulative gross value of placed orders, in currency units',
    registers: [this.registry],
  });

  // ---------- Inventory ----------
  private readonly inventoryUnits = new Counter({
    name: 'marketplace_inventory_units_total',
    help: 'Units moved through inventory, by direction (reserved at checkout, restored on cancellation)',
    labelNames: ['direction'] as const,
    registers: [this.registry],
  });

  // ---------- Bidding ----------
  private readonly bids = new Counter({
    name: 'marketplace_bids_total',
    help: 'Bid attempts by outcome; "conflict" means optimistic-locking retries were exhausted',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  // Directly measures whether the optimistic-locking strategy is holding
  // up under contention — a rising rate here is the signal to reconsider
  // it, and there is no other way to observe it from outside.
  private readonly bidRetries = new Counter({
    name: 'marketplace_bid_version_conflicts_total',
    help: 'Optimistic-locking collisions on Auction.version that forced a bid retry',
    registers: [this.registry],
  });

  private readonly auctionsEnded = new Counter({
    name: 'marketplace_auctions_ended_total',
    help: 'Auctions that reached their deadline, by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  // ---------- Queue / outbox ----------
  private readonly queueJobs = new Counter({
    name: 'queue_jobs_total',
    help: 'BullMQ jobs processed, by queue and outcome',
    labelNames: ['queue', 'result'] as const,
    registers: [this.registry],
  });

  private readonly queueJobDuration = new Histogram({
    name: 'queue_job_duration_seconds',
    help: 'BullMQ job handler duration in seconds',
    labelNames: ['queue'] as const,
    buckets: JOB_BUCKETS,
    registers: [this.registry],
  });

  private readonly outboxPublished = new Counter({
    name: 'outbox_events_published_total',
    help: 'Outbox events successfully relayed onto a queue',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });

  private readonly outboxFailures = new Counter({
    name: 'outbox_publish_failures_total',
    help: 'Outbox relay attempts that failed (Redis unreachable, etc.)',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });

  // ---------- WebSocket ----------
  private readonly wsConnections = new Gauge({
    name: 'websocket_connections_current',
    help: 'Currently open Socket.IO connections',
    registers: [this.registry],
  });

  private readonly wsSubscriptions = new Counter({
    name: 'websocket_subscriptions_total',
    help: 'Room subscription attempts, by room type and outcome',
    labelNames: ['room_type', 'result'] as const,
    registers: [this.registry],
  });

  private readonly wsBroadcasts = new Counter({
    name: 'websocket_broadcasts_total',
    help: 'Messages broadcast to rooms, by event name',
    labelNames: ['event'] as const,
    registers: [this.registry],
  });

  constructor() {
    // Process/heap/GC/event-loop-lag, on this registry only.
    collectDefaultMetrics({ register: this.registry });
  }

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  recordHttpError(
    method: string,
    route: string,
    statusCode: number,
    errorType: string,
  ): void {
    this.httpErrors.inc({
      method,
      route,
      status_code: String(statusCode),
      error_type: errorType,
    });
  }

  recordCheckout(result: CheckoutResult, durationSeconds: number): void {
    this.checkouts.inc({ result });
    this.checkoutDuration.observe(durationSeconds);
  }

  recordOrderPlaced(sellerOrderCount: number, totalAmount: number): void {
    this.ordersPlaced.inc();
    this.sellerOrdersCreated.inc(sellerOrderCount);
    this.orderValue.inc(totalAmount);
  }

  recordInventoryMovement(
    direction: 'reserved' | 'committed' | 'released',
    units: number,
  ): void {
    this.inventoryUnits.inc({ direction }, units);
  }

  recordBid(result: BidResult): void {
    this.bids.inc({ result });
  }

  recordBidVersionConflict(): void {
    this.bidRetries.inc();
  }

  recordAuctionEnded(outcome: 'with_winner' | 'no_bids'): void {
    this.auctionsEnded.inc({ outcome });
  }

  recordQueueJob(
    queue: string,
    result: JobResult,
    durationSeconds: number,
  ): void {
    this.queueJobs.inc({ queue, result });
    this.queueJobDuration.observe({ queue }, durationSeconds);
  }

  recordOutboxPublished(eventType: string): void {
    this.outboxPublished.inc({ event_type: eventType });
  }

  recordOutboxFailure(eventType: string): void {
    this.outboxFailures.inc({ event_type: eventType });
  }

  recordWebsocketConnection(delta: 1 | -1): void {
    this.wsConnections.inc(delta);
  }

  recordWebsocketSubscription(
    roomType: string,
    result: 'allowed' | 'denied',
  ): void {
    this.wsSubscriptions.inc({ room_type: roomType, result });
  }

  recordWebsocketBroadcast(event: string): void {
    this.wsBroadcasts.inc({ event });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

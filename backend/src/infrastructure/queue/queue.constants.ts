// Logical processing lanes — one BullMQ queue per domain area, so a slow
// or backed-up consumer (e.g. notifications) never head-of-line-blocks
// an unrelated one (e.g. search sync). The Outbox Publisher routes each
// OutboxEvent to one of these by event type (see event-queue-map.ts).
// Every queue except ANALYTICS has a consumer wired up; ANALYTICS exists
// so a future consumer has a queue to register against without
// re-plumbing this module. Do not add a consumer here without also
// adding it to the backend-architecture skill's event list.
export enum QueueName {
  SEARCH_SYNC = 'search-sync',
  ORDER_PROCESSING = 'order-processing',
  NOTIFICATIONS = 'notifications',
  ANALYTICS = 'analytics',
  AUCTION_DEADLINES = 'auction-deadlines',
  EMAIL = 'email',
  // The refund saga's lane (see RefundConsumer). Its own queue because
  // it's the one consumer that talks to an external payment provider:
  // it retries on a much slower cadence than an in-process handler and
  // must never hold up an order's status broadcast behind a gateway
  // outage.
  PAYMENTS = 'payments',
  // WebSocket fan-out. Deliberately its own lane: a broadcast is only
  // useful while it's fresh, so it must never queue behind a slow
  // search-sync or notification backlog.
  REALTIME = 'realtime',
}

export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QueueName);

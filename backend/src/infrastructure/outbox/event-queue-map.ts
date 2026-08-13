import { QueueName } from '../queue/queue.constants';
import { PRODUCT_CREATED_EVENT } from '../../modules/products/domain/events/product-created.event';
import { PRODUCT_UPDATED_EVENT } from '../../modules/products/domain/events/product-updated.event';
import { PRODUCT_ARCHIVED_EVENT } from '../../modules/products/domain/events/product-archived.event';
import { SELLER_ORDER_CREATED_EVENT } from '../../modules/orders/domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../modules/orders/domain/events/seller-order-status-changed.event';
import { INVENTORY_UPDATED_EVENT } from '../../modules/products/domain/events/inventory-updated.event';
import { BID_PLACED_EVENT } from '../../modules/bidding/domain/events/bid-placed.event';
import { AUCTION_ENDED_EVENT } from '../../modules/bidding/domain/events/auction-ended.event';

// Routes an OutboxEvent.eventType to the BullMQ queue(s) that should
// carry it — the one place that needs to know about every domain event
// type in the system. A value can be a single QueueName or an array,
// for events that fan out to more than one independent consumer (e.g.
// SellerOrderCreated: order-processing advances its status, notifications
// tells the seller — two unrelated reactions to the same fact, each its
// own queue so one backing up never blocks the other). The publisher
// marks the row PUBLISHED only once EVERY mapped queue's enqueue has
// succeeded.
//
// Extend this map (not the publisher itself) when a new producer starts
// recording outbox events for inventory/auction/analytics events; add
// the matching queue in infrastructure/queue/queue.constants.ts first if
// needed.
export const EVENT_QUEUE_MAP: Record<string, QueueName | QueueName[]> = {
  [PRODUCT_CREATED_EVENT]: QueueName.SEARCH_SYNC,
  [PRODUCT_UPDATED_EVENT]: QueueName.SEARCH_SYNC,
  [PRODUCT_ARCHIVED_EVENT]: QueueName.SEARCH_SYNC,
  [SELLER_ORDER_CREATED_EVENT]: [
    QueueName.ORDER_PROCESSING,
    QueueName.NOTIFICATIONS,
  ],
  // The three real-time broadcasts (see
  // infrastructure/realtime/RealtimeConsumer). They route ONLY to
  // REALTIME: a WebSocket broadcast is a notification, never a state
  // change, so nothing else in the system reacts to these.
  [INVENTORY_UPDATED_EVENT]: QueueName.REALTIME,
  [BID_PLACED_EVENT]: QueueName.REALTIME,
  [AUCTION_ENDED_EVENT]: QueueName.REALTIME,
  [SELLER_ORDER_STATUS_CHANGED_EVENT]: QueueName.REALTIME,
};

export function resolveQueuesForEventType(eventType: string): QueueName[] {
  const mapped = EVENT_QUEUE_MAP[eventType];
  if (!mapped) {
    return [];
  }
  return Array.isArray(mapped) ? mapped : [mapped];
}

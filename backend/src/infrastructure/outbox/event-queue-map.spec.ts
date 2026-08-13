import { QueueName } from '../queue/queue.constants';
import { resolveQueuesForEventType } from './event-queue-map';
import { PRODUCT_CREATED_EVENT } from '../../modules/products/domain/events/product-created.event';
import { INVENTORY_UPDATED_EVENT } from '../../modules/products/domain/events/inventory-updated.event';
import { BID_PLACED_EVENT } from '../../modules/bidding/domain/events/bid-placed.event';
import { AUCTION_ENDED_EVENT } from '../../modules/bidding/domain/events/auction-ended.event';
import { SELLER_ORDER_CREATED_EVENT } from '../../modules/orders/domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../modules/orders/domain/events/seller-order-status-changed.event';

// This map is the link between "a service recorded an event" and "a
// consumer ever sees it". A missing entry is silent — the event just
// sits PENDING forever and the feature appears to do nothing — so the
// routing is asserted directly rather than inferred from the consumers.
describe('resolveQueuesForEventType', () => {
  it('routes every real-time event to the realtime queue', () => {
    expect(resolveQueuesForEventType(INVENTORY_UPDATED_EVENT)).toEqual([
      QueueName.REALTIME,
    ]);
    expect(resolveQueuesForEventType(BID_PLACED_EVENT)).toEqual([
      QueueName.REALTIME,
    ]);
    expect(resolveQueuesForEventType(AUCTION_ENDED_EVENT)).toEqual([
      QueueName.REALTIME,
    ]);
    expect(
      resolveQueuesForEventType(SELLER_ORDER_STATUS_CHANGED_EVENT),
    ).toEqual([QueueName.REALTIME]);
  });

  // A broadcast is a notification, never a state change — nothing else
  // may react to these, or a WebSocket concern would become a business
  // dependency.
  it('routes real-time events to no other queue', () => {
    for (const eventType of [
      INVENTORY_UPDATED_EVENT,
      BID_PLACED_EVENT,
      AUCTION_ENDED_EVENT,
      SELLER_ORDER_STATUS_CHANGED_EVENT,
    ]) {
      expect(resolveQueuesForEventType(eventType)).toHaveLength(1);
    }
  });

  it('still fans SellerOrderCreated out to its two independent consumers', () => {
    expect(resolveQueuesForEventType(SELLER_ORDER_CREATED_EVENT)).toEqual([
      QueueName.ORDER_PROCESSING,
      QueueName.NOTIFICATIONS,
    ]);
  });

  it('normalizes a single-queue mapping to an array', () => {
    expect(resolveQueuesForEventType(PRODUCT_CREATED_EVENT)).toEqual([
      QueueName.SEARCH_SYNC,
    ]);
  });

  // An unmapped type is left PENDING by the publisher rather than
  // FAILED — see outbox-publisher.service.spec.ts.
  it('returns no queues for an event type nothing consumes yet', () => {
    expect(resolveQueuesForEventType('NotRoutedYet')).toEqual([]);
  });
});

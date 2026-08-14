import { QueueName } from '../queue/queue.constants';
import { resolveQueuesForEventType } from './event-queue-map';
import { PRODUCT_CREATED_EVENT } from '../../modules/products/domain/events/product-created.event';
import { INVENTORY_UPDATED_EVENT } from '../../modules/products/domain/events/inventory-updated.event';
import { BID_PLACED_EVENT } from '../../modules/bidding/domain/events/bid-placed.event';
import { AUCTION_ENDED_EVENT } from '../../modules/bidding/domain/events/auction-ended.event';
import { SELLER_ORDER_CREATED_EVENT } from '../../modules/orders/domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../modules/orders/domain/events/seller-order-status-changed.event';
import { ORDER_PLACED_EVENT } from '../../modules/orders/domain/events/order-placed.event';
import { REFUND_PROCESSED_EVENT } from '../../modules/payments-ledger/domain/events/refund-processed.event';
import { REFUND_FAILED_EVENT } from '../../modules/payments-ledger/domain/events/refund-failed.event';

// This map is the link between "a service recorded an event" and "a
// consumer ever sees it". A missing entry is silent — the event just
// sits PENDING forever and the feature appears to do nothing — so the
// routing is asserted directly rather than inferred from the consumers.
describe('resolveQueuesForEventType', () => {
  // INVENTORY_UPDATED/BID_PLACED are pure broadcasts — nothing besides
  // the WebSocket layer may react to these, or a WebSocket concern would
  // become a business dependency.
  it('routes pure broadcast events to the realtime queue only', () => {
    expect(resolveQueuesForEventType(INVENTORY_UPDATED_EVENT)).toEqual([
      QueueName.REALTIME,
    ]);
    expect(resolveQueuesForEventType(BID_PLACED_EVENT)).toEqual([
      QueueName.REALTIME,
    ]);
  });

  // PAYMENTS is the refund saga's trigger — a cancellation that never
  // reaches it is a buyer who never gets their money back, so the
  // routing is asserted rather than assumed.
  it('fans SellerOrderStatusChanged out to realtime, email, notifications, and the refund saga', () => {
    expect(
      resolveQueuesForEventType(SELLER_ORDER_STATUS_CHANGED_EVENT),
    ).toEqual([
      QueueName.REALTIME,
      QueueName.EMAIL,
      QueueName.NOTIFICATIONS,
      QueueName.PAYMENTS,
    ]);
  });

  it('routes both refund saga outcomes to notifications', () => {
    expect(resolveQueuesForEventType(REFUND_PROCESSED_EVENT)).toEqual([
      QueueName.NOTIFICATIONS,
    ]);
    expect(resolveQueuesForEventType(REFUND_FAILED_EVENT)).toEqual([
      QueueName.NOTIFICATIONS,
    ]);
  });

  it('fans AuctionEnded out to realtime, email, and notifications (winner alert)', () => {
    expect(resolveQueuesForEventType(AUCTION_ENDED_EVENT)).toEqual([
      QueueName.REALTIME,
      QueueName.EMAIL,
      QueueName.NOTIFICATIONS,
    ]);
  });

  it('fans SellerOrderCreated out to its three independent consumers', () => {
    expect(resolveQueuesForEventType(SELLER_ORDER_CREATED_EVENT)).toEqual([
      QueueName.ORDER_PROCESSING,
      QueueName.NOTIFICATIONS,
      QueueName.EMAIL,
    ]);
  });

  it('routes OrderPlaced to its own email queue', () => {
    expect(resolveQueuesForEventType(ORDER_PLACED_EVENT)).toEqual([
      QueueName.EMAIL,
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

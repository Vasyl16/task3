import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryType,
  ProductStatus,
  ProductType,
  SellerOrderStatus,
  UserRole,
  type Order,
  type Prisma,
  type SellerOrder,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { CartService } from '../cart/cart.service';
import { ProductsService } from '../products/products.service';
import { SellersService } from '../sellers/sellers.service';
import { BiddingService } from '../bidding/bidding.service';
import { computeCommission } from './domain/commission';
import { aggregateOrderStatus } from './domain/order-status-aggregation';
import {
  canAdminForceCancel,
  isValidSellerOrderTransition,
} from './domain/order-status-transitions';
import {
  CheckoutSellerLineInput,
  OrdersRepository,
  OrderWithSellerOrderItems,
  OrderWithSellerOrders,
  SellerOrderWithOrderContext,
} from './domain/orders.repository';
import { ORDER_PLACED_EVENT } from './domain/events/order-placed.event';
import { SELLER_ORDER_CREATED_EVENT } from './domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from './domain/events/seller-order-status-changed.event';
import { toPageParams, type Paginated } from '../../core/pagination';
import { ListOrdersQuery } from './dto/list-orders.query';
import { UpdateSellerOrderStatusDto } from './dto/update-seller-order-status.dto';

interface CheckoutLine {
  productId: string;
  sellerId: string;
  quantity: number;
  unitPrice: number;
}

// Seconds elapsed since a process.hrtime.bigint() reading.
function elapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly cartService: CartService,
    private readonly productsService: ProductsService,
    private readonly sellersService: SellersService,
    private readonly biddingService: BiddingService,
    private readonly outboxService: OutboxService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly metrics: MetricsService,
    // Used only to open the transaction boundary below — every actual
    // read/write still goes through OrdersRepository/ProductsService/
    // CartService, keeping Prisma details out of the rest of this class.
    private readonly prisma: PrismaService,
  ) {}

  findByBuyerId(buyerId: string): Promise<OrderWithSellerOrderItems[]> {
    return this.ordersRepository.findByBuyerId(buyerId);
  }

  // Seller dashboard's "own SellerOrders" list. sellerId is resolved
  // from the caller's own approved profile, exactly like product/auction
  // creation — never accepted as a request param, so a seller cannot
  // browse another seller's orders by editing an id in the URL.
  async findMySellerOrders(
    callerId: string,
  ): Promise<SellerOrderWithOrderContext[]> {
    const sellerProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(callerId);
    return this.ordersRepository.findBySellerId(sellerProfile.id);
  }

  // Admin-only; @Roles(ADMIN) is enforced on AdminController.
  async listForAdmin(
    query: ListOrdersQuery,
  ): Promise<Paginated<OrderWithSellerOrderItems>> {
    const { skip, take, page, limit } = toPageParams(query);
    const { items, total } = await this.ordersRepository.findAllForAdmin({
      status: query.status,
      buyerId: query.buyerId,
      search: query.search,
      skip,
      take,
    });
    return { items, total, page, limit };
  }

  async findById(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<OrderWithSellerOrderItems> {
    const order = await this.ordersRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    if (caller.role !== UserRole.ADMIN && order.buyerId !== caller.id) {
      // 404, not 403 — don't confirm to a stranger that this order ID
      // exists at all.
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  // THE multi-vendor checkout transaction. Everything from "re-read
  // authoritative product state" through "clear the cart" happens inside
  // ONE Prisma $transaction — any failure at any step rolls back
  // everything before it: no partial stock decrement, no partial
  // SellerOrder/Order creation, no partial cart clearing. Idempotency
  // against a duplicate/retried request is handled one layer up, by
  // IdempotencyInterceptor on the controller route (see
  // OrdersController.checkout) — this method itself has no idea whether
  // it's being called for the first time or is a replay after that guard
  // already let it through once.
  async checkout(buyerId: string): Promise<OrderWithSellerOrders> {
    const startedAt = process.hrtime.bigint();
    try {
      const { order, reservedUnits } = await this.runCheckout(buyerId);
      // Metrics are recorded HERE, after the transaction has committed —
      // never inside it. A checkout that rolls back reserved no stock and
      // placed no order, so counting it at the point of the write would
      // permanently overstate both. reservedUnits is carried out of the
      // transaction rather than re-queried, so this costs no extra round
      // trips and can't drift from what actually committed.
      this.metrics.recordCheckout('success', elapsedSeconds(startedAt));
      this.metrics.recordOrderPlaced(
        order.sellerOrders.length,
        Number(order.totalAmount),
      );
      this.metrics.recordInventoryMovement('reserved', reservedUnits);
      this.logger.log({
        event: 'checkout.completed',
        userId: buyerId,
        entityType: 'Order',
        entityId: order.id,
        sellerOrderCount: order.sellerOrders.length,
        totalAmount: Number(order.totalAmount),
      });
      return order;
    } catch (err) {
      // A rejection is the system working (empty cart, sold out, product
      // archived); a failure is not. Splitting them keeps an alert on
      // "checkout is broken" from firing every time a customer races
      // someone else to the last unit.
      const rejected = err instanceof BadRequestException;
      this.metrics.recordCheckout(
        rejected ? 'rejected' : 'failed',
        elapsedSeconds(startedAt),
      );
      this.logger[rejected ? 'warn' : 'error']({
        event: rejected ? 'checkout.rejected' : 'checkout.failed',
        userId: buyerId,
        error: err,
      });
      throw err;
    }
  }

  private async runCheckout(
    buyerId: string,
  ): Promise<{ order: OrderWithSellerOrders; reservedUnits: number }> {
    // 1. Validate cart.
    const cart = await this.cartService.getOrCreateForBuyer(buyerId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    const productIds = cart.items.map((item) => item.productId);

    return this.prisma.$transaction(async (tx) => {
      // 2. Re-read authoritative product state from PostgreSQL — inside
      // this transaction, so it's consistent with the stock decrement
      // below (nothing else can change it between this read and that
      // write).
      const products =
        await this.productsService.findManyWithInventoryForCheckout(
          tx,
          productIds,
        );
      const productById = new Map(products.map((p) => [p.id, p]));

      // 3+4+5: validate availability, purchasability, and stock for
      // EVERY line before decrementing anything — one bad line fails the
      // whole checkout rather than partially succeeding.
      const lines: CheckoutLine[] = [];
      for (const item of cart.items) {
        const product = productById.get(item.productId);
        if (!product) {
          throw new BadRequestException(
            `Product ${item.productId} no longer exists`,
          );
        }
        // Handles "product deactivated/deleted after being added to
        // cart": the cart may still hold a line for it (it was valid
        // when added), but checkout re-validates against current
        // PostgreSQL state and rejects it here, clearly, rather than
        // silently dropping the line or letting it through stale.
        if (product.status !== ProductStatus.ACTIVE) {
          throw new BadRequestException(
            `"${product.name}" is no longer available for purchase`,
          );
        }
        if (product.type === ProductType.AUCTION) {
          // Defensive — CartService already rejects adding AUCTION
          // products, but checkout must never trust anything it didn't
          // itself just re-validate.
          throw new BadRequestException(
            `"${product.name}" is not purchasable via cart checkout`,
          );
        }
        const available = product.inventory?.quantityAvailable ?? 0;
        if (available < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for "${product.name}" (requested ${item.quantity}, available ${available})`,
          );
        }
        lines.push({
          productId: product.id,
          sellerId: product.sellerId,
          quantity: item.quantity,
          // Current authoritative price — never the cart's stale
          // snapshot, and never anything read from Meilisearch.
          unitPrice: Number(product.basePrice),
        });
      }

      const result = await this.executeOrderTransaction(
        tx,
        buyerId,
        lines,
        correlationId,
      );

      // 14. Close the cart: record the conversion, then empty it — same
      // transaction as everything above, so a failure anywhere never
      // leaves the cart emptied without an order to show for it.
      await this.cartService.completeCheckout(tx, cart.id, result.id);

      // 15. Commit — implicit: returning here resolves the $transaction
      // callback, which is what commits it.
      return {
        order: result,
        reservedUnits: lines.reduce((sum, l) => sum + l.quantity, 0),
      };
    });
  }

  // The winner-checkout counterpart to cart checkout(): a single-line
  // "order" for the one auctioned product, at the winning bid price (not
  // Product.basePrice — the auction's own agreed price is already
  // authoritative, re-read from Postgres here rather than trusted from
  // whatever the client last saw). Reuses the exact same transaction
  // machinery (executeOrderTransaction) as cart checkout, so the same
  // async order-processing + seller-notification pipeline applies
  // uniformly to auction wins too.
  async checkoutAuctionWin(
    auctionId: string,
    callerId: string,
  ): Promise<OrderWithSellerOrders> {
    const auction = await this.biddingService.findAuctionById(auctionId); // 404s if missing
    this.biddingService.assertCanCheckoutAsWinner(auction, callerId);

    const correlationId = this.correlationIdService.getId() ?? randomUUID();

    return this.prisma.$transaction(async (tx) => {
      // Re-read the product's authoritative state — an auctioned
      // product can still be archived by its seller like any other.
      const [product] =
        await this.productsService.findManyWithInventoryForCheckout(tx, [
          auction.productId,
        ]);
      if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(
          'The auctioned product is no longer available',
        );
      }

      // The winning bid is a LOT price (the whole quantity, not per
      // unit — see Auction.quantity) — divided evenly across units so
      // OrderItem's quantity genuinely reflects how much stock this win
      // consumes, letting it flow through the exact same
      // decrementStockForCheckout(productId, quantity) path as an
      // ordinary cart line below. A lot size in the single digits (the
      // realistic range for this kind of listing) rounds back to the
      // original bid to the cent; a pathologically large quantity could
      // drift by a cent or two, same class of rounding a per-seat price
      // split has anywhere.
      const line: CheckoutLine = {
        productId: auction.productId,
        sellerId: auction.sellerId,
        quantity: auction.quantity,
        unitPrice: Number(auction.currentHighestBid) / auction.quantity,
      };
      // The lot has been held since the auction was created (see
      // BiddingService.createAuction), and a checkout reservation is the
      // same counter — so the hold simply BECOMES this order's
      // reservation. Releasing it and immediately re-reserving would be
      // a no-op numerically while opening a window where the units look
      // free, so the hold is carried over instead. Either way it is the
      // seller shipping that finally consumes the stock.
      const result = await this.executeOrderTransaction(
        tx,
        callerId,
        [line],
        correlationId,
        true,
      );

      await this.biddingService.markAuctionCompleted(tx, auctionId);

      return result;
    });
  }

  // Shared by cart checkout (above) and auction-winner checkout (see
  // BiddingService/OrdersController) — steps 6 through 13 of the
  // checkout algorithm: decrement stock, split by seller, create the
  // Order/SellerOrders/OrderItems/ledger entries, record outbox events.
  // Callers are responsible for validating their own lines (availability,
  // price, stock) BEFORE calling this — this method trusts its input.
  private async executeOrderTransaction(
    tx: Prisma.TransactionClient,
    buyerId: string,
    lines: CheckoutLine[],
    correlationId: string,
    stockAlreadyReserved = false,
  ): Promise<OrderWithSellerOrders> {
    // 6. Atomically RESERVE stock for every line. The first
    // insufficient/conflicting line throws, aborting the whole
    // transaction — no partial reservation survives. Units are not
    // consumed here; the seller shipping is what does that (see
    // updateSellerOrderStatus).
    //
    // Auction wins arrive here with their units already reserved by the
    // auction hold, which simply carries over to the order rather than
    // being released and immediately re-taken.
    if (!stockAlreadyReserved) {
      for (const line of lines) {
        await this.productsService.reserveStockForCheckout(
          tx,
          line.productId,
          line.quantity,
        );
      }
    }

    // 8. Split items by seller.
    const bySeller = new Map<string, CheckoutLine[]>();
    for (const line of lines) {
      const existing = bySeller.get(line.sellerId);
      if (existing) {
        existing.push(line);
      } else {
        bySeller.set(line.sellerId, [line]);
      }
    }

    const totalAmount = lines.reduce(
      (sum, l) => sum + l.quantity * l.unitPrice,
      0,
    );
    const sellerLines: CheckoutSellerLineInput[] = [];
    for (const [sellerId, sellerLineItems] of bySeller) {
      const subtotal = sellerLineItems.reduce(
        (sum, l) => sum + l.quantity * l.unitPrice,
        0,
      );
      sellerLines.push({
        sellerId,
        subtotal,
        // 11. Calculate platform commission.
        commission: computeCommission(subtotal),
        items: sellerLineItems.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      });
    }

    // 7+9+10+12: parent Order, one SellerOrder + OrderItems + initial
    // SALE/COMMISSION ledger entries per seller.
    const { order, sellerOrders } =
      await this.ordersRepository.createFromCheckout(tx, {
        buyerId,
        totalAmount,
        sellerLines,
      });

    // 13. OutboxEvents: one SellerOrderCreated per SellerOrder (fans out
    // to async order-processing + seller notification — see
    // infrastructure/outbox/event-queue-map.ts), plus one OrderPlaced for
    // the parent.
    for (const sellerOrder of sellerOrders) {
      const sellerProfile = await this.sellersService.findById(
        sellerOrder.sellerId,
      );
      await this.outboxService.record(tx, {
        aggregateType: 'SellerOrder',
        aggregateId: sellerOrder.id,
        eventType: SELLER_ORDER_CREATED_EVENT,
        payload: {
          sellerOrderId: sellerOrder.id,
          orderId: order.id,
          sellerId: sellerOrder.sellerId,
          sellerUserId: sellerProfile.userId,
        },
        correlationId,
      });
    }
    await this.outboxService.record(tx, {
      aggregateType: 'Order',
      aggregateId: order.id,
      eventType: ORDER_PLACED_EVENT,
      payload: {
        orderId: order.id,
        buyerId,
        sellerOrderIds: sellerOrders.map((s) => s.id),
      },
      correlationId,
    });

    return { ...order, sellerOrders };
  }

  async findSellerOrderById(id: string): Promise<SellerOrder> {
    const sellerOrder = await this.ordersRepository.findSellerOrderById(id);
    if (!sellerOrder) {
      throw new NotFoundException(`SellerOrder ${id} not found`);
    }
    return sellerOrder;
  }

  // The BUYER-side counterpart to assertOwnsSellerOrderOrIsAdmin (which
  // authorizes the seller): resolves a SellerOrder only for the customer
  // who actually bought it. Used by modules that let a customer act on
  // their own purchase — see DisputesService.raise.
  //
  // 404, not 403, for someone else's SellerOrder — same reasoning as
  // findById: a 403 would confirm the id exists, turning this into an
  // existence oracle.
  async findSellerOrderAsBuyer(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<SellerOrder> {
    const sellerOrder = await this.findSellerOrderById(id); // 404s if missing
    if (caller.role === UserRole.ADMIN) {
      return sellerOrder;
    }
    const order = await this.ordersRepository.findById(sellerOrder.orderId);
    if (!order || order.buyerId !== caller.id) {
      throw new NotFoundException(`SellerOrder ${id} not found`);
    }
    return sellerOrder;
  }

  // Explicit transitions only (see domain/order-status-transitions.ts):
  // NEW -> PROCESSING -> SHIPPED -> COMPLETED, or NEW|PROCESSING ->
  // CANCELLED. Cancelling restores stock and reverses this SellerOrder's
  // ledger entries — and ONLY this one; cancelling one seller's part of a
  // multi-vendor order never touches another seller's SellerOrder. The
  // parent Order's status is recomputed from ALL its SellerOrders in the
  // same transaction (see domain/order-status-aggregation.ts).
  async updateSellerOrderStatus(
    id: string,
    caller: AuthenticatedUser,
    dto: UpdateSellerOrderStatusDto,
  ): Promise<SellerOrder> {
    const sellerOrder = await this.findSellerOrderById(id); // 404s if missing
    await this.assertOwnsSellerOrderOrIsAdmin(sellerOrder, caller);

    const isAdminForceCancel =
      caller.role === UserRole.ADMIN &&
      dto.status === SellerOrderStatus.CANCELLED &&
      canAdminForceCancel(sellerOrder.status);

    if (
      !isAdminForceCancel &&
      !isValidSellerOrderTransition(sellerOrder.status, dto.status)
    ) {
      throw new BadRequestException(
        `Cannot transition SellerOrder from ${sellerOrder.status} to ${dto.status}`,
      );
    }

    const correlationId = this.correlationIdService.getId() ?? randomUUID();

    const { result, restoredUnits, committedUnits } =
      await this.prisma.$transaction(async (tx) => {
        const updated = await this.ordersRepository.updateSellerOrderStatus(
          tx,
          id,
          dto.status,
        );

        let restored = 0;
        let committed = 0;
        if (dto.status === SellerOrderStatus.CANCELLED) {
          // sellerOrder.status (not updated.status) is what the row was
          // BEFORE this write — that's what decides whether there is
          // still a hold to release or the units already shipped and
          // need a genuine restock. See restoreStockAndReverseLedger.
          restored = await this.restoreStockAndReverseLedger(
            tx,
            updated,
            sellerOrder.status,
          );
        } else if (dto.status === SellerOrderStatus.SHIPPED) {
          // Shipping is what finally consumes the stock the order has
          // been holding since checkout. Same transaction as the status
          // write, so a SellerOrder can never be SHIPPED without its
          // units having been committed.
          committed = await this.commitReservedStock(tx, updated);
        }

        const order = await this.recomputeOrderStatus(tx, updated.orderId);

        await this.recordStatusChanged(tx, updated, order, correlationId);

        return {
          result: updated,
          restoredUnits: restored,
          committedUnits: committed,
        };
      });

    if (restoredUnits > 0) {
      // Again after commit, for the same reason as checkout. The label
      // matches which of the two inventory ops actually ran — see
      // restoreStockAndReverseLedger.
      this.metrics.recordInventoryMovement(
        canAdminForceCancel(sellerOrder.status) ? 'returned' : 'released',
        restoredUnits,
      );
    }
    if (committedUnits > 0) {
      this.metrics.recordInventoryMovement('committed', committedUnits);
    }
    this.logger.log({
      event: 'seller_order.status_changed',
      userId: caller.id,
      entityType: 'SellerOrder',
      entityId: result.id,
      orderId: result.orderId,
      from: sellerOrder.status,
      to: result.status,
    });
    return result;
  }

  // Called by OrderProcessingConsumer (BullMQ, from the SellerOrderCreated
  // outbox event) — auto-advances a freshly-created SellerOrder from NEW
  // to PROCESSING. Guarded by updateSellerOrderStatusIfCurrent (a
  // conditional update, not a blind write), so a redelivered job that
  // finds the row already advanced (or cancelled in the meantime) is a
  // harmless no-op — this is what makes the consumer idempotent on top of
  // the EventIdempotencyService wrapper it's already called through.
  async autoAdvanceToProcessing(
    tx: Prisma.TransactionClient,
    sellerOrderId: string,
  ): Promise<void> {
    const updated =
      await this.ordersRepository.updateSellerOrderStatusIfCurrent(
        tx,
        sellerOrderId,
        SellerOrderStatus.NEW,
        SellerOrderStatus.PROCESSING,
      );
    if (!updated) {
      return;
    }
    const order = await this.recomputeOrderStatus(tx, updated.orderId);
    // This transition is just as real as an operator-driven one, so it
    // announces itself the same way — without this, a client watching
    // order:{id} would never learn the order left NEW, since nothing
    // else emits for the async advance.
    await this.recordStatusChanged(
      tx,
      updated,
      order,
      this.correlationIdService.getId() ?? randomUUID(),
    );
  }

  private recordStatusChanged(
    tx: Prisma.TransactionClient,
    sellerOrder: SellerOrder,
    order: Order,
    correlationId: string,
  ): Promise<unknown> {
    return this.outboxService.record(tx, {
      aggregateType: 'SellerOrder',
      aggregateId: sellerOrder.id,
      eventType: SELLER_ORDER_STATUS_CHANGED_EVENT,
      payload: {
        sellerOrderId: sellerOrder.id,
        orderId: sellerOrder.orderId,
        buyerId: order.buyerId,
        status: sellerOrder.status,
        orderStatus: order.status,
      },
      correlationId,
    });
  }

  // Restores stock for every item under this (and only this) SellerOrder,
  // and appends REFUND/ADJUSTMENT ledger entries that net its SALE/
  // COMMISSION entries back to zero — LedgerEntry is append-only (see
  // schema.prisma), so this reverses rather than mutates.
  // Returns the number of units put back, so the caller can record the
  // metric AFTER the transaction commits (see updateSellerOrderStatus).
  // Converts every line's checkout hold into a real stock reduction.
  // Lines whose reservation is already gone (a re-run transition) are
  // skipped rather than decremented again — see
  // ProductsService.commitReservationForShipment.
  private async commitReservedStock(
    tx: Prisma.TransactionClient,
    sellerOrder: SellerOrder,
  ): Promise<number> {
    const items = await this.ordersRepository.findOrderItemsForSellerOrder(
      tx,
      sellerOrder.id,
    );
    let committedUnits = 0;
    for (const item of items) {
      const applied = await this.productsService.commitReservationForShipment(
        tx,
        item.productId,
        item.quantity,
      );
      if (applied) committedUnits += item.quantity;
    }
    return committedUnits;
  }

  private async restoreStockAndReverseLedger(
    tx: Prisma.TransactionClient,
    sellerOrder: SellerOrder,
    previousStatus: SellerOrderStatus,
  ): Promise<number> {
    const items = await this.ordersRepository.findOrderItemsForSellerOrder(
      tx,
      sellerOrder.id,
    );
    // Which inventory op applies depends on whether the hold was still
    // there to release. A normal NEW/PROCESSING cancellation frees a
    // reservation that never left quantityAvailable. An admin
    // force-cancelling a SHIPPED/COMPLETED order (see
    // canAdminForceCancel) is different: SHIPMENT already consumed that
    // reservation, so there is nothing left to release — this is a
    // genuine restock instead, same as a return.
    const alreadyShipped = canAdminForceCancel(previousStatus);

    let restoredUnits = 0;
    for (const item of items) {
      if (alreadyShipped) {
        await this.productsService.returnStockAfterForceCancellation(
          tx,
          item.productId,
          item.quantity,
        );
      } else {
        // Released, not restored: a cancelled order's units never left
        // quantityAvailable in the first place.
        await this.productsService.releaseReservationForCancellation(
          tx,
          item.productId,
          item.quantity,
        );
      }
      restoredUnits += item.quantity;
    }

    const subtotal = Number(sellerOrder.subtotal);
    const commission = computeCommission(subtotal);
    await this.ordersRepository.createLedgerEntries(tx, [
      {
        sellerId: sellerOrder.sellerId,
        sellerOrderId: sellerOrder.id,
        type: LedgerEntryType.REFUND,
        amount: -subtotal,
      },
      {
        sellerId: sellerOrder.sellerId,
        sellerOrderId: sellerOrder.id,
        type: LedgerEntryType.ADJUSTMENT,
        amount: commission,
      },
    ]);
    return restoredUnits;
  }

  private async recomputeOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<Order> {
    const statuses =
      await this.ordersRepository.findSellerOrderStatusesForOrder(tx, orderId);
    const aggregate = aggregateOrderStatus(statuses);
    return this.ordersRepository.updateOrderStatus(tx, orderId, aggregate);
  }

  // ADMIN bypasses ownership entirely (explicit admin override); a
  // SELLER may only act on their own SellerOrders.
  private async assertOwnsSellerOrderOrIsAdmin(
    sellerOrder: SellerOrder,
    caller: AuthenticatedUser,
  ): Promise<void> {
    if (caller.role === UserRole.ADMIN) {
      return;
    }
    const ownProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(caller.id);
    if (ownProfile.id !== sellerOrder.sellerId) {
      throw new ForbiddenException('You do not own this SellerOrder');
    }
  }
}

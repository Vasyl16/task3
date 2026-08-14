import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  ProductType,
  UserRole,
  type Inventory,
  type Product,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { ReviewsService } from '../reviews/reviews.service';
import { toPageParams, type Paginated } from '../../core/pagination';
import { ListOwnProductsQuery } from './dto/list-own-products.query';
import { ListProductsForModerationQuery } from '../admin/dto/list-products-for-moderation.query';
import { CategoriesService } from '../categories/categories.service';
import { SellersService } from '../sellers/sellers.service';
import {
  ProductsRepository,
  ProductWithInventory,
} from './domain/products.repository';
import { PRODUCT_CREATED_EVENT } from './domain/events/product-created.event';
import { PRODUCT_UPDATED_EVENT } from './domain/events/product-updated.event';
import { PRODUCT_ARCHIVED_EVENT } from './domain/events/product-archived.event';
import {
  INVENTORY_UPDATED_EVENT,
  type InventoryUpdateReason,
} from './domain/events/inventory-updated.event';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ModerateProductDto,
  ProductModerationAction,
} from './dto/moderate-product.dto';

// A Product minus its moderation audit trail — see findAllForCatalog.
export type CatalogProduct = Omit<
  Product,
  'moderatedByUserId' | 'moderatedAt' | 'moderationNote'
> & {
  // Derived on read from the Review rows, never stored on Product. A
  // product nobody has reviewed reports 0/0 rather than null, so the
  // frontend has one shape to render instead of two.
  ratingAverage: number;
  ratingCount: number;
};

// How the catalogue is ordered. Rating sorting is a real business
// request ("show me the best-reviewed things"), so it is an explicit,
// validated option rather than a free-text orderBy the client controls —
// passing a client string straight to Prisma's orderBy would let it sort
// by columns the catalogue deliberately does not expose.
export const PRODUCT_SORTS = ['newest', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

// Built by listing what IS public rather than deleting what isn't. The
// difference matters: a sensitive column added to Product later is
// excluded from this response by default and has to be opted in
// deliberately, whereas a blocklist would start leaking it the moment it
// was added — which is exactly how the moderation fields got out.
function toCatalogProduct(
  product: Product,
  rating: { average: number; count: number } = { average: 0, count: 0 },
): CatalogProduct {
  return {
    id: product.id,
    sellerId: product.sellerId,
    categoryId: product.categoryId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    imageUrl: product.imageUrl,
    basePrice: product.basePrice,
    type: product.type,
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    ratingAverage: rating.average,
    ratingCount: rating.count,
  };
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly sellersService: SellersService,
    private readonly categoriesService: CategoriesService,
    private readonly outboxService: OutboxService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly reviewsService: ReviewsService,
    // Used only to open the transaction boundary below — every actual
    // read/write still goes through ProductsRepository, keeping Prisma
    // details out of the rest of the service.
    private readonly prisma: PrismaService,
  ) {}

  // Internal lookups — the full row, including the moderation audit
  // trail. Used by cart/bidding/orders and by the ownership-checked
  // write paths below; never returned straight to an anonymous client
  // (see the *ForCatalog variants).
  findAll(filter?: {
    categoryId?: string;
    sellerId?: string;
  }): Promise<Product[]> {
    return this.productsRepository.findAll(filter);
  }

  async findById(id: string): Promise<Product> {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  // What the @Public() catalog routes return. moderatedByUserId /
  // moderatedAt / moderationNote are an internal audit trail — an
  // admin's id and their free-text reason for taking a listing down —
  // and were being served to unauthenticated callers by GET /products
  // and GET /products/:id. Stripped here rather than in the controller
  // for the same reason UsersService.toPublicUser lives in the service:
  // sanitization belongs with the module that owns the data.
  async findAllForCatalog(filter?: {
    categoryId?: string;
    sellerId?: string;
    sort?: ProductSort;
  }): Promise<CatalogProduct[]> {
    const products = await this.findAll(filter);
    const ratings = await this.reviewsService.getRatingsFor(
      products.map((p) => p.id),
    );

    const catalog = products.map((product) =>
      toCatalogProduct(product, ratings.get(product.id)),
    );

    // Sorted here rather than in SQL because the rating is not a column
    // on Product — it is an aggregate over another table, computed per
    // request. The repository has already applied the default ordering,
    // so this only reorders when explicitly asked. If the catalogue ever
    // grows pagination, this has to move into the query: sorting a page
    // after it has been selected sorts the wrong rows.
    if (filter?.sort === 'rating') {
      catalog.sort(
        (a, b) =>
          b.ratingAverage - a.ratingAverage ||
          // Ties broken by how many people said it: 5.0 from forty
          // buyers outranks 5.0 from one.
          b.ratingCount - a.ratingCount ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    }

    return catalog;
  }

  async findByIdForCatalog(id: string): Promise<CatalogProduct> {
    const product = await this.findById(id);
    const rating = await this.reviewsService.getRatingFor(id);
    return toCatalogProduct(product, rating);
  }

  // Reference implementation of the strong-consistency + outbox pattern:
  // Product + Inventory + OutboxEvent all commit in one transaction, or
  // none do. The (future) search-sync consumer picks up ProductCreated
  // asynchronously — Products never calls Meilisearch directly.
  //
  // sellerId is NEVER taken from the request — it's derived from the
  // caller's own approved SellerProfile (see
  // SellersService.getOwnApprovedSellerProfileOrThrow). A seller can
  // only ever create products for themselves.
  async create(callerId: string, dto: CreateProductDto): Promise<Product> {
    const sellerProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(callerId);
    await this.categoriesService.findById(dto.categoryId); // 404s if missing

    const correlationId = this.correlationIdService.getId() ?? randomUUID();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await this.productsRepository.createWithInventory(tx, {
          ...dto,
          type: dto.type ?? ProductType.FIXED_PRICE,
          sellerId: sellerProfile.id,
        });
        await this.outboxService.record(tx, {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: PRODUCT_CREATED_EVENT,
          payload: {
            productId: product.id,
            sellerId: product.sellerId,
            categoryId: product.categoryId,
            name: product.name,
          },
          correlationId,
        });
        return product;
      });
    } catch (err) {
      // Product.slug is globally unique (it's the public URL), so one
      // seller's slug can collide with a product they can't even see.
      // Letting Prisma's P2002 escape would surface as an opaque 500 with
      // a stack trace naming the repository file; the seller needs to
      // know WHICH field to change.
      if (isSlugConflict(err)) {
        this.logger.warn({
          event: 'product.slug_conflict',
          userId: callerId,
          entityType: 'Product',
          sellerId: sellerProfile.id,
          slug: dto.slug,
        });
        throw new ConflictException(
          `The URL slug "${dto.slug}" is already taken — please choose a different one`,
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    caller: AuthenticatedUser,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findById(id); // 404s if missing
    await this.assertOwnsProductOrIsAdmin(product, caller);

    const { quantityAvailable, ...productFields } = dto;
    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.productsRepository.update(
        tx,
        id,
        productFields,
      );

      if (quantityAvailable !== undefined) {
        const inventory = await this.productsRepository.setStock(
          tx,
          id,
          quantityAvailable,
        );
        if (!inventory) {
          throw new ConflictException(
            `Stock for product ${id} was changed concurrently — please retry`,
          );
        }
        await this.recordInventoryUpdated(tx, inventory, 'SELLER_ADJUSTMENT');
      }

      await this.outboxService.record(tx, {
        aggregateType: 'Product',
        aggregateId: updated.id,
        eventType: PRODUCT_UPDATED_EVENT,
        payload: { productId: updated.id },
        correlationId,
      });
      return updated;
    });
  }

  // The file itself is already written to disk by the time this runs
  // (Multer's disk storage engine — see products.controller.ts) — this
  // only persists the resulting PUBLIC path. Same ownership check and
  // outbox pattern as update(), kept as a separate method because it's a
  // separate route (multipart, not the JSON UpdateProductDto) rather
  // than a field folded into it.
  async updateImage(
    id: string,
    caller: AuthenticatedUser,
    imageUrl: string,
  ): Promise<Product> {
    const product = await this.findById(id); // 404s if missing
    await this.assertOwnsProductOrIsAdmin(product, caller);

    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.productsRepository.update(tx, id, {
        imageUrl,
      });
      await this.outboxService.record(tx, {
        aggregateType: 'Product',
        aggregateId: updated.id,
        eventType: PRODUCT_UPDATED_EVENT,
        payload: { productId: updated.id },
        correlationId,
      });
      return updated;
    });
  }

  // Soft delete only (sets status ARCHIVED) — see
  // ProductsRepository.archive for why a physical delete would be
  // unsafe (existing carts/OrderItems/Auctions may still reference it).
  // The search index must drop the product too (an archived product is
  // never discoverable), so this records ProductArchived the same way
  // create()/update() record their events — search-sync deletes the
  // Meilisearch document on this event rather than upserting it.
  async archive(id: string, caller: AuthenticatedUser): Promise<Product> {
    const product = await this.findById(id); // 404s if missing
    await this.assertOwnsProductOrIsAdmin(product, caller);

    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const archived = await this.productsRepository.archive(tx, id);
      await this.outboxService.record(tx, {
        aggregateType: 'Product',
        aggregateId: archived.id,
        eventType: PRODUCT_ARCHIVED_EVENT,
        payload: { productId: archived.id },
        correlationId,
      });
      return archived;
    });
  }

  // A seller's OWN catalogue, including ARCHIVED. The public listing
  // hides archived products by design, which left a seller unable to
  // find — let alone restore — something they had taken down. Scoped to
  // the caller's own approved profile, never a client-supplied sellerId.
  async listOwnProducts(
    callerId: string,
    query: ListOwnProductsQuery,
  ): Promise<Paginated<Product>> {
    const sellerProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(callerId);
    const { skip, take, page, limit } = toPageParams(query);
    const { items, total } = await this.productsRepository.findForModeration({
      sellerId: sellerProfile.id,
      status: query.status,
      search: query.search,
      skip,
      take,
    });
    return { items, total, page, limit };
  }

  // Puts an archived listing back on sale. The mirror of archive():
  // status returns to ACTIVE and a ProductUpdated event re-indexes it,
  // since search-sync DELETED the document when it was archived.
  //
  // Deliberately NOT allowed to resurrect a product an ADMIN took down —
  // that is a moderation decision, and letting a seller undo it from
  // their own dashboard would make takedowns meaningless. Those carry a
  // moderatedAt stamp; reinstating them stays on AdminController.
  async restore(id: string, caller: AuthenticatedUser): Promise<Product> {
    const product = await this.findById(id);
    await this.assertOwnsProductOrIsAdmin(product, caller);

    if (product.status !== ProductStatus.ARCHIVED) {
      throw new ConflictException(`Product ${id} is not archived`);
    }
    if (product.moderatedAt && caller.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'This listing was removed by a moderator and can only be reinstated by an admin',
      );
    }

    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const restored = await this.productsRepository.restore(tx, id);
      await this.outboxService.record(tx, {
        aggregateType: 'Product',
        aggregateId: restored.id,
        eventType: PRODUCT_UPDATED_EVENT,
        payload: { productId: restored.id },
        correlationId,
      });
      return restored;
    });
  }

  // ===================== Moderation (admin) =====================
  // Admin-only; @Roles(ADMIN) is enforced on AdminController, and every
  // method here takes the moderator's id from the authenticated caller.

  async listForModeration(
    query: ListProductsForModerationQuery,
  ): Promise<Paginated<Product>> {
    const { skip, take, page, limit } = toPageParams(query);
    const { items, total } = await this.productsRepository.findForModeration({
      status: query.status,
      sellerId: query.sellerId,
      search: query.search,
      skip,
      take,
    });
    return { items, total, page, limit };
  }

  // Takedown reuses ARCHIVED rather than adding a parallel "removed by
  // admin" status: the visibility rules for a taken-down listing are
  // exactly the archived ones (invisible to browsing and search, still
  // referenced by existing carts and order history), and a second status
  // meaning the same thing would have to be handled at every read site.
  // What distinguishes a takedown from a seller's own archive is the
  // audit trail — moderatedByUserId/moderatedAt/moderationNote.
  //
  // The search index has to follow: takedown emits ProductArchived (the
  // search consumer DELETES the document), reinstatement emits
  // ProductUpdated (it re-upserts from Postgres). Both are recorded in
  // the same transaction as the status change, so the index can't end up
  // disagreeing with a takedown that rolled back.
  async moderate(
    id: string,
    moderator: AuthenticatedUser,
    dto: ModerateProductDto,
  ): Promise<Product> {
    const product = await this.findById(id); // 404s if missing

    const takingDown = dto.action === ProductModerationAction.TAKE_DOWN;
    const nextStatus = takingDown
      ? ProductStatus.ARCHIVED
      : ProductStatus.ACTIVE;
    if (product.status === nextStatus) {
      throw new ConflictException(
        `Product ${id} is already ${nextStatus.toLowerCase()}`,
      );
    }

    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    const moderated = await this.prisma.$transaction(async (tx) => {
      const updated = await this.productsRepository.setModerationStatus(
        tx,
        id,
        {
          status: nextStatus,
          moderatedByUserId: moderator.id,
          moderationNote: dto.note,
        },
      );
      await this.outboxService.record(tx, {
        aggregateType: 'Product',
        aggregateId: updated.id,
        eventType: takingDown ? PRODUCT_ARCHIVED_EVENT : PRODUCT_UPDATED_EVENT,
        payload: { productId: updated.id },
        correlationId,
      });
      return updated;
    });

    this.logger.warn({
      event: 'product.moderated',
      userId: moderator.id,
      entityType: 'Product',
      entityId: moderated.id,
      action: dto.action,
      sellerId: moderated.sellerId,
      fromStatus: product.status,
      toStatus: moderated.status,
    });
    return moderated;
  }

  // ===================== Checkout support =====================
  // Called by OrdersService (which imports this SERVICE, never
  // ProductsRepository directly — see the backend-architecture skill's
  // module-dependency rule) from inside its own checkout transaction, the
  // same way SellersService.review calls UsersService.updateRole(tx, ...).

  findManyWithInventoryForCheckout(
    tx: Prisma.TransactionClient,
    productIds: string[],
  ): Promise<ProductWithInventory[]> {
    return this.productsRepository.findManyWithInventory(tx, productIds);
  }

  // Checkout MOVES units into quantityReserved — they leave
  // quantityAvailable immediately, so a seller's stock figure reflects
  // what is genuinely still sellable. See ProductsRepository.reserveStock.
  async reserveStockForCheckout(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.reserveStock(
      tx,
      productId,
      quantity,
    );
    if (!inventory) {
      throw new ConflictException(
        `Insufficient stock for product ${productId} — it may have just sold out`,
      );
    }
    await this.recordInventoryUpdated(tx, inventory, 'CHECKOUT');
  }

  // The seller shipped: the units leave for good, so the hold is
  // consumed. quantityAvailable is untouched — it already came down at
  // checkout.
  //
  // Returns whether it actually applied. A null result means the
  // reservation was not there to convert — a ship transition that ran
  // twice, or an order whose units were released by an earlier
  // cancellation — and that is a no-op, not an error: failing here would
  // block a legitimate status change over inventory bookkeeping that is
  // already in the desired state.
  async commitReservationForShipment(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<boolean> {
    const inventory = await this.productsRepository.commitReservation(
      tx,
      productId,
      quantity,
    );
    if (!inventory) {
      this.logger.warn({
        event: 'inventory.commit_skipped',
        entityType: 'Product',
        entityId: productId,
        quantity,
      });
      return false;
    }
    await this.recordInventoryUpdated(tx, inventory, 'SHIPMENT');
    return true;
  }

  // A cancelled order puts its units back on sale — the exact inverse of
  // the reservation taken at checkout.
  async releaseReservationForCancellation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.releaseReservation(
      tx,
      productId,
      quantity,
    );
    if (!inventory) {
      // Nothing held — a release that already happened. Not an error:
      // failing here would block a legitimate cancellation over
      // bookkeeping that is already in the desired state.
      this.logger.warn({
        event: 'inventory.release_skipped',
        entityType: 'Product',
        entityId: productId,
        quantity,
      });
      return;
    }
    await this.recordInventoryUpdated(tx, inventory, 'CANCELLATION');
  }

  // The units already left quantityReserved at SHIPMENT, so there is no
  // hold left to release — an admin force-cancelling a SHIPPED or
  // COMPLETED order needs a genuine restock instead. See
  // OrdersService.updateSellerOrderStatus / canAdminForceCancel.
  async returnStockAfterForceCancellation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.returnStock(
      tx,
      productId,
      quantity,
    );
    await this.recordInventoryUpdated(tx, inventory, 'RETURN');
  }

  // ===================== Auction lot holds =====================
  // Called by BiddingService/OrdersService from inside their own
  // transactions, same contract as the checkout helpers above. A hold
  // does NOT consume stock — see ProductsRepository.reserveStock.

  async reserveStockForAuction(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.reserveStock(
      tx,
      productId,
      quantity,
    );
    if (!inventory) {
      throw new ConflictException(
        `Not enough free stock for product ${productId} to hold ${quantity} unit(s) for an auction`,
      );
    }
    await this.recordInventoryUpdated(tx, inventory, 'AUCTION_HOLD');
  }

  async releaseAuctionReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.releaseReservation(
      tx,
      productId,
      quantity,
    );
    if (!inventory) {
      this.logger.warn({
        event: 'inventory.release_skipped',
        entityType: 'Product',
        entityId: productId,
        quantity,
      });
      return;
    }
    await this.recordInventoryUpdated(tx, inventory, 'AUCTION_RELEASE');
  }

  // Inventory is the one piece of state that changes without its owner
  // (this module) being the one that triggered it — checkout and
  // cancellation both live in OrdersService. Recording the event HERE,
  // rather than in the caller, keeps "who may announce an inventory
  // change" with the module that owns the inventory row, and guarantees
  // the event can't be forgotten by a future caller. It's recorded on
  // the caller's transaction client, so it commits (or rolls back)
  // atomically with the stock change itself.
  private recordInventoryUpdated(
    tx: Prisma.TransactionClient,
    inventory: Inventory,
    reason: InventoryUpdateReason,
  ): Promise<unknown> {
    return this.outboxService.record(tx, {
      aggregateType: 'Inventory',
      aggregateId: inventory.productId,
      eventType: INVENTORY_UPDATED_EVENT,
      payload: {
        productId: inventory.productId,
        quantityAvailable: inventory.quantityAvailable,
        quantityReserved: inventory.quantityReserved,
        version: inventory.version,
        reason,
      },
      correlationId: this.correlationIdService.getId() ?? randomUUID(),
    });
  }

  // ADMIN bypasses ownership entirely (explicit admin override); a
  // SELLER may only act on their own products.
  private async assertOwnsProductOrIsAdmin(
    product: Product,
    caller: AuthenticatedUser,
  ): Promise<void> {
    if (caller.role === UserRole.ADMIN) {
      return;
    }
    const ownProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(caller.id);
    if (ownProfile.id !== product.sellerId) {
      throw new ForbiddenException('You do not own this product');
    }
  }
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// meta.target's shape is not stable across Prisma versions/adapters —
// it arrives as a string[] of field names on some, a single constraint
// name ("Product_slug_key") on others, and is absent entirely under the
// pg driver adapter this project uses, where only the message names the
// field. Checking all three keeps this from silently regressing to a
// 500 on a Prisma upgrade.
function isSlugConflict(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== UNIQUE_CONSTRAINT_VIOLATION
  ) {
    return false;
  }
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('slug');
  }
  if (typeof target === 'string') {
    return target.includes('slug');
  }
  return err.message.includes('slug');
}

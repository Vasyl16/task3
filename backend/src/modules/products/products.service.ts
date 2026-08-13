import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductStatus,
  ProductType,
  UserRole,
  type Inventory,
  type Prisma,
  type Product,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
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

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly sellersService: SellersService,
    private readonly categoriesService: CategoriesService,
    private readonly outboxService: OutboxService,
    private readonly correlationIdService: CorrelationIdService,
    // Used only to open the transaction boundary below — every actual
    // read/write still goes through ProductsRepository, keeping Prisma
    // details out of the rest of the service.
    private readonly prisma: PrismaService,
  ) {}

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

    return this.prisma.$transaction(async (tx) => {
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
  }

  async update(
    id: string,
    caller: AuthenticatedUser,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findById(id); // 404s if missing
    await this.assertOwnsProductOrIsAdmin(product, caller);

    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.productsRepository.update(tx, id, dto);
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

  // ===================== Moderation (admin) =====================
  // Admin-only; @Roles(ADMIN) is enforced on AdminController, and every
  // method here takes the moderator's id from the authenticated caller.

  listForModeration(filter: {
    status?: ProductStatus;
    sellerId?: string;
  }): Promise<Product[]> {
    return this.productsRepository.findForModeration(filter);
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

  async decrementStockForCheckout(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.decrementStock(
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

  async restoreStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const inventory = await this.productsRepository.restoreStock(
      tx,
      productId,
      quantity,
    );
    await this.recordInventoryUpdated(tx, inventory, 'CANCELLATION');
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

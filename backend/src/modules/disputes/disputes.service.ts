import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DisputeStatus,
  UserRole,
  type Dispute,
  type DisputeComment,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { OrdersService } from '../orders/orders.service';
import { SellersService } from '../sellers/sellers.service';
import { toPageParams, type Paginated } from '../../core/pagination';
import { ListDisputesQuery } from './dto/list-disputes.query';
import {
  DisputesRepository,
  type DisputeWithOrderContext,
} from './domain/disputes.repository';
import {
  isValidDisputeTransition,
  requiresResolutionText,
} from './domain/dispute-transitions';
import { AddDisputeCommentDto } from './dto/add-dispute-comment.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly disputesRepository: DisputesRepository,
    // Disputes are always ABOUT a SellerOrder, and only its buyer may
    // raise one — the ownership check lives in OrdersService, which owns
    // that fact, rather than being re-derived here.
    private readonly ordersService: OrdersService,
    // Only to resolve the caller's own seller profile for listForSeller.
    private readonly sellersService: SellersService,
  ) {}

  // The raiser is the authenticated caller, never a body field, and the
  // SellerOrder must be one they actually bought (404 otherwise).
  async raise(
    caller: AuthenticatedUser,
    dto: CreateDisputeDto,
  ): Promise<Dispute> {
    await this.ordersService.findSellerOrderAsBuyer(dto.sellerOrderId, caller);

    // A line-scoped dispute must be about a line of THIS order. Checked
    // rather than trusted: the buyer owns the order, but that says
    // nothing about an orderItemId they typed into the request, which
    // could belong to somebody else's purchase entirely.
    if (dto.orderItemId) {
      const item = await this.disputesRepository.findOrderItemInSellerOrder(
        dto.sellerOrderId,
        dto.orderItemId,
      );
      if (!item) {
        throw new NotFoundException(
          `Order item ${dto.orderItemId} not found on this order`,
        );
      }
    }

    // Scoped to the line when there is one, so a buyer can dispute a
    // damaged item and a missing item on the same order independently.
    const active = await this.disputesRepository.findActiveFor({
      sellerOrderId: dto.sellerOrderId,
      orderItemId: dto.orderItemId,
    });
    if (active) {
      throw new ConflictException(
        dto.orderItemId
          ? 'This item already has a dispute awaiting a decision'
          : 'This order already has a dispute awaiting a decision',
      );
    }

    const dispute = await this.disputesRepository.create({
      sellerOrderId: dto.sellerOrderId,
      orderItemId: dto.orderItemId,
      raisedById: caller.id,
      reason: dto.reason,
    });
    this.logger.log({
      event: 'dispute.raised',
      userId: caller.id,
      entityType: 'Dispute',
      entityId: dispute.id,
      sellerOrderId: dispute.sellerOrderId,
      orderItemId: dispute.orderItemId,
    });
    return dispute;
  }

  async listForAdmin(query: ListDisputesQuery): Promise<Paginated<Dispute>> {
    const { skip, take, page, limit } = toPageParams(query);
    const { items, total } = await this.disputesRepository.findMany({
      status: query.status,
      sellerOrderId: query.sellerOrderId,
      search: query.search,
      skip,
      take,
    });
    return { items, total, page, limit };
  }

  // The caller's own disputes. raisedById is applied AFTER the query, so
  // nothing a client sends can widen it to someone else's.
  async listOwn(
    caller: AuthenticatedUser,
    query: ListDisputesQuery,
  ): Promise<Paginated<Dispute>> {
    const { skip, take, page, limit } = toPageParams(query);
    const { items, total } = await this.disputesRepository.findMany({
      status: query.status,
      sellerOrderId: query.sellerOrderId,
      search: query.search,
      skip,
      take,
      raisedById: caller.id,
    });
    return { items, total, page, limit };
  }

  // Disputes raised against the caller's OWN shipments. The seller is
  // resolved from their approved profile, so a seller can never be
  // handed complaints about another seller's orders.
  async listForSeller(
    callerId: string,
    query: ListDisputesQuery,
  ): Promise<Paginated<Dispute>> {
    const profile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(callerId);
    const { skip, take, page, limit } = toPageParams(query);
    const { items, total } = await this.disputesRepository.findMany({
      status: query.status,
      search: query.search,
      skip,
      take,
      sellerId: profile.id,
    });
    return { items, total, page, limit };
  }

  // Three people may ever read or post to a dispute: the buyer who
  // raised it, any admin, and the SELLER whose shipment it is about — a
  // seller has to be able to see what was said about their own order,
  // and answer it, even though they didn't raise the case and aren't
  // ruling on it. Everyone else gets 404, never 403: confirming the id
  // exists would turn this into an existence oracle for other people's
  // orders.
  //
  // Always fetches WITH the order attached, even for callers who only
  // need the bare Dispute — the seller check needs sellerOrder.sellerId,
  // and a second query to re-fetch it would be pure waste.
  async findByIdWithOrderForCaller(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<DisputeWithOrderContext> {
    const dispute = await this.disputesRepository.findByIdWithOrder(id);
    if (!dispute) {
      throw new NotFoundException(`Dispute ${id} not found`);
    }
    if (caller.role === UserRole.ADMIN || dispute.raisedById === caller.id) {
      return dispute;
    }
    if (caller.role === UserRole.SELLER) {
      const profile = await this.sellersService.findByUserId(caller.id);
      if (profile?.id === dispute.sellerOrder.sellerId) {
        return dispute;
      }
    }
    throw new NotFoundException(`Dispute ${id} not found`);
  }

  private async findByIdForCaller(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<Dispute> {
    return this.findByIdWithOrderForCaller(id, caller);
  }

  // Admin-only (enforced by @Roles(ADMIN) on AdminController). Moves the
  // dispute along its lifecycle; the resolver is always the caller.
  async resolve(
    id: string,
    resolvedById: string,
    dto: ResolveDisputeDto,
  ): Promise<Dispute> {
    const dispute = await this.findById(id); // 404s if missing

    if (!isValidDisputeTransition(dispute.status, dto.status)) {
      throw new BadRequestException(
        `Cannot transition Dispute from ${dispute.status} to ${dto.status}`,
      );
    }
    if (requiresResolutionText(dto.status) && !dto.resolution?.trim()) {
      throw new BadRequestException(
        `A resolution is required when moving a dispute to ${dto.status}`,
      );
    }

    const updated = await this.disputesRepository.resolve(id, {
      status: dto.status,
      resolution: dto.resolution,
      resolvedById,
    });
    this.logger.log({
      event: 'dispute.resolved',
      userId: resolvedById,
      entityType: 'Dispute',
      entityId: updated.id,
      fromStatus: dispute.status,
      toStatus: updated.status,
    });
    return updated;
  }

  // Both sides of the conversation come through here — the buyer who
  // raised it and the admin handling it. findByIdForCaller is what makes
  // that safe: it 404s for anyone else, so a third party can neither read
  // the thread nor post to it.
  async listComments(
    disputeId: string,
    caller: AuthenticatedUser,
  ): Promise<DisputeComment[]> {
    await this.findByIdForCaller(disputeId, caller);
    return this.disputesRepository.findComments(disputeId);
  }

  async addComment(
    disputeId: string,
    caller: AuthenticatedUser,
    dto: AddDisputeCommentDto,
  ): Promise<DisputeComment> {
    const dispute = await this.findByIdForCaller(disputeId, caller);

    // A decided dispute is closed to new argument. Without this a buyer
    // could keep appending to a case nobody is reading any more, and the
    // thread would stop being a reliable record of what was considered
    // before the ruling.
    if (
      dispute.status === DisputeStatus.RESOLVED ||
      dispute.status === DisputeStatus.REJECTED
    ) {
      throw new ConflictException(
        `This dispute is already ${dispute.status.toLowerCase()} and can no longer be commented on`,
      );
    }

    const comment = await this.disputesRepository.addComment({
      disputeId,
      authorId: caller.id,
      body: dto.body,
    });
    this.logger.log({
      event: 'dispute.commented',
      userId: caller.id,
      entityType: 'DisputeComment',
      entityId: comment.id,
      disputeId,
    });
    return comment;
  }

  private async findById(id: string): Promise<Dispute> {
    const dispute = await this.disputesRepository.findById(id);
    if (!dispute) {
      throw new NotFoundException(`Dispute ${id} not found`);
    }
    return dispute;
  }
}

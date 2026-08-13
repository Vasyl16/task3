import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, type Dispute } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { OrdersService } from '../orders/orders.service';
import {
  DisputeListFilter,
  DisputesRepository,
} from './domain/disputes.repository';
import {
  isValidDisputeTransition,
  requiresResolutionText,
} from './domain/dispute-transitions';
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
  ) {}

  // The raiser is the authenticated caller, never a body field, and the
  // SellerOrder must be one they actually bought (404 otherwise).
  async raise(
    caller: AuthenticatedUser,
    dto: CreateDisputeDto,
  ): Promise<Dispute> {
    await this.ordersService.findSellerOrderAsBuyer(dto.sellerOrderId, caller);

    const active = await this.disputesRepository.findActiveForSellerOrder(
      dto.sellerOrderId,
    );
    if (active) {
      throw new ConflictException(
        'This order already has a dispute awaiting a decision',
      );
    }

    const dispute = await this.disputesRepository.create({
      sellerOrderId: dto.sellerOrderId,
      raisedById: caller.id,
      reason: dto.reason,
    });
    this.logger.log({
      event: 'dispute.raised',
      userId: caller.id,
      entityType: 'Dispute',
      entityId: dispute.id,
      sellerOrderId: dispute.sellerOrderId,
    });
    return dispute;
  }

  listForAdmin(filter: DisputeListFilter): Promise<Dispute[]> {
    return this.disputesRepository.findMany(filter);
  }

  listOwn(caller: AuthenticatedUser, filter: DisputeListFilter) {
    return this.disputesRepository.findMany({
      ...filter,
      raisedById: caller.id,
    });
  }

  async findByIdForCaller(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<Dispute> {
    const dispute = await this.findById(id);
    if (caller.role !== UserRole.ADMIN && dispute.raisedById !== caller.id) {
      throw new NotFoundException(`Dispute ${id} not found`);
    }
    return dispute;
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

  private async findById(id: string): Promise<Dispute> {
    const dispute = await this.disputesRepository.findById(id);
    if (!dispute) {
      throw new NotFoundException(`Dispute ${id} not found`);
    }
    return dispute;
  }
}

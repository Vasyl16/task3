import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { LedgerEntry, Refund } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { SellersService } from '../sellers/sellers.service';
import { PaymentsLedgerRepository } from './domain/payments-ledger.repository';
import { RequestRefundDto } from './dto/request-refund.dto';
import { ResolveRefundDto } from './dto/resolve-refund.dto';

@Injectable()
export class PaymentsLedgerService {
  constructor(
    private readonly paymentsLedgerRepository: PaymentsLedgerRepository,
    private readonly sellersService: SellersService,
    private readonly ordersService: OrdersService,
  ) {}

  async listLedgerForSeller(sellerId: string): Promise<LedgerEntry[]> {
    await this.sellersService.findById(sellerId); // 404s if missing
    return this.paymentsLedgerRepository.listLedgerForSeller(sellerId);
  }

  async requestRefund(dto: RequestRefundDto): Promise<Refund> {
    await this.ordersService.findSellerOrderById(dto.sellerOrderId); // 404s if missing
    return this.paymentsLedgerRepository.createRefundRequest(dto);
  }

  async findRefundById(id: string): Promise<Refund> {
    const refund = await this.paymentsLedgerRepository.findRefundById(id);
    if (!refund) {
      throw new NotFoundException(`Refund ${id} not found`);
    }
    return refund;
  }

  // Approving/processing a refund must reverse the sale in the ledger
  // (LedgerEntryType.REFUND), possibly trigger a real payment-gateway
  // refund, and update SellerOrder.status — atomically. Deliberately not
  // implemented here.
  async resolveRefund(id: string, _dto: ResolveRefundDto): Promise<Refund> {
    await this.findRefundById(id); // 404s if missing
    throw new NotImplementedException('PaymentsLedgerService.resolveRefund');
  }
}

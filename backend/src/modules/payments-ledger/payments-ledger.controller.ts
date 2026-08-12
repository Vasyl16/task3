import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PaymentsLedgerService } from './payments-ledger.service';
import { RequestRefundDto } from './dto/request-refund.dto';
import { ResolveRefundDto } from './dto/resolve-refund.dto';

// TODO(auth): ledger listing must be restricted to the owning seller (or
// ADMIN); resolveRefund must be restricted to the owning seller/ADMIN.
@Controller()
export class PaymentsLedgerController {
  constructor(private readonly paymentsLedgerService: PaymentsLedgerService) {}

  @Get('sellers/:sellerId/ledger')
  listLedgerForSeller(@Param('sellerId') sellerId: string) {
    return this.paymentsLedgerService.listLedgerForSeller(sellerId);
  }

  @Post('refunds')
  requestRefund(@Body() dto: RequestRefundDto) {
    return this.paymentsLedgerService.requestRefund(dto);
  }

  @Get('refunds/:id')
  findRefundById(@Param('id') id: string) {
    return this.paymentsLedgerService.findRefundById(id);
  }

  @Patch('refunds/:id/resolve')
  resolveRefund(@Param('id') id: string, @Body() dto: ResolveRefundDto) {
    return this.paymentsLedgerService.resolveRefund(id, dto);
  }
}

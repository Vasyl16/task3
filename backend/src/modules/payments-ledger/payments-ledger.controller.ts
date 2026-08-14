import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiAuth, ApiOwnership } from '../../core/openapi/api-auth.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { PaymentsLedgerService } from './payments-ledger.service';

// Money is the most sensitive surface in the app, so every route here
// takes the caller's identity and hands it to the service — a valid
// token is never on its own sufficient. Ownership (which seller's
// ledger, whose refund) is enforced in PaymentsLedgerService, the same
// place the rest of the app puts it.
@ApiTags('payments-ledger')
@Controller()
export class PaymentsLedgerController {
  constructor(private readonly paymentsLedgerService: PaymentsLedgerService) {}

  // A seller's revenue ledger is that seller's own business data. The
  // role gate keeps customers out entirely; the service then checks the
  // :sellerId is actually the caller's own profile, so one seller can't
  // read another's.
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @Get('sellers/:sellerId/ledger')
  @ApiAuth(UserRole.SELLER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'A seller’s revenue ledger (own, or ADMIN)',
    description:
      'Append-only double-entry-style records: SALE and COMMISSION on ' +
      'checkout, REFUND and ADJUSTMENT on cancellation. Entries are never ' +
      'mutated — a cancellation is recorded as reversing entries that net ' +
      'the original pair back to zero.',
  })
  @ApiResponse({
    status: 403,
    description: 'A seller may only read their own ledger.',
  })
  listLedgerForSeller(
    @Param('sellerId') sellerId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    return this.paymentsLedgerService.listLedgerForSeller(sellerId, caller);
  }

  // There is no "request a refund" endpoint — a Refund only ever exists
  // because the cancellation saga opened one (see
  // PaymentsLedgerService's "Refund saga" section). Getting money back
  // means getting the underlying SellerOrder cancelled — by the seller
  // pre-shipment, or by an ADMIN acting on a dispute ruling afterwards —
  // not requesting one directly.
  @Get('refunds/:id')
  @ApiAuth()
  @ApiOperation({
    summary: 'Get a refund',
    description:
      'Visible to the two parties it concerns — the buyer whose money it ' +
      'is and the seller whose sale it reverses — plus ADMIN. ' +
      '`status` walks REQUESTED → PROCESSED or FAILED; a FAILED refund ' +
      'has been escalated for a human to finish, and `failureReason` says ' +
      'why the provider declined it.',
  })
  @ApiOwnership('Refund')
  findRefundById(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    return this.paymentsLedgerService.findRefundByIdForCaller(id, caller);
  }
}

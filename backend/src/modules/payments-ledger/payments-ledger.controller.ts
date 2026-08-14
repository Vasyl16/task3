import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiAuth, ApiOwnership } from '../../core/openapi/api-auth.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { PaymentsLedgerService } from './payments-ledger.service';
import { RequestRefundDto } from './dto/request-refund.dto';
import { ResolveRefundDto } from './dto/resolve-refund.dto';

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

  // The requester is the authenticated caller, never a body field, and
  // the SellerOrder must be one they actually bought.
  @Post('refunds')
  @ApiAuth()
  @ApiOperation({
    summary: 'Request a refund on your own order',
    description:
      'The requester is the authenticated caller — RequestRefundDto has no ' +
      'requestedById field, and sending one is rejected. Distinct from the ' +
      'refund the system opens for itself when a seller cancels, which ' +
      'runs as a saga and needs no request.',
  })
  @ApiOwnership('SellerOrder')
  requestRefund(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: RequestRefundDto,
  ) {
    return this.paymentsLedgerService.requestRefund(caller, dto);
  }

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

  // Deciding a refund is a platform judgement call, not a party to the
  // transaction's — neither the seller who owes the money nor the buyer
  // who wants it may resolve their own case.
  @Roles(UserRole.ADMIN)
  @Patch('refunds/:id/resolve')
  @ApiAuth(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Resolve a refund (ADMIN) — not implemented',
    description:
      'Returns 501. Resolving a refund has to reverse the ledger, move ' +
      'money at the provider, and update the SellerOrder atomically; the ' +
      'authorization is wired but the operation itself is deliberately ' +
      'left unimplemented rather than half-done.',
  })
  @ApiResponse({ status: 501, description: 'Not implemented.' })
  resolveRefund(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: ResolveRefundDto,
  ) {
    return this.paymentsLedgerService.resolveRefund(id, caller, dto);
  }
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ListDisputesQuery } from './dto/list-disputes.query';

// Customer-facing half of disputes. The admin half (queue + rulings)
// lives on AdminController, behind a class-level @Roles(ADMIN) — see
// modules/admin/admin.controller.ts.
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  raise(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDisputeDto) {
    return this.disputesService.raise(user, dto);
  }

  // Scoped to the caller by the service — there is deliberately no
  // "list all disputes" for a non-admin, and no raisedById query param
  // that could be pointed at someone else.
  @Get()
  listOwn(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDisputesQuery,
  ) {
    return this.disputesService.listOwn(user, query);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.disputesService.findByIdForCaller(id, user);
  }
}

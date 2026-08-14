import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { DisputesService } from './disputes.service';
import { AddDisputeCommentDto } from './dto/add-dispute-comment.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ListDisputesQuery } from './dto/list-disputes.query';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

// Customer-facing half of disputes. The admin half (queue + rulings)
// lives on AdminController, behind a class-level @Roles(ADMIN) — see
// modules/admin/admin.controller.ts.
@ApiTags('disputes')
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

  // Returns the disputed purchase alongside the dispute — which line,
  // which product, what was paid. Serves the buyer's own view and the
  // admin queue from one endpoint, because both need exactly this and
  // the access rule is identical.
  @Get(':id')
  @ApiOperation({
    summary: 'Get a dispute, with the purchase it is about',
    description:
      'Visible to the buyer who raised it and to any admin; 404 for ' +
      'anyone else, so a dispute id cannot be used to read a stranger’s ' +
      'order.',
  })
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.disputesService.findByIdWithOrderForCaller(id, user);
  }

  // Shared with ADMIN rather than duplicated on AdminController: this is
  // one conversation, and giving each side its own endpoint would mean
  // two implementations of the same access rule. The service resolves
  // who may see the thread (the raiser, or any admin) — see
  // DisputesService.listComments.
  @Get(':id/comments')
  @ApiOperation({
    summary: 'Read the dispute thread',
    description:
      'Oldest first — it reads as a conversation. Visible to the buyer ' +
      'who raised the dispute and to any admin; 404 for anyone else.',
  })
  @ApiOkResponse({ description: 'Comments, oldest first.' })
  listComments(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disputesService.listComments(id, user);
  }

  @Post(':id/comments')
  @ApiOperation({
    summary: 'Reply on a dispute',
    description:
      'Both the buyer and the handling admin post here. Closed once the ' +
      'dispute is RESOLVED or REJECTED, so the thread stays a record of ' +
      'what was actually considered before the ruling.',
  })
  @ApiCreatedResponse({ description: 'Comment appended.' })
  @ApiResponse({
    status: 409,
    description: 'The dispute has already been decided.',
  })
  addComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddDisputeCommentDto,
  ) {
    return this.disputesService.addComment(id, user, dto);
  }
}

import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { NotificationsService } from './notifications.service';

// userId always comes from @CurrentUser(), never a request param — a
// notification list is inherently the caller's own.
//
// TODO: markRead doesn't yet verify the notification belongs to the
// caller — needs an ownership check once cross-user access is a real
// risk to close (today notification ids aren't guessable/exposed to
// other users anywhere, but that's not a substitute for an explicit
// check).
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findForUser(
    @CurrentUser() user: AuthenticatedUser,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.findForUser(user.id, {
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}

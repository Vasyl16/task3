import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

// TODO(auth): userId should come from the authenticated caller, not a
// path param.
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get(':userId')
  findForUser(
    @Param('userId') userId: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.findForUser(userId, {
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}

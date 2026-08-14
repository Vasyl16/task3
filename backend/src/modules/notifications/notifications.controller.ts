import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { NotificationsService } from './notifications.service';
import { ApiTags } from '@nestjs/swagger';

// userId always comes from @CurrentUser(), never a request param — a
// notification list is inherently the caller's own, and markRead is
// scoped to the caller inside the service.
@ApiTags('notifications')
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
  markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(id, user.id);
  }
}

import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './domain/notifications.repository';
import { PrismaNotificationsRepository } from './infrastructure/prisma-notifications.repository';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NotificationsRepository,
      useClass: PrismaNotificationsRepository,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

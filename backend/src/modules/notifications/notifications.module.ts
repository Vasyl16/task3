import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './domain/notifications.repository';
import { PrismaNotificationsRepository } from './infrastructure/prisma-notifications.repository';
import { NotificationsConsumer } from './consumers/notifications.consumer';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.NOTIFICATIONS }),
    IdempotencyModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NotificationsRepository,
      useClass: PrismaNotificationsRepository,
    },
    NotificationsConsumer,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

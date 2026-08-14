import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { EmailService } from './email.service';
import { EmailConsumer } from './consumers/email.consumer';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.EMAIL }),
    IdempotencyModule,
  ],
  providers: [EmailService, EmailConsumer],
})
export class EmailModule {}

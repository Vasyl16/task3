import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { OutboxService } from './outbox.service';
import { OutboxPublisherService } from './outbox-publisher.service';

// Not global — imported explicitly by any module whose service publishes
// domain events (products, orders, bidding, ...), so the dependency is
// visible in that module's imports array. OutboxPublisherService (the
// claim-and-publish worker) is provided here too — NestJS only
// instantiates it once app-wide no matter how many modules import this.
@Module({
  imports: [QueueModule],
  providers: [OutboxService, OutboxPublisherService],
  exports: [OutboxService],
})
export class OutboxModule {}

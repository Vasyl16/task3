import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

// Not global — imported explicitly by any module whose service publishes
// domain events (products, orders, bidding, ...), so the dependency is
// visible in that module's imports array.
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}

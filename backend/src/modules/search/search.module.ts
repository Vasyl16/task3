import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MeilisearchModule } from '../../infrastructure/meilisearch/meilisearch.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchSyncConsumer } from './consumers/search-sync.consumer';

@Module({
  imports: [
    // Registers this module's access to the search-sync queue so
    // SearchSyncConsumer's @Processor can bind to it — the connection
    // itself (BullModule.forRootAsync) is configured once, in
    // QueueModule (see AppModule).
    BullModule.registerQueue({ name: QueueName.SEARCH_SYNC }),
    MeilisearchModule,
    IdempotencyModule,
  ],
  controllers: [SearchController],
  providers: [SearchService, SearchSyncConsumer],
})
export class SearchModule {}

import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// Not @Global() — imported explicitly by any module whose reads it
// caches (ProductsModule first), same convention as OutboxModule and
// QueueModule.
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}

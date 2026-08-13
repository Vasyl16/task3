import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../../config/configuration';
import { ALL_QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';

// One shared Redis connection for every queue in the app. BullMQ workers
// require maxRetriesPerRequest: null (they manage their own blocking
// reads); sharing one connection instance also means a Redis outage is
// one thing to reason about, not five independent ones.
//
// Not @Global() — imported explicitly wherever it's needed (OutboxModule
// as a producer, SearchModule as a consumer, ...), same convention as
// OutboxModule/PrismaModule, so the dependency is visible in each
// module's imports array. NestJS still only instantiates this module
// (and therefore the Redis connection + BullMQ root config) once, no
// matter how many modules import it.
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: new Redis(config.get('redis.url', { infer: true }), {
          maxRetriesPerRequest: null,
        }),
      }),
    }),
    BullModule.registerQueue(...ALL_QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}

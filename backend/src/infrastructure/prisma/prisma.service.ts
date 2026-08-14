import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // Prisma 7 requires an explicit driver adapter — it no longer reads
  // DATABASE_URL on its own at runtime. pg (node-postgres) is the right
  // choice for a long-lived server process; @prisma/adapter-neon exists
  // for edge/serverless instead.
  constructor(configService: ConfigService<AppConfig, true>) {
    const connectionString = configService.get('database.url', {
      infer: true,
    });
    if (!connectionString) {
      throw new Error('DATABASE_URL is required but was not resolved');
    }
    // Pool size is configurable because the right value depends on
    // round-trip latency, and this project's PostgreSQL is remote. Every
    // interactive $transaction (checkout, bid placement) holds a
    // connection for its whole duration, so the pool — not CPU — is what
    // caps concurrent writes: past `max` simultaneous transactions,
    // further ones wait and then fail with "Unable to start a
    // transaction in the given time". Load testing put a number on it —
    // see the load-test section of ../../../../README.md.
    super({
      adapter: new PrismaPg({
        connectionString,
        max: configService.get('database.poolMax', { infer: true }),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

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
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

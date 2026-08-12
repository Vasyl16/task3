import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// PrismaService is injected via the global PrismaModule — no import needed.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}

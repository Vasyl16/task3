import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../core/auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

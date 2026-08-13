import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../core/auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

// @Public() because Prometheus scrapes this unauthenticated — it has no
// JWT to present. That is the standard arrangement, and safe only
// because the endpoint exposes aggregate counters, never per-user data:
// nothing here is labelled with a user id, email, or order id (see
// MetricsService — every label is a bounded, non-identifying dimension).
// In a real deployment this port would additionally not be exposed
// publicly; treat that as an infrastructure concern, not an app one.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.render());
  }
}
